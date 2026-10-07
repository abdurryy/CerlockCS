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

	"github.com/abdurryy/CerlockCS/internal/faceit"
)

// settingsFile is stored as <data>/settings.json. It holds the FACEIT key,
// so only the owner may read it.
type settingsFile struct {
	FaceitKey string `json:"faceitKey,omitempty"`
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
	st.mu.Lock()
	defer st.mu.Unlock()
	next := st.data
	next.FaceitKey = key
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
}

func (s *Server) settingsView() settingsView {
	k := s.faceitKey()
	return settingsView{FaceitKey: k != "", FaceitKeyHint: keyHint(k)}
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

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, s.settingsView())
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FaceitKey *string `json:"faceitKey"`
	}
	if !readJSON(w, r, &body) {
		return
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
