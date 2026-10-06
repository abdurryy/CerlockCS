package replay

import (
	"bytes"
	"encoding/binary"
	"testing"

	"github.com/abdurryy/CerlockCS/internal/match"
)

func TestWriteLayout(t *testing.T) {
	m := &match.Match{Map: "de_test", TickRate: 64, Weapons: map[uint16]string{}}
	m.Frames.Ticks = []int32{10, 12, 14}
	m.Players = []match.Player{{Index: 0, Name: "a"}, {Index: 1, Name: "b"}}
	m.Frames.Tracks = make([]match.Track, 2)
	for p := range m.Frames.Tracks {
		m.Frames.Tracks[p].Grow(3)
		for f := 0; f < 3; f++ {
			m.Frames.Tracks[p].X[f] = int16(p*100 + f)
		}
	}
	m.Bomb = match.BombTrack{X: make([]int16, 3), Y: make([]int16, 3), Z: make([]int16, 3), State: make([]uint8, 3)}

	var buf bytes.Buffer
	if err := Write(&buf, m, map[string]any{"hello": 1}); err != nil {
		t.Fatal(err)
	}
	data := buf.Bytes()
	h, err := ReadHeader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if h.Frames != 3 || h.Match.Map != "de_test" || h.Extra["hello"] != float64(1) {
		t.Fatalf("header = %+v", h)
	}
	for name, c := range h.Columns {
		if c.Offset%8 != 0 {
			t.Errorf("column %s at unaligned offset %d", name, c.Offset)
		}
	}
	x := h.Columns["player.x"]
	if x.Length != 6 {
		t.Fatalf("player.x length = %d", x.Length)
	}
	got := make([]int16, 6)
	binary.Read(bytes.NewReader(data[x.Offset:x.Offset+12]), binary.LittleEndian, got)
	want := []int16{0, 1, 2, 100, 101, 102}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("player.x = %v, want %v", got, want)
		}
	}
	ticks := h.Columns["frame.tick"]
	if v := binary.LittleEndian.Uint32(data[ticks.Offset+4:]); v != 12 {
		t.Fatalf("frame.tick[1] = %d", v)
	}
}
