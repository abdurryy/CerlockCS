package analysis

import (
	"fmt"
	"sort"

	"github.com/abdurryy/CerlockCS/internal/match"
)

// blunders looks for single mistakes with a clear cost. Unlike insights,
// which describe patterns, every blunder is one moment you can watch.
func (a *analyzer) blunders() {
	m := a.m
	deathOf := map[[2]int]int{}
	for i, k := range m.Kills {
		deathOf[[2]int{k.Round, k.Victim}] = i
	}
	cost := func(k int) float64 {
		if k < 0 || k >= len(a.r.KillSwing) {
			return -1
		}
		return a.r.KillSwing[k]
	}
	add := func(b Blunder) {
		if b.Team < 0 && b.Player >= 0 {
			b.Team = a.teamOf(b.Player)
		}
		a.r.Blunders = append(a.r.Blunders, b)
	}
	alive := a.aliveBeforeKills()

	// Team kills and damage.
	type pair struct{ round, attacker, victim int }
	teamDmg := map[pair]int{}
	teamDmgTick := map[pair]int{}
	teamDmgWeapon := map[pair]uint16{}
	for _, d := range m.Damages {
		if d.Attacker < 0 || a.teamOf(d.Attacker) != a.teamOf(d.Victim) {
			continue
		}
		k := pair{d.Round, d.Attacker, d.Victim}
		if _, ok := teamDmgTick[k]; !ok {
			teamDmgTick[k] = d.Tick
		}
		teamDmg[k] += d.Health
		teamDmgWeapon[k] = d.Weapon
	}
	teamKilled := map[pair]bool{}
	for i, k := range m.Kills {
		if k.Killer < 0 || k.Killer == k.Victim || a.enemies(k.Killer, k.Victim) {
			continue
		}
		teamKilled[pair{k.Round, k.Killer, k.Victim}] = true
		add(Blunder{
			Kind: "team_kill", Severity: High, Round: k.Round, Tick: k.Tick, Player: k.Killer, Other: k.Victim, Team: -1,
			Title:  "Killed a teammate",
			Detail: fmt.Sprintf("%s killed %s with the %s.", a.name(k.Killer), a.name(k.Victim), a.weapon(k.Weapon)),
			Pos:    k.VictimPos, Cost: cost(i),
		})
	}
	for k, dmg := range teamDmg {
		if teamKilled[k] || dmg < 25 {
			continue
		}
		b := Blunder{
			Kind: "team_damage", Severity: Low, Round: k.round, Tick: teamDmgTick[k], Player: k.attacker, Other: k.victim, Team: -1,
			Pos: a.posAt(k.victim, teamDmgTick[k]), Cost: -1,
		}
		if dmg >= 50 {
			b.Severity = Medium
		}
		if k.attacker == k.victim {
			b.Kind = "self_damage"
			b.Title = "Hurt themselves"
			b.Detail = fmt.Sprintf("%s took %d damage from their own %s.", a.name(k.attacker), dmg, a.weapon(teamDmgWeapon[k]))
		} else {
			b.Title = "Hurt a teammate"
			b.Detail = fmt.Sprintf("%s did %d damage to %s with the %s.", a.name(k.attacker), dmg, a.name(k.victim), a.weapon(teamDmgWeapon[k]))
		}
		add(b)
	}

	// Flashes that got the flashed player killed.
	for _, b := range m.Blinds {
		if b.Attacker < 0 || a.enemies(b.Attacker, b.Victim) || b.Duration < 1 {
			continue
		}
		k, ok := deathOf[[2]int{b.Round, b.Victim}]
		if !ok {
			continue
		}
		kl := m.Kills[k]
		window := b.Tick + int((float64(b.Duration)+0.3)*a.rate)
		if kl.Tick < b.Tick || kl.Tick > window || kl.Killer < 0 || !a.enemies(kl.Killer, kl.Victim) {
			continue
		}
		after := a.seconds(kl.Tick - b.Tick)
		if b.Attacker == b.Victim {
			add(Blunder{
				Kind: "self_flash_death", Severity: Medium, Round: b.Round, Tick: b.Tick, Player: b.Victim, Other: kl.Killer, Team: -1,
				Title:  "Flashed themselves and died",
				Detail: fmt.Sprintf("%s was blinded by their own flash for %.1fs and died %.1fs later.", a.name(b.Victim), b.Duration, after),
				Pos:    kl.VictimPos, Cost: cost(k),
			})
			continue
		}
		add(Blunder{
			Kind: "team_flash_death", Severity: High, Round: b.Round, Tick: b.Tick, Player: b.Attacker, Other: b.Victim, Team: -1,
			Title:  "Team flash got a teammate killed",
			Detail: fmt.Sprintf("%s flashed %s for %.1fs and %s died %.1fs later.", a.name(b.Attacker), a.name(b.Victim), b.Duration, a.name(b.Victim), after),
			Pos:    kl.VictimPos, Cost: cost(k),
		})
	}

	// Deaths with something obviously wrong about them.
	for i, k := range m.Kills {
		if k.Killer < 0 || !a.enemies(k.Killer, k.Victim) {
			continue
		}
		v := k.Victim
		t := a.teamOf(v)
		place := ""
		if k.VictimPlace != "" {
			place = " at " + prettyPlace(k.VictimPlace)
		}
		if k.VictimReloading {
			add(Blunder{
				Kind: "reload_death", Severity: Medium, Round: k.Round, Tick: k.Tick, Player: v, Other: k.Killer, Team: -1,
				Title:  "Died mid reload",
				Detail: fmt.Sprintf("%s was reloading when %s killed them%s.", a.name(v), a.name(k.Killer), place),
				Pos:    k.VictimPos, Cost: cost(i),
			})
		}
		mates := 0
		if t >= 0 {
			mates = alive[i][t]
		}
		if k.Seen >= 2 && mates > 1 {
			sev := Low
			if k.Seen >= 3 {
				sev = Medium
			}
			add(Blunder{
				Kind: "crossfire", Severity: sev, Round: k.Round, Tick: k.Tick, Player: v, Other: k.Killer, Team: -1,
				Title:  "Peeked into a crossfire",
				Detail: fmt.Sprintf("%d enemies could see %s when they died%s. One angle at a time is the safer way.", k.Seen, a.name(v), place),
				Pos:    k.VictimPos, Cost: cost(i),
			})
		}
		// Got a kill and died right after in the same spot, without anyone
		// trading it.
		for _, j := range a.killsByRound[k.Round] {
			if a.traded[i] {
				break
			}
			prev := m.Kills[j]
			if prev.Killer != v || prev.Tick >= k.Tick || !a.enemies(v, prev.Victim) || prev.Victim == k.Killer {
				continue
			}
			gap := a.seconds(k.Tick - prev.Tick)
			if gap <= 3 && dist(prev.KillerPos, k.VictimPos) < 350 {
				add(Blunder{
					Kind: "overpeek", Severity: Low, Round: k.Round, Tick: prev.Tick, Player: v, Other: k.Killer, Team: -1,
					Title:  "Stayed on the angle after a kill",
					Detail: fmt.Sprintf("%s killed %s and died %.1fs later to %s from the same spot. After a kill the next enemy usually knows where you are.", a.name(v), a.name(prev.Victim), gap, a.name(k.Killer)),
					Pos:    k.VictimPos, Cost: cost(i),
				})
				break
			}
		}
		var value int
		for _, u := range k.VictimUtility {
			value += utilityPrice[u]
		}
		if value >= 1000 {
			add(Blunder{
				Kind: "unused_utility", Severity: Low, Round: k.Round, Tick: k.Tick, Player: v, Other: k.Killer, Team: -1,
				Title:  "Died with a full set of grenades",
				Detail: fmt.Sprintf("%s died holding $%d of utility%s.", a.name(v), value, place),
				Pos:    k.VictimPos, Cost: -1,
			})
		}
	}

	// Bomb carrier dying first.
	for _, info := range a.r.Rounds {
		if info.OpeningKill < 0 {
			continue
		}
		k := m.Kills[info.OpeningKill]
		if a.sideOf(k.Victim, k.Round) != match.SideT || !a.hadBomb(k.Victim, k.Tick) {
			continue
		}
		add(Blunder{
			Kind: "bomb_carrier_first", Severity: Medium, Round: k.Round, Tick: k.Tick, Player: k.Victim, Other: k.Killer, Team: -1,
			Title:  "Bomb carrier died first",
			Detail: fmt.Sprintf("%s took the first fight of the round while carrying the bomb.", a.name(k.Victim)),
			Pos:    k.VictimPos, Cost: cost(info.OpeningKill),
		})
	}

	a.bombBlunders(deathOf, add)
	a.economyBlunders(add)
	a.utilityBlunders(add)
	a.duelBlunders(add)

	sort.SliceStable(a.r.Blunders, func(i, j int) bool {
		x, y := a.r.Blunders[i], a.r.Blunders[j]
		if x.Round != y.Round {
			return x.Round < y.Round
		}
		return x.Tick < y.Tick
	})
	for _, b := range a.r.Blunders {
		if b.Player >= 0 && b.Player < len(a.r.Players) {
			st := &a.r.Players[b.Player]
			st.Blunders++
			if b.Cost > 0 {
				st.BlunderCost = round1(st.BlunderCost + b.Cost*100)
			}
		}
	}
}

func (a *analyzer) bombBlunders(deathOf map[[2]int]int, add func(Blunder)) {
	m := a.m
	for ri, r := range m.Rounds {
		var plant, boom *match.BombEvent
		var defuses []*match.BombEvent
		for i := range m.BombEvents {
			b := &m.BombEvents[i]
			if b.Round != ri {
				continue
			}
			switch b.Kind {
			case "planted":
				plant = b
			case "exploded":
				boom = b
			case "defuse_begin":
				defuses = append(defuses, b)
			}
		}
		if plant == nil {
			if r.Reason == "time_ran_out" {
				t := -1
				for x := 0; x < 2; x++ {
					if r.SideOf[x] == match.SideT {
						t = x
					}
				}
				add(Blunder{
					Kind: "time_ran_out", Severity: Medium, Round: ri, Tick: r.EndTick - int(10*a.rate), Player: -1, Other: -1, Team: t,
					Title:  "Ran out of time",
					Detail: fmt.Sprintf("%s never got the bomb down and lost the round on time.", a.m.Teams[max(t, 0)].Name),
					Cost:   -1,
				})
			}
			continue
		}
		if boom == nil {
			continue
		}
		// Players still in range when it went off.
		for _, k := range a.killsByRound[ri] {
			kl := m.Kills[k]
			if kl.Tick >= boom.Tick && kl.Tick <= boom.Tick+int(2*a.rate) {
				add(Blunder{
					Kind: "bomb_death", Severity: Medium, Round: ri, Tick: boom.Tick - int(8*a.rate), Player: kl.Victim, Other: -1, Team: -1,
					Title:  "Died to the bomb",
					Detail: fmt.Sprintf("%s was still too close when the bomb went off and lost their weapons for nothing.", a.name(kl.Victim)),
					Pos:    kl.VictimPos, Cost: -1,
				})
			}
		}
		// A defuse that could never finish.
		if len(defuses) > 0 {
			d := defuses[len(defuses)-1]
			left := r.BombTime - a.seconds(d.Tick-plant.Tick)
			need := 10.0
			if d.Kit {
				need = 5
			}
			if left < need {
				kit := "without a kit"
				if d.Kit {
					kit = "with a kit"
				}
				add(Blunder{
					Kind: "late_defuse", Severity: Medium, Round: ri, Tick: d.Tick, Player: d.Player, Other: -1, Team: -1,
					Title:  "Defuse started too late",
					Detail: fmt.Sprintf("%s started defusing %s with %.1fs left, it needs %.0f.", a.name(d.Player), kit, left, need),
					Pos:    d.Pos, Cost: -1,
				})
			}
		}
	}
}

func (a *analyzer) economyBlunders(add func(Blunder)) {
	m := a.m
	for ri, r := range m.Rounds {
		if a.pistols[ri] || len(r.Players) == 0 {
			continue
		}
		info := a.r.Rounds[ri]
		for _, rp := range r.Players {
			t := a.teamOf(rp.Player)
			if t < 0 {
				continue
			}
			buy := info.BuyType[t]
			pos := a.posAt(rp.Player, r.FreezeEndTick)
			if (buy == "full" || buy == "force") && rp.Armor == 0 && rp.Money+rp.Spent >= 1650 {
				add(Blunder{
					Kind: "no_armor", Severity: Medium, Round: ri, Tick: r.FreezeEndTick, Player: rp.Player, Other: -1, Team: -1,
					Title:  "No armor on a buy round",
					Detail: fmt.Sprintf("%s played a %s round without kevlar while having $%d.", a.name(rp.Player), buy, rp.Money+rp.Spent),
					Pos:    pos, Cost: -1,
				})
			}
			if buy == "eco" && rp.EquipValue >= 3500 && rp.Spent >= 2500 {
				add(Blunder{
					Kind: "buy_desync", Severity: Low, Round: ri, Tick: r.FreezeEndTick, Player: rp.Player, Other: -1, Team: -1,
					Title:  "Bought while the team saved",
					Detail: fmt.Sprintf("%s spent $%d on a round the rest of the team saved.", a.name(rp.Player), rp.Spent),
					Pos:    pos, Cost: -1,
				})
			}
			if buy == "full" && rp.EquipValue < 2000 && rp.Money >= 2700 {
				add(Blunder{
					Kind: "buy_desync", Severity: Medium, Round: ri, Tick: r.FreezeEndTick, Player: rp.Player, Other: -1, Team: -1,
					Title:  "Did not buy with the team",
					Detail: fmt.Sprintf("%s kept $%d and played with $%d of gear while the team full bought.", a.name(rp.Player), rp.Money, rp.EquipValue),
					Pos:    pos, Cost: -1,
				})
			}
		}
	}
}

func (a *analyzer) utilityBlunders(add func(Blunder)) {
	for _, inf := range a.m.Infernos {
		if inf.Thrower < 0 || inf.EndTick < 0 {
			continue
		}
		burned := a.seconds(inf.EndTick - inf.StartTick)
		if burned >= 1.5 {
			continue
		}
		var pos [3]float32
		if len(inf.Snapshots) > 0 && len(inf.Snapshots[0].Hull) >= 2 {
			pos = [3]float32{inf.Snapshots[0].Hull[0], inf.Snapshots[0].Hull[1], 0}
		}
		add(Blunder{
			Kind: "wasted_molotov", Severity: Low, Round: inf.Round, Tick: inf.StartTick, Player: inf.Thrower, Other: -1, Team: -1,
			Title:  "Molotov went out straight away",
			Detail: fmt.Sprintf("%s's molotov only burned for %.1fs, it most likely landed in a smoke.", a.name(inf.Thrower), burned),
			Pos:    pos, Cost: -1,
		})
	}
}

// duelBlunders flags lost duels where most shots were fired on the move.
func (a *analyzer) duelBlunders(add func(Blunder)) {
	m := a.m
	s := &m.Shots
	if len(s.Speed) != len(s.Ticks) {
		return
	}
	deathKill := map[[2]int]int{}
	for i, k := range m.Kills {
		deathKill[[2]int{k.Round, k.Victim}] = i
	}
	for _, e := range m.Engagements {
		if !e.Died {
			continue
		}
		var total, moving int
		var speedSum float64
		for i := range s.Ticks {
			t := int(s.Ticks[i])
			if t < e.StartTick || t > e.EndTick || int(s.Player[i]) != e.Attacker || !isGun(s.Weapon[i]) {
				continue
			}
			total++
			if float64(s.Speed[i]) > accurateSpeed(s.Weapon[i])*1.5 {
				moving++
				speedSum += float64(s.Speed[i])
			}
		}
		if total < 3 || float64(moving)/float64(total) < 0.6 {
			continue
		}
		k, ok := deathKill[[2]int{e.Round, e.Attacker}]
		pos := [3]float32{}
		c := -1.0
		if ok {
			pos = m.Kills[k].VictimPos
			c = a.r.KillSwing[k]
		}
		add(Blunder{
			Kind: "running_shots", Severity: Low, Round: e.Round, Tick: e.StartTick + int(a.rate), Player: e.Attacker, Other: e.Victim, Team: -1,
			Title:  "Shot while moving and lost the duel",
			Detail: fmt.Sprintf("%d of %s's %d shots against %s were fired on the move, at %.0f u/s on average.", moving, a.name(e.Attacker), total, a.name(e.Victim), speedSum/float64(moving)),
			Pos:    pos, Cost: c,
		})
	}
}

// aliveBeforeKills returns, for every kill, how many players each team had
// alive just before it.
func (a *analyzer) aliveBeforeKills() [][2]int {
	m := a.m
	out := make([][2]int, len(m.Kills))
	for ri, r := range m.Rounds {
		alive := [2]int{}
		for _, rp := range r.Players {
			if t := a.teamOf(rp.Player); t >= 0 {
				alive[t]++
			}
		}
		for _, k := range a.killsByRound[ri] {
			out[k] = alive
			if t := a.teamOf(m.Kills[k].Victim); t >= 0 && alive[t] > 0 {
				alive[t]--
			}
		}
	}
	return out
}

func (a *analyzer) posAt(p, tick int) [3]float32 {
	fr := &a.m.Frames
	if p < 0 || p >= len(fr.Tracks) || len(fr.Ticks) == 0 {
		return [3]float32{}
	}
	return fr.Tracks[p].Pos(fr.IndexAt(tick))
}

// hadBomb reports whether p carried the bomb just before tick.
func (a *analyzer) hadBomb(p, tick int) bool {
	fr := &a.m.Frames
	f := fr.IndexAt(tick)
	for i := f; i >= 0 && i > f-4; i-- {
		if fr.Tracks[p].Flags[i]&match.FlagBomb != 0 {
			return true
		}
	}
	return false
}

func (a *analyzer) weapon(w uint16) string {
	if name := a.m.Weapons[w]; name != "" {
		return name
	}
	return "unknown weapon"
}
