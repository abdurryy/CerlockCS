package faceit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const (
	m1 = "1-11111111-1111-1111-1111-111111111111"
	m2 = "1-22222222-2222-2222-2222-222222222222"
	m3 = "1-33333333-3333-3333-3333-333333333333"
	m4 = "1-44444444-4444-4444-4444-444444444444"
	m5 = "1-55555555-5555-5555-5555-555555555555"
)

func TestParseURL(t *testing.T) {
	tests := []struct {
		in, kind, id string
	}{
		{"https://www.faceit.com/sv/cs2/room/1-bcde0562-93c0-4539-8e6f-90420bb122a6", "match", "1-bcde0562-93c0-4539-8e6f-90420bb122a6"},
		{"https://www.faceit.com/en/cs2/room/1-BCDE0562-93c0-4539-8e6f-90420bb122a6/scoreboard?x=1", "match", "1-bcde0562-93c0-4539-8e6f-90420bb122a6"},
		{"  1-bcde0562-93c0-4539-8e6f-90420bb122a6 ", "match", "1-bcde0562-93c0-4539-8e6f-90420bb122a6"},
		{"1-bcde0562-93c0-4539-8e6f-90420bb122a6-1-1.dem.zst", "match", "1-bcde0562-93c0-4539-8e6f-90420bb122a6"},
		{"https://www.faceit.com/en/teams/5b7cbb9b-03a2-4f2e-a6b4-d6d6f7b3c4c1", "team", "5b7cbb9b-03a2-4f2e-a6b4-d6d6f7b3c4c1"},
		{"faceit.com/en/teams/5b7cbb9b-03a2-4f2e-a6b4-d6d6f7b3c4c1/leagues", "team", "5b7cbb9b-03a2-4f2e-a6b4-d6d6f7b3c4c1"},
		{"5b7cbb9b-03a2-4f2e-a6b4-d6d6f7b3c4c1", "team", "5b7cbb9b-03a2-4f2e-a6b4-d6d6f7b3c4c1"},
		{"https://www.faceit.com/en/players/someone", "", ""},
		{"", "", ""},
		{"e-maniacs", "", ""},
	}
	for _, tt := range tests {
		ref, ok := ParseURL(tt.in)
		if ok != (tt.kind != "") || ref.Kind != tt.kind || ref.ID != tt.id {
			t.Errorf("ParseURL(%q) = %+v, %v", tt.in, ref, ok)
		}
	}
	if !ValidMatchID(m1) || ValidMatchID("1-x") || ValidMatchID("../"+m1) {
		t.Fatal("ValidMatchID")
	}
}

func TestKind(t *testing.T) {
	tests := []struct{ typ, name, want string }{
		{"championship", "ESEA S56 EU Open", "league"},
		{"", "ESEA League Season 56", "league"},
		{"matchmaking", "5v5 RANKED", "matchmaking"},
		{"", "Europe 5v5 Queue", "matchmaking"},
		{"hub", "Some Hub", "other"},
		{"", "", "other"},
	}
	for _, tt := range tests {
		if got := Kind(tt.typ, tt.name); got != tt.want {
			t.Errorf("Kind(%q, %q) = %s, want %s", tt.typ, tt.name, got, tt.want)
		}
	}
}

func TestDemoExt(t *testing.T) {
	tests := []struct {
		links []string
		want  string
	}{
		{[]string{"https://cdn.example/cs2/1-a-1-1.dem.zst?X-Amz-Signature=abc"}, ".dem.zst"},
		{[]string{"https://cdn.example/download?id=1", "https://demos.faceit-cdn.net/cs2/x.dem.gz"}, ".dem.gz"},
		{[]string{"https://cdn.example/x.DEM"}, ".dem"},
		{[]string{"https://cdn.example/x.zip"}, ""},
	}
	for _, tt := range tests {
		if got := DemoExt(tt.links...); got != tt.want {
			t.Errorf("DemoExt(%v) = %q", tt.links, got)
		}
	}
	if SniffExt([]byte{0x28, 0xb5, 0x2f, 0xfd, 0}) != ".dem.zst" || SniffExt([]byte("PBDEMS2\x00")) != ".dem" {
		t.Fatal("SniffExt")
	}
}

func TestHistoryPaging(t *testing.T) {
	f := newFake(t)
	var queries []string
	f.handle("/data/v4/players/pa/history", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		queries = append(queries, q.Get("offset")+"/"+q.Get("limit"))
		if q.Get("game") != "cs2" || q.Get("from") == "" {
			t.Errorf("query %s", r.URL.RawQuery)
		}
		offset, _ := strconv.Atoi(q.Get("offset"))
		limit, _ := strconv.Atoi(q.Get("limit"))
		// 130 matches in total.
		var items []obj
		for i := offset; i < min(offset+limit, 130); i++ {
			items = append(items, obj{"match_id": "m" + strconv.Itoa(i)})
		}
		json.NewEncoder(w).Encode(obj{"items": items})
	})
	c := f.client()
	items, err := c.History(context.Background(), "pa", 250)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 130 || items[129].MatchID != "m129" {
		t.Fatalf("got %d items", len(items))
	}
	if strings.Join(queries, ",") != "0/100,100/100" {
		t.Fatalf("pages %v", queries)
	}

	queries = nil
	items, _ = c.History(context.Background(), "pa", 150)
	if len(items) != 130 || strings.Join(queries, ",") != "0/100,100/50" {
		t.Fatalf("got %d items, pages %v", len(items), queries)
	}
}

// scoutFake sets up five players and five matches:
//
//	m1  newest, pa pb pc pd on faction2, league, won 13 - 9
//	m2  pa pb pc against pd pe, not together
//	m3  all five on faction1, no veto in the details, lost 8 - 13
//	m4  all five but cancelled
//	m5  oldest, four together, details and stats missing
func scoutFake(t *testing.T) *fake {
	f := newFake(t)
	all := []string{"pa", "pb", "pc", "pd", "pe"}
	items := []obj{
		historyItem(m1, 5000, "FINISHED", []string{"x1", "x2", "x3", "x4", "x5"}, []string{"pa", "pb", "pc", "pd", "x6"}),
		historyItem(m2, 4000, "FINISHED", []string{"pa", "pb", "pc", "x1", "x2"}, []string{"pd", "pe", "x3", "x4", "x5"}),
		historyItem(m3, 3000, "FINISHED", all, []string{"x1", "x2", "x3", "x4", "x5"}),
		historyItem(m4, 2000, "CANCELLED", all, []string{"x1", "x2", "x3", "x4", "x5"}),
		historyItem(m5, 1000, "FINISHED", []string{"pa", "pb", "pc", "pe", "x1"}, []string{"x2", "x3", "x4", "x5", "x6"}),
	}
	for _, p := range all {
		f.json("/data/v4/players/"+p+"/history", obj{"items": items})
	}
	f.json("/data/v4/matches/"+m1, obj{
		"match_id":         m1,
		"competition_name": "ESEA S56 EU Open Division",
		"competition_type": "championship",
		"started_at":       5000,
		"status":           "FINISHED",
		"faceit_url":       "https://www.faceit.com/{lang}/cs2/room/" + m1,
		"teams": obj{
			"faction1": obj{"faction_id": "team-x", "name": "Other Team"},
			"faction2": obj{"faction_id": "team-us", "name": "E-ManiacS"},
		},
		"voting":   obj{"map": obj{"pick": []string{"de_mirage"}}},
		"results":  obj{"winner": "faction2", "score": obj{"faction1": 0, "faction2": 1}},
		"demo_url": []string{"https://demos.example/cs2/" + m1 + "-1-1.dem.zst"},
	})
	f.json("/data/v4/matches/"+m1+"/stats", obj{"rounds": []obj{{
		"round_stats": obj{"Map": "de_mirage", "Score": "9 / 13"},
		"teams": []obj{
			{"team_id": "team-x", "team_stats": obj{"Final Score": "9"}},
			{"team_id": "team-us", "team_stats": obj{"Final Score": "13"}},
		},
	}}})
	// No veto, null fields and numbers as strings.
	f.json("/data/v4/matches/"+m3, `{"match_id":"`+m3+`","started_at":"3000","voting":null,"teams":{"faction1":{"name":"team_pa","roster":null},"faction2":{"name":"team_x1"}},"results":{"winner":"faction2","score":{"faction1":"0","faction2":null}},"demo_url":null}`)
	f.json("/data/v4/matches/"+m3+"/stats", obj{"rounds": []obj{{
		"round_stats": obj{"Map": "de_nuke", "Score": "8 / 13"},
		"teams": []obj{
			{"team_id": "?", "players": []obj{{"player_id": "pa"}}},
			{"team_id": "?", "players": []obj{{"player_id": "x1"}}},
		},
	}}})
	return f
}

func TestFindTogether(t *testing.T) {
	f := scoutFake(t)
	players := []Member{
		{FaceitID: "pa", Nickname: "Alpha"}, {FaceitID: "pb"}, {FaceitID: "pc"}, {FaceitID: "pd"}, {FaceitID: "pe"},
	}
	found, err := f.client().FindTogether(context.Background(), players, 4, 100)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, m := range found.Matches {
		ids = append(ids, m.MatchID)
	}
	if strings.Join(ids, ",") != m1+","+m3+","+m5 {
		t.Fatalf("matches %v", ids)
	}

	a := found.Matches[0]
	if a.Map != "de_mirage" || a.Kind != "league" || a.Won == nil || !*a.Won || a.Score != "13 - 9" || a.Opponent != "Other Team" || !a.Demo {
		t.Fatalf("m1 %+v", a)
	}
	if a.URL != "https://www.faceit.com/en/cs2/room/"+m1 || a.StartedAt != 5000 {
		t.Fatalf("m1 url %s at %d", a.URL, a.StartedAt)
	}
	if strings.Join(a.Players, ",") != "Alpha,nick_pb,nick_pc,nick_pd" {
		t.Fatalf("m1 players %v", a.Players)
	}

	b := found.Matches[1]
	if b.Map != "de_nuke" || b.Kind != "matchmaking" || b.Won == nil || *b.Won || b.Score != "8 - 13" || b.Demo || b.Opponent != "team_x1" {
		t.Fatalf("m3 %+v", b)
	}

	c := found.Matches[2]
	if c.Map != "" || c.Score != "" || c.Won == nil || !*c.Won || c.Opponent != "team_f2" || len(c.Players) != 4 {
		t.Fatalf("m5 %+v", c)
	}

	if len(found.Maps) != 2 || found.Maps[0] != (MapCount{"de_mirage", 1, 1}) || found.Maps[1] != (MapCount{"de_nuke", 1, 0}) {
		t.Fatalf("maps %+v", found.Maps)
	}
	// Only kept matches get their details fetched.
	if f.count("/data/v4/matches/"+m2) != 0 || f.count("/data/v4/matches/"+m4) != 0 {
		t.Fatal("details fetched for a match that was not kept")
	}

	// With three together the split match counts as well.
	found, _ = f.client().FindTogether(context.Background(), players, 3, 100)
	if len(found.Matches) != 4 {
		t.Fatalf("min 3: %d matches", len(found.Matches))
	}
}

func TestFindTogetherBySteamID(t *testing.T) {
	f := scoutFake(t)
	f.handle("/data/v4/players", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("game_player_id") == steamOf("pe") {
			json.NewEncoder(w).Encode(obj{"player_id": "pe", "nickname": "Echo"})
			return
		}
		http.NotFound(w, r)
	})
	players := []Member{
		{FaceitID: "pa"}, {SteamID: steamOf("pe")}, {SteamID: "76561198000000099", Nickname: "ghost"},
	}
	found, err := f.client().FindTogether(context.Background(), players, 3, 100)
	if err != nil {
		t.Fatal(err)
	}
	// pa and pe are together in m3 and m5. ghost is unknown, so at most two
	// of the three can be together and minTogether stays at 3.
	if len(found.Matches) != 0 {
		t.Fatalf("got %d matches", len(found.Matches))
	}
	found, _ = f.client().FindTogether(context.Background(), players, 2, 100)
	if len(found.Matches) != 2 || found.Matches[0].MatchID != m3 || strings.Join(found.Matches[0].Players, ",") != "nick_pa,Echo" {
		t.Fatalf("got %+v", found.Matches)
	}
}

func TestBadKey(t *testing.T) {
	f := scoutFake(t)
	c := f.client().WithKey("wrong")
	_, err := c.FindTogether(context.Background(), []Member{{FaceitID: "pa"}}, 1, 10)
	if Code(err) != CodeBadKey {
		t.Fatalf("err %v", err)
	}
	if strings.Contains(err.Error(), "wrong") {
		t.Fatal("key in the error")
	}
	if err := c.Check(context.Background()); Code(err) != CodeBadKey {
		t.Fatalf("check %v", err)
	}
	noKey := New(f.srv.URL, f.srv.URL, func() string { return "" })
	if _, err := noKey.Lookup(context.Background(), m1); Code(err) != CodeNoKey {
		t.Fatalf("no key %v", err)
	}
}

func TestRetryOn429(t *testing.T) {
	f := newFake(t)
	var calls atomic.Int32
	f.handle("/data/v4/games/cs2", func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.Write([]byte(`{"game_id":"cs2"}`))
	})
	if err := f.client().Check(context.Background()); err != nil || calls.Load() != 2 {
		t.Fatalf("err %v after %d calls", err, calls.Load())
	}

	calls.Store(0)
	f.handle("/data/v4/games/cs2", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Retry-After", "0")
		w.WriteHeader(http.StatusTooManyRequests)
	})
	if err := f.client().Check(context.Background()); Code(err) != CodeRateLimited || calls.Load() != 2 {
		t.Fatalf("err %v after %d calls", err, calls.Load())
	}

	// A wait longer than allowed is not waited for.
	calls.Store(0)
	f.handle("/data/v4/games/cs2", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Retry-After", "3600")
		w.WriteHeader(http.StatusTooManyRequests)
	})
	start := time.Now()
	if err := f.client().Check(context.Background()); Code(err) != CodeRateLimited || calls.Load() != 1 || time.Since(start) > 5*time.Second {
		t.Fatalf("err %v after %d calls", err, calls.Load())
	}
}

func TestRequestLimit(t *testing.T) {
	f := newFake(t)
	var now, peak atomic.Int32
	f.handle("/data/v4/players/p", func(w http.ResponseWriter, r *http.Request) {
		n := now.Add(1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		now.Add(-1)
		w.Write([]byte(`{"player_id":"p"}`))
	})
	c := f.client()
	done := make(chan struct{})
	for i := 0; i < 12; i++ {
		go func() {
			c.Player(context.Background(), "p")
			done <- struct{}{}
		}()
	}
	for i := 0; i < 12; i++ {
		<-done
	}
	if peak.Load() > maxInFlight || peak.Load() < 2 {
		t.Fatalf("peak %d requests in flight", peak.Load())
	}
}

func TestLookupMatch(t *testing.T) {
	f := newFake(t)
	f.json("/data/v4/matches/"+m1, obj{
		"match_id":         m1,
		"competition_name": "ESEA S56 EU Open Division",
		"scheduled_at":     1791374400,
		"status":           "READY",
		"teams": obj{
			"faction1": obj{"faction_id": "t1", "name": "Us", "avatar": "https://a/1.png", "roster": []obj{
				{"player_id": "pa", "nickname": "Alpha", "game_player_id": steamOf("pa")},
				{"player_id": "pb", "nickname": "Bravo", "game_player_id": ""},
			}},
			"faction2": obj{"faction_id": "t2", "name": "E-ManiacS", "roster": []obj{
				{"player_id": "pc", "nickname": "Charlie", "game_player_id": steamOf("pc")},
			}},
		},
	})
	f.json("/data/v4/players/pb", obj{"player_id": "pb", "nickname": "Bravo", "games": obj{"cs2": obj{"game_player_id": steamOf("pb")}}})
	l, err := f.client().Lookup(context.Background(), "https://www.faceit.com/sv/cs2/room/"+m1)
	if err != nil {
		t.Fatal(err)
	}
	if l.MatchID != m1 || l.Map != "" || l.StartedAt != 1791374400 || len(l.Teams) != 2 || l.Competition == "" {
		t.Fatalf("lineup %+v", l)
	}
	if l.Teams[0].Name != "Us" || l.Teams[0].Players[1].SteamID != steamOf("pb") || l.Teams[1].Players[0].SteamID != steamOf("pc") {
		t.Fatalf("teams %+v", l.Teams)
	}
	// The match is not played yet, so there are no stats to ask for.
	if f.count("/data/v4/matches/"+m1+"/stats") != 0 {
		t.Fatal("stats fetched for an upcoming match")
	}

	if _, err := f.client().Lookup(context.Background(), m2); Code(err) != CodeNotFound {
		t.Fatalf("missing match: %v", err)
	}
	if _, err := f.client().Lookup(context.Background(), "hello"); Code(err) != CodeBadRequest {
		t.Fatalf("bad link: %v", err)
	}
}

func TestLookupTeam(t *testing.T) {
	f := newFake(t)
	team := "5b7cbb9b-03a2-4f2e-a6b4-d6d6f7b3c4c1"
	f.json("/data/v4/teams/"+team, obj{"team_id": team, "name": "E-ManiacS", "members": []obj{
		{"user_id": "pa", "nickname": "Alpha"}, {"user_id": "pb", "nickname": "Bravo"}, {"user_id": ""},
	}})
	f.json("/data/v4/players/pa", obj{"player_id": "pa", "games": obj{"cs2": obj{"game_player_id": steamOf("pa")}}})
	f.json("/data/v4/players/pb", obj{"player_id": "pb", "steam_id_64": steamOf("pb"), "games": nil})
	l, err := f.client().Lookup(context.Background(), "https://www.faceit.com/en/teams/"+team)
	if err != nil {
		t.Fatal(err)
	}
	if l.MatchID != "" || len(l.Teams) != 1 || l.Teams[0].Name != "E-ManiacS" || len(l.Teams[0].Players) != 2 {
		t.Fatalf("lineup %+v", l)
	}
	if l.Teams[0].Players[0].SteamID != steamOf("pa") || l.Teams[0].Players[1].SteamID != steamOf("pb") {
		t.Fatalf("players %+v", l.Teams[0].Players)
	}
}

func TestMapFallbackToStats(t *testing.T) {
	f := newFake(t)
	f.json("/data/v4/matches/"+m1, obj{"match_id": m1, "status": "FINISHED", "voting": obj{"map": obj{"pick": []string{"8a7b"}, "entities": []obj{{"guid": "8a7b", "class_name": "de_ancient"}}}}})
	f.json("/data/v4/matches/"+m2, obj{"match_id": m2, "status": "FINISHED"})
	f.json("/data/v4/matches/"+m2+"/stats", obj{"rounds": []obj{{"round_stats": obj{"Map": "de_anubis"}}}})
	for id, want := range map[string]string{m1: "de_ancient", m2: "de_anubis"} {
		l, err := f.client().Lookup(context.Background(), id)
		if err != nil || l.Map != want {
			t.Fatalf("%s: %v %+v", id, err, l)
		}
	}
}

func TestDemoURL(t *testing.T) {
	f := newFake(t)
	var body map[string]string
	f.handle("/download/v2/demos/download", func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&body)
		w.Write([]byte(`{"payload":{"download_url":"https://cdn.example/x.dem.zst?sig=1"}}`))
	})
	c := f.client()
	link, err := c.DemoURL(context.Background(), "https://demos.example/x.dem.zst")
	if err != nil || link != "https://cdn.example/x.dem.zst?sig=1" || body["resource_url"] != "https://demos.example/x.dem.zst" {
		t.Fatalf("link %q err %v body %v", link, err, body)
	}
	if f.count("/download/v2/demos/download-url") != 1 {
		t.Fatal("the newer path was not tried first")
	}

	f.handle("/download/v2/demos/download-url", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	})
	_, err = c.DemoURL(context.Background(), "https://demos.example/x.dem.zst")
	if Code(err) != CodeNoDownloads || err.Error() != NoDownloadsMsg {
		t.Fatalf("err %v", err)
	}
}

func TestFetch(t *testing.T) {
	f := newFake(t)
	data := bytes.Repeat([]byte{0x28, 0xb5, 0x2f, 0xfd}, 1<<19)
	f.handle("/cdn/x.dem.zst", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("key sent to the file server")
		}
		w.Write(data)
	})
	f.handle("/cdn/expired.dem.zst", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	})
	c := f.client()
	var buf bytes.Buffer
	var last int64
	n, err := c.Fetch(context.Background(), f.srv.URL+"/cdn/x.dem.zst", &buf, 1<<30, func(done, total int64) { last = done })
	if err != nil || n != int64(len(data)) || !bytes.Equal(buf.Bytes(), data) || last == 0 {
		t.Fatalf("n %d err %v progress %d", n, err, last)
	}
	if _, err := c.Fetch(context.Background(), f.srv.URL+"/cdn/x.dem.zst", &buf, 1000, nil); err == nil {
		t.Fatal("size limit not applied")
	}
	if _, err := c.Fetch(context.Background(), f.srv.URL+"/cdn/expired.dem.zst", &buf, 1<<30, nil); !errors.Is(err, ErrLinkExpired) {
		t.Fatalf("err %v", err)
	}
	if _, err := c.Fetch(context.Background(), "file:///etc/passwd", &buf, 1<<30, nil); err == nil {
		t.Fatal("non http link accepted")
	}
}

func TestLenientJSON(t *testing.T) {
	var m Match
	raw := `{"match_id":"x","started_at":"1700000000","teams":[],"voting":{"map":{"pick":null}},"results":{"winner":null,"score":{"faction1":"13","faction2":9.0}},"demo_url":"nope"}`
	if err := decode(strings.NewReader(raw), &m); err != nil {
		t.Fatal(err)
	}
	if m.MatchID != "x" || m.When() != 1700000000 || m.MapName() != "" || m.Results.Score["faction1"] != 13 || m.Results.Score["faction2"] != 9 {
		t.Fatalf("%+v", m)
	}
	if err := decode(strings.NewReader("<html>"), &m); Code(err) != CodeUnreachable {
		t.Fatalf("html: %v", err)
	}
}
