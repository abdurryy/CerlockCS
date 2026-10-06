package analysis

import (
	"testing"

	"github.com/abdurryy/CerlockCS/internal/match"
)

// fixture builds a 5v5 round where team 0 opens, loses a player and trades
// him two seconds later.
func fixture() *match.Match {
	m := &match.Match{TickRate: 64}
	for i := 0; i < 10; i++ {
		m.Players = append(m.Players, match.Player{Index: i, Team: i / 5})
	}
	m.Frames.Ticks = []int32{0, 1000, 2000}
	m.Frames.Tracks = make([]match.Track, 10)
	for i := range m.Frames.Tracks {
		m.Frames.Tracks[i].Grow(3)
		for f := 0; f < 3; f++ {
			m.Frames.Tracks[i].Flags[f] = match.FlagAlive
			m.Frames.Tracks[i].X[f] = int16(i * 100)
		}
	}
	r := match.Round{StartTick: 0, FreezeEndTick: 0, EndTick: 5000, Winner: match.SideCT, WinnerTeam: 0,
		SideOf: [2]match.Side{match.SideCT, match.SideT}}
	for i := 0; i < 10; i++ {
		side := match.SideCT
		if i >= 5 {
			side = match.SideT
		}
		r.Players = append(r.Players, match.RoundPlayer{Player: i, Side: side, EquipValue: 5000})
	}
	m.Rounds = []match.Round{r}
	kill := func(tick, killer, victim int) {
		m.Kills = append(m.Kills, match.Kill{Tick: tick, Killer: killer, Victim: victim, Assister: -1, Weapon: 303,
			VictimPos: [3]float32{float32(victim * 100), 0, 0}})
	}
	kill(1500, 0, 5)  // opening kill for team 0
	kill(1600, 6, 1)  // team 1 kills player 1
	kill(1728, 2, 6)  // traded two seconds later
	kill(3000, 2, 7)
	kill(3100, 2, 8)
	kill(3200, 9, 2)
	kill(3300, 3, 9)
	return m
}

func TestTradesAndOpenings(t *testing.T) {
	r := Analyze(fixture())
	info := r.Rounds[0]
	if info.OpeningKill != 0 {
		t.Fatalf("opening kill = %d", info.OpeningKill)
	}
	if len(info.Traded) == 0 || info.Traded[0] != 1 {
		t.Fatalf("traded = %v", info.Traded)
	}
	p2 := r.Players[2]
	if p2.Kills != 3 || p2.TradeKills != 1 || p2.Deaths != 1 {
		t.Fatalf("player 2 = %+v", p2)
	}
	if r.Players[1].TradedDeaths != 1 || r.Players[0].OpeningKills != 1 || r.Players[5].OpeningDeaths != 1 {
		t.Fatal("opening or trade attribution is wrong")
	}
	if p2.MultiKills[3] != 1 {
		t.Fatalf("multi kills = %v", p2.MultiKills)
	}
	ts := r.Teams[0]
	if ts.OpeningKills != 1 || ts.AdvantageRounds.Won != 1 || ts.Sides["CT"].Won != 1 {
		t.Fatalf("team stats = %+v", ts)
	}
}

func TestClutch(t *testing.T) {
	m := fixture()
	// Leave team 1 with a single player against three.
	m.Kills = m.Kills[:5]
	m.Rounds[0].Winner = match.SideT
	m.Rounds[0].WinnerTeam = 1
	r := Analyze(m)
	c := r.Rounds[0].Clutch
	if c == nil || c.Player != 9 || c.Versus != 4 || !c.Won {
		t.Fatalf("clutch = %+v", c)
	}
}

func TestBuyType(t *testing.T) {
	cases := map[int]string{500: "eco", 2500: "force", 4800: "full"}
	for v, want := range cases {
		if got := buyType(v, false); got != want {
			t.Errorf("buyType(%d) = %s, want %s", v, got, want)
		}
	}
	if buyType(4000, true) != "pistol" {
		t.Error("pistol round not detected")
	}
}
