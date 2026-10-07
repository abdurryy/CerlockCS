package faceit

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// Number reads a JSON number that FACEIT sometimes sends as a string or
// null. Anything unreadable becomes 0.
type Number float64

func (n *Number) UnmarshalJSON(b []byte) error {
	s := strings.Trim(strings.TrimSpace(string(b)), `"`)
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		f = 0
	}
	*n = Number(f)
	return nil
}

// Text reads a JSON string that may also come as a number or null.
type Text string

func (t *Text) UnmarshalJSON(b []byte) error {
	var s string
	if json.Unmarshal(b, &s) == nil {
		*t = Text(s)
		return nil
	}
	raw := strings.TrimSpace(string(b))
	if raw == "null" || strings.HasPrefix(raw, "{") || strings.HasPrefix(raw, "[") {
		*t = ""
		return nil
	}
	*t = Text(raw)
	return nil
}

type Match struct {
	MatchID         string             `json:"match_id"`
	Game            string             `json:"game"`
	CompetitionName string             `json:"competition_name"`
	CompetitionType string             `json:"competition_type"`
	StartedAt       Number             `json:"started_at"`
	ScheduledAt     Number             `json:"scheduled_at"`
	ConfiguredAt    Number             `json:"configured_at"`
	FinishedAt      Number             `json:"finished_at"`
	Status          string             `json:"status"`
	FaceitURL       string             `json:"faceit_url"`
	Teams           map[string]Faction `json:"teams"`
	Voting          *Voting            `json:"voting"`
	Results         *Results           `json:"results"`
	DemoURL         []string           `json:"demo_url"`
}

type Faction struct {
	FactionID string        `json:"faction_id"`
	Name      string        `json:"name"`
	Avatar    string        `json:"avatar"`
	Roster    []RosterEntry `json:"roster"`
}

type RosterEntry struct {
	PlayerID       string `json:"player_id"`
	Nickname       string `json:"nickname"`
	Avatar         string `json:"avatar"`
	GamePlayerID   Text   `json:"game_player_id"`
	GamePlayerName string `json:"game_player_name"`
}

type Voting struct {
	Map struct {
		Pick     []string    `json:"pick"`
		Entities []MapEntity `json:"entities"`
	} `json:"map"`
}

type MapEntity struct {
	GUID      string `json:"guid"`
	GameMapID string `json:"game_map_id"`
	ClassName string `json:"class_name"`
	Name      string `json:"name"`
}

type Results struct {
	Winner string            `json:"winner"`
	Score  map[string]Number `json:"score"`
}

type HistoryItem struct {
	MatchID         string                 `json:"match_id"`
	GameMode        string                 `json:"game_mode"`
	MatchType       string                 `json:"match_type"`
	CompetitionName string                 `json:"competition_name"`
	CompetitionType string                 `json:"competition_type"`
	StartedAt       Number                 `json:"started_at"`
	FinishedAt      Number                 `json:"finished_at"`
	Status          string                 `json:"status"`
	Teams           map[string]HistoryTeam `json:"teams"`
	Results         *Results               `json:"results"`
	FaceitURL       string                 `json:"faceit_url"`
}

type HistoryTeam struct {
	TeamID   string          `json:"team_id"`
	Nickname string          `json:"nickname"`
	Players  []HistoryPlayer `json:"players"`
}

type HistoryPlayer struct {
	PlayerID     string `json:"player_id"`
	Nickname     string `json:"nickname"`
	GamePlayerID Text   `json:"game_player_id"`
}

type Team struct {
	TeamID   string       `json:"team_id"`
	Name     string       `json:"name"`
	Nickname string       `json:"nickname"`
	Avatar   string       `json:"avatar"`
	Members  []TeamMember `json:"members"`
}

type TeamMember struct {
	UserID   string `json:"user_id"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}

type Player struct {
	PlayerID  string                `json:"player_id"`
	Nickname  string                `json:"nickname"`
	Avatar    string                `json:"avatar"`
	SteamID64 Text                  `json:"steam_id_64"`
	Games     map[string]PlayerGame `json:"games"`
}

type PlayerGame struct {
	GamePlayerID   Text   `json:"game_player_id"`
	GamePlayerName string `json:"game_player_name"`
}

// SteamID returns the player's CS2 SteamID64, or "" when FACEIT has none.
func (p *Player) SteamID() string {
	if g, ok := p.Games["cs2"]; ok && validSteamID(string(g.GamePlayerID)) {
		return string(g.GamePlayerID)
	}
	if validSteamID(string(p.SteamID64)) {
		return string(p.SteamID64)
	}
	return ""
}

type Stats struct {
	Rounds []StatsRound `json:"rounds"`
}

type StatsRound struct {
	RoundStats map[string]Text `json:"round_stats"`
	Teams      []StatsTeam     `json:"teams"`
}

type StatsTeam struct {
	TeamID    string          `json:"team_id"`
	TeamStats map[string]Text `json:"team_stats"`
	Players   []StatsPlayer   `json:"players"`
}

type StatsPlayer struct {
	PlayerID string `json:"player_id"`
	Nickname string `json:"nickname"`
}

var steamIDPattern = regexp.MustCompile(`^7656\d{13}$`)

func validSteamID(s string) bool { return steamIDPattern.MatchString(s) }

var (
	mapPattern  = regexp.MustCompile(`^(de|cs|ar|dz|gd)_[a-z0-9_]+$`)
	wordPattern = regexp.MustCompile(`^[a-z0-9]+$`)
)

// MapName returns the picked map, for example "de_mirage", or "" when the
// veto is not done.
func (m *Match) MapName() string {
	if m.Voting == nil {
		return ""
	}
	for _, pick := range m.Voting.Map.Pick {
		if name := normalizeMap(pick, m.Voting.Map.Entities); name != "" {
			return name
		}
	}
	return ""
}

func normalizeMap(pick string, entities []MapEntity) string {
	p := strings.ToLower(strings.TrimSpace(pick))
	if mapPattern.MatchString(p) {
		return p
	}
	for _, e := range entities {
		if pick != e.GUID && pick != e.GameMapID && pick != e.Name {
			continue
		}
		for _, v := range []string{e.ClassName, e.GameMapID, e.GUID} {
			if v = strings.ToLower(v); mapPattern.MatchString(v) {
				return v
			}
		}
	}
	// Some old matches only carry the display name, for example "Mirage".
	if simple := strings.ReplaceAll(p, " ", ""); wordPattern.MatchString(simple) {
		return "de_" + simple
	}
	return ""
}

// Faction returns faction1 or faction2.
func (m *Match) Faction(key string) Faction { return m.Teams[key] }

// When returns the best known time of the match in unix seconds.
func (m *Match) When() int64 {
	for _, t := range []Number{m.StartedAt, m.ScheduledAt, m.ConfiguredAt, m.FinishedAt} {
		if t > 0 {
			return int64(t)
		}
	}
	return 0
}

// RoomURL returns the English match room link.
func RoomURL(id, faceitURL string) string {
	if strings.HasPrefix(faceitURL, "https://") && strings.Contains(faceitURL, "/room/") {
		return strings.ReplaceAll(faceitURL, "{lang}", "en")
	}
	return "https://www.faceit.com/en/cs2/room/" + id
}

var factions = [2]string{"faction1", "faction2"}

func otherFaction(f string) string {
	if f == factions[0] {
		return factions[1]
	}
	return factions[0]
}
