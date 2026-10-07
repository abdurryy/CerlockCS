package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// Helpers for the desktop app. They have no window code, so they are tested
// on every platform.

const (
	appPort    = 7350
	appLogSize = 5 << 20
)

// appAddr picks where the app's server listens. It tries the usual port and
// a few after it, so the page keeps the same address (and its saved
// settings) between runs. running is true when a Cerlock server already
// answers there. An empty addr means no port was usable.
func appAddr(free, cerlock func(addr string) bool) (addr string, running bool) {
	for port := appPort; port < appPort+10; port++ {
		a := fmt.Sprintf("127.0.0.1:%d", port)
		if free(a) {
			return a, false
		}
		if cerlock(a) {
			return a, true
		}
	}
	return "", false
}

// portFree reports whether addr can be listened on.
func portFree(addr string) bool {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

// anyFreeAddr returns a free local address picked by the system.
func anyFreeAddr() (string, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	defer ln.Close()
	return ln.Addr().String(), nil
}

// isCerlock reports whether a Cerlock server answers on addr.
func isCerlock(addr string) bool {
	c := http.Client{Timeout: 2 * time.Second}
	res, err := c.Get("http://" + addr + "/api/health")
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var body struct {
		OK bool `json:"ok"`
	}
	return res.StatusCode == http.StatusOK && json.NewDecoder(res.Body).Decode(&body) == nil && body.OK
}

// waitReady waits until the server on addr answers. It gives up when stopped
// is closed (the server quit) or after timeout.
func waitReady(addr string, stopped <-chan struct{}, timeout time.Duration) error {
	deadline := time.After(timeout)
	tick := time.NewTicker(50 * time.Millisecond)
	defer tick.Stop()
	for {
		if isCerlock(addr) {
			return nil
		}
		select {
		case <-stopped:
			return errors.New("the server stopped while starting")
		case <-deadline:
			return fmt.Errorf("the server did not answer on %s", addr)
		case <-tick.C:
		}
	}
}

// openLog opens the app log for appending. A log bigger than limit bytes is
// started again from empty.
func openLog(path string, limit int64) (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	if st, err := os.Stat(path); err == nil && st.Size() > limit {
		flags |= os.O_TRUNC
	}
	return os.OpenFile(path, flags, 0o644)
}

// windowSize returns the first size of the app window in pixels: 1600x950
// at normal scaling, made smaller to fit the screen.
func windowSize(screenW, screenH, dpi int) (w, h int) {
	if dpi <= 0 {
		dpi = 96
	}
	w, h = 1600*dpi/96, 950*dpi/96
	if screenW > 0 {
		w = min(w, screenW*92/100)
	}
	if screenH > 0 {
		h = min(h, screenH*88/100)
	}
	return w, h
}

// appServer is the viewer server running inside the app.
type appServer struct {
	done chan struct{} // closed when the server has stopped
	err  error         // why it stopped on its own, set before done is closed
}

// startServer runs "cerlock serve" with args until ctx is cancelled.
func startServer(ctx context.Context, args ...string) *appServer {
	s := &appServer{done: make(chan struct{})}
	go func() {
		defer close(s.done)
		s.err = serve(ctx, args)
		if s.err == nil && ctx.Err() == nil {
			s.err = errors.New("the server stopped")
		}
	}()
	return s
}

// stop shuts the server down and waits for it to finish.
func (s *appServer) stop(cancel context.CancelFunc) error {
	cancel()
	select {
	case <-s.done:
		return s.err
	case <-time.After(10 * time.Second):
		return errors.New("the server did not stop in time")
	}
}
