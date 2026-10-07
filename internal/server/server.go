// Package server serves the web viewer, the replay library and map assets.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/abdurryy/CerlockCS/internal/faceit"
	"github.com/abdurryy/CerlockCS/internal/icons"
	"github.com/abdurryy/CerlockCS/internal/maps"
	"github.com/abdurryy/CerlockCS/internal/pipeline"
)

type Config struct {
	Addr     string
	DataDir  string
	DemoDirs []string
	// Watch parses new demos in DemoDirs in the background.
	Watch          bool
	Offline        bool
	Workers        int
	SampleInterval int
	MaxUpload      int64
	// Static holds the built web app.
	Static fs.FS
	// FaceitKey is used when no key is saved in the settings.
	FaceitKey string
	// FaceitAPI and FaceitDownloadAPI replace the FACEIT base URLs, tests
	// point them at a fake. Empty means CERLOCK_FACEIT_API and
	// CERLOCK_FACEIT_DOWNLOAD_API, or the real FACEIT.
	FaceitAPI         string
	FaceitDownloadAPI string
	// DownloadsDir is watched for FACEIT demos downloaded in the browser,
	// empty turns it off.
	DownloadsDir string
}

type Server struct {
	cfg      Config
	lib      *Library
	maps     *maps.Store
	icons    *icons.Store
	settings *settingsStore
	faceit   *faceit.Client
	dl       *downloader
}

func New(cfg Config) (*Server, error) {
	if cfg.MaxUpload == 0 {
		cfg.MaxUpload = 4 << 30
	}
	lib, err := OpenLibrary(filepath.Join(cfg.DataDir, "replays"), cfg.Workers, cfg.SampleInterval)
	if err != nil {
		return nil, err
	}
	ms := maps.NewStore(filepath.Join(cfg.DataDir, "maps"))
	ms.Offline = cfg.Offline
	is := icons.NewStore(filepath.Join(cfg.DataDir, "icons"))
	is.Offline = cfg.Offline
	if cfg.FaceitAPI == "" {
		cfg.FaceitAPI = os.Getenv("CERLOCK_FACEIT_API")
	}
	if cfg.FaceitDownloadAPI == "" {
		cfg.FaceitDownloadAPI = os.Getenv("CERLOCK_FACEIT_DOWNLOAD_API")
	}
	s := &Server{cfg: cfg, lib: lib, maps: ms, icons: is}
	s.settings = openSettings(filepath.Join(cfg.DataDir, "settings.json"))
	s.faceit = faceit.New(cfg.FaceitAPI, cfg.FaceitDownloadAPI, s.faceitKey)
	s.dl = newDownloader(filepath.Join(cfg.DataDir, "demos", "faceit"), lib, s.faceit, cfg.MaxUpload)
	return s, nil
}

var validID = regexp.MustCompile(`^[0-9a-f]{20}$`)

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/replays", s.listReplays)
	mux.HandleFunc("GET /api/replays/{id}", s.getReplay)
	mux.HandleFunc("GET /api/replays/{id}/info", s.getEntry)
	mux.HandleFunc("DELETE /api/replays/{id}", s.deleteReplay)
	mux.HandleFunc("POST /api/upload", s.upload)
	mux.HandleFunc("GET /api/library", s.library)
	mux.HandleFunc("POST /api/library/parse", s.parseLocal)
	mux.HandleFunc("GET /api/maps/{name}", s.mapInfo)
	mux.HandleFunc("GET /api/icons", s.iconList)
	mux.HandleFunc("GET /api/icons/{group}/{file}", s.icon)
	mux.HandleFunc("POST /api/open", s.openLink)
	mux.HandleFunc("GET /api/settings", s.getSettings)
	mux.HandleFunc("PUT /api/settings", s.putSettings)
	mux.HandleFunc("POST /api/scout/match", s.scoutMatch)
	mux.HandleFunc("POST /api/scout/find", s.scoutFind)
	mux.HandleFunc("POST /api/scout/download", s.scoutDownload)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	mux.Handle("/", s.static())
	return logRequests(mux)
}

func (s *Server) Run(ctx context.Context) error {
	srv := &http.Server{
		Addr:              s.cfg.Addr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	if s.cfg.Watch && (len(s.cfg.DemoDirs) > 0 || s.cfg.DownloadsDir != "") {
		go s.watch(ctx)
	}
	// Fetch missing icons right away so the first replay has them.
	go s.icons.Available()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	err := srv.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// watch looks for new demos every few seconds so they are ready before
// anyone opens them.
func (s *Server) watch(ctx context.Context) {
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		s.lib.Scan(s.cfg.DemoDirs, true)
		if s.cfg.DownloadsDir != "" {
			s.lib.ScanDownloads(s.cfg.DownloadsDir, 30*24*time.Hour)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *Server) listReplays(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"replays": s.lib.Entries(),
		"jobs":    s.lib.Jobs(),
	})
}

func (s *Server) getEntry(w http.ResponseWriter, r *http.Request) {
	e, ok := s.lib.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("replay not found"))
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) getReplay(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID.MatchString(id) {
		writeError(w, http.StatusBadRequest, errors.New("bad id"))
		return
	}
	if _, ok := s.lib.Get(id); !ok {
		writeError(w, http.StatusNotFound, errors.New("replay not found"))
		return
	}
	f, err := os.Open(s.lib.replayPath(id))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	defer f.Close()
	st, _ := f.Stat()
	// Replays are stored gzipped, every browser can inflate them natively.
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", st.ModTime(), f)
}

func (s *Server) deleteReplay(w http.ResponseWriter, r *http.Request) {
	if err := s.lib.Delete(r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// upload parses the demo while it is still being received, so for most
// demos the replay is ready as soon as the last byte arrives.
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.URL.Query().Get("name"))
	if name == "." || name == "/" || name == "" {
		name = "demo.dem"
	}
	body := http.MaxBytesReader(w, r.Body, s.cfg.MaxUpload)
	head, rd, err := readHead(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	size := r.ContentLength
	if size < 0 {
		writeError(w, http.StatusLengthRequired, errors.New("Content-Length is required"))
		return
	}
	id := pipeline.Fingerprint(size, head)
	if e, ok := s.lib.Get(id); ok {
		writeJSON(w, http.StatusOK, e)
		return
	}
	job := &Job{ID: id, Name: name, Status: "parsing"}
	if !s.lib.claim(job) {
		writeError(w, http.StatusConflict, errors.New("this demo is already being parsed"))
		return
	}
	e, err := s.lib.Process(job, rd, size)
	if err != nil {
		s.lib.mu.Lock()
		delete(s.lib.jobs, id)
		s.lib.mu.Unlock()
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	// Drain anything the parser did not need so the client sees a clean
	// response instead of a reset connection.
	io.Copy(io.Discard, body)
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) library(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"dirs":  s.cfg.DemoDirs,
		"demos": s.lib.Scan(s.cfg.DemoDirs, false),
	})
}

func (s *Server) parseLocal(w http.ResponseWriter, r *http.Request) {
	p := filepath.Clean(r.URL.Query().Get("path"))
	allowed := false
	for _, dir := range s.cfg.DemoDirs {
		rel, err := filepath.Rel(filepath.Clean(dir), p)
		if err == nil && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel) {
			allowed = true
		}
	}
	if !allowed || !isDemoFile(p) {
		writeError(w, http.StatusForbidden, errors.New("path is not inside a demo folder"))
		return
	}
	if err := s.lib.Enqueue(p); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) mapInfo(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if strings.HasSuffix(name, ".png") {
		p, ok := s.maps.ImagePath(name)
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFile(w, r, p)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	info, err := s.maps.Info(ctx, name)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) iconList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, map[string]any{"icons": s.icons.Available()})
}

func (s *Server) icon(w http.ResponseWriter, r *http.Request) {
	name, ok := strings.CutSuffix(r.PathValue("group")+"/"+r.PathValue("file"), ".svg")
	p, valid := s.icons.Path(name)
	if !ok || !valid {
		http.NotFound(w, r)
		return
	}
	b, err := os.ReadFile(p)
	if err != nil || icons.Check(b) != nil {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "image/svg+xml")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "public, max-age=604800")
	w.Write(b)
}

// static serves the single page app and falls back to index.html for client
// side routes.
func (s *Server) static() http.Handler {
	if s.cfg.Static == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "web app not built, run: make web", http.StatusNotFound)
		})
	}
	files := http.FileServerFS(s.cfg.Static)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(s.cfg.Static, p); err != nil {
			r.URL.Path = "/"
		} else if strings.HasPrefix(p, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(sw, r)
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/replays" && r.URL.Path != "/api/library" {
			log.Printf("%s %s %d %s", r.Method, r.URL.Path, sw.status, time.Since(start).Round(time.Millisecond))
		}
	})
}
