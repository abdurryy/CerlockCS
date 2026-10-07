package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/klauspost/compress/gzip"

	"github.com/abdurryy/CerlockCS/internal/match"
	"github.com/abdurryy/CerlockCS/internal/replay"
)

const (
	matchA = "1-bcde0562-93c0-4539-8e6f-90420bb122a6"
	matchB = "1-aaaaaaaa-93c0-4539-8e6f-90420bb122a6"
)

type obj = map[string]any

func roster(ids ...string) []obj {
	var out []obj
	for _, id := range ids {
		out = append(out, obj{"player_id": id, "nickname": "nick_" + id, "game_player_id": "7656119800000000" + id[1:]})
	}
	return out
}

func scoutRoutes(demoHandler http.HandlerFunc) map[string]http.HandlerFunc {
	match := obj{
		"match_id":         matchA,
		"competition_name": "ESEA S56 EU Open Division",
		"competition_type": "championship",
		"started_at":       1791374400,
		"status":           "FINISHED",
		"teams": obj{
			"faction1": obj{"faction_id": "t1", "name": "Us", "roster": roster("p1", "p2", "p3", "p4", "p5")},
			"faction2": obj{"faction_id": "t2", "name": "E-ManiacS", "roster": roster("p6", "p7")},
		},
		"voting":   obj{"map": obj{"pick": []string{"de_nuke"}}},
		"results":  obj{"winner": "faction2", "score": obj{"faction1": 0, "faction2": 1}},
		"demo_url": []string{"https://demos.example/cs2/" + matchA + "-1-1.dem.zst"},
	}
	item := obj{
		"match_id": matchA, "started_at": 1791374400, "status": "finished",
		"teams": obj{
			"faction1": obj{"players": roster("p1", "p2", "p3", "p4", "p5")},
			"faction2": obj{"players": roster("p6", "p7")},
		},
	}
	routes := map[string]http.HandlerFunc{
		"/data/v4/games/cs2":                    serveJSON(obj{}),
		"/data/v4/matches/" + matchA:            serveJSON(match),
		"/data/v4/matches/" + matchA + "/stats": serveJSON(obj{"rounds": []obj{{"teams": []obj{{"team_id": "t1", "team_stats": obj{"Final Score": "11"}}, {"team_id": "t2", "team_stats": obj{"Final Score": "13"}}}}}}),
		"/data/v4/matches/" + matchB:            serveJSON(obj{"match_id": matchB, "demo_url": []string{}}),
	}
	for _, p := range []string{"p1", "p2", "p3", "p4"} {
		routes["/data/v4/players/"+p+"/history"] = serveJSON(obj{"items": []obj{item}})
	}
	if demoHandler != nil {
		routes["/download/v2/demos/download-url"] = demoHandler
	}
	return routes
}

func TestScoutNeedsKey(t *testing.T) {
	_, h := newFaceitServer(t, t.TempDir(), "http://127.0.0.1:1", "")
	for _, path := range []string{"/api/scout/match", "/api/scout/find", "/api/scout/download"} {
		rec := send(h, "POST", path, `{}`)
		if rec.Code != 400 || errorCode(rec) != "no_key" {
			t.Errorf("%s: status %d body %s", path, rec.Code, rec.Body.String())
		}
	}
}

func TestScoutMatch(t *testing.T) {
	fake := fakeFaceit(t, scoutRoutes(nil))
	_, h := newFaceitServer(t, t.TempDir(), fake.URL, goodKey)
	rec := send(h, "POST", "/api/scout/match", `{"url":"https://www.faceit.com/sv/cs2/room/`+matchA+`"}`)
	if rec.Code != 200 {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body struct {
		MatchID string `json:"matchId"`
		Map     string `json:"map"`
		Teams   []struct {
			Name    string `json:"name"`
			Players []struct {
				FaceitID string `json:"faceitId"`
				SteamID  string `json:"steamId"`
			} `json:"players"`
		} `json:"teams"`
	}
	json.Unmarshal(rec.Body.Bytes(), &body)
	if body.MatchID != matchA || body.Map != "de_nuke" || len(body.Teams) != 2 || body.Teams[1].Name != "E-ManiacS" || body.Teams[1].Players[0].SteamID != "76561198000000006" {
		t.Fatalf("body %s", rec.Body.String())
	}

	if rec := send(h, "POST", "/api/scout/match", `{"url":"hello"}`); rec.Code != 400 || errorCode(rec) != "bad_request" {
		t.Fatalf("bad url: %d %s", rec.Code, rec.Body.String())
	}
	if rec := send(h, "POST", "/api/scout/match", `{"url":"1-cccccccc-93c0-4539-8e6f-90420bb122a6"}`); rec.Code != 404 || errorCode(rec) != "not_found" {
		t.Fatalf("missing match: %d %s", rec.Code, rec.Body.String())
	}
	if rec := send(h, "POST", "/api/scout/match", `{"url":`); rec.Code != 400 || errorCode(rec) != "bad_request" {
		t.Fatalf("broken body: %d %s", rec.Code, rec.Body.String())
	}
}

func TestScoutFind(t *testing.T) {
	fake := fakeFaceit(t, scoutRoutes(nil))
	s, h := newFaceitServer(t, t.TempDir(), fake.URL, goodKey)
	s.lib.entries["0123456789abcdef0123"] = &Entry{ID: "0123456789abcdef0123", Name: matchA + "-1-1.dem.zst", Created: time.Now()}

	rec := send(h, "POST", "/api/scout/find", `{"players":[{"faceitId":"p1"},{"faceitId":"p2"},{"faceitId":"p3"},{"faceitId":"p4","nickname":"Four"}]}`)
	if rec.Code != 200 {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Matches []struct {
			MatchID  string   `json:"matchId"`
			Map      string   `json:"map"`
			Kind     string   `json:"kind"`
			Won      *bool    `json:"won"`
			Score    string   `json:"score"`
			Players  []string `json:"players"`
			Opponent string   `json:"opponent"`
			Demo     bool     `json:"demo"`
			ReplayID string   `json:"replayId"`
		} `json:"matches"`
		Maps []struct {
			Map    string `json:"map"`
			Played int    `json:"played"`
		} `json:"maps"`
	}
	json.Unmarshal(rec.Body.Bytes(), &body)
	if len(body.Matches) != 1 || len(body.Maps) != 1 {
		t.Fatalf("body %s", rec.Body.String())
	}
	m := body.Matches[0]
	if m.MatchID != matchA || m.Map != "de_nuke" || m.Kind != "league" || m.Won == nil || *m.Won || m.Score != "11 - 13" || m.Opponent != "E-ManiacS" || !m.Demo || m.ReplayID != "0123456789abcdef0123" || len(m.Players) != 4 || m.Players[3] != "Four" {
		t.Fatalf("match %+v", m)
	}

	if rec := send(h, "POST", "/api/scout/find", `{"players":[]}`); rec.Code != 400 || errorCode(rec) != "bad_request" {
		t.Fatalf("no players: %d %s", rec.Code, rec.Body.String())
	}
	if rec := send(h, "POST", "/api/scout/find", `{"players":[{"faceitId":"p1"}]}`, "Origin", "https://evil.example"); rec.Code != 403 {
		t.Fatalf("other site: %d", rec.Code)
	}
}

func TestScoutDownloadNotAllowed(t *testing.T) {
	calls := 0
	fake := fakeFaceit(t, scoutRoutes(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusForbidden)
	}))
	_, h := newFaceitServer(t, t.TempDir(), fake.URL, goodKey)
	rec := send(h, "POST", "/api/scout/download", `{"matchIds":["`+matchA+`","`+matchA+`","nope"]}`)
	if rec.Code != 200 {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body downloadResult
	json.Unmarshal(rec.Body.Bytes(), &body)
	if body.DownloadsAllowed || len(body.Queued) != 0 || len(body.Failed) != 2 || calls != 1 {
		t.Fatalf("body %s after %d calls", rec.Body.String(), calls)
	}
	if !strings.Contains(body.Failed[1].Error, "match rooms") {
		t.Fatalf("message %q", body.Failed[1].Error)
	}
}

func TestScoutDownload(t *testing.T) {
	demo := append([]byte{0x28, 0xb5, 0x2f, 0xfd}, bytes.Repeat([]byte("not really a demo "), 100_000)...)
	var fakeURL string
	routes := scoutRoutes(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ResourceURL string `json:"resource_url"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if !strings.HasSuffix(req.ResourceURL, matchA+"-1-1.dem.zst") {
			t.Errorf("resource %q", req.ResourceURL)
		}
		serveJSON(obj{"payload": obj{"download_url": fakeURL + "/cdn/" + matchA + "-1-1.dem.zst?sig=abc"}})(w, r)
	})
	routes["/cdn/"+matchA+"-1-1.dem.zst"] = func(w http.ResponseWriter, r *http.Request) { w.Write(demo) }
	fake := fakeFaceit(t, routes)
	fakeURL = fake.URL
	dir := t.TempDir()
	_, h := newFaceitServer(t, dir, fake.URL, goodKey)

	rec := send(h, "POST", "/api/scout/download", `{"matchIds":["`+matchA+`","`+matchB+`"]}`)
	var body downloadResult
	json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != 200 || !body.DownloadsAllowed || len(body.Queued) != 1 || body.Queued[0] != matchA || len(body.Failed) != 1 || body.Failed[0].MatchID != matchB {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}

	// The file lands in the data folder and goes on to the parser, which
	// gives up on it since it is not a real demo.
	file := filepath.Join(dir, "demos", "faceit", matchA+".dem.zst")
	deadline := time.Now().Add(10 * time.Second)
	for {
		var list struct {
			Jobs []Job `json:"jobs"`
		}
		json.Unmarshal(send(h, "GET", "/api/replays", "").Body.Bytes(), &list)
		if len(list.Jobs) == 1 && list.Jobs[0].Name == matchA+".dem.zst" && list.Jobs[0].Status == "error" && !strings.HasPrefix(list.Jobs[0].ID, "faceit-") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("jobs %+v", list.Jobs)
		}
		time.Sleep(20 * time.Millisecond)
	}
	b, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(b, demo) {
		t.Fatalf("file %d bytes, %v", len(b), err)
	}
	if parts, _ := filepath.Glob(filepath.Join(dir, "demos", "faceit", ".*")); len(parts) != 0 {
		t.Fatalf("left over %v", parts)
	}

	// Asking again uses the file that is already there.
	rec = send(h, "POST", "/api/scout/download", `{"matchIds":["`+matchA+`"]}`)
	json.Unmarshal(rec.Body.Bytes(), &body)
	if len(body.Queued) != 1 {
		t.Fatalf("again: %s", rec.Body.String())
	}
}

func TestSteamIDsBackfill(t *testing.T) {
	dir := t.TempDir()
	replays := filepath.Join(dir, "replays")
	os.MkdirAll(replays, 0o755)
	id := "00000000000000000001"

	m := &match.Match{Map: "de_nuke", Weapons: map[uint16]string{}}
	m.Players = []match.Player{{Name: "alpha", SteamID: 76561198000000001}, {Name: "BOT Kim"}}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if err := replay.Write(zw, m, nil); err != nil {
		t.Fatal(err)
	}
	zw.Close()
	os.WriteFile(filepath.Join(replays, id+".crlk.gz"), buf.Bytes(), 0o644)
	old, _ := json.Marshal(obj{"id": id, "name": "old.dem", "map": "de_nuke", "players": []string{"alpha", "BOT Kim"}, "format": replay.Version})
	os.WriteFile(filepath.Join(replays, id+".json"), old, 0o644)

	_, h := newFaceitServer(t, dir, "http://127.0.0.1:1", "")
	var list struct {
		Replays []Entry `json:"replays"`
	}
	json.Unmarshal(send(h, "GET", "/api/replays", "").Body.Bytes(), &list)
	if len(list.Replays) != 1 || strings.Join(list.Replays[0].SteamIDs, ",") != "76561198000000001,0" {
		t.Fatalf("replays %+v", list.Replays)
	}
	saved, _ := os.ReadFile(filepath.Join(replays, id+".json"))
	if !strings.Contains(string(saved), "76561198000000001") {
		t.Fatalf("entry not updated: %s", saved)
	}
}
