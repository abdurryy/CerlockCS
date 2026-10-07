package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestScanDownloadsOnlyTakesFaceitDemos(t *testing.T) {
	s, _ := newTestServer(t)
	dir := t.TempDir()
	write := func(name string, age time.Duration) {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte("not really a demo "+name), 0o644); err != nil {
			t.Fatal(err)
		}
		when := time.Now().Add(-age)
		os.Chtimes(p, when, when)
	}
	write("1-bcde0562-93c0-4539-8e6f-90420bb122a6-1-1.dem.zst", time.Hour)
	write("1-00000000-1111-2222-3333-444444444444-1-1.dem.gz", 60*24*time.Hour)
	write("1-bcde0562-93c0-4539-8e6f-90420bb122a6-1-1.dem.zst.crdownload", time.Minute)
	write("match.dem", time.Hour)
	write("holiday.jpg", time.Hour)

	s.lib.ScanDownloads(dir, 30*24*time.Hour)

	var names []string
	for _, j := range s.lib.Jobs() {
		names = append(names, j.Name)
	}
	if len(names) != 1 || names[0] != "1-bcde0562-93c0-4539-8e6f-90420bb122a6-1-1.dem.zst" {
		t.Fatalf("queued %v", names)
	}
}
