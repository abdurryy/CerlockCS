package server

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOutsideLink(t *testing.T) {
	tests := []struct {
		url  string
		want string
		ok   bool
	}{
		{"https://www.faceit.com/en/players/someone", "https://www.faceit.com/en/players/someone", true},
		{"https://faceit.com/", "https://faceit.com/", true},
		{"https://developers.faceit.com/docs", "https://developers.faceit.com/docs", true},
		{"https://FACEIT.com/en", "https://FACEIT.com/en", true},
		{"https://github.com/abdurryy/CerlockCS?tab=readme#download", "https://github.com/abdurryy/CerlockCS?tab=readme#download", true},
		{"https://developer.microsoft.com/microsoft-edge/webview2/", "https://developer.microsoft.com/microsoft-edge/webview2/", true},
		{"http://www.faceit.com/", "", false},
		{"https://notfaceit.com/", "", false},
		{"https://faceit.com.evil.example/", "", false},
		{"https://faceit.com@evil.example/", "", false},
		{"https://user:pass@faceit.com/", "", false},
		{"https://faceit.com:8443/", "", false},
		{"https://gist.github.com/", "", false},
		{"https://microsoft.com/", "", false},
		{"file:///C:/Windows/System32/calc.exe", "", false},
		{"javascript:alert(1)", "", false},
		{"faceit.com", "", false},
		{"", "", false},
	}
	for _, tt := range tests {
		got, ok := outsideLink(tt.url)
		if ok != tt.ok || got != tt.want {
			t.Errorf("outsideLink(%q) = %q, %v, want %q, %v", tt.url, got, ok, tt.want, tt.ok)
		}
	}
}

func TestOpenLink(t *testing.T) {
	_, h := newTestServer(t)
	var opened []string
	openErr := error(nil)
	old := openBrowser
	openBrowser = func(u string) error {
		opened = append(opened, u)
		return openErr
	}
	t.Cleanup(func() { openBrowser = old })

	post := func(contentType, body string) int {
		req := httptest.NewRequest("POST", "/api/open", strings.NewReader(body))
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	tests := []struct {
		name        string
		contentType string
		body        string
		fail        bool
		want        int
	}{
		{"allowed", "application/json", `{"url":"https://www.faceit.com/en"}`, false, http.StatusNoContent},
		{"charset", "application/json; charset=utf-8", `{"url":"https://github.com/"}`, false, http.StatusNoContent},
		{"other site", "application/json", `{"url":"https://example.com/"}`, false, http.StatusBadRequest},
		{"plain text", "text/plain", `{"url":"https://www.faceit.com/en"}`, false, http.StatusBadRequest},
		{"no type", "", `{"url":"https://www.faceit.com/en"}`, false, http.StatusBadRequest},
		{"bad json", "application/json", `{"url":`, false, http.StatusBadRequest},
		{"browser fails", "application/json", `{"url":"https://github.com/"}`, true, http.StatusInternalServerError},
	}
	for _, tt := range tests {
		opened = nil
		openErr = nil
		if tt.fail {
			openErr = errors.New("no browser")
		}
		if got := post(tt.contentType, tt.body); got != tt.want {
			t.Errorf("%s: status %d, want %d", tt.name, got, tt.want)
		}
		if wantOpen := tt.want == http.StatusNoContent || tt.fail; wantOpen != (len(opened) == 1) {
			t.Errorf("%s: opened %v", tt.name, opened)
		}
	}
	if rec := do(h, "GET", "/api/open", ""); rec.Code == http.StatusNoContent {
		t.Fatal("GET must not open anything")
	}
}
