package faceit

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// Lineup is a match with both teams, or a single team when Lineup was made
// from a team link.
type Lineup struct {
	MatchID     string `json:"matchId"`
	Map         string `json:"map"`
	StartedAt   int64  `json:"startedAt"`
	Competition string `json:"competition"`
	Teams       []Side `json:"teams"`
}

type Side struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Avatar  string   `json:"avatar"`
	Players []Member `json:"players"`
}

type Member struct {
	FaceitID string `json:"faceitId"`
	Nickname string `json:"nickname"`
	SteamID  string `json:"steamId"`
	Avatar   string `json:"avatar"`
}

// Lookup reads a pasted link and returns the teams it points at.
func (c *Client) Lookup(ctx context.Context, link string) (*Lineup, error) {
	ref, ok := ParseURL(link)
	if !ok {
		return nil, newError(CodeBadRequest, "Paste a FACEIT match room link or a team link")
	}
	if ref.Kind == "team" {
		return c.teamLineup(ctx, ref.ID)
	}
	return c.matchLineup(ctx, ref.ID)
}

func (c *Client) matchLineup(ctx context.Context, id string) (*Lineup, error) {
	m, err := c.Match(ctx, id)
	if err != nil {
		return nil, notFound(err, "FACEIT has no match with that id")
	}
	l := &Lineup{MatchID: firstNonEmpty(m.MatchID, id), Map: m.MapName(), StartedAt: m.When(), Competition: m.CompetitionName}
	if l.Map == "" && isFinished(m.Status) {
		if st, err := c.MatchStats(ctx, id); err == nil {
			l.Map = st.mapName()
		}
	}
	for _, key := range factions {
		f := m.Faction(key)
		side := Side{ID: f.FactionID, Name: f.Name, Avatar: f.Avatar, Players: []Member{}}
		for _, r := range f.Roster {
			mem := Member{FaceitID: r.PlayerID, Nickname: r.Nickname, Avatar: r.Avatar}
			if validSteamID(string(r.GamePlayerID)) {
				mem.SteamID = string(r.GamePlayerID)
			}
			side.Players = append(side.Players, mem)
		}
		l.Teams = append(l.Teams, side)
	}
	for i := range l.Teams {
		if err := c.fillSteamIDs(ctx, l.Teams[i].Players); err != nil {
			return nil, err
		}
	}
	return l, nil
}

func (c *Client) teamLineup(ctx context.Context, id string) (*Lineup, error) {
	t, err := c.Team(ctx, id)
	if err != nil {
		return nil, notFound(err, "FACEIT has no team with that id")
	}
	side := Side{ID: firstNonEmpty(t.TeamID, id), Name: firstNonEmpty(t.Name, t.Nickname), Avatar: t.Avatar, Players: []Member{}}
	for _, m := range t.Members {
		if m.UserID == "" {
			continue
		}
		side.Players = append(side.Players, Member{FaceitID: m.UserID, Nickname: m.Nickname, Avatar: m.Avatar})
	}
	if err := c.fillSteamIDs(ctx, side.Players); err != nil {
		return nil, err
	}
	return &Lineup{Teams: []Side{side}}, nil
}

// fillSteamIDs looks up the players that came without a SteamID. A player
// that cannot be found keeps an empty one, only key and rate limit problems
// are returned.
func (c *Client) fillSteamIDs(ctx context.Context, players []Member) error {
	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		fatal error
	)
	for i := range players {
		if players[i].SteamID != "" || players[i].FaceitID == "" {
			continue
		}
		wg.Add(1)
		go func(p *Member) {
			defer wg.Done()
			info, err := c.Player(ctx, p.FaceitID)
			if err != nil {
				if isFatal(err) {
					mu.Lock()
					fatal = cmpErr(fatal, err)
					mu.Unlock()
				}
				return
			}
			p.SteamID = info.SteamID()
			if p.Nickname == "" {
				p.Nickname = info.Nickname
			}
			if p.Avatar == "" {
				p.Avatar = info.Avatar
			}
		}(&players[i])
	}
	wg.Wait()
	return fatal
}

// Found is the result of FindTogether.
type Found struct {
	Matches []FoundMatch `json:"matches"`
	Maps    []MapCount   `json:"maps"`
}

type FoundMatch struct {
	MatchID     string   `json:"matchId"`
	URL         string   `json:"url"`
	Map         string   `json:"map"`
	StartedAt   int64    `json:"startedAt"`
	Competition string   `json:"competition"`
	Kind        string   `json:"kind"`
	Won         *bool    `json:"won"`
	Score       string   `json:"score"`
	Players     []string `json:"players"`
	Opponent    string   `json:"opponent"`
	Demo        bool     `json:"demo"`
	ReplayID    string   `json:"replayId"`
}

type MapCount struct {
	Map    string `json:"map"`
	Played int    `json:"played"`
	Won    int    `json:"won"`
}

// MaxFound is the most matches FindTogether returns.
const MaxFound = 60

// together collects what the players' histories say about one match.
type together struct {
	item HistoryItem
	// sides holds, per faction, the indexes of the given players seen in it.
	sides map[string]map[int]bool
}

// FindTogether walks the history of every player and keeps the matches
// where at least minTogether of them were on the same side. Only those get
// their details fetched. The newest MaxFound come back, newest first.
func (c *Client) FindTogether(ctx context.Context, players []Member, minTogether, limit int) (*Found, error) {
	if !c.HasKey() {
		return nil, newError(CodeNoKey, "Add your FACEIT API key in the settings first")
	}
	players = dedupe(players)
	if len(players) == 0 {
		return nil, newError(CodeBadRequest, "No players to look for")
	}
	if limit <= 0 {
		limit = 100
	}
	limit = min(limit, 1000)
	if err := c.resolvePlayers(ctx, players); err != nil {
		return nil, err
	}
	// Two entries can turn out to be the same FACEIT account.
	players = dedupe(players)
	if minTogether <= 0 {
		minTogether = 4
	}
	minTogether = min(minTogether, len(players))
	histories, err := c.histories(ctx, players, limit)
	if err != nil {
		return nil, err
	}
	kept := groupTogether(players, histories, minTogether)
	if len(kept) > MaxFound {
		kept = kept[:MaxFound]
	}

	out := make([]FoundMatch, len(kept))
	var wg sync.WaitGroup
	for i, g := range kept {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out[i] = c.describe(ctx, g, players)
		}()
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &Found{Matches: out, Maps: countMaps(out)}, nil
}

func dedupe(players []Member) []Member {
	seen := map[string]bool{}
	var out []Member
	for _, p := range players {
		p.FaceitID = strings.TrimSpace(p.FaceitID)
		p.SteamID = strings.TrimSpace(p.SteamID)
		p.Nickname = strings.TrimSpace(p.Nickname)
		var key string
		switch {
		case p.FaceitID != "":
			key = "f:" + p.FaceitID
		case p.SteamID != "":
			key = "s:" + p.SteamID
		case p.Nickname != "":
			key = "n:" + strings.ToLower(p.Nickname)
		default:
			continue
		}
		if !seen[key] {
			seen[key] = true
			out = append(out, p)
		}
	}
	return out
}

// resolvePlayers finds the FACEIT id of players given only by SteamID or
// nickname. Players FACEIT does not know have no history to walk, but can
// still be recognised by SteamID in the others' matches.
func (c *Client) resolvePlayers(ctx context.Context, players []Member) error {
	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		fatal error
	)
	for i := range players {
		if players[i].FaceitID != "" {
			continue
		}
		wg.Add(1)
		go func(p *Member) {
			defer wg.Done()
			var info *Player
			var err error
			if validSteamID(p.SteamID) {
				info, err = c.PlayerBySteamID(ctx, p.SteamID)
			}
			if (info == nil || info.PlayerID == "") && p.Nickname != "" && !isFatal(err) {
				info, err = c.PlayerByNickname(ctx, p.Nickname)
			}
			if err != nil || info == nil {
				if isFatal(err) {
					mu.Lock()
					fatal = cmpErr(fatal, err)
					mu.Unlock()
				}
				return
			}
			p.FaceitID = info.PlayerID
			if p.SteamID == "" {
				p.SteamID = info.SteamID()
			}
			if p.Nickname == "" {
				p.Nickname = info.Nickname
			}
		}(&players[i])
	}
	wg.Wait()
	return fatal
}

func (c *Client) histories(ctx context.Context, players []Member, limit int) ([][]HistoryItem, error) {
	out := make([][]HistoryItem, len(players))
	errs := make([]error, len(players))
	var wg sync.WaitGroup
	for i, p := range players {
		if p.FaceitID == "" {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			out[i], errs[i] = c.History(ctx, p.FaceitID, limit)
		}()
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	found := 0
	for i, err := range errs {
		if isFatal(err) {
			return nil, err
		}
		if err == nil && players[i].FaceitID != "" {
			found++
		}
	}
	if found == 0 {
		for _, err := range errs {
			if err != nil {
				return nil, err
			}
		}
		return nil, newError(CodeNotFound, "None of these players were found on FACEIT")
	}
	return out, nil
}

// groupTogether groups the history items by match and keeps the matches
// where at least minTogether players were in the same faction, newest
// first.
func groupTogether(players []Member, histories [][]HistoryItem, minTogether int) []*together {
	byFaceit := map[string]int{}
	bySteam := map[string]int{}
	for i, p := range players {
		if p.FaceitID != "" {
			byFaceit[p.FaceitID] = i
		}
		if p.SteamID != "" {
			bySteam[p.SteamID] = i
		}
	}
	index := func(hp HistoryPlayer) (int, bool) {
		if i, ok := byFaceit[hp.PlayerID]; ok && hp.PlayerID != "" {
			return i, true
		}
		i, ok := bySteam[string(hp.GamePlayerID)]
		return i, ok && hp.GamePlayerID != ""
	}

	groups := map[string]*together{}
	for _, items := range histories {
		for _, it := range items {
			if it.MatchID == "" || isCancelled(it.Status) {
				continue
			}
			g, ok := groups[it.MatchID]
			if !ok {
				g = &together{item: it, sides: map[string]map[int]bool{}}
				groups[it.MatchID] = g
			}
			for _, key := range factions {
				for _, hp := range it.Teams[key].Players {
					if i, ok := index(hp); ok {
						if g.sides[key] == nil {
							g.sides[key] = map[int]bool{}
						}
						g.sides[key][i] = true
					}
				}
			}
			if g.item.StartedAt == 0 && it.StartedAt != 0 {
				g.item.StartedAt = it.StartedAt
			}
		}
	}

	var kept []*together
	for _, g := range groups {
		if len(g.sides[g.side()]) >= minTogether {
			kept = append(kept, g)
		}
	}
	sort.Slice(kept, func(i, j int) bool {
		a, b := kept[i].when(), kept[j].when()
		if a != b {
			return a > b
		}
		return kept[i].item.MatchID < kept[j].item.MatchID
	})
	return kept
}

// side returns the faction with the most of the given players.
func (g *together) side() string {
	if len(g.sides[factions[1]]) > len(g.sides[factions[0]]) {
		return factions[1]
	}
	return factions[0]
}

func (g *together) when() int64 {
	if g.item.StartedAt > 0 {
		return int64(g.item.StartedAt)
	}
	return int64(g.item.FinishedAt)
}

// describe turns a kept match into a result, filling in what the match
// details and stats add. A match whose details cannot be fetched still comes
// back with what the history knew.
func (c *Client) describe(ctx context.Context, g *together, players []Member) FoundMatch {
	it := g.item
	side := g.side()
	fm := FoundMatch{
		MatchID:     it.MatchID,
		URL:         RoomURL(it.MatchID, it.FaceitURL),
		StartedAt:   g.when(),
		Competition: it.CompetitionName,
		Kind:        Kind(it.CompetitionType, it.CompetitionName),
		Opponent:    it.Teams[otherFaction(side)].Nickname,
		Players:     []string{},
	}
	for i, p := range players {
		if g.sides[side][i] {
			fm.Players = append(fm.Players, firstNonEmpty(p.Nickname, nickIn(it.Teams[side].Players, p.FaceitID)))
		}
	}
	fm.Won = won(it.Results, side)

	m, err := c.Match(ctx, it.MatchID)
	if err == nil {
		fm.Map = m.MapName()
		fm.URL = RoomURL(it.MatchID, firstNonEmpty(m.FaceitURL, it.FaceitURL))
		fm.Competition = firstNonEmpty(m.CompetitionName, fm.Competition)
		fm.Kind = Kind(firstNonEmpty(m.CompetitionType, it.CompetitionType), fm.Competition)
		fm.Opponent = firstNonEmpty(m.Faction(otherFaction(side)).Name, fm.Opponent)
		if fm.StartedAt == 0 {
			fm.StartedAt = m.When()
		}
		for _, u := range m.DemoURL {
			if strings.TrimSpace(u) != "" {
				fm.Demo = true
			}
		}
		if w := won(m.Results, side); w != nil {
			fm.Won = w
		}
		if a, b, ok := roundScore(m.Results, side); ok {
			fm.Score = fmt.Sprintf("%d - %d", a, b)
		}
	}
	// The match score counts maps, the round score is only in the stats.
	if fm.Map == "" || fm.Score == "" {
		if st, err := c.MatchStats(ctx, it.MatchID); err == nil {
			if fm.Map == "" {
				fm.Map = st.mapName()
			}
			if fm.Score == "" {
				fm.Score = st.score(players, g.sides[side], m, side)
			}
		}
	}
	return fm
}

func nickIn(players []HistoryPlayer, id string) string {
	for _, p := range players {
		if p.PlayerID == id {
			return p.Nickname
		}
	}
	return ""
}

func won(r *Results, side string) *bool {
	if r == nil || (r.Winner != factions[0] && r.Winner != factions[1]) {
		return nil
	}
	w := r.Winner == side
	return &w
}

// roundScore reads the match result when it holds rounds. For most matches
// it only counts maps (1 - 0), then the stats have the rounds.
func roundScore(r *Results, side string) (int, int, bool) {
	if r == nil || r.Score == nil {
		return 0, 0, false
	}
	a, okA := r.Score[side]
	b, okB := r.Score[otherFaction(side)]
	if !okA || !okB || max(a, b) <= 3 {
		return 0, 0, false
	}
	return int(a), int(b), true
}

func (s *Stats) mapName() string {
	for _, r := range s.Rounds {
		if name := normalizeMap(string(r.RoundStats["Map"]), nil); name != "" {
			return name
		}
	}
	return ""
}

// score returns the round score of the first map from our side, for example
// "13 - 9".
func (s *Stats) score(players []Member, ours map[int]bool, m *Match, side string) string {
	if len(s.Rounds) == 0 {
		return ""
	}
	r := s.Rounds[0]
	ourIDs := map[string]bool{}
	for i := range ours {
		ourIDs[players[i].FaceitID] = true
	}
	factionID := ""
	if m != nil {
		factionID = m.Faction(side).FactionID
	}
	us := -1
	for i, t := range r.Teams {
		if factionID != "" && t.TeamID == factionID {
			us = i
			break
		}
		for _, p := range t.Players {
			if ourIDs[p.PlayerID] {
				us = i
			}
		}
		if us >= 0 {
			break
		}
	}
	if us < 0 || len(r.Teams) != 2 {
		return ""
	}
	them := 1 - us
	a, errA := strconv.Atoi(strings.TrimSpace(string(r.Teams[us].TeamStats["Final Score"])))
	b, errB := strconv.Atoi(strings.TrimSpace(string(r.Teams[them].TeamStats["Final Score"])))
	if errA != nil || errB != nil {
		// "13 / 9" lists the teams in the same order as the stats.
		parts := strings.Split(string(r.RoundStats["Score"]), "/")
		if len(parts) != 2 {
			return ""
		}
		x, errX := strconv.Atoi(strings.TrimSpace(parts[us]))
		y, errY := strconv.Atoi(strings.TrimSpace(parts[them]))
		if errX != nil || errY != nil {
			return ""
		}
		a, b = x, y
	}
	return fmt.Sprintf("%d - %d", a, b)
}

// Kind sorts a match into "league", "matchmaking" or "other".
func Kind(competitionType, competitionName string) string {
	t := strings.ToLower(competitionType)
	n := strings.ToLower(competitionName)
	for _, w := range []string{"championship", "league", "esea"} {
		if strings.Contains(t, w) || strings.Contains(n, w) {
			return "league"
		}
	}
	if t == "matchmaking" || strings.Contains(n, "queue") || strings.Contains(n, "matchmaking") || strings.Contains(n, "5v5 ranked") {
		return "matchmaking"
	}
	return "other"
}

func countMaps(matches []FoundMatch) []MapCount {
	out := []MapCount{}
	index := map[string]int{}
	for _, m := range matches {
		if m.Map == "" {
			continue
		}
		i, ok := index[m.Map]
		if !ok {
			i = len(out)
			index[m.Map] = i
			out = append(out, MapCount{Map: m.Map})
		}
		out[i].Played++
		if m.Won != nil && *m.Won {
			out[i].Won++
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Played != out[j].Played {
			return out[i].Played > out[j].Played
		}
		return out[i].Map < out[j].Map
	})
	return out
}

func isFinished(status string) bool {
	s := strings.ToLower(status)
	return s == "finished" || s == ""
}

func isCancelled(status string) bool {
	s := strings.ToLower(status)
	return s == "cancelled" || s == "canceled" || s == "aborted"
}

// isFatal reports errors that would fail every other call as well.
func isFatal(err error) bool {
	switch Code(err) {
	case CodeNoKey, CodeBadKey, CodeRateLimited:
		return true
	}
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func cmpErr(have, err error) error {
	if have != nil {
		return have
	}
	return err
}

func notFound(err error, msg string) error {
	if Code(err) == CodeNotFound {
		return &Error{Code: CodeNotFound, Msg: msg, Status: 404, err: err}
	}
	return err
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
