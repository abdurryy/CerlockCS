package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAppAddr(t *testing.T) {
	tests := []struct {
		name    string
		busy    []string // taken by something else
		cerlock []string // taken by a Cerlock server
		want    string
		running bool
	}{
		{"free", nil, nil, "127.0.0.1:7350", false},
		{"cerlock running", nil, []string{"127.0.0.1:7350"}, "127.0.0.1:7350", true},
		{"other program", []string{"127.0.0.1:7350"}, nil, "127.0.0.1:7351", false},
		{"cerlock on the next port", []string{"127.0.0.1:7350"}, []string{"127.0.0.1:7351"}, "127.0.0.1:7351", true},
		{"all taken", []string{
			"127.0.0.1:7350", "127.0.0.1:7351", "127.0.0.1:7352", "127.0.0.1:7353", "127.0.0.1:7354",
			"127.0.0.1:7355", "127.0.0.1:7356", "127.0.0.1:7357", "127.0.0.1:7358", "127.0.0.1:7359",
		}, nil, "", false},
	}
	for _, tt := range tests {
		in := func(list []string) func(string) bool {
			return func(addr string) bool {
				for _, a := range list {
					if a == addr {
						return true
					}
				}
				return false
			}
		}
		taken := func(addr string) bool { return in(tt.busy)(addr) || in(tt.cerlock)(addr) }
		free := func(addr string) bool { return !taken(addr) }
		got, running := appAddr(free, in(tt.cerlock))
		if got != tt.want || running != tt.running {
			t.Errorf("%s: got %q, %v, want %q, %v", tt.name, got, running, tt.want, tt.running)
		}
	}
}

func TestPortFree(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	if portFree(addr) {
		t.Fatalf("%s is in use", addr)
	}
	ln.Close()
	if !portFree(addr) {
		t.Fatalf("%s was closed", addr)
	}
	picked, err := anyFreeAddr()
	if err != nil || !strings.HasPrefix(picked, "127.0.0.1:") || !portFree(picked) {
		t.Fatalf("anyFreeAddr = %q, %v", picked, err)
	}
}

func TestIsCerlock(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
		want   bool
	}{
		{"cerlock", 200, `{"ok":true}`, true},
		{"not ok", 200, `{"ok":false}`, false},
		{"other json", 200, `{"status":"up"}`, false},
		{"html", 200, `<html>hello</html>`, false},
		{"not found", 404, `{"ok":true}`, false},
	}
	for _, tt := range tests {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/health" {
				http.NotFound(w, r)
				return
			}
			w.WriteHeader(tt.status)
			w.Write([]byte(tt.body))
		}))
		if got := isCerlock(strings.TrimPrefix(srv.URL, "http://")); got != tt.want {
			t.Errorf("%s: got %v", tt.name, got)
		}
		srv.Close()
	}
	free, err := anyFreeAddr()
	if err != nil {
		t.Fatal(err)
	}
	if isCerlock(free) {
		t.Error("nothing listens there")
	}
}

func TestWaitReady(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	if err := waitReady(strings.TrimPrefix(srv.URL, "http://"), nil, time.Second); err != nil {
		t.Fatal(err)
	}

	free, err := anyFreeAddr()
	if err != nil {
		t.Fatal(err)
	}
	stopped := make(chan struct{})
	close(stopped)
	if err := waitReady(free, stopped, 5*time.Second); err == nil || !strings.Contains(err.Error(), "stopped") {
		t.Fatalf("stopped server: %v", err)
	}
	if err := waitReady(free, nil, 100*time.Millisecond); err == nil {
		t.Fatal("expected a timeout")
	}
}

func TestAppServer(t *testing.T) {
	dir := t.TempDir()
	addr, err := anyFreeAddr()
	if err != nil {
		t.Fatal(err)
	}
	args := []string{"-addr", addr, "-data", dir, "-demos", dir, "-offline", "-watch=false"}

	// Closing the window cancels the server, which must stop cleanly.
	ctx, cancel := context.WithCancel(context.Background())
	srv := startServer(ctx, args...)
	if err := waitReady(addr, srv.done, 10*time.Second); err != nil {
		t.Fatal(err)
	}
	if err := srv.stop(cancel); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if isCerlock(addr) {
		t.Fatal("server still answers after stop")
	}

	// A server that cannot start reports why.
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	ctx, cancel = context.WithCancel(context.Background())
	srv = startServer(ctx, args...)
	if err := waitReady(addr, srv.done, 10*time.Second); err == nil {
		t.Fatal("expected the server to fail")
	}
	if err := srv.stop(cancel); err == nil || !strings.Contains(err.Error(), "address") {
		t.Fatalf("stop: %v", err)
	}
}

func TestOpenLog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data", "cerlock.log")
	write := func(s string) {
		t.Helper()
		f, err := openLog(path, 10)
		if err != nil {
			t.Fatal(err)
		}
		f.WriteString(s)
		f.Close()
	}
	tests := []struct {
		write string
		want  string
	}{
		{"first ", "first "},
		{"second", "first second"},
		{"third", "third"}, // over 10 bytes, so it starts again
		{"!", "third!"},
	}
	for _, tt := range tests {
		write(tt.write)
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if string(b) != tt.want {
			t.Fatalf("after %q: got %q, want %q", tt.write, b, tt.want)
		}
	}
}

func TestWindowSize(t *testing.T) {
	tests := []struct {
		name             string
		screenW, screenH int
		dpi              int
		wantW, wantH     int
	}{
		{"1080p", 1920, 1080, 96, 1600, 950},
		{"1440p", 2560, 1440, 96, 1600, 950},
		{"4k at 150%", 3840, 2160, 144, 2400, 1425},
		{"1080p at 125%", 1920, 1080, 120, 1766, 950},
		{"small laptop", 1366, 768, 96, 1256, 675},
		{"unknown dpi", 1920, 1080, 0, 1600, 950},
		{"unknown screen", 0, 0, 96, 1600, 950},
	}
	for _, tt := range tests {
		w, h := windowSize(tt.screenW, tt.screenH, tt.dpi)
		if w != tt.wantW || h != tt.wantH {
			t.Errorf("%s: got %dx%d, want %dx%d", tt.name, w, h, tt.wantW, tt.wantH)
		}
	}
}
