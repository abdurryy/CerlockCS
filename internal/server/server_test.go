package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func newTestServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	s, err := New(Config{
		DataDir:  t.TempDir(),
		DemoDirs: []string{t.TempDir()},
		Offline:  true,
		Workers:  1,
		Static:   fstest.MapFS{"index.html": {Data: []byte("<html>app</html>")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return s, s.Handler()
}

func do(h http.Handler, method, url, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestEmptyLibrary(t *testing.T) {
	_, h := newTestServer(t)
	rec := do(h, "GET", "/api/replays", "")
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	var body struct {
		Replays []Entry `json:"replays"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Replays) != 0 {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestUploadRejectsNonDemos(t *testing.T) {
	_, h := newTestServer(t)
	rec := do(h, "POST", "/api/upload?name=notes.txt", "definitely not a demo file")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	// A failed upload must not block a retry of the same file.
	rec = do(h, "POST", "/api/upload?name=notes.txt", "definitely not a demo file")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("retry status %d", rec.Code)
	}
}

func TestParseLocalStaysInsideDemoFolders(t *testing.T) {
	_, h := newTestServer(t)
	rec := do(h, "POST", "/api/library/parse?path=/etc/passwd", "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestReplayIDIsValidated(t *testing.T) {
	_, h := newTestServer(t)
	if rec := do(h, "GET", "/api/replays/..%2f..%2fetc", ""); rec.Code == 200 {
		t.Fatal("expected an error for a bad id")
	}
	if rec := do(h, "GET", "/api/replays/0123456789abcdef0123", ""); rec.Code != 404 {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestSPAFallback(t *testing.T) {
	_, h := newTestServer(t)
	rec := do(h, "GET", "/some/client/route", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "app") {
		t.Fatalf("status %d body %q", rec.Code, rec.Body.String())
	}
}

func TestMapInfoOffline(t *testing.T) {
	_, h := newTestServer(t)
	rec := do(h, "GET", "/api/maps/de_mirage", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"scale":5`) {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestIcons(t *testing.T) {
	s, h := newTestServer(t)
	dir := filepath.Join(s.cfg.DataDir, "icons", "weapon")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "ak47.svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 0o644)
	os.WriteFile(filepath.Join(dir, "awp.svg"), []byte(`<svg><script>x()</script></svg>`), 0o644)

	rec := do(h, "GET", "/api/icons", "")
	var body struct {
		Icons map[string]float64 `json:"icons"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Icons) != 1 {
		t.Fatalf("list %s", rec.Body.String())
	}

	rec = do(h, "GET", "/api/icons/weapon/ak47.svg", "")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/svg+xml" || rec.Header().Get("Content-Security-Policy") == "" {
		t.Fatalf("icon %d %v", rec.Code, rec.Header())
	}
	for _, url := range []string{"/api/icons/weapon/awp.svg", "/api/icons/weapon/ak47", "/api/icons/other/ak47.svg", "/api/icons/weapon/..%2Fx.svg"} {
		if rec := do(h, "GET", url, ""); rec.Code != 404 {
			t.Errorf("%s: status %d", url, rec.Code)
		}
	}
}
