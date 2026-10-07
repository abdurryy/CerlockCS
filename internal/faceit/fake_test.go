package faceit

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

const testKey = "0f5c1a2b-test-key-3f9a"

// fake is a small stand in for the FACEIT APIs. Routes are matched on the
// path, every request has to carry the test key.
type fake struct {
	srv    *httptest.Server
	mu     sync.Mutex
	routes map[string]http.HandlerFunc
	hits   map[string]int
}

func newFake(t *testing.T) *fake {
	t.Helper()
	f := &fake{routes: map[string]http.HandlerFunc{}, hits: map[string]int{}}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.hits[r.URL.Path]++
		h, ok := f.routes[r.URL.Path]
		f.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer "+testKey && !strings.HasPrefix(r.URL.Path, "/cdn/") {
			http.Error(w, `{"errors":[{"message":"unauthorized"}]}`, http.StatusUnauthorized)
			return
		}
		if !ok {
			http.Error(w, `{"errors":[{"message":"not found"}]}`, http.StatusNotFound)
			return
		}
		h(w, r)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fake) handle(path string, h http.HandlerFunc) {
	f.mu.Lock()
	f.routes[path] = h
	f.mu.Unlock()
}

// json serves body for path. A string is sent as is.
func (f *fake) json(path string, body any) {
	f.handle(path, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if s, ok := body.(string); ok {
			w.Write([]byte(s))
			return
		}
		json.NewEncoder(w).Encode(body)
	})
}

func (f *fake) count(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits[path]
}

func (f *fake) client() *Client {
	return New(f.srv.URL+"/data/v4", f.srv.URL+"/download/v2", func() string { return testKey })
}

type obj = map[string]any

func historyPlayers(faction string, ids ...string) obj {
	var ps []obj
	for _, id := range ids {
		ps = append(ps, obj{"player_id": id, "nickname": "nick_" + id, "game_player_id": steamOf(id)})
	}
	return obj{"team_id": faction + "-team", "nickname": "team_" + faction, "players": ps}
}

func steamOf(id string) string {
	return "765611980000000" + map[string]string{"pa": "01", "pb": "02", "pc": "03", "pd": "04", "pe": "05"}[id]
}

func historyItem(id string, started int, status string, f1, f2 []string) obj {
	return obj{
		"match_id":         id,
		"competition_name": "5v5 RANKED",
		"competition_type": "matchmaking",
		"started_at":       started,
		"status":           status,
		"teams": obj{
			"faction1": historyPlayers("f1", f1...),
			"faction2": historyPlayers("f2", f2...),
		},
		"results":    obj{"winner": "faction1", "score": obj{"faction1": 1, "faction2": 0}},
		"faceit_url": "https://www.faceit.com/{lang}/cs2/room/" + id,
	}
}
