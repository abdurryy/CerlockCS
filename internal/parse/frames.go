package parse

import (
	"math"
	"math/bits"
	"strconv"

	"github.com/golang/geo/r3"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
	st "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/sendtables"

	"github.com/abdurryy/CerlockCS/internal/aim"
	"github.com/abdurryy/CerlockCS/internal/match"
)

// Utility bits stored in Track.Util. Flashes take two bits for the count.
const (
	utilSmoke  = 1 << 0
	utilFlash1 = 1 << 1
	utilFlash2 = 1 << 2
	utilHE     = 1 << 3
	utilFire   = 1 << 4
	utilDecoy  = 1 << 5
)

func playerKey(pl *common.Player) string {
	if pl.SteamID64 != 0 && !pl.IsBot {
		return strconv.FormatUint(pl.SteamID64, 10)
	}
	return "bot:" + pl.Name
}

func isPlaying(pl *common.Player) bool {
	return pl != nil && (pl.Team == common.TeamTerrorists || pl.Team == common.TeamCounterTerrorists)
}

// index returns the replay index for a player, registering them on first
// sight. Spectators and nil players map to -1.
func (c *collector) index(pl *common.Player) int {
	if pl == nil {
		return -1
	}
	if i, ok := c.byPtr[pl]; ok {
		return i
	}
	key := playerKey(pl)
	if i, ok := c.players[key]; ok {
		c.byPtr[pl] = i
		return i
	}
	if !isPlaying(pl) || !c.recording {
		return -1
	}
	i := len(c.m.Players)
	c.players[key] = i
	c.m.Players = append(c.m.Players, match.Player{
		Index:   i,
		SteamID: pl.SteamID64,
		Name:    pl.Name,
		IsBot:   pl.IsBot,
		Team:    -1,
	})
	c.m.Frames.Tracks = append(c.m.Frames.Tracks, match.Track{})
	c.m.Frames.Tracks[i].Grow(len(c.m.Frames.Ticks))
	c.lastUtil = append(c.lastUtil, nil)
	c.byPtr[pl] = i
	return i
}

func (c *collector) registerFrames() {
	c.p.RegisterEventHandler(func(events.FrameDone) { c.onFrame() })
}

func (c *collector) onFrame() {
	gs := c.p.GameState()
	tick := gs.IngameTick()

	if c.opts.Progress != nil {
		if pr := c.p.Progress(); pr-c.lastProg >= 0.01 {
			c.lastProg = pr
			c.opts.Progress(pr)
		}
	}

	if !c.recording {
		// Demos recorded mid match never send a round start, begin as
		// soon as the game is live.
		if gs.IsMatchStarted() && !gs.IsWarmupPeriod() && len(c.m.Rounds) == 0 {
			c.beginRecording()
			c.startRound(tick)
		} else {
			return
		}
	}

	playing := gs.Participants().Playing()
	for i := range c.slotPlayer {
		c.slotPlayer[i] = -1
	}
	for _, pl := range playing {
		if idx := c.index(pl); idx >= 0 && pl.EntityID > 0 && pl.EntityID <= len(c.slotPlayer) {
			c.slotPlayer[pl.EntityID-1] = idx
		}
	}

	sample := tick-c.lastSample >= c.opts.SampleInterval
	f := len(c.m.Frames.Ticks)
	if sample {
		c.lastSample = tick
		c.m.Frames.Ticks = append(c.m.Frames.Ticks, int32(tick))
		for i := range c.m.Frames.Tracks {
			c.m.Frames.Tracks[i].Grow(f + 1)
		}
		c.sampleBomb()
	}

	bomb := gs.Bomb()
	for _, pl := range playing {
		idx := c.index(pl)
		pawn := pl.PlayerPawnEntity()
		if idx < 0 || pawn == nil {
			continue
		}
		// Every Player accessor resolves the pawn again through string keyed
		// lookups, so read straight from the pawn and keep the per tick work
		// down to what the aim tracker needs.
		hp := propInt(pawn, "m_iHealth")
		alive := hp > 0
		pos := pawn.Position()
		ang := propVec(pawn, "m_angEyeAngles")
		yaw, pitch := float32(ang.Y), aim.NormalizePitch(float32(ang.X))
		flags := common.PlayerFlags(propUint(pawn, "m_fFlags"))
		spotted := c.spottedBy(pawn)

		if c.aim != nil && alive {
			eye := float32(pos.Z) + 64
			if flags.Ducking() {
				eye = float32(pos.Z) + 46
			}
			c.aim.Push(idx, aim.Sample{
				Tick:      int32(tick),
				Eye:       [3]float32{float32(pos.X), float32(pos.Y), eye},
				Yaw:       yaw,
				Pitch:     pitch,
				Alive:     true,
				SpottedBy: spotted,
			})
		}
		if !sample {
			continue
		}

		t := &c.m.Frames.Tracks[idx]
		t.X[f] = clamp16(pos.X)
		t.Y[f] = clamp16(pos.Y)
		t.Z[f] = clamp16(pos.Z)
		t.Yaw[f] = uint16(math.Mod(float64(yaw)+360, 360) / 360 * 65535)
		t.Pitch[f] = int16(pitch * 100)
		t.Side[f] = uint8(pl.Team)
		t.Money[f] = uint16(clampInt(pl.Money(), 0, 65535))
		t.Spotted[f] = spotted
		t.Place[f] = c.place(propString(pawn, placeProp))
		if !alive {
			continue
		}
		t.HP[f] = uint8(clampInt(hp, 0, 255))
		t.Armor[f] = uint8(clampInt(propInt(pawn, "m_ArmorValue"), 0, 255))
		t.Flags[f] = c.flags(pl, pawn, flags, bomb)
		if w := pl.ActiveWeapon(); w != nil {
			t.Weapon[f] = c.weapon(w.Type)
		}
		t.Primary[f], t.Util[f] = c.loadout(pl)
		c.lastUtil[idx] = grenadesHeld(pl)
		if rem := pl.FlashDurationTimeRemaining().Seconds(); rem > 0 {
			t.Flash[f] = uint8(clampInt(int(rem*40), 0, 255))
		}
	}

	if sample {
		c.sampleInfernos(tick)
	}
	if c.econAt > 0 && tick >= c.econAt {
		c.econAt = 0
		if r := c.current(); r != nil {
			c.captureEconomy(r)
		}
	}
	if c.aim != nil {
		c.aim.EndFrame(tick)
	}
}

func (c *collector) flags(pl *common.Player, pawn st.Entity, pf common.PlayerFlags, bomb *common.Bomb) uint16 {
	f := match.FlagAlive
	set := func(cond bool, flag uint16) {
		if cond {
			f |= flag
		}
	}
	set(pf.Ducking(), match.FlagDucking)
	set(!pf.OnGround(), match.FlagAirborne)
	set(propBool(pawn, "m_bIsScoped"), match.FlagScoped)
	set(propBool(pawn, "m_bIsWalking"), match.FlagWalking)
	set(propBool(pawn, "m_pItemServices.m_bHasDefuser"), match.FlagDefuseKit)
	set(propBool(pawn, "m_pItemServices.m_bHasHelmet"), match.FlagHelmet)
	set(pl.IsDefusing, match.FlagDefusing)
	set(pl.IsPlanting, match.FlagPlanting)
	set(pl.IsReloading, match.FlagReloading)
	set(bomb != nil && bomb.Carrier == pl, match.FlagBomb)
	set(pl.IsBlinded(), match.FlagBlind)
	return f
}

var spottedProps = [2]string{"m_bSpottedByMask.0000", "m_bSpottedByMask.0001"}

const placeProp = "m_szLastPlaceName"

// place returns the index of a callout name in Match.Places.
func (c *collector) place(name string) uint8 {
	if i, ok := c.placeIdx[name]; ok {
		return i
	}
	if len(c.m.Places) >= 255 {
		return 0
	}
	i := uint8(len(c.m.Places))
	c.placeIdx[name] = i
	c.m.Places = append(c.m.Places, name)
	return i
}

// spottedBy converts the game's spotted mask, which is indexed by entity
// slot, into a mask indexed by replay player index.
func (c *collector) spottedBy(pawn st.Entity) uint32 {
	var out uint32
	for word, name := range spottedProps {
		mask := propUint(pawn, name)
		for mask != 0 {
			bit := bits.TrailingZeros64(mask)
			mask &= mask - 1
			slot := word*32 + bit
			if slot < len(c.slotPlayer) {
				if idx := c.slotPlayer[slot]; idx >= 0 && idx < 32 {
					out |= 1 << uint(idx)
				}
			}
		}
	}
	return out
}

// loadout returns the best gun the player carries and their utility bits.
func (c *collector) loadout(pl *common.Player) (uint16, uint8) {
	var best common.EquipmentType
	var util uint8
	for _, w := range pl.Inventory {
		if w == nil {
			continue
		}
		switch w.Type {
		case common.EqSmoke:
			util |= utilSmoke
		case common.EqHE:
			util |= utilHE
		case common.EqMolotov, common.EqIncendiary:
			util |= utilFire
		case common.EqDecoy:
			util |= utilDecoy
		case common.EqFlash:
			util |= utilFlash1
		}
		if rank(w.Type) > rank(best) {
			best = w.Type
		}
	}
	if util&utilFlash1 != 0 && pl.FlashbangCount() > 1 {
		util |= utilFlash2
	}
	if best == common.EqUnknown {
		return 0, util
	}
	return c.weapon(best), util
}

func rank(t common.EquipmentType) int {
	switch t.Class() {
	case common.EqClassRifle, common.EqClassHeavy:
		return 4
	case common.EqClassSMG:
		return 3
	case common.EqClassPistols:
		return 2
	}
	if t == common.EqKnife {
		return 1
	}
	return 0
}

func grenadesHeld(pl *common.Player) []uint16 {
	var out []uint16
	for _, w := range pl.Inventory {
		if w != nil && w.Class() == common.EqClassGrenade {
			out = append(out, uint16(w.Type))
			if w.Type == common.EqFlash && pl.FlashbangCount() > 1 {
				out = append(out, uint16(w.Type))
			}
		}
	}
	return out
}

func (c *collector) weapon(t common.EquipmentType) uint16 {
	id := uint16(t)
	if _, ok := c.m.Weapons[id]; !ok && t != common.EqUnknown {
		c.m.Weapons[id] = t.String()
	}
	return id
}

func (c *collector) sampleBomb() {
	b := c.p.GameState().Bomb()
	bt := &c.m.Bomb
	state := c.bombState
	if b.Carrier != nil {
		state = match.BombCarried
	} else if state == match.BombCarried || state == match.BombNone {
		state = match.BombDropped
	}
	pos := b.Position()
	bt.X = append(bt.X, clamp16(pos.X))
	bt.Y = append(bt.Y, clamp16(pos.Y))
	bt.Z = append(bt.Z, clamp16(pos.Z))
	bt.State = append(bt.State, state)
}

func clamp16(v float64) int16 {
	if v > math.MaxInt16 {
		return math.MaxInt16
	}
	if v < math.MinInt16 {
		return math.MinInt16
	}
	return int16(math.Round(v))
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func v3(v r3.Vector) [3]float32 {
	return [3]float32{float32(v.X), float32(v.Y), float32(v.Z)}
}
