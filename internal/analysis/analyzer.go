package analysis

import (
	"math"
	"sort"

	"github.com/abdurryy/CerlockCS/internal/match"
)

// Equipment type ids, mirrored from demoinfocs to keep this package free of
// parser dependencies.
const (
	eqKnife      = 405
	eqWorld      = 407
	eqDecoy      = 501
	eqMolotov    = 502
	eqIncendiary = 503
	eqFlash      = 504
	eqSmoke      = 505
	eqHE         = 506
)

var utilityPrice = map[uint16]int{
	eqDecoy:      50,
	eqMolotov:    400,
	eqIncendiary: 500,
	eqFlash:      200,
	eqSmoke:      300,
	eqHE:         300,
}

func isGun(w uint16) bool {
	return w >= 1 && w < 400
}

const (
	tradeWindow       = 5.0
	isolationDistance = 1200.0
	earlyDeathSeconds = 20.0
	minBlind          = 1.0
)

type analyzer struct {
	m    *match.Match
	r    *Report
	rate float64

	killsByRound [][]int
	// traded[k] is true when the death in kill k was avenged in time.
	traded    map[int]bool
	tradeKill map[int]bool
	// tradeTime[j] is how many seconds trade kill j came after the death it
	// avenged.
	tradeTime  map[int]float64
	plantSwing map[int]float64
	// mateDist[k] is the distance from the victim to the closest living
	// teammate, -1 when nobody was alive.
	mateDist map[int]float64
	// sides[r][p] is the side player p played in round r.
	sides    []map[int]match.Side
	pistols  map[int]bool
	plantRnd map[int]string
}

func newAnalyzer(m *match.Match) *analyzer {
	a := &analyzer{
		m:         m,
		r:         &Report{TradeWindow: tradeWindow},
		rate:      m.TickRate,
		traded:    map[int]bool{},
		tradeKill: map[int]bool{},
		tradeTime: map[int]float64{},
		mateDist:  map[int]float64{},
		pistols:   map[int]bool{},
		plantRnd:  map[int]string{},
	}
	if a.rate <= 0 {
		a.rate = 64
	}
	a.killsByRound = make([][]int, len(m.Rounds))
	for i, k := range m.Kills {
		if k.Round >= 0 && k.Round < len(m.Rounds) {
			a.killsByRound[k.Round] = append(a.killsByRound[k.Round], i)
		}
	}
	a.sides = make([]map[int]match.Side, len(m.Rounds))
	for ri, r := range m.Rounds {
		s := map[int]match.Side{}
		for _, rp := range r.Players {
			s[rp.Player] = rp.Side
		}
		a.sides[ri] = s
	}
	for _, b := range m.BombEvents {
		if b.Kind == "planted" {
			a.plantRnd[b.Round] = b.Site
		}
	}
	a.findPistols()
	return a
}

func (a *analyzer) seconds(ticks int) float64 { return float64(ticks) / a.rate }

func (a *analyzer) teamOf(p int) int { return a.m.TeamOf(p) }

func (a *analyzer) enemies(p, q int) bool {
	tp, tq := a.teamOf(p), a.teamOf(q)
	return tp >= 0 && tq >= 0 && tp != tq
}

// findPistols marks the first round and the first round after halftime.
// Overtime switches come later and start with full money, so only the
// first switch counts.
func (a *analyzer) findPistols() {
	rs := a.m.Rounds
	if len(rs) == 0 {
		return
	}
	if rs[0].Number == 1 {
		a.pistols[0] = true
	}
	for i := 1; i < len(rs); i++ {
		if rs[i].SideOf[0] != rs[i-1].SideOf[0] {
			a.pistols[i] = true
			break
		}
	}
}

// buyType classifies a team buy from the average equipment value per
// player, so it works for wingman as well as 5v5.
func buyType(perPlayer int, pistol bool) string {
	switch {
	case pistol:
		return "pistol"
	case perPlayer < 1000:
		return "eco"
	case perPlayer < 4000:
		return "force"
	}
	return "full"
}

func (a *analyzer) rounds() {
	m := a.m
	for ri, r := range m.Rounds {
		info := RoundInfo{Round: ri, OpeningKill: -1, FirstContact: -1}
		var count [2]int
		for _, rp := range r.Players {
			if t := a.teamOf(rp.Player); t >= 0 {
				info.EquipValue[t] += rp.EquipValue
				count[t]++
			}
		}
		for t := 0; t < 2; t++ {
			avg := 0
			if count[t] > 0 {
				avg = info.EquipValue[t] / count[t]
			}
			info.BuyType[t] = buyType(avg, a.pistols[ri])
		}
		if site, ok := a.plantRnd[ri]; ok {
			info.Planted = true
			info.Site = site
		}

		kills := a.killsByRound[ri]
		for _, k := range kills {
			kl := m.Kills[k]
			if kl.Killer >= 0 && a.enemies(kl.Killer, kl.Victim) {
				info.OpeningKill = k
				break
			}
		}

		// Trades: the killer dies to the victim's team shortly after.
		for i, k := range kills {
			kl := m.Kills[k]
			if kl.Killer < 0 || !a.enemies(kl.Killer, kl.Victim) {
				continue
			}
			for _, j := range kills[i+1:] {
				later := m.Kills[j]
				if a.seconds(later.Tick-kl.Tick) > tradeWindow {
					break
				}
				if later.Victim == kl.Killer && later.Killer >= 0 && a.teamOf(later.Killer) == a.teamOf(kl.Victim) {
					a.traded[k] = true
					a.tradeKill[j] = true
					a.tradeTime[j] = a.seconds(later.Tick - kl.Tick)
					info.Traded = append(info.Traded, k)
					break
				}
			}
			a.mateDist[k] = a.closestTeammate(kl)
		}

		info.Clutch = a.clutch(ri)

		freeze := r.FreezeEndTick
		for _, d := range m.Damages {
			if d.Round == ri && d.Attacker >= 0 && a.enemies(d.Attacker, d.Victim) {
				info.FirstContact = math.Max(0, a.seconds(d.Tick-freeze))
				break
			}
		}
		a.r.Rounds = append(a.r.Rounds, info)
	}
}

func (a *analyzer) closestTeammate(k match.Kill) float64 {
	fr := &a.m.Frames
	f := fr.IndexAt(k.Tick)
	team := a.teamOf(k.Victim)
	best := -1.0
	for p := range a.m.Players {
		if p == k.Victim || a.teamOf(p) != team {
			continue
		}
		t := &fr.Tracks[p]
		if f >= len(t.Flags) || !t.Alive(f) {
			continue
		}
		pos := t.Pos(f)
		d := dist(pos, k.VictimPos)
		if best < 0 || d < best {
			best = d
		}
	}
	return best
}

func dist(a, b [3]float32) float64 {
	dx, dy, dz := float64(a[0]-b[0]), float64(a[1]-b[1]), float64(a[2]-b[2])
	return math.Sqrt(dx*dx + dy*dy + dz*dz)
}

func (a *analyzer) clutch(ri int) *Clutch {
	r := a.m.Rounds[ri]
	alive := [2]map[int]bool{{}, {}}
	for _, rp := range r.Players {
		if t := a.teamOf(rp.Player); t >= 0 {
			alive[t][rp.Player] = true
		}
	}
	if len(alive[0]) == 0 || len(alive[1]) == 0 {
		return nil
	}
	for _, k := range a.killsByRound[ri] {
		kl := a.m.Kills[k]
		if t := a.teamOf(kl.Victim); t >= 0 {
			delete(alive[t], kl.Victim)
		}
		for t := 0; t < 2; t++ {
			if len(alive[t]) == 1 && len(alive[1-t]) >= 1 {
				var p int
				for p = range alive[t] {
				}
				return &Clutch{
					Player: p,
					Versus: len(alive[1-t]),
					Won:    r.WinnerTeam == t,
					Tick:   kl.Tick,
				}
			}
		}
	}
	return nil
}

func (a *analyzer) players() {
	m := a.m
	stats := make([]PlayerStats, len(m.Players))
	for p := range stats {
		stats[p] = PlayerStats{Player: p, MultiKills: map[int]int{}}
	}

	kast := make([]map[int]bool, len(m.Players))
	roundKills := make([]map[int]int, len(m.Players))
	for p := range kast {
		kast[p] = map[int]bool{}
		roundKills[p] = map[int]int{}
	}
	died := map[[2]int]bool{}

	for ri := range m.Rounds {
		for p := range a.sides[ri] {
			if p < len(stats) {
				stats[p].Rounds++
			}
		}
	}

	for i, k := range m.Kills {
		v := k.Victim
		st := &stats[v]
		st.Deaths++
		died[[2]int{k.Round, v}] = true
		if a.traded[i] {
			st.TradedDeaths++
			kast[v][k.Round] = true
		} else if k.Killer >= 0 && a.enemies(k.Killer, v) {
			st.UntradedDeaths++
			if d := a.mateDist[i]; d > isolationDistance {
				st.IsolatedDeaths++
			}
		}
		if k.Round < len(m.Rounds) {
			if a.seconds(k.Tick-m.Rounds[k.Round].FreezeEndTick) < earlyDeathSeconds {
				st.EarlyDeaths++
			}
		}
		if k.VictimBlind {
			st.BlindDeaths++
		}
		if len(k.VictimUtility) > 0 {
			st.DeathsWithUtility++
			for _, u := range k.VictimUtility {
				st.UnusedUtilityValue += utilityPrice[u]
			}
		}

		if k.Killer >= 0 && a.enemies(k.Killer, v) {
			ks := &stats[k.Killer]
			ks.Kills++
			if k.Headshot {
				ks.Headshots++
			}
			if a.tradeKill[i] {
				ks.TradeKills++
			}
			kast[k.Killer][k.Round] = true
			roundKills[k.Killer][k.Round]++
		}
		if k.Assister >= 0 && a.enemies(k.Assister, v) {
			stats[k.Assister].Assists++
			if k.FlashAssist {
				stats[k.Assister].FlashAssists++
			}
			kast[k.Assister][k.Round] = true
		}
	}

	for _, info := range a.r.Rounds {
		if info.OpeningKill >= 0 {
			k := m.Kills[info.OpeningKill]
			stats[k.Killer].OpeningKills++
			stats[k.Victim].OpeningDeaths++
		}
		if c := info.Clutch; c != nil {
			stats[c.Player].ClutchesPlayed++
			if c.Won {
				stats[c.Player].ClutchesWon++
			}
		}
	}

	for _, d := range m.Damages {
		if d.Attacker < 0 || !a.enemies(d.Attacker, d.Victim) {
			continue
		}
		st := &stats[d.Attacker]
		st.Damage += d.Health
		switch d.Weapon {
		case eqHE, eqMolotov, eqIncendiary:
			st.UtilityDamage += d.Health
		}
		if isGun(d.Weapon) {
			st.ShotsHit++
		}
	}

	for i, p := range m.Shots.Player {
		if int(p) < len(stats) && isGun(m.Shots.Weapon[i]) {
			stats[p].ShotsFired++
		}
	}

	for _, g := range m.Grenades {
		if g.Thrower < 0 {
			continue
		}
		st := &stats[g.Thrower]
		switch g.Type {
		case eqFlash:
			st.FlashesThrown++
		case eqSmoke:
			st.SmokesThrown++
		case eqHE:
			st.HEThrown++
		case eqMolotov, eqIncendiary:
			st.MolotovsThrown++
		case eqDecoy:
			st.DecoysThrown++
		}
	}

	for _, b := range m.Blinds {
		if b.Attacker < 0 {
			continue
		}
		st := &stats[b.Attacker]
		dur := float64(b.Duration)
		switch {
		case b.Attacker == b.Victim:
			if dur >= minBlind {
				st.SelfFlashed++
			}
		case a.enemies(b.Attacker, b.Victim):
			st.EnemyBlindTime += dur
			if dur >= minBlind {
				st.EnemiesFlashed++
			}
		default:
			st.TeammateBlindTime += dur
			if dur >= minBlind {
				st.TeammatesFlashed++
			}
		}
	}

	for p := range stats {
		for ri := range m.Rounds {
			if _, ok := a.sides[ri][p]; ok && !died[[2]int{ri, p}] {
				kast[p][ri] = true
			}
		}
	}
	a.playerExtras(stats, kast)

	for p := range stats {
		st := &stats[p]
		for _, n := range roundKills[p] {
			if n >= 2 {
				st.MultiKills[n]++
			}
		}
		if st.Rounds > 0 {
			rounds := float64(st.Rounds)
			st.ADR = round1(float64(st.Damage) / rounds)
			st.KAST = round1(float64(len(kast[p])) / rounds * 100)
			st.Rating = round2(rating(st, roundKills[p]))
		}
		if st.ShotsFired > 0 {
			st.Accuracy = round1(math.Min(100, float64(st.ShotsHit)/float64(st.ShotsFired)*100))
		}
		st.EnemyBlindTime = round1(st.EnemyBlindTime)
		st.TeammateBlindTime = round1(st.TeammateBlindTime)
	}
	a.r.Players = stats
}

// rating is the public HLTV 1.0 formula.
func rating(st *PlayerStats, roundKills map[int]int) float64 {
	rounds := float64(st.Rounds)
	var multi [6]int
	for _, n := range roundKills {
		if n > 5 {
			n = 5
		}
		multi[n]++
	}
	killRating := float64(st.Kills) / rounds / 0.679
	survivalRating := (rounds - float64(st.Deaths)) / rounds / 0.317
	multiRating := float64(multi[1]+4*multi[2]+9*multi[3]+16*multi[4]+25*multi[5]) / rounds / 1.277
	return (killRating + 0.7*survivalRating + multiRating) / 2.7
}

func (a *analyzer) teams() {
	m := a.m
	for t := 0; t < 2; t++ {
		ts := TeamStats{
			Team:          t,
			Sides:         map[string]*SideRecord{"CT": {}, "T": {}},
			OpeningBySide: map[string]*SideRecord{"CT": {}, "T": {}},
			Buys:          map[string]*SideRecord{},
		}
		var contactSum float64
		var contactN int
		var distSum float64
		var distN int

		for ri, r := range m.Rounds {
			side := r.SideOf[t].String()
			if side == "" {
				continue
			}
			won := r.WinnerTeam == t
			rec := func(s *SideRecord) {
				s.Played++
				if won {
					s.Won++
				}
			}
			rec(ts.Sides[side])
			info := a.r.Rounds[ri]
			if a.pistols[ri] {
				rec(&ts.Pistol)
			}
			buy := info.BuyType[t]
			if ts.Buys[buy] == nil {
				ts.Buys[buy] = &SideRecord{}
			}
			rec(ts.Buys[buy])
			if buy == "full" && (info.BuyType[1-t] == "eco" || info.BuyType[1-t] == "force") {
				rec(&ts.AntiEco)
			}
			if info.OpeningKill >= 0 {
				k := m.Kills[info.OpeningKill]
				o := ts.OpeningBySide[side]
				if a.teamOf(k.Killer) == t {
					ts.OpeningKills++
					o.Played++
					o.Won++
					rec(&ts.AdvantageRounds)
				} else {
					ts.OpeningDeaths++
					o.Played++
					rec(&ts.DisadvantageRounds)
				}
			}
			if info.Planted {
				if r.SideOf[t] == match.SideT {
					rec(&ts.Plants)
				} else {
					rec(&ts.Retakes)
				}
			}
			if info.FirstContact >= 0 {
				contactSum += info.FirstContact
				contactN++
			}
		}

		for i, k := range m.Kills {
			if a.teamOf(k.Victim) != t {
				continue
			}
			ts.Deaths++
			if a.traded[i] {
				ts.TradedDeaths++
			}
			if d, ok := a.mateDist[i]; ok && d >= 0 {
				distSum += d
				distN++
			}
		}
		if ts.Deaths > 0 {
			ts.TradeRate = round1(float64(ts.TradedDeaths) / float64(ts.Deaths) * 100)
		}
		if distN > 0 {
			ts.AvgTeammateDistance = math.Round(distSum / float64(distN))
		}
		ts.FirstContact = -1
		if contactN > 0 {
			ts.FirstContact = round1(contactSum / float64(contactN))
		}

		for _, st := range a.r.Players {
			if a.teamOf(st.Player) != t {
				continue
			}
			ts.GrenadesUsed += st.FlashesThrown + st.SmokesThrown + st.HEThrown + st.MolotovsThrown + st.DecoysThrown
			ts.TeamFlashes += st.TeammatesFlashed
			ts.TeamBlindTime += st.TeammateBlindTime
			ts.UnusedUtility += st.UnusedUtilityValue
		}
		ts.TeamBlindTime = round1(ts.TeamBlindTime)
		if n := len(m.Rounds); n > 0 {
			ts.UtilPerRound = round1(float64(ts.GrenadesUsed) / float64(n))
		}
		a.r.Teams[t] = ts
	}
}

func (a *analyzer) aim() {
	m := a.m
	for p := range m.Players {
		s := AimSummary{Player: p, ReactionMs: -1, CrosshairErrorDeg: -1, FirstShotErrorDeg: -1, TimeToDamageMs: -1}
		var reaction, xhair, firstShot, ttd []float64
		var shots, hits, kills, hs int
		for _, e := range m.Engagements {
			if e.Attacker != p {
				continue
			}
			s.Engagements++
			if e.Killed {
				s.DuelsWon++
				kills++
				if e.Headshot {
					hs++
				}
			}
			if e.Died {
				s.DuelsLost++
				if e.Shots == 0 {
					s.NoShotDeaths++
				}
			}
			shots += e.Shots
			hits += e.Hits
			if e.ReactionMs >= 0 {
				if e.ReactionMs < 80 {
					s.Prefires++
				} else {
					reaction = append(reaction, e.ReactionMs)
				}
			}
			if e.CrosshairErrorDeg >= 0 {
				xhair = append(xhair, e.CrosshairErrorDeg)
			}
			if e.FirstShotErrorDeg >= 0 {
				firstShot = append(firstShot, e.FirstShotErrorDeg)
			}
			if e.TimeToDamageMs >= 0 {
				ttd = append(ttd, e.TimeToDamageMs)
			}
		}
		s.ReactionSamples = len(reaction)
		s.ReactionMs = median(reaction, 3)
		s.CrosshairErrorDeg = median(xhair, 3)
		s.FirstShotErrorDeg = median(firstShot, 3)
		s.TimeToDamageMs = median(ttd, 3)
		if kills > 0 {
			s.HeadshotRate = round1(float64(hs) / float64(kills) * 100)
		}
		if shots > 0 {
			s.DuelAccuracy = round1(math.Min(100, float64(hits)/float64(shots)*100))
		}
		a.r.Aim = append(a.r.Aim, s)
	}
}

func median(v []float64, min int) float64 {
	if len(v) < min {
		return -1
	}
	s := append([]float64(nil), v...)
	sort.Float64s(s)
	n := len(s)
	if n%2 == 1 {
		return round1(s[n/2])
	}
	return round1((s[n/2-1] + s[n/2]) / 2)
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }
func round2(v float64) float64 { return math.Round(v*100) / 100 }
