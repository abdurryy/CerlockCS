package maps

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

const nukeOverview = `// HLTV overview description file for de_nuke.bsp

"de_nuke"
{
	"material"	"overviews/de_nuke"	// texture file
	"pos_x"		"-3453"	// upper left world coordinate
	"pos_y"		"2887"
	"scale"		"7"

	"verticalsections"
	{
		"default" // use the primary radar image
		{
			"AltitudeMax" "10000"
			"AltitudeMin" "-495"
		}
		"lower"
		{
			"AltitudeMax" "-495"
			"AltitudeMin" "-10000"
		}
	}
}
`

func TestParseOverview(t *testing.T) {
	info, err := ParseOverview("de_nuke", nukeOverview)
	if err != nil {
		t.Fatal(err)
	}
	if info.PosX != -3453 || info.PosY != 2887 || info.Scale != 7 {
		t.Fatalf("calibration = %v %v %v", info.PosX, info.PosY, info.Scale)
	}
	if len(info.Levels) != 2 || info.Levels[1].Name != "lower" || info.Levels[1].AltitudeMax != -495 {
		t.Fatalf("levels = %+v", info.Levels)
	}
	if info.Levels[0].AltitudeMin != -495 {
		t.Fatalf("default level should start at -495, got %v", info.Levels[0].AltitudeMin)
	}
}

func TestParseOverviewSingleLevel(t *testing.T) {
	src := "\"de_mirage\"\n{\n\t\"pos_x\" \"-3230\"\n\t\"pos_y\" \"1713\"\n\t\"scale\" \"5.00\"\n}\n"
	info, err := ParseOverview("de_mirage", src)
	if err != nil {
		t.Fatal(err)
	}
	if len(info.Levels) != 1 || info.Scale != 5 {
		t.Fatalf("got %+v", info)
	}
}

func TestKeyValuesErrors(t *testing.T) {
	for _, src := range []string{`"a" {`, `"a" "b" }`, `"a`} {
		if _, err := ParseKeyValues(src); err == nil {
			t.Errorf("expected error for %q", src)
		}
	}
}

func TestStoreDownloadsAndCaches(t *testing.T) {
	hits := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits[r.URL.Path]++
		switch r.URL.Path {
		case "/data/radar_info/de_nuke.txt":
			w.Write([]byte(nukeOverview))
		case "/images/radars/de_nuke_radar_psd.png", "/images/radars/de_nuke_lower_radar_psd.png":
			w.Write([]byte("png"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	dir := t.TempDir()
	s := NewStore(dir)
	s.Source = srv.URL
	for i := 0; i < 2; i++ {
		info, err := s.Info(context.Background(), "de_nuke")
		if err != nil {
			t.Fatal(err)
		}
		if len(info.Levels) != 2 || info.Levels[1].Image != "/api/maps/de_nuke_lower_radar_psd.png" {
			t.Fatalf("levels = %+v", info.Levels)
		}
	}
	if hits["/data/radar_info/de_nuke.txt"] != 1 {
		t.Fatalf("overview downloaded %d times", hits["/data/radar_info/de_nuke.txt"])
	}
	if _, err := os.Stat(filepath.Join(dir, "de_nuke_radar_psd.png")); err != nil {
		t.Fatal(err)
	}
}

func TestStoreFallsBackToBuiltin(t *testing.T) {
	s := NewStore(t.TempDir())
	s.Offline = true
	info, err := s.Info(context.Background(), "de_vertigo")
	if err != nil {
		t.Fatal(err)
	}
	if !info.Known || info.Scale != 4 || len(info.Levels) != 2 || info.Levels[0].Image != "" {
		t.Fatalf("got %+v", info)
	}
	if _, err := s.Info(context.Background(), "../etc"); err == nil {
		t.Fatal("expected invalid name error")
	}
}
