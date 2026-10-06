// Package icons keeps the CS2 weapon, utility and killfeed icons on disk.
//
// The icons are Valve's, so they are not part of this repository. Like the
// radar images they are downloaded the first time they are needed, from
// open source projects that ship them, and cached in Dir:
//
//	weapon/ak47.svg      equipment icons, named like the game files
//	hud/bombsite-a.svg   bomb, armor, site and other HUD icons
//	kill/headshot.svg    killfeed modifiers (headshot, wallbang...)
//
// Icons exported from your own game files can be dropped into the same
// folders and are used instead.
package icons

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Upstream sources, pinned to a commit so the files never change under us.
const (
	hudSource  = "https://raw.githubusercontent.com/drweissbrot/cs-hud/5595dd02d67f0ca674d96d8c629e067ec6528c1b/src/themes/fennec/img"
	killSource = "https://raw.githubusercontent.com/akiver/cs-demo-manager/b45a5f29283590c3fd0fc6526564b49567c0b931/src/ui/icons"
)

// Weapons are the equipment icons the viewer uses, named like the game's
// panorama/images/icons/equipment files.
var Weapons = []string{
	"ak47", "aug", "awp", "bizon", "c4", "cz75a", "deagle", "decoy", "defuser",
	"elite", "famas", "fiveseven", "flashbang", "g3sg1", "galilar", "glock",
	"hegrenade", "hkp2000", "incgrenade", "inferno", "knife", "knife_t", "m249",
	"m4a1", "m4a1_silencer", "mac10", "mag7", "molotov", "mp5sd", "mp7", "mp9",
	"negev", "nova", "p250", "p90", "revolver", "sawedoff", "scar20", "sg556",
	"smokegrenade", "ssg08", "taser", "tec9", "ump45", "usp_silencer", "xm1014",
	"armor", "armor_helmet", "helmet", "kevlar", "healthshot", "planted_c4",
}

// HUD icons, the key is our name and the value the upstream path.
var HUD = map[string]string{
	"armor":         "icons/armor.svg",
	"armor-helmet":  "icons/armor-helmet.svg",
	"bomb":          "icons/bomb.svg",
	"bombsite-a":    "icons/bombsite-a.svg",
	"bombsite-b":    "icons/bombsite-b.svg",
	"dead":          "icons/dead.svg",
	"defuse":        "icons/defuse.svg",
	"elimination":   "icons/elimination.svg",
	"health":        "icons/health.svg",
	"planted-bomb":  "icons/planted-bomb.svg",
	"dropped-bomb":  "icons/radar/dropped-bomb.svg",
	"radar-planted": "icons/radar/planted-bomb.svg",
	"time":          "icons/time.svg",
}

// Kill icons for the killfeed, the key is our name and the value the
// upstream file.
var Kill = map[string]string{
	"headshot":  "headshot-icon.svg",
	"penetrate": "penetrate-icon.svg",
	"noscope":   "noscope-icon.svg",
	"smoke":     "through-smoke-kill-icon.svg",
	"blind":     "blind-icon.svg",
	"airborne":  "airborne-kill-icon.svg",
	"flash":     "flashbang-assist-icon.svg",
	"explosion": "explosion-icon.svg",
	"world":     "weapons/world-icon.svg",
	"ct":        "counter-terrorist-icon.svg",
	"t":         "terrorist-icon.svg",
}

var validName = regexp.MustCompile(`^(weapon|hud|kill)/[a-z0-9_-]{1,40}$`)

// Store downloads icons on first use and serves them from disk.
type Store struct {
	Dir     string
	Offline bool
	Client  *http.Client
	// Remote returns the download URL for an icon, empty if there is none.
	// It defaults to the pinned upstream sources.
	Remote func(name string) string

	once sync.Once
	mu   sync.Mutex
	have map[string]float64
}

func NewStore(dir string) *Store {
	return &Store{Dir: dir, Client: &http.Client{Timeout: 20 * time.Second}, Remote: upstream}
}

// Names lists every icon the viewer knows about.
func Names() []string {
	var out []string
	for _, w := range Weapons {
		out = append(out, "weapon/"+w)
	}
	for k := range HUD {
		out = append(out, "hud/"+k)
	}
	for k := range Kill {
		out = append(out, "kill/"+k)
	}
	sort.Strings(out)
	return out
}

func upstream(name string) string {
	group, file, _ := strings.Cut(name, "/")
	switch group {
	case "weapon":
		return hudSource + "/weapons/" + file + ".svg"
	case "hud":
		if p, ok := HUD[file]; ok {
			return hudSource + "/" + p
		}
	case "kill":
		if p, ok := Kill[file]; ok {
			return killSource + "/" + p
		}
	}
	return ""
}

// Path returns where an icon lives on disk.
func (s *Store) Path(name string) (string, bool) {
	if !validName.MatchString(name) {
		return "", false
	}
	return filepath.Join(s.Dir, filepath.FromSlash(name)+".svg"), true
}

// Available downloads what is missing (once per run) and returns the icons
// that exist on disk with their width to height ratio, so the viewer can
// size them before they load. Concurrent callers wait for the same download.
func (s *Store) Available() map[string]float64 {
	s.once.Do(func() {
		if !s.Offline {
			s.fetchMissing(context.Background())
		}
		s.mu.Lock()
		s.have = s.scan()
		s.mu.Unlock()
	})
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.have
}

// scan lists the icons on disk, including ones the user added themselves.
func (s *Store) scan() map[string]float64 {
	out := map[string]float64{}
	for _, group := range []string{"weapon", "hud", "kill"} {
		entries, err := os.ReadDir(filepath.Join(s.Dir, group))
		if err != nil {
			continue
		}
		for _, e := range entries {
			n, ok := strings.CutSuffix(e.Name(), ".svg")
			if !ok || e.IsDir() {
				continue
			}
			name := group + "/" + n
			if !validName.MatchString(name) {
				continue
			}
			b, err := os.ReadFile(filepath.Join(s.Dir, group, e.Name()))
			if err != nil || Check(b) != nil {
				continue
			}
			out[name] = Aspect(b)
		}
	}
	return out
}

var (
	viewBox = regexp.MustCompile(`viewBox\s*=\s*"\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)`)
	size    = regexp.MustCompile(`<svg[^>]*?\swidth\s*=\s*"([\d.]+)(?:px)?"[^>]*?\sheight\s*=\s*"([\d.]+)(?:px)?"`)
)

// Aspect returns the width to height ratio of an svg, 1 if it is unknown.
func Aspect(b []byte) float64 {
	m := viewBox.FindSubmatch(b)
	if m == nil {
		m = size.FindSubmatch(b)
	}
	if m == nil {
		return 1
	}
	w, err1 := strconv.ParseFloat(string(m[1]), 64)
	h, err2 := strconv.ParseFloat(string(m[2]), 64)
	if err1 != nil || err2 != nil || w <= 0 || h <= 0 {
		return 1
	}
	return math.Round(w/h*1000) / 1000
}

func (s *Store) fetchMissing(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	jobs := make(chan string)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for name := range jobs {
				p, _ := s.Path(name)
				if _, err := os.Stat(p); err == nil {
					continue
				}
				if url := s.Remote(name); url != "" {
					s.download(ctx, url, p)
				}
			}
		}()
	}
	for _, n := range Names() {
		jobs <- n
	}
	close(jobs)
	wg.Wait()
}

func (s *Store) download(ctx context.Context, url, dst string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := s.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %s", url, resp.Status)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if err := Check(b); err != nil {
		return fmt.Errorf("%s: %w", url, err)
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

var unsafe = regexp.MustCompile(`(?i)<script|<foreignobject|javascript:|\son[a-z]+\s*=|<!entity`)

// Check makes sure a file is a plain SVG drawing. The viewer only uses icons
// as images and masks, but they are served from the same origin, so anything
// that could run code is refused.
func Check(b []byte) error {
	t := bytes.TrimSpace(b)
	t = bytes.TrimPrefix(t, []byte("\xef\xbb\xbf"))
	if bytes.HasPrefix(t, []byte("<?xml")) {
		if i := bytes.Index(t, []byte("?>")); i >= 0 {
			t = bytes.TrimSpace(t[i+2:])
		}
	}
	if !bytes.HasPrefix(t, []byte("<svg")) {
		return errors.New("not an svg")
	}
	if unsafe.Match(t) {
		return errors.New("svg has scripts or external content")
	}
	return nil
}
