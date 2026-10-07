package server

import (
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
)

// openBrowser opens a page in the default browser. Tests replace it.
var openBrowser = func(u string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", u)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	default:
		cmd = exec.Command("xdg-open", u)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

// outsideLink checks that a link may be opened in the browser from the app
// window. Only https pages on a few known sites are allowed.
func outsideLink(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.Opaque != "" {
		return "", false
	}
	host := strings.ToLower(u.Hostname())
	switch {
	case host == "faceit.com", strings.HasSuffix(host, ".faceit.com"):
	case host == "github.com", host == "developer.microsoft.com":
	default:
		return "", false
	}
	return u.String(), true
}

// openLink opens an outside link in the user's own browser, where they are
// logged in, instead of inside the app window.
func (s *Server) openLink(w http.ResponseWriter, r *http.Request) {
	// A JSON body cannot be sent by a plain form on another site.
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		writeError(w, http.StatusBadRequest, errors.New("expected JSON"))
		return
	}
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	link, ok := outsideLink(req.URL)
	if !ok {
		writeError(w, http.StatusBadRequest, errors.New("this link cannot be opened"))
		return
	}
	if err := openBrowser(link); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
