package parse

import (
	"sort"

	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"

	"github.com/abdurryy/CerlockCS/internal/aim"
	"github.com/abdurryy/CerlockCS/internal/match"
)

var endReasons = map[events.RoundEndReason]string{
	events.RoundEndReasonTargetBombed:        "bomb_exploded",
	events.RoundEndReasonBombDefused:         "bomb_defused",
	events.RoundEndReasonCTWin:               "t_eliminated",
	events.RoundEndReasonTerroristsWin:       "ct_eliminated",
	events.RoundEndReasonTargetSaved:         "time_ran_out",
	events.RoundEndReasonDraw:                "draw",
	events.RoundEndReasonTerroristsSurrender: "t_surrender",
	events.RoundEndReasonCTSurrender:         "ct_surrender",
}

func (c *collector) registerRounds() {
	p := c.p
	p.RegisterEventHandler(func(e events.RoundStart) {
		gs := p.GameState()
		if gs.IsWarmupPeriod() {
			return
		}
		tick := c.tick()
		// A round start with nothing played means the match (re)started,
		// for example after a knife round or a "live on three" restart.
		if gs.TotalRoundsPlayed() == 0 && len(c.m.Rounds) > 0 {
			c.reset()
		}
		if !c.recording {
			c.beginRecording()
		}
		c.startRound(tick)
	})

	p.RegisterEventHandler(func(events.RoundFreezetimeEnd) {
		if r := c.current(); r != nil {
			r.FreezeEndTick = c.tick()
			// Inventories and equipment values are updated after this event
			// fires, take the snapshot half a second later.
			c.econAt = r.FreezeEndTick + int(c.tickRate()/2)
		}
	})

	p.RegisterEventHandler(func(e events.RoundEnd) {
		r := c.current()
		if r == nil || r.EndTick > 0 {
			return
		}
		r.EndTick = c.tick()
		r.Winner = match.Side(e.Winner)
		r.Reason = endReasons[e.Reason]
		if r.Reason == "" {
			r.Reason = "other"
		}
		if r.FreezeEndTick == 0 {
			r.FreezeEndTick = r.StartTick
		}
		if len(r.Players) == 0 {
			c.captureEconomy(r)
		}
		c.econAt = 0
		if c.aim != nil {
			c.aim.Flush(r.EndTick)
		}
	})

	p.RegisterEventHandler(func(events.RoundEndOfficial) {
		if r := c.current(); r != nil {
			r.OfficialEndTick = c.tick()
		}
	})
}

func (c *collector) beginRecording() {
	c.recording = true
	c.m.FirstTick = c.tick()
	c.aim = aim.NewTracker(c.tickRate())
}

func (c *collector) current() *match.Round {
	if c.round < 0 || c.round >= len(c.m.Rounds) {
		return nil
	}
	return &c.m.Rounds[c.round]
}

func (c *collector) startRound(tick int) {
	if r := c.current(); r != nil && r.EndTick == 0 {
		r.EndTick = tick - 1
		r.Reason = "unfinished"
		if c.aim != nil {
			c.aim.Flush(r.EndTick)
		}
	}
	gs := c.p.GameState()
	r := match.Round{
		Number:    gs.TotalRoundsPlayed() + 1,
		StartTick: tick,
		RoundTime: 115,
		BombTime:  40,
	}
	if d, err := gs.Rules().RoundTime(); err == nil && d > 0 {
		r.RoundTime = d.Seconds()
	}
	if d, err := gs.Rules().BombTime(); err == nil && d > 0 {
		r.BombTime = d.Seconds()
	}
	if !gs.IsFreezetimePeriod() {
		r.FreezeEndTick = tick
	}
	c.m.Rounds = append(c.m.Rounds, r)
	c.round = len(c.m.Rounds) - 1
	c.roundClans = append(c.roundClans, [2]string{
		gs.TeamCounterTerrorists().ClanName(),
		gs.TeamTerrorists().ClanName(),
	})
	c.bombState = match.BombNone
	if c.aim != nil {
		c.aim.SetRound(c.round)
	}
}

func (c *collector) captureEconomy(r *match.Round) {
	r.Players = r.Players[:0]
	for _, pl := range c.p.GameState().Participants().Playing() {
		idx := c.index(pl)
		if idx < 0 {
			continue
		}
		rp := match.RoundPlayer{
			Player:     idx,
			Side:       match.Side(pl.Team),
			Money:      pl.Money(),
			EquipValue: pl.EquipmentValueCurrent(),
			Spent:      pl.MoneySpentThisRound(),
			Armor:      pl.Armor(),
			Helmet:     pl.HasHelmet(),
			Kit:        pl.HasDefuseKit(),
		}
		for _, w := range pl.Inventory {
			if w != nil && w.Type != common.EqKnife {
				rp.Inventory = append(rp.Inventory, c.weapon(w.Type))
			}
		}
		sort.Slice(rp.Inventory, func(i, j int) bool { return rp.Inventory[i] < rp.Inventory[j] })
		r.Players = append(r.Players, rp)
	}
	sort.Slice(r.Players, func(i, j int) bool { return r.Players[i].Player < r.Players[j].Player })
}

// finish fills in everything that can only be known once the demo is done:
// which players belong together, team names, scores and the aim data.
func (c *collector) finish() {
	m := c.m
	m.Map = c.mapName
	m.Server = c.server
	m.TickRate = c.tickRate()
	if n := len(m.Frames.Ticks); n > 0 {
		m.LastTick = int(m.Frames.Ticks[n-1])
		if m.FirstTick == 0 || m.FirstTick > int(m.Frames.Ticks[0]) {
			m.FirstTick = int(m.Frames.Ticks[0])
		}
	}
	if r := c.current(); r != nil && r.EndTick == 0 {
		r.EndTick = m.LastTick
		r.Reason = "unfinished"
	}
	for i := range m.Rounds {
		if m.Rounds[i].OfficialEndTick == 0 {
			m.Rounds[i].OfficialEndTick = m.Rounds[i].EndTick
		}
	}

	c.assignTeams()

	if c.aim != nil {
		c.aim.Flush(m.LastTick)
		m.Engagements, m.AimSamples = c.aim.Result()
	}
}

// assignTeams groups players into two rosters that stay together across
// halftime. Team 0 is whoever played CT in the first round.
func (c *collector) assignTeams() {
	m := c.m
	sideIn := func(player, round int) match.Side {
		r := m.Rounds[round]
		for _, rp := range r.Players {
			if rp.Player == player {
				return rp.Side
			}
		}
		// Fall back to the side seen in frames during the round.
		t := &m.Frames.Tracks[player]
		from := m.Frames.IndexAt(r.StartTick)
		to := m.Frames.IndexAt(r.EndTick)
		for f := from; f <= to && f < len(t.Side); f++ {
			if s := match.Side(t.Side[f]); s == match.SideT || s == match.SideCT {
				return s
			}
		}
		return match.SideNone
	}

	team := make([]int, len(m.Players))
	for i := range team {
		team[i] = -1
	}
	side0 := match.SideCT
	for ri := range m.Rounds {
		// Work out which side team 0 is on from players we already know.
		votes := map[match.Side]int{}
		for p := range m.Players {
			if team[p] < 0 {
				continue
			}
			s := sideIn(p, ri)
			if s == match.SideNone {
				continue
			}
			if team[p] == 0 {
				votes[s]++
			} else {
				votes[s.Opposite()]++
			}
		}
		if votes[match.SideT] > votes[match.SideCT] {
			side0 = match.SideT
		} else if votes[match.SideCT] > votes[match.SideT] {
			side0 = match.SideCT
		}
		for p := range m.Players {
			if team[p] >= 0 {
				continue
			}
			s := sideIn(p, ri)
			if s == match.SideNone {
				continue
			}
			if s == side0 {
				team[p] = 0
			} else {
				team[p] = 1
			}
		}
		m.Rounds[ri].SideOf = [2]match.Side{side0, side0.Opposite()}
	}
	for p := range m.Players {
		m.Players[p].Team = team[p]
	}

	if len(m.Rounds) > 0 {
		m.Teams[0].StartSide = m.Rounds[0].SideOf[0]
		m.Teams[1].StartSide = m.Rounds[0].SideOf[1]
	}
	m.Teams[0].Name = c.clanName(0)
	m.Teams[1].Name = c.clanName(1)

	score := [2]int{}
	for i := range m.Rounds {
		r := &m.Rounds[i]
		r.WinnerTeam = -1
		for t := 0; t < 2; t++ {
			if r.Winner != match.SideNone && r.SideOf[t] == r.Winner {
				r.WinnerTeam = t
				score[t]++
			}
		}
		r.ScoreA, r.ScoreB = score[0], score[1]
	}
	m.Teams[0].Score, m.Teams[1].Score = score[0], score[1]
}

// clanName picks the clan name most often shown for the side the team played.
func (c *collector) clanName(team int) string {
	votes := map[string]int{}
	best := ""
	for i, r := range c.m.Rounds {
		if i >= len(c.roundClans) {
			break
		}
		name := c.roundClans[i][1]
		if r.SideOf[team] == match.SideCT {
			name = c.roundClans[i][0]
		}
		if name == "" {
			continue
		}
		votes[name]++
		if votes[name] > votes[best] {
			best = name
		}
	}
	if best != "" {
		return best
	}
	if team == 0 {
		return "Team A"
	}
	return "Team B"
}
