package icons

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M0 0h32v32H0z"/></svg>`

func TestCheck(t *testing.T) {
	good := []string{
		svg,
		`<?xml version="1.0"?>` + "\n" + svg,
		"\xef\xbb\xbf" + svg,
	}
	for _, s := range good {
		if err := Check([]byte(s)); err != nil {
			t.Errorf("Check(%.30q) = %v", s, err)
		}
	}
	bad := []string{
		`<html><body>nope</body></html>`,
		`<svg><script>alert(1)</script></svg>`,
		`<svg onload="alert(1)"></svg>`,
		`<svg><a href="javascript:alert(1)"/></svg>`,
		`<svg><foreignObject><div/></foreignObject></svg>`,
	}
	for _, s := range bad {
		if Check([]byte(s)) == nil {
			t.Errorf("Check(%q) accepted", s)
		}
	}
}

func TestStoreDownloadsOnce(t *testing.T) {
	var hits atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		switch r.URL.Path {
		case "/weapon/ak47", "/kill/headshot":
			w.Write([]byte(svg))
		case "/weapon/awp":
			w.Write([]byte(`<svg onload="x()"></svg>`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer up.Close()

	s := NewStore(t.TempDir())
	s.Remote = func(name string) string { return up.URL + "/" + name }
	got := s.Available()
	if len(got) != 2 || got["kill/headshot"] != 1 || got["weapon/ak47"] != 1 {
		t.Fatalf("available %v", got)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "weapon", "awp.svg")); err == nil {
		t.Fatal("unsafe icon was saved")
	}
	n := hits.Load()
	if int(n) != len(Names()) {
		t.Fatalf("%d requests for %d icons", n, len(Names()))
	}
	s.Available()
	if hits.Load() != n {
		t.Fatal("second call downloaded again")
	}

	// A fresh store on the same folder finds the cached files and only asks
	// for the ones still missing.
	s2 := NewStore(s.Dir)
	s2.Remote = s.Remote
	s2.Available()
	if got := hits.Load() - n; int(got) != len(Names())-2 {
		t.Fatalf("%d requests on second run", got)
	}
}

func TestStoreOfflineUsesOwnFiles(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "weapon"), 0o755)
	os.WriteFile(filepath.Join(dir, "weapon", "ak47.svg"), []byte(svg), 0o644)
	os.WriteFile(filepath.Join(dir, "weapon", "notes.txt"), []byte("x"), 0o644)
	s := NewStore(dir)
	s.Offline = true
	s.Remote = func(string) string { t.Fatal("offline store downloaded"); return "" }
	if got := s.Available(); len(got) != 1 || got["weapon/ak47"] != 1 {
		t.Fatalf("available %v", got)
	}
}

func TestPathRejectsBadNames(t *testing.T) {
	s := NewStore(t.TempDir())
	for _, n := range []string{"weapon/../../etc/passwd", "other/ak47", "weapon/AK47", "weapon/", "ak47"} {
		if _, ok := s.Path(n); ok {
			t.Errorf("Path(%q) accepted", n)
		}
	}
	if p, ok := s.Path("hud/bombsite-a"); !ok || !strings.HasSuffix(p, filepath.Join("hud", "bombsite-a.svg")) {
		t.Errorf("Path(hud/bombsite-a) = %q, %v", p, ok)
	}
}

func TestEveryNameHasASource(t *testing.T) {
	for _, n := range Names() {
		if upstream(n) == "" {
			t.Errorf("%s has no source", n)
		}
		if _, ok := (&Store{}).Path(n); !ok {
			t.Errorf("%s is not a valid name", n)
		}
	}
}

func TestAspect(t *testing.T) {
	cases := map[string]float64{
		`<svg viewBox="0 0 88.5 32">`:      2.766,
		`<svg viewBox="0,0,30,30">`:        1,
		`<svg width="64px" height="32px">`: 2,
		`<svg x="0px" width="32.074px" height="16.037px" viewBox="0 0 32.074 16.037">`: 2,
		`<svg>`: 1,
	}
	for in, want := range cases {
		if got := Aspect([]byte(in)); got != want {
			t.Errorf("Aspect(%q) = %v, want %v", in, got, want)
		}
	}
}
