package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/abdurryy/CerlockCS/internal/ai"
	"github.com/abdurryy/CerlockCS/internal/faceit"
)

// settingsFile is stored as <data>/settings.json. It holds the FACEIT key
// and the keys for writing the game plan, so only the owner may read it.
type settingsFile struct {
	FaceitKey string `json:"faceitKey,omitempty"`
	// The model that writes the game plan up: the provider, the model, a
	// key per provider and Ollama's address.
	AIProvider string            `json:"aiProvider,omitempty"`
	AIModel    string            `json:"aiModel,omitempty"`
	AIKeys     map[string]string `json:"aiKeys,omitempty"`
	AIURL      string            `json:"aiUrl,omitempty"`
}

type settingsStore struct {
	path string
	mu   sync.Mutex
	data settingsFile
}

func openSettings(path string) *settingsStore {
	st := &settingsStore{path: path}
	b, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("could not read the settings: %v", err)
		}
		return st
	}
	if err := json.Unmarshal(b, &st.data); err != nil {
		log.Printf("the settings file is broken, starting without it")
		st.data = settingsFile{}
	}
	// A file edited by hand may have been saved readable for everyone.
	os.Chmod(path, 0o600)
	return st
}

func (st *settingsStore) faceitKey() string {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.data.FaceitKey
}

func (st *settingsStore) setFaceitKey(key string) error {
	return st.update(func(d *settingsFile) { d.FaceitKey = key })
}

func (st *settingsStore) get() settingsFile {
	st.mu.Lock()
	defer st.mu.Unlock()
	d := st.data
	d.AIKeys = make(map[string]string, len(st.data.AIKeys))
	for k, v := range st.data.AIKeys {
		d.AIKeys[k] = v
	}
	return d
}

// update changes a copy of the settings and saves it.
func (st *settingsStore) update(change func(*settingsFile)) error {
	st.mu.Lock()
	defer st.mu.Unlock()
	next := st.data
	next.AIKeys = make(map[string]string, len(st.data.AIKeys))
	for k, v := range st.data.AIKeys {
		next.AIKeys[k] = v
	}
	change(&next)
	if len(next.AIKeys) == 0 {
		next.AIKeys = nil
	}
	if err := st.write(next); err != nil {
		return err
	}
	st.data = next
	return nil
}

// write replaces the file in one step so a crash never leaves half a file.
func (st *settingsStore) write(data settingsFile) error {
	dir := filepath.Dir(st.path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".settings-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil && !errors.Is(err, errors.ErrUnsupported) {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), st.path); err != nil {
		return err
	}
	return os.Chmod(st.path, 0o600)
}

// faceitKey returns the key saved in the settings, or the one from the
// command line or environment.
func (s *Server) faceitKey() string {
	if k := s.settings.faceitKey(); k != "" {
		return k
	}
	return s.cfg.FaceitKey
}

type settingsView struct {
	FaceitKey     bool   `json:"faceitKey"`
	FaceitKeyHint string `json:"faceitKeyHint"`
	AI            aiView `json:"ai"`
}

// aiView says which keys are saved, never the keys.
type aiView struct {
	Provider  string             `json:"provider"`
	Model     string             `json:"model"`
	URL       string             `json:"url"`
	Keys      map[string]keyInfo `json:"keys"`
	Providers []ai.Provider      `json:"providers"`
}

type keyInfo struct {
	Saved bool   `json:"saved"`
	Hint  string `json:"hint"`
}

func (s *Server) settingsView() settingsView {
	k := s.faceitKey()
	d := s.settings.get()
	keys := map[string]keyInfo{}
	for _, p := range ai.Providers {
		if p.NeedsKey {
			v := d.AIKeys[p.ID]
			keys[p.ID] = keyInfo{Saved: v != "", Hint: keyHint(v)}
		}
	}
	view := aiView{Provider: d.AIProvider, Model: d.AIModel, URL: d.AIURL, Keys: keys, Providers: ai.Providers}
	return settingsView{FaceitKey: k != "", FaceitKeyHint: keyHint(k), AI: view}
}

// keyHint shows the last four characters so the user can tell keys apart.
// Short keys get no hint at all.
func keyHint(k string) string {
	if len(k) < 16 {
		return ""
	}
	return "..." + k[len(k)-4:]
}

var validKey = regexp.MustCompile(`^[\x21-\x7e]{8,200}$`)

var validModel = regexp.MustCompile(`^[A-Za-z0-9._:/@+-]{1,120}$`)

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, s.settingsView())
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FaceitKey *string `json:"faceitKey"`
		AI        *struct {
			Provider *string `json:"provider"`
			Model    *string `json:"model"`
			URL      *string `json:"url"`
			// Key is for the provider in the same request, or the saved one.
			Key *string `json:"key"`
		} `json:"ai"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if a := body.AI; a != nil {
		cur := s.settings.get()
		provider := cur.AIProvider
		if a.Provider != nil {
			provider = strings.TrimSpace(*a.Provider)
			if _, ok := ai.ProviderByID(provider); provider != "" && !ok {
				codeError(w, http.StatusBadRequest, faceit.CodeBadRequest, "Pick one of the listed providers")
				return
			}
		}
		model, url, key := cur.AIModel, cur.AIURL, ""
		if a.Model != nil {
			model = strings.TrimSpace(*a.Model)
			if model != "" && !validModel.MatchString(model) {
				codeError(w, http.StatusBadRequest, faceit.CodeBadRequest, "That does not look like a model name")
				return
			}
		}
		if a.URL != nil {
			url = strings.TrimSpace(*a.URL)
			if url != "" && !ai.ValidURL(url) {
				codeError(w, http.StatusBadRequest, faceit.CodeBadRequest, "The address has to start with http:// or https://")
				return
			}
		}
		if a.Key != nil {
			key = strings.TrimSpace(*a.Key)
			if key != "" && !validKey.MatchString(key) {
				codeError(w, http.StatusBadRequest, ai.CodeBadKey, "That does not look like a key")
				return
			}
			if p, ok := ai.ProviderByID(provider); !ok || !p.NeedsKey {
				codeError(w, http.StatusBadRequest, faceit.CodeBadRequest, "This provider does not use a key")
				return
			}
		}
		err := s.settings.update(func(d *settingsFile) {
			d.AIProvider, d.AIModel, d.AIURL = provider, model, url
			if a.Key != nil {
				if key == "" {
					delete(d.AIKeys, provider)
				} else {
					d.AIKeys[provider] = key
				}
			}
		})
		if err != nil {
			log.Printf("could not save the settings: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not save the settings"})
			return
		}
	}
	if body.FaceitKey != nil {
		key := strings.TrimSpace(*body.FaceitKey)
		if key != "" && !validKey.MatchString(key) {
			codeError(w, http.StatusBadRequest, faceit.CodeBadRequest, "That does not look like a FACEIT API key")
			return
		}
		if key != "" {
			ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			err := s.faceit.WithKey(key).Check(ctx)
			cancel()
			// Only a clear no from FACEIT stops the key from being saved,
			// the app may just be offline right now.
			if faceit.Code(err) == faceit.CodeBadKey {
				codeError(w, http.StatusBadRequest, faceit.CodeBadKey, "FACEIT did not accept this key")
				return
			}
		}
		if err := s.settings.setFaceitKey(key); err != nil {
			log.Printf("could not save the settings: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not save the settings"})
			return
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, s.settingsView())
}
