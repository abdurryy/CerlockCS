// Package replay writes the file the web viewer loads.
//
// Layout (little endian):
//
//	"CRLK"  magic
//	uint32  format version
//	uint32  length of the JSON header
//	...     JSON header, padded to 8 bytes
//	...     binary columns, each starting on an 8 byte boundary
//
// The header lists every column with its type, offset and length so the
// browser can wrap them in typed arrays without copying. Player columns are
// stored player by player: value for player p at frame f is at p*frames+f.
package replay

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/abdurryy/CerlockCS/internal/match"
)

const (
	Magic   = "CRLK"
	Version = 1
)

type Column struct {
	Type   string `json:"type"`
	Offset int    `json:"offset"`
	Length int    `json:"length"`
}

type Header struct {
	Version int               `json:"version"`
	Frames  int               `json:"frames"`
	Match   *match.Match      `json:"match"`
	Extra   map[string]any    `json:"extra,omitempty"`
	Columns map[string]Column `json:"columns"`
}

type column struct {
	name string
	typ  string
	data any
	n    int
}

func size(typ string) int {
	switch typ {
	case "u8":
		return 1
	case "i16", "u16":
		return 2
	case "i32", "u32", "f32":
		return 4
	}
	panic("unknown column type " + typ)
}

func columns(m *match.Match) []column {
	var cols []column
	add := func(name, typ string, data any, n int) {
		cols = append(cols, column{name, typ, data, n})
	}

	fr := &m.Frames
	add("frame.tick", "i32", fr.Ticks, len(fr.Ticks))

	// Concatenate the per player tracks into one array per field.
	cat16 := func(get func(*match.Track) []int16) []int16 {
		out := make([]int16, 0, len(fr.Tracks)*len(fr.Ticks))
		for i := range fr.Tracks {
			out = append(out, get(&fr.Tracks[i])...)
		}
		return out
	}
	catU16 := func(get func(*match.Track) []uint16) []uint16 {
		out := make([]uint16, 0, len(fr.Tracks)*len(fr.Ticks))
		for i := range fr.Tracks {
			out = append(out, get(&fr.Tracks[i])...)
		}
		return out
	}
	catU8 := func(get func(*match.Track) []uint8) []uint8 {
		out := make([]uint8, 0, len(fr.Tracks)*len(fr.Ticks))
		for i := range fr.Tracks {
			out = append(out, get(&fr.Tracks[i])...)
		}
		return out
	}
	catU32 := func(get func(*match.Track) []uint32) []uint32 {
		out := make([]uint32, 0, len(fr.Tracks)*len(fr.Ticks))
		for i := range fr.Tracks {
			out = append(out, get(&fr.Tracks[i])...)
		}
		return out
	}
	n := len(fr.Tracks) * len(fr.Ticks)
	add("player.x", "i16", cat16(func(t *match.Track) []int16 { return t.X }), n)
	add("player.y", "i16", cat16(func(t *match.Track) []int16 { return t.Y }), n)
	add("player.z", "i16", cat16(func(t *match.Track) []int16 { return t.Z }), n)
	add("player.yaw", "u16", catU16(func(t *match.Track) []uint16 { return t.Yaw }), n)
	add("player.pitch", "i16", cat16(func(t *match.Track) []int16 { return t.Pitch }), n)
	add("player.hp", "u8", catU8(func(t *match.Track) []uint8 { return t.HP }), n)
	add("player.armor", "u8", catU8(func(t *match.Track) []uint8 { return t.Armor }), n)
	add("player.flags", "u16", catU16(func(t *match.Track) []uint16 { return t.Flags }), n)
	add("player.weapon", "u16", catU16(func(t *match.Track) []uint16 { return t.Weapon }), n)
	add("player.primary", "u16", catU16(func(t *match.Track) []uint16 { return t.Primary }), n)
	add("player.util", "u8", catU8(func(t *match.Track) []uint8 { return t.Util }), n)
	add("player.flash", "u8", catU8(func(t *match.Track) []uint8 { return t.Flash }), n)
	add("player.money", "u16", catU16(func(t *match.Track) []uint16 { return t.Money }), n)
	add("player.spotted", "u32", catU32(func(t *match.Track) []uint32 { return t.Spotted }), n)
	add("player.side", "u8", catU8(func(t *match.Track) []uint8 { return t.Side }), n)

	b := &m.Bomb
	add("bomb.x", "i16", b.X, len(b.X))
	add("bomb.y", "i16", b.Y, len(b.Y))
	add("bomb.z", "i16", b.Z, len(b.Z))
	add("bomb.state", "u8", b.State, len(b.State))

	s := &m.Shots
	add("shot.tick", "i32", s.Ticks, len(s.Ticks))
	add("shot.player", "u8", s.Player, len(s.Player))
	add("shot.weapon", "u16", s.Weapon, len(s.Weapon))

	g := &m.GrenadePaths
	add("nade.x", "i16", g.X, len(g.X))
	add("nade.y", "i16", g.Y, len(g.Y))
	add("nade.z", "i16", g.Z, len(g.Z))
	add("nade.tick", "i32", g.Ticks, len(g.Ticks))

	a := &m.AimSamples
	add("aim.tick", "i32", a.Ticks, len(a.Ticks))
	add("aim.yaw", "f32", a.Yaw, len(a.Yaw))
	add("aim.pitch", "f32", a.Pitch, len(a.Pitch))
	add("aim.error", "f32", a.Error, len(a.Error))
	add("aim.visible", "u8", a.Visible, len(a.Visible))
	return cols
}

func align8(n int) int { return (n + 7) &^ 7 }

// Write serializes the match. extra is stored in the header as is, the
// server uses it for the analysis report.
func Write(w io.Writer, m *match.Match, extra map[string]any) error {
	cols := columns(m)
	h := Header{
		Version: Version,
		Frames:  len(m.Frames.Ticks),
		Match:   m,
		Extra:   extra,
		Columns: map[string]Column{},
	}

	// Column offsets depend on the header size and the header contains the
	// offsets. Grow the guess until the header fits, then pad the JSON with
	// spaces so the first column starts exactly at base.
	rel := make(map[string]int, len(cols))
	off := 0
	for _, c := range cols {
		rel[c.name] = off
		off = align8(off + c.n*size(c.typ))
	}
	var meta []byte
	base := 0
	for {
		for _, c := range cols {
			h.Columns[c.name] = Column{Type: c.typ, Offset: base + rel[c.name], Length: c.n}
		}
		var err error
		if meta, err = json.Marshal(h); err != nil {
			return err
		}
		if 12+len(meta) <= base {
			break
		}
		base = align8(12 + len(meta) + 64)
	}
	for 12+len(meta) < base {
		meta = append(meta, ' ')
	}

	bw := bufio.NewWriterSize(w, 1<<20)
	bw.WriteString(Magic)
	binary.Write(bw, binary.LittleEndian, uint32(Version))
	binary.Write(bw, binary.LittleEndian, uint32(len(meta)))
	bw.Write(meta)
	pos := 12 + len(meta)
	pad := func(to int) {
		for ; pos < to; pos++ {
			bw.WriteByte(0)
		}
	}
	for _, c := range cols {
		if err := binary.Write(bw, binary.LittleEndian, c.data); err != nil {
			return fmt.Errorf("replay: column %s: %w", c.name, err)
		}
		pos += c.n * size(c.typ)
		pad(align8(pos))
	}
	return bw.Flush()
}

// ReadHeader reads only the JSON header of a replay.
func ReadHeader(r io.Reader) (*Header, error) {
	var pre [12]byte
	if _, err := io.ReadFull(r, pre[:]); err != nil {
		return nil, err
	}
	if string(pre[:4]) != Magic {
		return nil, errors.New("replay: not a replay file")
	}
	if v := binary.LittleEndian.Uint32(pre[4:]); v != Version {
		return nil, fmt.Errorf("replay: unsupported version %d", v)
	}
	n := binary.LittleEndian.Uint32(pre[8:])
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	var h Header
	if err := json.Unmarshal(buf, &h); err != nil {
		return nil, err
	}
	return &h, nil
}
