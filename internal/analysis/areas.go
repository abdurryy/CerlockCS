package analysis

import (
	"fmt"
	"sort"
	"strings"

	"github.com/abdurryy/CerlockCS/internal/match"
)

type areaKey struct {
	place string
	team  int
	side  string
}

// areas counts kills, deaths and time spent per callout, split by team and
// side.
func (a *analyzer) areas() {
	m := a.m
	stats := map[areaKey]*AreaStats{}
	get := func(place string, team int, side match.Side) *AreaStats {
		if place == "" || team < 0 || side == match.SideNone {
			return nil
		}
		k := areaKey{place, team, side.String()}
		s, ok := stats[k]
		if !ok {
			s = &AreaStats{Place: place, Name: prettyPlace(place), Team: team, Side: side.String()}
			stats[k] = s
		}
		return s
	}

	opening := map[int]bool{}
	for _, info := range a.r.Rounds {
		if info.OpeningKill >= 0 {
			opening[info.OpeningKill] = true
		}
	}
	for i, k := range m.Kills {
		if k.Killer < 0 || !a.enemies(k.Killer, k.Victim) {
			continue
		}
		if s := get(k.KillerPlace, a.teamOf(k.Killer), k.KillerSide); s != nil {
			s.Kills++
			if opening[i] {
				s.OpeningKills++
			}
		}
		if s := get(k.VictimPlace, a.teamOf(k.Victim), k.VictimSide); s != nil {
			s.Deaths++
			if opening[i] {
				s.OpeningDeaths++
			}
		}
	}

	fr := &m.Frames
	if len(m.Places) > 1 && len(fr.Ticks) > 1 {
		dt := a.seconds(m.SampleInterval)
		for ri, r := range m.Rounds {
			from := fr.IndexAt(r.FreezeEndTick)
			to := fr.IndexAt(r.EndTick)
			for p, side := range a.sides[ri] {
				if p >= len(fr.Tracks) {
					continue
				}
				t := &fr.Tracks[p]
				team := a.teamOf(p)
				for f := from; f <= to && f < len(t.Place); f++ {
					if !t.Alive(f) || int(t.Place[f]) >= len(m.Places) {
						continue
					}
					if s := get(m.Places[t.Place[f]], team, side); s != nil {
						s.Time += dt
					}
				}
			}
		}
	}

	for _, s := range stats {
		s.Time = round1(s.Time)
		a.r.Areas = append(a.r.Areas, *s)
	}
	sort.Slice(a.r.Areas, func(i, j int) bool {
		x, y := a.r.Areas[i], a.r.Areas[j]
		if x.Team != y.Team {
			return x.Team < y.Team
		}
		if x.Side != y.Side {
			return x.Side < y.Side
		}
		return x.Kills+x.Deaths > y.Kills+y.Deaths
	})
}

// setupAt describes where a team's players stand at a tick, for example
// "Ramp 2, Bombsite A 2, Outside".
func (a *analyzer) setupAt(team, ri, tick int) string {
	m := a.m
	fr := &m.Frames
	if len(fr.Ticks) == 0 {
		return ""
	}
	f := fr.IndexAt(tick)
	count := map[string]int{}
	for p, side := range a.sides[ri] {
		if p >= len(fr.Tracks) || a.teamOf(p) != team || side == match.SideNone {
			continue
		}
		t := &fr.Tracks[p]
		if !t.Alive(f) || int(t.Place[f]) >= len(m.Places) {
			continue
		}
		if name := prettyPlace(m.Places[t.Place[f]]); name != "" {
			count[name]++
		}
	}
	type kv struct {
		name string
		n    int
	}
	var list []kv
	for k, v := range count {
		list = append(list, kv{k, v})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].n != list[j].n {
			return list[i].n > list[j].n
		}
		return list[i].name < list[j].name
	})
	parts := make([]string, len(list))
	for i, x := range list {
		parts[i] = x.name
		if x.n > 1 {
			parts[i] = fmt.Sprintf("%s %d", x.name, x.n)
		}
	}
	return strings.Join(parts, ", ")
}

// siteHit finds the first time a T player walked onto a bombsite.
func (a *analyzer) siteHit(ri int) (string, float64) {
	m := a.m
	r := m.Rounds[ri]
	fr := &m.Frames
	if len(fr.Ticks) == 0 {
		return "", -1
	}
	from := fr.IndexAt(r.FreezeEndTick)
	to := fr.IndexAt(r.EndTick)
	for f := from; f <= to; f++ {
		for p, side := range a.sides[ri] {
			if side != match.SideT || p >= len(fr.Tracks) {
				continue
			}
			t := &fr.Tracks[p]
			if f >= len(t.Place) || !t.Alive(f) || int(t.Place[f]) >= len(m.Places) {
				continue
			}
			name := m.Places[t.Place[f]]
			if strings.HasPrefix(name, "Bombsite") && len(name) > 8 {
				return name[8:], a.seconds(int(fr.Ticks[f]) - r.FreezeEndTick)
			}
		}
	}
	return "", -1
}
