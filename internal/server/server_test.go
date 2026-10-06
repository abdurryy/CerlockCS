package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
