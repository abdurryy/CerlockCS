package analysis

import (
	"math"

	"github.com/abdurryy/CerlockCS/internal/match"
)

// accurateSpeed is roughly the speed under which a weapon is accurate,
// about a third of its max movement speed.
func accurateSpeed(w uint16) float64 {
	switch {
	case w >= 1 && w <= 10, w >= 101 && w <= 107:
		return 85
	case w >= 201 && w <= 206:
		return 80
	case w == 306 || w >= 309:
		return 70
	}
	return 75
}

const unitsPerMetre = 52.5

// playerExtras fills the second set of player metrics: side splits, round
// swing, movement and utility efficiency.
func (a *analyzer) playerExtras(stats []PlayerStats, kast []map[int]bool) {
	m := a.m
	n := len(stats)
	for p := range stats {
		stats[p].Sides = map[string]*SideStats{"CT": {}, "T": {}}
		stats[p].WeaponKills = map[string]int{}
		stats[p].KillPlaces = map[string]int{}
		stats[p].DeathPlaces = map[string]int{}
	}

	kastBySide := make([]map[string]int, n)
	for p := range kastBySide {
		kastBySide[p] = map[string]int{}
	}
	for ri := range m.Rounds {
		for p, side := range a.sides[ri] {
			if p >= n {
				continue
			}
			if ss := stats[p].Sides[side.String()]; ss != nil {
				ss.Rounds++
				if kast[p][ri] {
					kastBySide[p][side.String()]++
				}
			}
		}
	}

	swing := make([]float64, n)
	distSum := make([]float64, n)
	distN := make([]int, n)
	tradeSum := make([]float64, n)
	tradeN := make([]int, n)
	for i, k := range m.Kills {
		v := &stats[k.Victim]
		if ss := v.Sides[k.VictimSide.String()]; ss != nil {
			ss.Deaths++
		}
		if k.VictimPlace != "" {
			v.DeathPlaces[prettyPlace(k.VictimPlace)]++
		}
		if k.Killer < 0 || !a.enemies(k.Killer, k.Victim) {
			continue
		}
		ks := &stats[k.Killer]
		if ss := ks.Sides[k.KillerSide.String()]; ss != nil {
			ss.Kills++
		}
		name := m.Weapons[k.Weapon]
		if name == "" {
			name = "Other"
		}
		ks.WeaponKills[name]++
		if k.KillerPlace != "" {
			ks.KillPlaces[prettyPlace(k.KillerPlace)]++
		}
		if k.Distance > 0 {
			distSum[k.Killer] += float64(k.Distance)
			distN[k.Killer]++
		}
		if t, ok := a.tradeTime[i]; ok {
			tradeSum[k.Killer] += t
			tradeN[k.Killer]++
		}
		if i < len(a.r.KillSwing) {
			swing[k.Killer] += a.r.KillSwing[i]
			swing[k.Victim] -= a.r.KillSwing[i]
		}
	}
	for p, v := range a.plantSwing {
		if p >= 0 && p < n {
			swing[p] += v
		}
	}

	heDmg := make([]int, n)
	fireDmg := make([]int, n)
	for _, d := range m.Damages {
		if d.Attacker < 0 || !a.enemies(d.Attacker, d.Victim) {
			continue
		}
		side := a.sides[d.Round][d.Attacker].String()
		if ss := stats[d.Attacker].Sides[side]; ss != nil {
			ss.Damage += d.Health
		}
		switch d.Weapon {
		case eqHE:
			heDmg[d.Attacker] += d.Health
		case eqMolotov, eqIncendiary:
			fireDmg[d.Attacker] += d.Health
		}
	}

	shots := make([]int, n)
	still := make([]int, n)
	s := &m.Shots
	for i := range s.Ticks {
		p := int(s.Player[i])
		w := s.Weapon[i]
		if p >= n || !isGun(w) || i >= len(s.Speed) {
			continue
		}
		shots[p]++
		speed := float64(s.Speed[i])
		if speed <= accurateSpeed(w) {
			still[p]++
		}
		if speed > 150 {
			stats[p].RunningShots++
		}
	}

	alive, travel := a.aliveAndTravel()

	for p := range stats {
		st := &stats[p]
		for side, ss := range st.Sides {
			if ss.Rounds > 0 {
				ss.ADR = round1(float64(ss.Damage) / float64(ss.Rounds))
				ss.KAST = round1(float64(kastBySide[p][side]) / float64(ss.Rounds) * 100)
			}
		}
		if st.Rounds > 0 {
			r := float64(st.Rounds)
			st.Swing = round1(swing[p] / r * 100)
			st.KPR = round2(float64(st.Kills) / r)
			st.DPR = round2(float64(st.Deaths) / r)
			st.TimeAlive = round1(alive[p] / r)
			st.Travel = math.Round(travel[p] / r)
		}
		if shots[p] > 0 {
			st.CounterStrafe = round1(float64(still[p]) / float64(shots[p]) * 100)
		}
		if distN[p] > 0 {
			st.AvgKillDistance = round1(distSum[p] / float64(distN[p]))
		}
		if tradeN[p] > 0 {
			st.AvgTradeTime = round2(tradeSum[p] / float64(tradeN[p]))
		}
		if st.HEThrown > 0 {
			st.HEDamagePerNade = round1(float64(heDmg[p]) / float64(st.HEThrown))
		}
		if st.MolotovsThrown > 0 {
			st.FireDamagePer = round1(float64(fireDmg[p]) / float64(st.MolotovsThrown))
		}
		if st.FlashesThrown > 0 {
			st.BlindPerFlash = round2(st.EnemyBlindTime / float64(st.FlashesThrown))
		}
	}
}

// aliveAndTravel returns, per player, the seconds spent alive after freeze
// time and the distance walked, summed over all rounds.
func (a *analyzer) aliveAndTravel() ([]float64, []float64) {
	m := a.m
	fr := &m.Frames
	n := len(m.Players)
	alive := make([]float64, n)
	travel := make([]float64, n)
	for ri, r := range m.Rounds {
		death := map[int]int{}
		for _, k := range a.killsByRound[ri] {
			death[m.Kills[k].Victim] = m.Kills[k].Tick
		}
		for p := range a.sides[ri] {
			if p >= n {
				continue
			}
			end := r.EndTick
			if t, ok := death[p]; ok && t < end {
				end = t
			}
			if end > r.FreezeEndTick {
				alive[p] += a.seconds(end - r.FreezeEndTick)
			}
			t := &fr.Tracks[p]
			from := fr.IndexAt(r.FreezeEndTick)
			to := fr.IndexAt(end)
			for f := from + 1; f <= to && f < len(t.X); f++ {
				if !t.Alive(f) || !t.Alive(f-1) {
					continue
				}
				dx := float64(t.X[f] - t.X[f-1])
				dy := float64(t.Y[f] - t.Y[f-1])
				d := math.Hypot(dx, dy)
				if d < 300 {
					travel[p] += d
				}
			}
		}
	}
	return alive, travel
}

// sideOf returns the side player p played in round ri.
func (a *analyzer) sideOf(p, ri int) match.Side {
	if ri < 0 || ri >= len(a.sides) {
		return match.SideNone
	}
	return a.sides[ri][p]
}
