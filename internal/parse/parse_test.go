package parse

import (
	"os"
	"testing"
)

// Set CERLOCK_TEST_DEMO to a CS2 demo to run the parser against real data.
func TestParseDemo(t *testing.T) {
	path := os.Getenv("CERLOCK_TEST_DEMO")
	if path == "" {
		t.Skip("CERLOCK_TEST_DEMO not set")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	m, err := Parse(f, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if m.Map == "" || len(m.Rounds) == 0 || len(m.Players) < 2 || len(m.Kills) == 0 {
		t.Fatalf("map=%q rounds=%d players=%d kills=%d", m.Map, len(m.Rounds), len(m.Players), len(m.Kills))
	}
	frames := len(m.Frames.Ticks)
	for i, tr := range m.Frames.Tracks {
		if len(tr.X) != frames || len(tr.Flags) != frames {
			t.Fatalf("track %d has %d frames, want %d", i, len(tr.X), frames)
		}
	}
	if len(m.Bomb.State) != frames {
		t.Fatalf("bomb track has %d frames, want %d", len(m.Bomb.State), frames)
	}
	score := m.Teams[0].Score + m.Teams[1].Score
	if score == 0 || score > len(m.Rounds) {
		t.Fatalf("score %d-%d over %d rounds", m.Teams[0].Score, m.Teams[1].Score, len(m.Rounds))
	}
	for _, k := range m.Kills {
		if k.Victim < 0 || k.Victim >= len(m.Players) {
			t.Fatalf("kill with bad victim %+v", k)
		}
	}
}

func TestConvexHull(t *testing.T) {
	pts := [][2]float64{{0, 0}, {10, 0}, {10, 10}, {0, 10}, {5, 5}, {2, 8}}
	hull := convexHull(pts)
	if len(hull) != 4 {
		t.Fatalf("hull = %v", hull)
	}
	if got := convexHull([][2]float64{{1, 1}}); len(got) != 1 {
		t.Fatalf("single point hull = %v", got)
	}
}
