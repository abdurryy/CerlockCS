package aim

import (
	"math"
	"testing"
)

func TestAngleTo(t *testing.T) {
	eye := [3]float32{0, 0, 64}
	cases := []struct {
		yaw, pitch float32
		target     [3]float32
		want       float64
	}{
		{0, 0, [3]float32{100, 0, 64}, 0},
		{90, 0, [3]float32{100, 0, 64}, 90},
		{180, 0, [3]float32{100, 0, 64}, 180},
		{0, 0, [3]float32{100, 100, 64}, 45},
		// Positive pitch looks down.
		{0, 45, [3]float32{100, 0, -36}, 0},
	}
	for _, c := range cases {
		got := AngleTo(eye, c.yaw, c.pitch, c.target)
		if math.Abs(got-c.want) > 0.01 {
			t.Errorf("AngleTo(yaw %v, pitch %v) = %.3f, want %.3f", c.yaw, c.pitch, got, c.want)
		}
	}
}

func TestNormalizePitch(t *testing.T) {
	if NormalizePitch(350) != -10 || NormalizePitch(10) != 10 {
		t.Fatal("pitch normalization is wrong")
	}
}

// A simple duel: the victim walks into view at tick 100, the attacker flicks
// 10 degrees, shoots at 116 and kills at 120.
func TestEngagementMetrics(t *testing.T) {
	tr := NewTracker(64)
	const attacker, victim = 0, 1
	for tick := int32(0); tick <= 140; tick++ {
		yaw := float32(10)
		if tick >= 112 {
			yaw = 0
		}
		var spotted uint32
		if tick >= 100 {
			spotted = 1 << attacker
		}
		tr.Push(attacker, Sample{Tick: tick, Eye: [3]float32{0, 0, 64}, Yaw: yaw, Alive: true})
		tr.Push(victim, Sample{Tick: tick, Eye: [3]float32{1000, 0, 64}, Alive: tick <= 120, SpottedBy: spotted})
		switch tick {
		case 116:
			tr.Shot(116, attacker)
		case 118:
			tr.Hit(118, attacker, victim, 303, 30, false)
		case 120:
			tr.Kill(120, attacker, victim, 303, 0, true)
		}
		tr.EndFrame(int(tick))
	}
	tr.Flush(140)
	es, samples := tr.Result()
	if len(es) != 1 {
		t.Fatalf("got %d engagements, want 1", len(es))
	}
	e := es[0]
	if e.FirstSeenTick != 100 || e.FirstShotTick != 116 || e.FirstHitTick != 118 || !e.Killed || !e.Headshot {
		t.Fatalf("unexpected engagement %+v", e)
	}
	if math.Abs(e.ReactionMs-250) > 0.01 {
		t.Errorf("reaction = %v ms, want 250", e.ReactionMs)
	}
	if math.Abs(e.CrosshairErrorDeg-10) > 0.01 {
		t.Errorf("crosshair error = %v, want 10", e.CrosshairErrorDeg)
	}
	if math.Abs(e.FlickDeg-10) > 0.01 || e.FirstShotErrorDeg != 0 {
		t.Errorf("flick = %v, first shot error = %v", e.FlickDeg, e.FirstShotErrorDeg)
	}
	if e.SampleLen == 0 || len(samples.Ticks) != e.SampleLen || samples.Ticks[e.SampleLen-1] != 120 {
		t.Errorf("samples cover %d ticks ending at %v", e.SampleLen, samples.Ticks)
	}
}

func TestSpeed(t *testing.T) {
	tr := NewTracker(64)
	// 250 units per second along x.
	for tick := int32(0); tick < 10; tick++ {
		tr.Push(0, Sample{Tick: tick, Eye: [3]float32{float32(tick) * 250 / 64, 0, 64}, Alive: true})
	}
	if v := tr.Speed(0); math.Abs(float64(v)-250) > 0.5 {
		t.Fatalf("speed = %v, want 250", v)
	}
	if tr.Speed(5) != 0 {
		t.Fatal("unknown player should have no speed")
	}
}
