package parse

import (
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"

	"github.com/abdurryy/CerlockCS/internal/match"
)

func (c *collector) registerBomb() {
	p := c.p
	add := func(kind string, pl *common.Player, site events.Bombsite) {
		if !c.live() {
			return
		}
		ev := match.BombEvent{
			Tick:   c.tick(),
			Round:  c.round,
			Kind:   kind,
			Player: c.index(pl),
			Pos:    v3(p.GameState().Bomb().Position()),
		}
		if site != events.BomsiteUnknown {
			ev.Site = string(rune(site))
		}
		if pl != nil && (kind == "plant_begin" || kind == "defuse_begin") {
			ev.Pos = v3(pl.Position())
		}
		c.m.BombEvents = append(c.m.BombEvents, ev)
	}

	p.RegisterEventHandler(func(e events.BombPlantBegin) { add("plant_begin", e.Player, e.Site) })
	p.RegisterEventHandler(func(e events.BombPlantAborted) { add("plant_abort", e.Player, events.BomsiteUnknown) })
	p.RegisterEventHandler(func(e events.BombPlanted) {
		c.bombState = match.BombPlanted
		add("planted", e.Player, e.Site)
	})
	p.RegisterEventHandler(func(e events.BombDefuseStart) {
		add("defuse_begin", e.Player, events.BomsiteUnknown)
		if e.HasKit && c.live() && len(c.m.BombEvents) > 0 {
			c.m.BombEvents[len(c.m.BombEvents)-1].Kit = true
		}
	})
	p.RegisterEventHandler(func(e events.BombDefuseAborted) { add("defuse_abort", e.Player, events.BomsiteUnknown) })
	p.RegisterEventHandler(func(e events.BombDefused) {
		c.bombState = match.BombDefused
		add("defused", e.Player, e.Site)
	})
	p.RegisterEventHandler(func(e events.BombExplode) {
		c.bombState = match.BombExploded
		add("exploded", e.Player, e.Site)
	})
	p.RegisterEventHandler(func(e events.BombDropped) {
		if c.bombState == match.BombCarried || c.bombState == match.BombNone {
			c.bombState = match.BombDropped
		}
		add("dropped", e.Player, events.BomsiteUnknown)
	})
	p.RegisterEventHandler(func(e events.BombPickup) {
		c.bombState = match.BombCarried
		add("pickup", e.Player, events.BomsiteUnknown)
	})
}
