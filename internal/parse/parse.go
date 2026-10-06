// Package parse reads a CS2 demo in a single pass and builds a match.Match.
package parse

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"runtime/debug"

	dem "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/msg"

	"github.com/abdurryy/CerlockCS/internal/aim"
	"github.com/abdurryy/CerlockCS/internal/match"
)

type Options struct {
	// SampleInterval is the number of ticks between stored frames. Players
	// are interpolated in the viewer so 2 (32 Hz on a 64 tick demo) looks
	// smooth while keeping the replay small.
	SampleInterval int
	// Progress is called with values between 0 and 1.
	Progress func(float32)
}

func Parse(r io.Reader, opts Options) (m *match.Match, err error) {
	if opts.SampleInterval <= 0 {
		opts.SampleInterval = 2
	}

	// The parser allocates a lot of short lived entity state. A higher GC
	// target trades some memory for roughly 10% faster parses.
	defer debug.SetGCPercent(debug.SetGCPercent(400))

	p := dem.NewParserWithConfig(bufio.NewReaderSize(r, 1<<20), dem.ParserConfig{
		MsgQueueBufferSize:             -1,
		IgnoreErrBombsiteIndexNotFound: true,
		IgnorePacketEntitiesPanic:      true,
	})
	defer p.Close()

	c := newCollector(p, opts)
	c.register()

	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("parser panic: %v", r)
		}
	}()

	if err := p.ParseToEnd(); err != nil && !errors.Is(err, dem.ErrUnexpectedEndOfDemo) {
		if len(c.m.Rounds) == 0 {
			return nil, err
		}
		// Truncated demos are common (server crash, upload cut off), keep
		// whatever was parsed.
	}
	if opts.Progress != nil {
		opts.Progress(1)
	}
	if len(c.m.Frames.Ticks) == 0 {
		return nil, errors.New("demo contains no match data")
	}
	c.finish()
	return c.m, nil
}

func (c *collector) register() {
	p := c.p
	p.RegisterNetMessageHandler(func(m *msg.CSVCMsg_ServerInfo) {
		if name := m.GetMapName(); name != "" {
			c.mapName = name
		}
	})
	p.RegisterNetMessageHandler(func(m *msg.CDemoFileHeader) {
		if c.mapName == "" {
			c.mapName = m.GetMapName()
		}
		c.server = m.GetServerName()
	})
	c.registerRounds()
	c.registerCombat()
	c.registerUtility()
	c.registerBomb()
	c.registerFrames()
}

// collector holds the state for one parse. On a match restart the match
// specific parts are thrown away and rebuilt.
type collector struct {
	p    dem.Parser
	opts Options
	m    *match.Match

	mapName string
	server  string

	players    map[string]int
	byPtr      map[*common.Player]int
	placeIdx   map[string]uint8
	slotPlayer [128]int
	lastUtil   [][]uint16
	lastSample int
	lastProg   float32

	recording  bool
	round      int
	roundClans [][2]string
	econAt     int

	bombState uint8

	grenadeByUID    map[int64]int
	grenadeByEntity map[int]int
	lastFireNade    map[int]int
	infernoByUID    map[int64]int
	lastFireSample  map[int64]int

	aim *aim.Tracker
}

func newCollector(p dem.Parser, opts Options) *collector {
	c := &collector{p: p, opts: opts}
	c.reset()
	return c
}

func (c *collector) reset() {
	c.m = &match.Match{
		SampleInterval: c.opts.SampleInterval,
		Weapons:        map[uint16]string{},
		Places:         []string{""},
	}
	c.placeIdx = map[string]uint8{"": 0}
	c.players = map[string]int{}
	c.byPtr = map[*common.Player]int{}
	c.lastUtil = nil
	c.lastSample = -1 << 30
	c.recording = false
	c.round = -1
	c.roundClans = nil
	c.econAt = 0
	c.bombState = match.BombNone
	c.grenadeByUID = map[int64]int{}
	c.grenadeByEntity = map[int]int{}
	c.lastFireNade = map[int]int{}
	c.infernoByUID = map[int64]int{}
	c.lastFireSample = map[int64]int{}
	c.aim = nil
}

func (c *collector) tick() int { return c.p.GameState().IngameTick() }

func (c *collector) tickRate() float64 {
	if r := c.p.TickRate(); r > 0 {
		return r
	}
	return 64
}
