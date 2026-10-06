// Package aim cuts out short, full tick rate windows around every fight and
// measures how the attacker aimed during them.
//
// The visibility signal is the game's own radar spotting (m_bSpottedByMask).
// It is not a perfect line of sight check, but it updates within a few ticks of
// an enemy becoming visible, which is good enough for reaction time and
// crosshair placement numbers.
package aim

import (
	"math"
	"sort"

	"github.com/abdurryy/CerlockCS/internal/match"
)

// Sample is one tick of view data for one player.
type Sample struct {
	Tick  int32
	Eye   [3]float32
	Yaw   float32
	Pitch float32
	Alive bool
	// SpottedBy has bit i set when player i currently sees this player.
	SpottedBy uint32
}

const historySize = 512

type history struct {
	buf  [historySize]Sample
	next int
	n    int
}

func (h *history) push(s Sample) {
	h.buf[h.next] = s
	h.next = (h.next + 1) % historySize
	if h.n < historySize {
		h.n++
	}
}

// since returns samples with tick >= from in chronological order.
func (h *history) since(from int32) []Sample {
	out := make([]Sample, 0, 64)
	start := (h.next - h.n + historySize) % historySize
	for i := 0; i < h.n; i++ {
		s := h.buf[(start+i)%historySize]
		if s.Tick >= from {
			out = append(out, s)
		}
	}
	return out
}

type pair struct{ attacker, victim int }

type pending struct {
	e        match.Engagement
	attacker []Sample
	victim   []Sample
	lastHit  int
	closeAt  int
	hitTicks []int
}

// Tracker receives per tick samples and combat events from the parser and
// turns them into engagements.
type Tracker struct {
	TickRate float64
	// PreWindow is how many seconds before the first hit are kept.
	PreWindow float64
	// Linger is how long an engagement stays open after the last hit.
	Linger float64

	hist    []*history
	shots   map[int][]int
	active  map[pair]*pending
	round   int
	out     []match.Engagement
	samples match.AimSamples
}

func NewTracker(tickRate float64) *Tracker {
	if tickRate <= 0 {
		tickRate = 64
	}
	return &Tracker{
		TickRate:  tickRate,
		PreWindow: 2,
		Linger:    1,
		shots:     map[int][]int{},
		active:    map[pair]*pending{},
	}
}

func (t *Tracker) ticks(seconds float64) int { return int(math.Round(seconds * t.TickRate)) }

func (t *Tracker) SetRound(r int) { t.round = r }

// Push records one tick for a player. Call it every parsed frame.
func (t *Tracker) Push(player int, s Sample) {
	for len(t.hist) <= player {
		t.hist = append(t.hist, &history{})
	}
	t.hist[player].push(s)
	for k, p := range t.active {
		if k.attacker == player {
			p.attacker = append(p.attacker, s)
		}
		if k.victim == player {
			p.victim = append(p.victim, s)
		}
	}
}

// Speed returns a player's horizontal speed in units per second, measured
// over the last few ticks. Zero when there is not enough history.
func (t *Tracker) Speed(player int) float32 {
	if player < 0 || player >= len(t.hist) {
		return 0
	}
	h := t.hist[player]
	if h.n < 2 {
		return 0
	}
	last := h.buf[(h.next-1+historySize)%historySize]
	for i := 2; i <= h.n && i <= 16; i++ {
		s := h.buf[(h.next-i+historySize)%historySize]
		dt := last.Tick - s.Tick
		if dt < 4 {
			continue
		}
		if dt > 16 {
			return 0
		}
		dx := float64(last.Eye[0] - s.Eye[0])
		dy := float64(last.Eye[1] - s.Eye[1])
		v := math.Hypot(dx, dy) / (float64(dt) / t.TickRate)
		if v > 1000 {
			// Respawn or teleport, not movement.
			return 0
		}
		return float32(v)
	}
	return 0
}

func (t *Tracker) Shot(tick, player int) {
	list := append(t.shots[player], tick)
	// Only recent shots matter, drop anything older than the pre window.
	cut := tick - t.ticks(t.PreWindow+t.Linger+1)
	i := sort.SearchInts(list, cut)
	t.shots[player] = list[i:]
}

// Hit registers damage from attacker to victim with a gun.
func (t *Tracker) Hit(tick, attacker, victim int, weapon uint16, damage int, headshot bool) {
	p := t.open(tick, attacker, victim, weapon)
	if p == nil {
		return
	}
	p.e.Hits++
	p.e.Damage += damage
	p.hitTicks = append(p.hitTicks, tick)
	if p.e.FirstHitTick < 0 {
		p.e.FirstHitTick = tick
	}
	if headshot {
		p.e.Headshot = true
	}
	p.lastHit = tick
	p.closeAt = tick + t.ticks(t.Linger)
}

// Kill closes the killer's engagement and records the duel from the victim's
// side as well, so lost fights where the victim never landed a shot show up.
func (t *Tracker) Kill(tick, killer, victim int, killerWeapon, victimWeapon uint16, headshot bool) {
	if p := t.active[pair{killer, victim}]; p != nil {
		p.e.Killed = true
		p.e.KillTick = tick
		if headshot {
			p.e.Headshot = true
		}
		p.closeAt = tick
	} else if p := t.open(tick, killer, victim, killerWeapon); p != nil {
		p.e.Killed = true
		p.e.KillTick = tick
		p.e.Headshot = headshot
		p.closeAt = tick
	}
	if victimWeapon != 0 {
		if p := t.active[pair{victim, killer}]; p != nil {
			p.e.Died = true
			p.closeAt = tick
		} else if p := t.open(tick, victim, killer, victimWeapon); p != nil {
			p.e.Died = true
			p.closeAt = tick
		}
	}
	// Anything else the dead player was part of is over.
	for k, p := range t.active {
		if k.attacker == victim || k.victim == victim {
			if p.closeAt > tick {
				p.closeAt = tick
			}
		}
	}
}

func (t *Tracker) open(tick, attacker, victim int, weapon uint16) *pending {
	if attacker < 0 || victim < 0 || attacker == victim {
		return nil
	}
	key := pair{attacker, victim}
	if p, ok := t.active[key]; ok {
		return p
	}
	if attacker >= len(t.hist) || victim >= len(t.hist) {
		return nil
	}
	start := int32(tick - t.ticks(t.PreWindow))
	p := &pending{
		e: match.Engagement{
			Round:             t.round,
			Attacker:          attacker,
			Victim:            victim,
			Weapon:            weapon,
			StartTick:         int(start),
			FirstSeenTick:     -1,
			FirstShotTick:     -1,
			FirstHitTick:      -1,
			KillTick:          -1,
			ReactionMs:        -1,
			TimeToDamageMs:    -1,
			CrosshairErrorDeg: -1,
			FlickDeg:          -1,
			FirstShotErrorDeg: -1,
		},
		attacker: t.hist[attacker].since(start),
		victim:   t.hist[victim].since(start),
		lastHit:  tick,
		closeAt:  tick + t.ticks(t.Linger),
	}
	t.active[key] = p
	return p
}

// EndFrame closes engagements whose linger time ran out.
func (t *Tracker) EndFrame(tick int) {
	for k, p := range t.active {
		if tick >= p.closeAt {
			t.finish(p, tick)
			delete(t.active, k)
		}
	}
}

// Flush closes everything, used on round end and at the end of the demo.
func (t *Tracker) Flush(tick int) {
	keys := make([]pair, 0, len(t.active))
	for k := range t.active {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		return t.active[keys[i]].e.StartTick < t.active[keys[j]].e.StartTick
	})
	for _, k := range keys {
		t.finish(t.active[k], tick)
		delete(t.active, k)
	}
	t.shots = map[int][]int{}
}

// Result returns all finished engagements, ordered by start tick.
func (t *Tracker) Result() ([]match.Engagement, match.AimSamples) {
	sort.SliceStable(t.out, func(i, j int) bool { return t.out[i].StartTick < t.out[j].StartTick })
	for i := range t.out {
		t.out[i].ID = i
	}
	return t.out, t.samples
}

func (t *Tracker) finish(p *pending, tick int) {
	e := p.e
	e.EndTick = tick
	if p.e.KillTick >= 0 {
		e.EndTick = p.e.KillTick
	}

	// Pair attacker and victim samples by tick.
	victimAt := make(map[int32]Sample, len(p.victim))
	for _, s := range p.victim {
		victimAt[s.Tick] = s
	}
	type row struct {
		a, v    Sample
		err     float64
		visible bool
	}
	rows := make([]row, 0, len(p.attacker))
	bit := uint32(0)
	if e.Attacker < 32 {
		bit = 1 << uint(e.Attacker)
	}
	for _, a := range p.attacker {
		if int(a.Tick) > e.EndTick {
			break
		}
		v, ok := victimAt[a.Tick]
		if !ok {
			continue
		}
		rows = append(rows, row{
			a:       a,
			v:       v,
			err:     AngleTo(a.Eye, a.Yaw, a.Pitch, v.Eye),
			visible: v.SpottedBy&bit != 0,
		})
	}
	if len(rows) < 2 {
		return
	}

	shots := t.shotsBetween(e.Attacker, e.StartTick, e.EndTick)
	ref := e.FirstHitTick
	if ref < 0 {
		ref = e.EndTick
	}

	// The fight starts at the last moment the victim went from hidden to
	// spotted before the first hit.
	seen := -1
	for i := 1; i < len(rows); i++ {
		if int(rows[i].a.Tick) > ref {
			break
		}
		if rows[i].visible && !rows[i-1].visible {
			seen = i
		}
	}

	errAt := func(tick int) (float64, int) {
		i := sort.Search(len(rows), func(i int) bool { return int(rows[i].a.Tick) >= tick })
		if i >= len(rows) {
			i = len(rows) - 1
		}
		return rows[i].err, i
	}

	if seen >= 0 {
		e.FirstSeenTick = int(rows[seen].a.Tick)
		e.CrosshairErrorDeg = round2(rows[seen].err)
		if e.FirstHitTick >= 0 {
			e.TimeToDamageMs = round2(float64(e.FirstHitTick-e.FirstSeenTick) / t.TickRate * 1000)
		}
	}

	from := e.StartTick
	if e.FirstSeenTick >= 0 {
		from = e.FirstSeenTick
	}
	for _, s := range shots {
		if s >= from {
			e.FirstShotTick = s
			break
		}
	}
	for _, s := range shots {
		if s >= from {
			e.Shots++
		}
	}
	if e.FirstShotTick >= 0 {
		errShot, i := errAt(e.FirstShotTick)
		e.FirstShotErrorDeg = round2(errShot)
		if seen >= 0 && e.FirstShotTick <= ref {
			e.ReactionMs = round2(float64(e.FirstShotTick-e.FirstSeenTick) / t.TickRate * 1000)
			a0, a1 := rows[seen].a, rows[i].a
			e.FlickDeg = round2(AngleBetween(a0.Yaw, a0.Pitch, a1.Yaw, a1.Pitch))
		}
	}
	if e.Hits > e.Shots {
		// Shotguns hit several times per shot and some hits land a tick
		// before the shot event, keep the numbers sane.
		e.Shots = e.Hits
	}

	e.SampleStart = len(t.samples.Ticks)
	e.SampleLen = len(rows)
	for _, r := range rows {
		t.samples.Ticks = append(t.samples.Ticks, r.a.Tick)
		t.samples.Yaw = append(t.samples.Yaw, r.a.Yaw)
		t.samples.Pitch = append(t.samples.Pitch, r.a.Pitch)
		t.samples.Error = append(t.samples.Error, float32(r.err))
		var vis uint8
		if r.visible {
			vis = 1
		}
		t.samples.Visible = append(t.samples.Visible, vis)
	}
	t.out = append(t.out, e)
}

func (t *Tracker) shotsBetween(player, from, to int) []int {
	var out []int
	for _, s := range t.shots[player] {
		if s >= from && s <= to {
			out = append(out, s)
		}
	}
	return out
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// Direction converts the game's yaw and pitch (degrees, pitch positive when
// looking down) to a unit vector.
func Direction(yaw, pitch float32) [3]float64 {
	y := float64(yaw) * math.Pi / 180
	p := float64(pitch) * math.Pi / 180
	return [3]float64{math.Cos(p) * math.Cos(y), math.Cos(p) * math.Sin(y), -math.Sin(p)}
}

// AngleTo returns the angle in degrees between where the player looks and the
// direction from their eye to target.
func AngleTo(eye [3]float32, yaw, pitch float32, target [3]float32) float64 {
	d := Direction(yaw, pitch)
	v := [3]float64{
		float64(target[0] - eye[0]),
		float64(target[1] - eye[1]),
		float64(target[2] - eye[2]),
	}
	l := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
	if l == 0 {
		return 0
	}
	dot := (d[0]*v[0] + d[1]*v[1] + d[2]*v[2]) / l
	return math.Acos(math.Max(-1, math.Min(1, dot))) * 180 / math.Pi
}

func AngleBetween(yaw1, pitch1, yaw2, pitch2 float32) float64 {
	a := Direction(yaw1, pitch1)
	b := Direction(yaw2, pitch2)
	dot := a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
	return math.Acos(math.Max(-1, math.Min(1, dot))) * 180 / math.Pi
}

// NormalizePitch maps pitch values stored as 270..360 to -90..0.
func NormalizePitch(p float32) float32 {
	if p > 180 {
		return p - 360
	}
	return p
}
