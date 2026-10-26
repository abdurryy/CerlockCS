package server

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

// Exports are files the web app makes, like the scouting videos. They are
// saved in one folder on disk in a tidy layout, for example
// e-maniacs/mirage/ct/eco-rounds.mp4, instead of one browser download per
// file.

// exportPart is one folder or file name: lower case, digits, - and _.
var exportPart = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

// exportTypes are the files that can be saved, with their extension.
var exportTypes = map[string]string{
	"video/mp4":  ".mp4",
	"video/webm": ".webm",
	"image/png":  ".png",
}

const maxExport = 2 << 30

// openFolder shows a folder in the file manager. Tests replace it.
var openFolder = func(dir string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", dir)
	case "windows":
		cmd = exec.Command("explorer", dir)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

func (s *Server) exportDir() string {
	if s.cfg.ExportDir != "" {
		return s.cfg.ExportDir
	}
	return filepath.Join(s.cfg.DataDir, "exports")
}

// exportPath checks a relative path like "team/mirage/ct/eco-rounds.mp4"
// and returns it inside base. With file set the last part has an
// extension, which the caller checks.
func exportPath(base, rel string, file bool) (string, bool) {
	if rel == "" {
		return base, !file
	}
	parts := strings.Split(rel, "/")
	if len(parts) > 6 {
		return "", false
	}
	for i, p := range parts {
		if file && i == len(parts)-1 {
			p = strings.TrimSuffix(p, path.Ext(p))
		}
		if !exportPart.MatchString(p) {
			return "", false
		}
	}
	return filepath.Join(append([]string{base}, parts...)...), true
}

// exportInfo says where exports go.
func (s *Server) exportInfo(w http.ResponseWriter, r *http.Request) {
	if !sameSite(r) {
		writeError(w, http.StatusForbidden, errors.New("requests from other sites are not allowed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"dir": s.exportDir()})
}

// saveExport writes the request body to the path in ?path=. Only video
// and PNG bodies are taken: a form on another site cannot send those
// types, and a script there would need a CORS answer it never gets.
func (s *Server) saveExport(w http.ResponseWriter, r *http.Request) {
	if !sameSite(r) {
		writeError(w, http.StatusForbidden, errors.New("requests from other sites are not allowed"))
		return
	}
	mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	ext, ok := exportTypes[mt]
	if !ok {
		writeError(w, http.StatusUnsupportedMediaType, errors.New("only mp4, webm and png files can be saved"))
		return
	}
	rel := r.URL.Query().Get("path")
	dst, ok := exportPath(s.exportDir(), rel, true)
	if !ok || path.Ext(rel) != ext {
		writeError(w, http.StatusBadRequest, errors.New("bad file name"))
		return
	}
	dir := filepath.Dir(dst)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	tmp, err := os.CreateTemp(dir, ".cerlock-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	n, err := io.Copy(tmp, http.MaxBytesReader(w, r.Body, maxExport))
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), dst)
	}
	if err != nil {
		os.Remove(tmp.Name())
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": dst, "size": n})
}

// openExport shows an export folder, the top one when path is empty.
func (s *Server) openExport(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		writeError(w, http.StatusBadRequest, errors.New("expected JSON"))
		return
	}
	if !readJSON(w, r, &body) {
		return
	}
	dir, ok := exportPath(s.exportDir(), body.Path, false)
	if !ok {
		writeError(w, http.StatusBadRequest, errors.New("bad folder name"))
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if err := openFolder(dir); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
