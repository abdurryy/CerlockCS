package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestGameReplayDirs(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses the unix Steam layout")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	if got := gameReplayDirs(); len(got) != 0 {
		t.Fatalf("no Steam install, got %v", got)
	}

	dir := filepath.Join(home, ".local", "share", "Steam", "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "replays")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	// ~/.steam/steam is usually a link to the same install, it must not
	// show up twice.
	os.MkdirAll(filepath.Join(home, ".steam"), 0o755)
	if err := os.Symlink(filepath.Join(home, ".local", "share", "Steam"), filepath.Join(home, ".steam", "steam")); err != nil {
		t.Fatal(err)
	}
	if got := gameReplayDirs(); len(got) != 1 {
		t.Fatalf("got %v", got)
	}
}
