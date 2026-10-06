// Package match holds the parsed representation of a demo. The parser fills it,
// the analysis and aim packages read it and the replay package serializes it.
package match

import "sort"

// Side uses the same numbers as the game so values can be copied straight
// from the demo.
type Side uint8

const (
	SideNone Side = 0
	SideT    Side = 2
	SideCT   Side = 3
)

func (s Side) String() string {
	switch s {
	case SideT:
		return "T"
	case SideCT:
		return "CT"
	}
	return ""
}

func (s Side) Opposite() Side {
	switch s {
	case SideT:
		return SideCT
	case SideCT:
		return SideT
	}
	return SideNone
}

// Player flags stored per frame.
const (
	FlagAlive uint16 = 1 << iota
	FlagDucking
	FlagScoped
	FlagDefusing
	FlagPlanting
	FlagAirborne
	FlagWalking
	FlagBomb
	FlagDefuseKit
	FlagHelmet
	FlagReloading
	FlagBlind
)

// Bomb states stored per frame.
const (
	BombNone uint8 = iota
	BombCarried
	BombDropped
	BombPlanted
	BombDefused
	BombExploded
)

type Match struct {
	Map      string  `json:"map"`
	Server   string  `json:"server"`
	TickRate float64 `json:"tickRate"`
	// SampleInterval is the number of ticks between two stored frames.
	SampleInterval int `json:"sampleInterval"`
	FirstTick      int `json:"firstTick"`
	LastTick       int `json:"lastTick"`

	Teams   [2]Team  `json:"teams"`
	Players []Player `json:"players"`
	Rounds  []Round  `json:"rounds"`

	Kills      []Kill      `json:"kills"`
	Damages    []Damage    `json:"damages"`
	Blinds     []Blind     `json:"blinds"`
	Grenades   []Grenade   `json:"grenades"`
	Infernos   []Inferno   `json:"infernos"`
	BombEvents []BombEvent `json:"bombEvents"`

	Weapons map[uint16]string `json:"weapons"`
	// Places are the map's callout names, Track.Place indexes into it.
	// Index 0 is the empty name.
	Places []string `json:"places"`

	Frames       Frames       `json:"-"`
	Bomb         BombTrack    `json:"-"`
	Shots        Shots        `json:"-"`
	GrenadePaths GrenadePaths `json:"-"`

	Engagements []Engagement `json:"engagements"`
	AimSamples  AimSamples   `json:"-"`
}

type Team struct {
	Name  string `json:"name"`
	Score int    `json:"score"`
	// StartSide is the side the team played in the first recorded round.
	StartSide Side `json:"startSide"`
}

type Player struct {
	Index   int    `json:"index"`
	SteamID uint64 `json:"steamId,string"`
	Name    string `json:"name"`
	Team    int    `json:"team"`
	IsBot   bool   `json:"isBot"`
}

type Round struct {
	Number          int    `json:"number"`
	StartTick       int    `json:"startTick"`
	FreezeEndTick   int    `json:"freezeEndTick"`
	EndTick         int    `json:"endTick"`
	OfficialEndTick int    `json:"officialEndTick"`
	Winner          Side   `json:"winner"`
	WinnerTeam      int    `json:"winnerTeam"`
	Reason          string `json:"reason"`
	// SideOf[t] is the side team t played this round.
	SideOf  [2]Side       `json:"sideOf"`
	ScoreA  int           `json:"scoreA"`
	ScoreB  int           `json:"scoreB"`
	Players []RoundPlayer `json:"players"`
	// RoundTime and BombTime are in seconds, read from the game rules.
	RoundTime float64 `json:"roundTime"`
	BombTime  float64 `json:"bombTime"`
}

// RoundPlayer is a player's economy snapshot taken when freeze time ends.
type RoundPlayer struct {
	Player     int      `json:"player"`
	Side       Side     `json:"side"`
	Money      int      `json:"money"`
	EquipValue int      `json:"equipValue"`
	Spent      int      `json:"spent"`
	Armor      int      `json:"armor"`
	Helmet     bool     `json:"helmet"`
	Kit        bool     `json:"kit"`
	Inventory  []uint16 `json:"inventory"`
}

type Kill struct {
	Tick          int        `json:"tick"`
	Round         int        `json:"round"`
	Killer        int        `json:"killer"`
	Victim        int        `json:"victim"`
	Assister      int        `json:"assister"`
	Weapon        uint16     `json:"weapon"`
	Headshot      bool       `json:"headshot"`
	Wallbang      bool       `json:"wallbang"`
	ThroughSmoke  bool       `json:"throughSmoke"`
	NoScope       bool       `json:"noScope"`
	AttackerBlind bool       `json:"attackerBlind"`
	FlashAssist   bool       `json:"flashAssist"`
	KillerSide    Side       `json:"killerSide"`
	VictimSide    Side       `json:"victimSide"`
	KillerPos     [3]float32 `json:"killerPos"`
	VictimPos     [3]float32 `json:"victimPos"`
	// VictimUtility lists the grenades the victim was still carrying.
	VictimUtility []uint16 `json:"victimUtility"`
	VictimBlind   bool     `json:"victimBlind"`
	// VictimReloading is true when the victim died mid reload.
	VictimReloading bool `json:"victimReloading"`
	// Seen is how many enemies had the victim spotted when they died.
	Seen        int     `json:"seen"`
	KillerPlace string  `json:"killerPlace"`
	VictimPlace string  `json:"victimPlace"`
	Distance    float32 `json:"distance"`
	// KillerSpeed is the killer's movement speed in units per second.
	KillerSpeed float32 `json:"killerSpeed"`
}

type Damage struct {
	Tick     int    `json:"tick"`
	Round    int    `json:"round"`
	Attacker int    `json:"attacker"`
	Victim   int    `json:"victim"`
	Weapon   uint16 `json:"weapon"`
	Health   int    `json:"health"`
	Armor    int    `json:"armor"`
	HitGroup int    `json:"hitGroup"`
	HPAfter  int    `json:"hpAfter"`
}

type Blind struct {
	Tick     int     `json:"tick"`
	Round    int     `json:"round"`
	Attacker int     `json:"attacker"`
	Victim   int     `json:"victim"`
	Duration float32 `json:"duration"`
	Grenade  int     `json:"grenade"`
}

type Grenade struct {
	ID         int        `json:"id"`
	Type       uint16     `json:"type"`
	Thrower    int        `json:"thrower"`
	Side       Side       `json:"side"`
	Round      int        `json:"round"`
	ThrowTick  int        `json:"throwTick"`
	EffectTick int        `json:"effectTick"`
	EndTick    int        `json:"endTick"`
	Pos        [3]float32 `json:"pos"`
	PathStart  int        `json:"pathStart"`
	PathLen    int        `json:"pathLen"`
}

type Inferno struct {
	ID        int            `json:"id"`
	Thrower   int            `json:"thrower"`
	Round     int            `json:"round"`
	StartTick int            `json:"startTick"`
	EndTick   int            `json:"endTick"`
	Snapshots []FireSnapshot `json:"snapshots"`
}

type FireSnapshot struct {
	Tick int `json:"tick"`
	// Hull is a flat list of x,y pairs.
	Hull []float32 `json:"hull"`
}

type BombEvent struct {
	Tick   int        `json:"tick"`
	Round  int        `json:"round"`
	Kind   string     `json:"kind"`
	Player int        `json:"player"`
	Site   string     `json:"site"`
	Pos    [3]float32 `json:"pos"`
	// Kit is set on defuse_begin when the defuser has a kit.
	Kit bool `json:"kit,omitempty"`
}

// Frames stores sampled player state. Each player owns a Track with one value
// per frame, so Tracks[p].X[f] is player p's x position at Ticks[f].
type Frames struct {
	Ticks  []int32
	Tracks []Track
}

type Track struct {
	X, Y, Z []int16
	Yaw     []uint16
	Pitch   []int16
	HP      []uint8
	Armor   []uint8
	Flags   []uint16
	Weapon  []uint16
	Primary []uint16
	Util    []uint8
	Flash   []uint8
	Money   []uint16
	Spotted []uint32
	Side    []uint8
	Place   []uint8
}

func (t *Track) Grow(n int) {
	for len(t.X) < n {
		t.X = append(t.X, 0)
		t.Y = append(t.Y, 0)
		t.Z = append(t.Z, 0)
		t.Yaw = append(t.Yaw, 0)
		t.Pitch = append(t.Pitch, 0)
		t.HP = append(t.HP, 0)
		t.Armor = append(t.Armor, 0)
		t.Flags = append(t.Flags, 0)
		t.Weapon = append(t.Weapon, 0)
		t.Primary = append(t.Primary, 0)
		t.Util = append(t.Util, 0)
		t.Flash = append(t.Flash, 0)
		t.Money = append(t.Money, 0)
		t.Spotted = append(t.Spotted, 0)
		t.Side = append(t.Side, 0)
		t.Place = append(t.Place, 0)
	}
}

// IndexAt returns the last frame at or before tick, or 0.
func (f *Frames) IndexAt(tick int) int {
	i := sort.Search(len(f.Ticks), func(i int) bool { return int(f.Ticks[i]) > tick })
	if i == 0 {
		return 0
	}
	return i - 1
}

func (t *Track) Alive(f int) bool { return t.Flags[f]&FlagAlive != 0 }

func (t *Track) Pos(f int) [3]float32 {
	return [3]float32{float32(t.X[f]), float32(t.Y[f]), float32(t.Z[f])}
}

type BombTrack struct {
	X, Y, Z []int16
	State   []uint8
}

type Shots struct {
	Ticks  []int32
	Player []uint8
	Weapon []uint16
	// Speed is the shooter's horizontal speed in units per second.
	Speed []uint16
}

type GrenadePaths struct {
	X, Y, Z []int16
	Ticks   []int32
}

// Engagement is one attacker versus one victim fight, built around the
// damage the attacker dealt. Aim samples for the window live in AimSamples.
type Engagement struct {
	ID       int    `json:"id"`
	Round    int    `json:"round"`
	Attacker int    `json:"attacker"`
	Victim   int    `json:"victim"`
	Weapon   uint16 `json:"weapon"`

	StartTick int `json:"startTick"`
	EndTick   int `json:"endTick"`
	// FirstSeenTick is when the victim first showed up as spotted by the
	// attacker inside the window, -1 if they were already spotted when the
	// window opened.
	FirstSeenTick int `json:"firstSeenTick"`
	FirstShotTick int `json:"firstShotTick"`
	FirstHitTick  int `json:"firstHitTick"`
	KillTick      int `json:"killTick"`

	Shots    int  `json:"shots"`
	Hits     int  `json:"hits"`
	Damage   int  `json:"damage"`
	Headshot bool `json:"headshot"`
	Killed   bool `json:"killed"`
	// Died is true when the victim of this engagement killed the attacker.
	Died bool `json:"died"`

	// Metrics, -1 when not measurable.
	ReactionMs        float64 `json:"reactionMs"`
	TimeToDamageMs    float64 `json:"timeToDamageMs"`
	CrosshairErrorDeg float64 `json:"crosshairErrorDeg"`
	FlickDeg          float64 `json:"flickDeg"`
	FirstShotErrorDeg float64 `json:"firstShotErrorDeg"`

	SampleStart int `json:"sampleStart"`
	SampleLen   int `json:"sampleLen"`
}

// AimSamples holds full tick rate view data for every engagement window.
type AimSamples struct {
	Ticks []int32
	Yaw   []float32
	Pitch []float32
	// Error is the angle in degrees between the attacker's view direction and
	// the direction to the victim's head.
	Error   []float32
	Visible []uint8
}

func (m *Match) TeamOf(player int) int {
	if player < 0 || player >= len(m.Players) {
		return -1
	}
	return m.Players[player].Team
}
