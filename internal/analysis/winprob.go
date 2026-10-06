package analysis

import (
	"math"
	"sort"

	"github.com/abdurryy/CerlockCS/internal/match"
)

// winChance estimates the chance that a team with us players alive wins
// against them. It follows the usual shape of round stats: 5v4 lands around
// 70%, 4v2 around 90% and a planted bomb moves things toward T. It does not
// look at weapons or time, so treat it as a rough guide.
func winChance(us, them int, side match.Side, planted bool) float64 {
	if us <= 0 {
		return 0
	}
	if them <= 0 {
		return 1
	}
	x := 2.8 * float64(us-them) / math.Sqrt(float64(us+them))
	if planted {
		if side == match.SideT {
			x += 0.9
		} else {
			x -= 0.9
		}
	}
	return 1 / (1 + math.Exp(-x))
}

// winProbability builds the win chance line for every round and works out
// how much each kill and plant swung it.
func (a *analyzer) winProbability() {
	m := a.m
	a.r.KillSwing = make([]float64, len(m.Kills))
	a.plantSwing = map[int]float64{}

	for ri, r := range m.Rounds {
		alive := [2]int{}
		for _, rp := range r.Players {
			if t := a.teamOf(rp.Player); t >= 0 {
				alive[t]++
			}
		}
		if alive[0] == 0 || alive[1] == 0 {
			continue
		}
		planted := false
		chance := func() float64 {
			return winChance(alive[0], alive[1], r.SideOf[0], planted)
		}

		type event struct {
			tick  int
			kill  int
			plant *match.BombEvent
		}
		var evs []event
		for _, k := range a.killsByRound[ri] {
			evs = append(evs, event{tick: m.Kills[k].Tick, kill: k})
		}
		for i := range m.BombEvents {
			b := &m.BombEvents[i]
			if b.Round == ri && b.Kind == "planted" {
				evs = append(evs, event{tick: b.Tick, kill: -1, plant: b})
			}
		}
		sort.SliceStable(evs, func(i, j int) bool { return evs[i].tick < evs[j].tick })

		info := &a.r.Rounds[ri]
		info.WinProb = append(info.WinProb, WinPoint{Tick: r.FreezeEndTick, P: round3(chance())})
		for _, e := range evs {
			before := chance()
			if e.plant != nil {
				planted = true
				after := chance()
				// Swing for the planting team, which is whoever plays T.
				delta := after - before
				if r.SideOf[0] == match.SideCT {
					delta = -delta
				}
				a.plantSwing[e.plant.Player] += delta
			} else {
				k := m.Kills[e.kill]
				t := a.teamOf(k.Victim)
				if t < 0 || alive[t] == 0 {
					continue
				}
				alive[t]--
				after := chance()
				// Swing is the drop in the victim team's chance.
				drop := before - after
				if t == 1 {
					drop = after - before
				}
				a.r.KillSwing[e.kill] = round3(drop)
			}
			info.WinProb = append(info.WinProb, WinPoint{Tick: e.tick, P: round3(chance())})
		}
		end := 0.5
		switch r.WinnerTeam {
		case 0:
			end = 1
		case 1:
			end = 0
		}
		info.WinProb = append(info.WinProb, WinPoint{Tick: r.EndTick, P: end})
	}
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }
