package parse

import (
	"sort"

	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"

	"github.com/abdurryy/CerlockCS/internal/match"
)

func (c *collector) registerUtility() {
	p := c.p

	p.RegisterEventHandler(func(e events.GrenadeProjectileThrow) {
		if !c.live() || e.Projectile == nil {
			return
		}
		c.grenadeFor(e.Projectile)
	})

	p.RegisterEventHandler(func(e events.GrenadeProjectileDestroy) {
		if !c.live() || e.Projectile == nil {
			return
		}
		g := c.grenadeFor(e.Projectile)
		c.storePath(g, e.Projectile.Trajectory)
		gr := &c.m.Grenades[g]
		tick := c.tick()
		detonated := gr.EffectTick >= 0
		if !detonated {
			gr.EffectTick = tick
			if n := len(e.Projectile.Trajectory); n > 0 {
				gr.Pos = v3(e.Projectile.Trajectory[n-1].Position)
			}
		}
		if gr.Type == uint16(common.EqMolotov) || gr.Type == uint16(common.EqIncendiary) {
			// The fire starts a few ticks after the bottle breaks, remember
			// it so the inferno can be linked back to this grenade.
			c.lastFireNade[gr.Thrower] = g
		} else if !detonated && gr.EndTick < 0 {
			gr.EndTick = tick
		}
		delete(c.grenadeByEntity, e.Projectile.Entity.ID())
	})

	detonate := func(e events.GrenadeEvent, instant bool) {
		if !c.live() {
			return
		}
		g := c.grenadeByEvent(e)
		gr := &c.m.Grenades[g]
		gr.EffectTick = c.tick()
		gr.Pos = v3(e.Position)
		if instant {
			gr.EndTick = gr.EffectTick
		}
	}
	expire := func(e events.GrenadeEvent) {
		if !c.live() {
			return
		}
		if g, ok := c.findGrenade(e); ok {
			c.m.Grenades[g].EndTick = c.tick()
		}
	}

	p.RegisterEventHandler(func(e events.FlashExplode) { detonate(e.GrenadeEvent, true) })
	p.RegisterEventHandler(func(e events.HeExplode) { detonate(e.GrenadeEvent, true) })
	p.RegisterEventHandler(func(e events.SmokeStart) { detonate(e.GrenadeEvent, false) })
	p.RegisterEventHandler(func(e events.DecoyStart) { detonate(e.GrenadeEvent, false) })
	p.RegisterEventHandler(func(e events.SmokeExpired) { expire(e.GrenadeEvent) })
	p.RegisterEventHandler(func(e events.DecoyExpired) { expire(e.GrenadeEvent) })

	p.RegisterEventHandler(func(e events.InfernoStart) {
		if !c.live() || e.Inferno == nil {
			return
		}
		tick := c.tick()
		thrower := c.index(e.Inferno.Thrower())
		inf := match.Inferno{
			ID:        len(c.m.Infernos),
			Thrower:   thrower,
			Round:     c.round,
			StartTick: tick,
			EndTick:   -1,
		}
		c.infernoByUID[e.Inferno.UniqueID()] = inf.ID
		c.m.Infernos = append(c.m.Infernos, inf)
	})

	p.RegisterEventHandler(func(e events.InfernoExpired) {
		if !c.live() || e.Inferno == nil {
			return
		}
		id, ok := c.infernoByUID[e.Inferno.UniqueID()]
		if !ok {
			return
		}
		tick := c.tick()
		inf := &c.m.Infernos[id]
		inf.EndTick = tick
		if g, ok := c.lastFireNade[inf.Thrower]; ok {
			if gr := &c.m.Grenades[g]; gr.EndTick < 0 {
				gr.EndTick = tick
			}
			delete(c.lastFireNade, inf.Thrower)
		}
		delete(c.infernoByUID, e.Inferno.UniqueID())
		delete(c.lastFireSample, e.Inferno.UniqueID())
	})
}

func (c *collector) grenadeFor(proj *common.GrenadeProjectile) int {
	if g, ok := c.grenadeByUID[proj.UniqueID()]; ok {
		return g
	}
	var typ common.EquipmentType
	if proj.WeaponInstance != nil {
		typ = proj.WeaponInstance.Type
	}
	thrower := proj.Thrower
	if thrower == nil {
		thrower = proj.Owner
	}
	g := match.Grenade{
		ID:         len(c.m.Grenades),
		Type:       c.weapon(typ),
		Thrower:    c.index(thrower),
		Round:      c.round,
		ThrowTick:  c.tick(),
		EffectTick: -1,
		EndTick:    -1,
	}
	if thrower != nil {
		g.Side = match.Side(thrower.Team)
	}
	if n := len(proj.Trajectory); n > 0 {
		g.ThrowTick = proj.Trajectory[0].Tick
	}
	c.m.Grenades = append(c.m.Grenades, g)
	c.grenadeByUID[proj.UniqueID()] = g.ID
	if proj.Entity != nil {
		c.grenadeByEntity[proj.Entity.ID()] = g.ID
	}
	return g.ID
}

func (c *collector) findGrenade(e events.GrenadeEvent) (int, bool) {
	if g, ok := c.grenadeByEntity[e.GrenadeEntityID]; ok {
		return g, true
	}
	// The projectile may already be gone, match on type and thrower.
	thrower := c.index(e.Thrower)
	for i := len(c.m.Grenades) - 1; i >= 0; i-- {
		g := &c.m.Grenades[i]
		if g.Round != c.round {
			break
		}
		if g.Type == uint16(e.GrenadeType) && g.Thrower == thrower && g.EndTick < 0 {
			return i, true
		}
	}
	return 0, false
}

// grenadeByEvent finds the grenade for a detonation, creating one when the
// throw happened before recording started.
func (c *collector) grenadeByEvent(e events.GrenadeEvent) int {
	if g, ok := c.findGrenade(e); ok {
		return g
	}
	thrower := c.index(e.Thrower)
	g := match.Grenade{
		ID:         len(c.m.Grenades),
		Type:       c.weapon(e.GrenadeType),
		Thrower:    thrower,
		Round:      c.round,
		ThrowTick:  c.tick(),
		EffectTick: -1,
		EndTick:    -1,
	}
	if e.Thrower != nil {
		g.Side = match.Side(e.Thrower.Team)
	}
	c.m.Grenades = append(c.m.Grenades, g)
	return g.ID
}

func (c *collector) storePath(g int, traj []common.TrajectoryEntry) {
	gr := &c.m.Grenades[g]
	if gr.PathLen > 0 || len(traj) == 0 {
		return
	}
	paths := &c.m.GrenadePaths
	gr.PathStart = len(paths.Ticks)
	var last [3]int16
	for i, t := range traj {
		p := [3]int16{clamp16(t.Position.X), clamp16(t.Position.Y), clamp16(t.Position.Z)}
		// Resting grenades report the same spot every tick.
		if i > 0 && p == last && i != len(traj)-1 {
			continue
		}
		last = p
		paths.X = append(paths.X, p[0])
		paths.Y = append(paths.Y, p[1])
		paths.Z = append(paths.Z, p[2])
		paths.Ticks = append(paths.Ticks, int32(t.Tick))
	}
	gr.PathLen = len(paths.Ticks) - gr.PathStart
}

// sampleInfernos stores the outline of every burning molotov when it changes.
func (c *collector) sampleInfernos(tick int) {
	for _, inf := range c.p.GameState().Infernos() {
		id, ok := c.infernoByUID[inf.UniqueID()]
		if !ok {
			continue
		}
		if last, ok := c.lastFireSample[inf.UniqueID()]; ok && tick-last < 8 {
			continue
		}
		c.lastFireSample[inf.UniqueID()] = tick
		var pts [][2]float64
		for _, f := range inf.Fires().Active().List() {
			pts = append(pts, [2]float64{f.X, f.Y})
		}
		hull := convexHull(pts)
		flat := make([]float32, 0, len(hull)*2)
		for _, p := range hull {
			flat = append(flat, float32(p[0]), float32(p[1]))
		}
		snaps := &c.m.Infernos[id].Snapshots
		if n := len(*snaps); n > 0 && equalHull((*snaps)[n-1].Hull, flat) {
			continue
		}
		*snaps = append(*snaps, match.FireSnapshot{Tick: tick, Hull: flat})
	}
}

func equalHull(a, b []float32) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if d := a[i] - b[i]; d > 1 || d < -1 {
			return false
		}
	}
	return true
}

// convexHull is Andrew's monotone chain, returning points counter clockwise.
// Fewer than three points are returned as they are.
func convexHull(pts [][2]float64) [][2]float64 {
	if len(pts) < 3 {
		return pts
	}
	sort.Slice(pts, func(i, j int) bool {
		if pts[i][0] != pts[j][0] {
			return pts[i][0] < pts[j][0]
		}
		return pts[i][1] < pts[j][1]
	})
	cross := func(o, a, b [2]float64) float64 {
		return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
	}
	hull := make([][2]float64, 0, 2*len(pts))
	for _, p := range pts {
		for len(hull) >= 2 && cross(hull[len(hull)-2], hull[len(hull)-1], p) <= 0 {
			hull = hull[:len(hull)-1]
		}
		hull = append(hull, p)
	}
	lower := len(hull) + 1
	for i := len(pts) - 2; i >= 0; i-- {
		p := pts[i]
		for len(hull) >= lower && cross(hull[len(hull)-2], hull[len(hull)-1], p) <= 0 {
			hull = hull[:len(hull)-1]
		}
		hull = append(hull, p)
	}
	return hull[:len(hull)-1]
}
