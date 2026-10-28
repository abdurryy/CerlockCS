package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveExportWritesIntoFolders(t *testing.T) {
	s, h := newTestServer(t)
	rec := send(h, "PUT", "/api/exports/file?path=e-maniacs/mirage/ct/eco-rounds.mp4", "video bytes", "Content-Type", "video/mp4")
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	got, err := os.ReadFile(filepath.Join(s.exportDir(), "e-maniacs", "mirage", "ct", "eco-rounds.mp4"))
	if err != nil || string(got) != "video bytes" {
		t.Fatalf("file %q, %v", got, err)
	}
	// Saving again replaces the file and leaves no temp files behind.
	send(h, "PUT", "/api/exports/file?path=e-maniacs/mirage/ct/eco-rounds.mp4", "newer", "Content-Type", "video/mp4")
	left, _ := os.ReadDir(filepath.Join(s.exportDir(), "e-maniacs", "mirage", "ct"))
	if len(left) != 1 {
		t.Fatalf("files %v", left)
	}
}

func TestSaveExportRefusesBadRequests(t *testing.T) {
	s, h := newTestServer(t)
	cases := []struct {
		name, path, typ, origin string
		want                    int
	}{
		{"up a folder", "../evil.mp4", "video/mp4", "", 400},
		{"dots in a folder", "team/../../evil.mp4", "video/mp4", "", 400},
		{"absolute", "/tmp/evil.mp4", "video/mp4", "", 400},
		{"backslash", `team\evil.mp4`, "video/mp4", "", 400},
		{"upper case", "Team/clip.mp4", "video/mp4", "", 400},
		{"hidden file", "team/.mp4", "video/mp4", "", 400},
		{"empty", "", "video/mp4", "", 400},
		{"extension does not match", "team/clip.exe", "video/mp4", "", 400},
		{"png named mp4", "team/clip.mp4", "image/png", "", 400},
		{"form post type", "team/clip.mp4", "text/plain", "", 415},
		{"html named mp4", "team/clip.mp4", "text/html", "", 400},
		{"other site", "team/clip.mp4", "video/mp4", "https://evil.example", 403},
	}
	for _, c := range cases {
		hdr := []string{"Content-Type", c.typ}
		if c.origin != "" {
			hdr = append(hdr, "Origin", c.origin)
		}
		if rec := send(h, "PUT", "/api/exports/file?path="+c.path, "x", hdr...); rec.Code != c.want {
			t.Errorf("%s: status %d, want %d", c.name, rec.Code, c.want)
		}
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(s.exportDir()), "evil.mp4")); err == nil {
		t.Fatal("wrote outside the exports folder")
	}
}

func TestOpenExportOnlyOpensExportFolders(t *testing.T) {
	s, h := newTestServer(t)
	var opened []string
	old := openFolder
	openFolder = func(dir string) error {
		opened = append(opened, dir)
		return nil
	}
	defer func() { openFolder = old }()

	if rec := send(h, "POST", "/api/exports/open", `{"path":"e-maniacs"}`, "Content-Type", "application/json"); rec.Code != 204 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if rec := send(h, "POST", "/api/exports/open", `{"path":"../.."}`, "Content-Type", "application/json"); rec.Code != 400 {
		t.Fatalf("status %d for a path outside", rec.Code)
	}
	if rec := send(h, "POST", "/api/exports/open", `{}`, "Content-Type", "application/json", "Origin", "https://evil.example"); rec.Code != 403 {
		t.Fatalf("status %d for another site", rec.Code)
	}
	if len(opened) != 1 || opened[0] != filepath.Join(s.exportDir(), "e-maniacs") {
		t.Fatalf("opened %v", opened)
	}
}

func TestOpenExportOpensTheVideoPage(t *testing.T) {
	_, h := newTestServer(t)
	var opened []string
	old := openFolder
	openFolder = func(p string) error {
		opened = append(opened, p)
		return nil
	}
	defer func() { openFolder = old }()

	// Not saved yet.
	if rec := send(h, "POST", "/api/exports/open", `{"path":"e-maniacs/index.html"}`, "Content-Type", "application/json"); rec.Code != 404 {
		t.Fatalf("status %d before the page exists", rec.Code)
	}
	if rec := send(h, "PUT", "/api/exports/file?path=e-maniacs/index.html", "<!doctype html>", "Content-Type", "text/html; charset=utf-8"); rec.Code != 200 {
		t.Fatalf("save status %d: %s", rec.Code, rec.Body.String())
	}
	if rec := send(h, "POST", "/api/exports/open", `{"path":"e-maniacs/index.html"}`, "Content-Type", "application/json"); rec.Code != 204 {
		t.Fatalf("open status %d: %s", rec.Code, rec.Body.String())
	}
	if rec := send(h, "POST", "/api/exports/open", `{"path":"../index.html"}`, "Content-Type", "application/json"); rec.Code != 400 {
		t.Fatalf("status %d for a page outside", rec.Code)
	}
	if len(opened) != 1 || filepath.Base(opened[0]) != "index.html" {
		t.Fatalf("opened %v", opened)
	}
}
