package parse

import (
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"

	"github.com/abdurryy/CerlockCS/internal/match"
)

func isGun(t common.EquipmentType) bool {
	switch t.Class() {
	case common.EqClassPistols, common.EqClassSMG, common.EqClassHeavy, common.EqClassRifle:
		return true
	}
	return false
}

func (c *collector) live() bool { return c.recording && c.round >= 0 }

func (c *collector) registerCombat() {
	p := c.p

	p.RegisterEventHandler(func(e events.Kill) {
		if !c.live() || e.Victim == nil {
			return
		}
		tick := c.tick()
		victim := c.index(e.Victim)
		if victim < 0 {
			return
		}
		k := match.Kill{
			Tick:          tick,
			Round:         c.round,
			Killer:        c.index(e.Killer),
			Victim:        victim,
			Assister:      c.index(e.Assister),
			Headshot:      e.IsHeadshot,
			Wallbang:      e.PenetratedObjects > 0,
			ThroughSmoke:  e.ThroughSmoke,
			NoScope:       e.NoScope,
			AttackerBlind: e.AttackerBlind,
			FlashAssist:   e.AssistedFlash,
			VictimSide:    match.Side(e.Victim.Team),
			VictimPos:     v3(e.Victim.Position()),
			VictimUtility: c.lastUtil[victim],
			VictimBlind:   e.Victim.IsBlinded(),
		}
		var killerWeapon common.EquipmentType
		if e.Weapon != nil {
			killerWeapon = e.Weapon.Type
			k.Weapon = c.weapon(e.Weapon.Type)
		}
		if e.Killer != nil {
			k.KillerSide = match.Side(e.Killer.Team)
			k.KillerPos = v3(e.Killer.Position())
		}
		c.m.Kills = append(c.m.Kills, k)

		if c.aim != nil && k.Killer >= 0 && isGun(killerWeapon) && k.KillerSide != k.VictimSide {
			var victimWeapon uint16
			if w := e.Victim.ActiveWeapon(); w != nil && isGun(w.Type) {
				victimWeapon = uint16(w.Type)
			} else if t := &c.m.Frames.Tracks[victim]; len(t.Weapon) > 0 {
				// The weapon is often dropped before the death event fires.
				if w := t.Weapon[len(t.Weapon)-1]; isGun(common.EquipmentType(w)) {
					victimWeapon = w
				}
			}
			c.aim.Kill(tick, k.Killer, victim, uint16(killerWeapon), victimWeapon, e.IsHeadshot)
		}
	})

	p.RegisterEventHandler(func(e events.PlayerHurt) {
		if !c.live() || e.Player == nil {
			return
		}
		victim := c.index(e.Player)
		if victim < 0 {
			return
		}
		d := match.Damage{
			Tick:     c.tick(),
			Round:    c.round,
			Attacker: c.index(e.Attacker),
			Victim:   victim,
			Health:   e.HealthDamageTaken,
			Armor:    e.ArmorDamageTaken,
			HitGroup: int(e.HitGroup),
			HPAfter:  e.Health,
		}
		var wt common.EquipmentType
		if e.Weapon != nil {
			wt = e.Weapon.Type
			d.Weapon = c.weapon(wt)
		}
		c.m.Damages = append(c.m.Damages, d)

		if c.aim != nil && d.Attacker >= 0 && isGun(wt) && e.Attacker.Team != e.Player.Team {
			c.aim.Hit(d.Tick, d.Attacker, victim, uint16(wt), d.Health, e.HitGroup == events.HitGroupHead)
		}
	})

	p.RegisterEventHandler(func(e events.WeaponFire) {
		if !c.live() || e.Shooter == nil || e.Weapon == nil {
			return
		}
		shooter := c.index(e.Shooter)
		if shooter < 0 || shooter > 255 {
			return
		}
		tick := c.tick()
		s := &c.m.Shots
		s.Ticks = append(s.Ticks, int32(tick))
		s.Player = append(s.Player, uint8(shooter))
		s.Weapon = append(s.Weapon, c.weapon(e.Weapon.Type))
		if c.aim != nil && isGun(e.Weapon.Type) {
			c.aim.Shot(tick, shooter)
		}
	})

	p.RegisterEventHandler(func(e events.PlayerFlashed) {
		if !c.live() || e.Player == nil {
			return
		}
		victim := c.index(e.Player)
		if victim < 0 {
			return
		}
		b := match.Blind{
			Tick:     c.tick(),
			Round:    c.round,
			Attacker: c.index(e.Attacker),
			Victim:   victim,
			Duration: e.Player.FlashDuration,
			Grenade:  -1,
		}
		if e.Projectile != nil {
			if g, ok := c.grenadeByUID[e.Projectile.UniqueID()]; ok {
				b.Grenade = g
			}
		}
		if b.Duration <= 0 {
			return
		}
		c.m.Blinds = append(c.m.Blinds, b)
	})
}
