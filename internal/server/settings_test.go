package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const goodKey = "8c2d4e6f-1a3b-4c5d-9e7f-0a1b2c3d3f9a"

// fakeFaceit accepts goodKey on every route given and 401 for other keys.
func fakeFaceit(t *testing.T, routes map[string]http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cdn := strings.HasPrefix(r.URL.Path, "/cdn/")
		if cdn && r.Header.Get("Authorization") != "" {
			t.Errorf("key sent to %s", r.URL.Path)
		}
		if !cdn && r.Header.Get("Authorization") != "Bearer "+goodKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if h, ok := routes[r.URL.Path]; ok {
			h(w, r)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func serveJSON(v any) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(v)
	}
}

func newFaceitServer(t *testing.T, dataDir, api, envKey string) (*Server, http.Handler) {
	t.Helper()
	s, err := New(Config{
		DataDir:           dataDir,
		Offline:           true,
		Workers:           1,
		FaceitKey:         envKey,
		FaceitAPI:         api + "/data/v4",
		FaceitDownloadAPI: api + "/download/v2",
	})
	if err != nil {
		t.Fatal(err)
	}
	return s, s.Handler()
}

func send(h http.Handler, method, url, body string, header ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func readSettings(t *testing.T, rec *httptest.ResponseRecorder) settingsView {
	t.Helper()
	var v settingsView
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("body %s", rec.Body.String())
	}
	return v
}

func errorCode(rec *httptest.ResponseRecorder) string {
	var body struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Error == "" {
		return ""
	}
	return body.Code
}

func TestSettingsSaveKey(t *testing.T) {
	fake := fakeFaceit(t, map[string]http.HandlerFunc{"/data/v4/games/cs2": serveJSON(map[string]any{"game_id": "cs2"})})
	dir := t.TempDir()
	_, h := newFaceitServer(t, dir, fake.URL, "")

	if v := readSettings(t, send(h, "GET", "/api/settings", "")); v.FaceitKey || v.FaceitKeyHint != "" {
		t.Fatalf("fresh settings %+v", v)
	}
	rec := send(h, "PUT", "/api/settings", `{"faceitKey":"  `+goodKey+` "}`)
	if rec.Code != 200 || strings.Contains(rec.Body.String(), goodKey) {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if v := readSettings(t, rec); !v.FaceitKey || v.FaceitKeyHint != "...3f9a" {
		t.Fatalf("saved %+v", v)
	}
	if body := send(h, "GET", "/api/settings", "").Body.String(); strings.Contains(body, goodKey) {
		t.Fatal("key sent back to the browser")
	}

	path := filepath.Join(dir, "settings.json")
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && st.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", st.Mode().Perm())
	}

	// A new server on the same data folder still has it.
	_, h2 := newFaceitServer(t, dir, fake.URL, "")
	if v := readSettings(t, send(h2, "GET", "/api/settings", "")); !v.FaceitKey {
		t.Fatal("key not loaded on start")
	}

	// Clearing falls back to the key from the command line.
	_, h3 := newFaceitServer(t, dir, fake.URL, "env-key-0000-1111-2222-abcd")
	if v := readSettings(t, send(h3, "PUT", "/api/settings", `{"faceitKey":""}`)); !v.FaceitKey || v.FaceitKeyHint != "...abcd" {
		t.Fatalf("after clear %+v", v)
	}
	b, _ := os.ReadFile(path)
	if strings.Contains(string(b), goodKey) {
		t.Fatal("key still in the settings file")
	}
}

func TestSettingsRejectedKey(t *testing.T) {
	fake := fakeFaceit(t, map[string]http.HandlerFunc{"/data/v4/games/cs2": serveJSON(map[string]any{})})
	dir := t.TempDir()
	_, h := newFaceitServer(t, dir, fake.URL, "")
	rec := send(h, "PUT", "/api/settings", `{"faceitKey":"11111111-2222-3333-4444-555555555555"}`)
	if rec.Code != 400 || errorCode(rec) != "bad_key" || strings.Contains(rec.Body.String(), "5555") {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "settings.json")); err == nil {
		t.Fatal("rejected key was saved")
	}
	rec = send(h, "PUT", "/api/settings", `{"faceitKey":"has a space in it"}`)
	if rec.Code != 400 || errorCode(rec) != "bad_request" {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestSettingsSavedWhenOffline(t *testing.T) {
	down := httptest.NewServer(http.NotFoundHandler())
	down.Close()
	_, h := newFaceitServer(t, t.TempDir(), down.URL, "")
	rec := send(h, "PUT", "/api/settings", `{"faceitKey":"`+goodKey+`"}`)
	if rec.Code != 200 || !readSettings(t, rec).FaceitKey {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestSettingsOtherSite(t *testing.T) {
	_, h := newFaceitServer(t, t.TempDir(), "http://127.0.0.1:1", "")
	rec := send(h, "PUT", "/api/settings", `{"faceitKey":""}`, "Origin", "https://evil.example")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status %d", rec.Code)
	}
	for _, origin := range []string{"http://localhost:5173", "http://127.0.0.1:7350", "http://example.com"} {
		req := httptest.NewRequest("PUT", "/api/settings", strings.NewReader(`{}`))
		req.Host = "example.com"
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 200 {
			t.Errorf("%s: status %d", origin, rec.Code)
		}
	}
}

func TestKeyHint(t *testing.T) {
	tests := map[string]string{"": "", "short": "", goodKey: "...3f9a"}
	for in, want := range tests {
		if got := keyHint(in); got != want {
			t.Errorf("keyHint(%q) = %q", in, got)
		}
	}
}
