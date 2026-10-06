package analysis

import (
	"fmt"
	"sort"
)

var reasonText = map[string]string{
	"bomb_exploded": "the bomb went off",
	"bomb_defused":  "the bomb was defused",
	"t_eliminated":  "all T were killed",
	"ct_eliminated": "all CT were killed",
	"time_ran_out":  "time ran out",
}

// stories writes a short play by play for each round: setups, the kills
// that mattered, the plant and how the round ended.
func (a *analyzer) stories() {
	m := a.m
	for ri, r := range m.Rounds {
		info := &a.r.Rounds[ri]
		var lines []StoryLine
		addLine := func(tick int, kind, text string, player int) {
			lines = append(lines, StoryLine{Tick: tick, Kind: kind, Text: text, Player: player})
		}

		setupTick := r.FreezeEndTick + int(20*a.rate)
		if setupTick < r.EndTick {
			for t := 0; t < 2; t++ {
				info.Setup[t] = a.setupAt(t, ri, setupTick)
			}
			for t := 0; t < 2; t++ {
				if info.Setup[t] != "" {
					addLine(setupTick, "setup", fmt.Sprintf("%s (%s) setup: %s", m.Teams[t].Name, r.SideOf[t], info.Setup[t]), -1)
				}
			}
		}
		info.Hit, info.HitTime = a.siteHit(ri)
		if info.Hit != "" {
			addLine(r.FreezeEndTick+int(info.HitTime*a.rate), "hit", fmt.Sprintf("T first stepped onto %s after %.0fs", "site "+info.Hit, info.HitTime), -1)
		}

		swingBig := 0.15
		traded := map[int]bool{}
		for _, k := range info.Traded {
			traded[k] = true
		}
		for _, k := range a.killsByRound[ri] {
			kl := m.Kills[k]
			where := ""
			if kl.VictimPlace != "" {
				where = " at " + prettyPlace(kl.VictimPlace)
			}
			switch {
			case k == info.OpeningKill:
				addLine(kl.Tick, "opening", fmt.Sprintf("%s opened the round on %s%s with the %s", a.name(kl.Killer), a.name(kl.Victim), where, a.weapon(kl.Weapon)), kl.Killer)
			case kl.Killer < 0 || !a.enemies(kl.Killer, kl.Victim):
				addLine(kl.Tick, "death", fmt.Sprintf("%s died%s", a.name(kl.Victim), where), kl.Victim)
			case a.tradeKill[k]:
				addLine(kl.Tick, "trade", fmt.Sprintf("%s traded with a kill on %s%s", a.name(kl.Killer), a.name(kl.Victim), where), kl.Killer)
			case k < len(a.r.KillSwing) && a.r.KillSwing[k] >= swingBig:
				addLine(kl.Tick, "swing", fmt.Sprintf("%s killed %s%s, a %.0f%% swing", a.name(kl.Killer), a.name(kl.Victim), where, a.r.KillSwing[k]*100), kl.Killer)
			default:
				addLine(kl.Tick, "kill", fmt.Sprintf("%s killed %s%s", a.name(kl.Killer), a.name(kl.Victim), where), kl.Killer)
			}
			if traded[k] {
				lines[len(lines)-1].Text += " (traded)"
			}
		}
		for _, b := range m.BombEvents {
			if b.Round != ri {
				continue
			}
			switch b.Kind {
			case "planted":
				left := r.RoundTime - a.seconds(b.Tick-r.FreezeEndTick)
				addLine(b.Tick, "plant", fmt.Sprintf("%s planted on %s with %.0fs left on the clock", a.name(b.Player), b.Site, left), b.Player)
			case "defused":
				addLine(b.Tick, "defuse", fmt.Sprintf("%s defused the bomb", a.name(b.Player)), b.Player)
			}
		}
		if c := info.Clutch; c != nil {
			res := "lost"
			if c.Won {
				res = "won"
			}
			addLine(c.Tick, "clutch", fmt.Sprintf("%s was left alone in a 1v%d and %s it", a.name(c.Player), c.Versus, res), c.Player)
		}
		if r.WinnerTeam >= 0 {
			why := reasonText[r.Reason]
			if why == "" {
				why = "the round ended"
			}
			side := r.SideOf[r.WinnerTeam]
			addLine(r.EndTick, "end", fmt.Sprintf("%s won as %s, %s", m.Teams[r.WinnerTeam].Name, side, why), -1)
		}
		sort.SliceStable(lines, func(i, j int) bool { return lines[i].Tick < lines[j].Tick })
		info.Story = lines
	}
}
