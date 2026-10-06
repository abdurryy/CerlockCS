// Package maps provides radar images and the numbers needed to place world
// coordinates on them.
//
// CS2 ships a 1024x1024 radar image per map together with an overview file
// (resource/overviews/<map>.txt). The overview gives the world position of the
// image's top left corner and how many world units one pixel covers:
//
//	px = (x - pos_x) / scale
//	py = (pos_y - y) / scale
//
// Maps with two floors (Nuke, Train, Vertigo) have a second image for the
// lower level and an altitude where the two meet.
package maps

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
	"time"
)

type Level struct {
	Name        string  `json:"name"`
	AltitudeMin float64 `json:"altitudeMin"`
	AltitudeMax float64 `json:"altitudeMax"`
	// Image is the URL the viewer loads the radar from, empty when no image
	// is available.
	Image string `json:"image"`
}

type Info struct {
	Name   string  `json:"name"`
	PosX   float64 `json:"posX"`
	PosY   float64 `json:"posY"`
	Scale  float64 `json:"scale"`
	Size   int     `json:"size"`
	Levels []Level `json:"levels"`
	// Known is false when no overview data exists for the map. The viewer
	// then fits the map to where players walked instead.
	Known bool `json:"known"`
}

type calibration struct {
	posX, posY, scale float64
	// lowerMax is the altitude below which the lower radar is used, nil for
	// maps with a single level.
	lowerMax *float64
}

func f(v float64) *float64 { return &v }

// Values from resource/overviews/*.txt in the CS2 game files. Used when the
// overview file cannot be downloaded.
var builtin = map[string]calibration{
	"de_ancient":  {-2953, 2164, 5, nil},
	"de_anubis":   {-2796, 3328, 5.22, nil},
	"de_cache":    {-2000, 3250, 5.5, nil},
	"de_dust2":    {-2476, 3239, 4.4, nil},
	"de_inferno":  {-2087, 3870, 4.9, nil},
	"de_mirage":   {-3230, 1713, 5, nil},
	"de_nuke":     {-3453, 2887, 7, f(-495)},
	"de_overpass": {-4831, 1781, 5.2, nil},
	"de_train":    {-2308, 2078, 4.082077, f(-50)},
	"de_vertigo":  {-3168, 1762, 4, f(11700)},
	"cs_italy":    {-2647, 2592, 4.6, nil},
	"cs_office":   {-1838, 1858, 4.1, nil},
}

// DefaultSource mirrors the radar images and overview files straight from
// the game depot and is updated with every CS2 patch.
const DefaultSource = "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main"

var (
	validName  = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)
	validImage = regexp.MustCompile(`^[a-z0-9_]{1,64}_radar_psd\.png$`)
)

// ParseOverview reads an overview file.
func ParseOverview(name, src string) (Info, error) {
	kv, err := ParseKeyValues(src)
	if err != nil {
		return Info{}, err
	}
	root := kv.Block(name)
	if root == nil {
		// Some files use a different root key, take the first block.
		for _, v := range kv {
			if b, ok := v.(KV); ok {
				root = b
				break
			}
		}
	}
	if root == nil {
		return Info{}, errors.New("overview: no root block")
	}
	num := func(key string) (float64, error) {
		s, ok := root.String(key)
		if !ok {
			return 0, fmt.Errorf("overview: missing %s", key)
		}
		return strconv.ParseFloat(s, 64)
	}
	info := Info{Name: name, Size: 1024, Known: true}
	if info.PosX, err = num("pos_x"); err != nil {
		return Info{}, err
	}
	if info.PosY, err = num("pos_y"); err != nil {
		return Info{}, err
	}
	if info.Scale, err = num("scale"); err != nil {
		return Info{}, err
	}
	if info.Scale <= 0 {
		return Info{}, errors.New("overview: bad scale")
	}
	info.Levels = []Level{{Name: "default", AltitudeMin: -1e6, AltitudeMax: 1e6}}
	if vs := root.Block("verticalsections"); vs != nil {
		if lower := vs.Block("lower"); lower != nil {
			if s, ok := lower.String("altitudemax"); ok {
				if max, err := strconv.ParseFloat(s, 64); err == nil {
					info.Levels[0].AltitudeMin = max
					info.Levels = append(info.Levels, Level{Name: "lower", AltitudeMin: -1e6, AltitudeMax: max})
				}
			}
		}
	}
	return info, nil
}

func fromBuiltin(name string) (Info, bool) {
	c, ok := builtin[name]
	if !ok {
		return Info{Name: name, Size: 1024, Levels: []Level{{Name: "default", AltitudeMin: -1e6, AltitudeMax: 1e6}}}, false
	}
	info := Info{Name: name, PosX: c.posX, PosY: c.posY, Scale: c.scale, Size: 1024, Known: true}
	info.Levels = []Level{{Name: "default", AltitudeMin: -1e6, AltitudeMax: 1e6}}
	if c.lowerMax != nil {
		info.Levels[0].AltitudeMin = *c.lowerMax
		info.Levels = append(info.Levels, Level{Name: "lower", AltitudeMin: -1e6, AltitudeMax: *c.lowerMax})
	}
	return info, true
}

// Store keeps radar images and overview files on disk and downloads missing
// ones from Source. Files use the names the game uses, so images exported
// from the game files can be dropped straight into Dir:
//
//	de_nuke.txt
//	de_nuke_radar_psd.png
//	de_nuke_lower_radar_psd.png
type Store struct {
	Dir     string
	Source  string
	Offline bool
	Client  *http.Client
	// URLPrefix is prepended to image names in Level.Image.
	URLPrefix string

	mu      sync.Mutex
	locks   map[string]*sync.Mutex
	missing map[string]time.Time
}

func NewStore(dir string) *Store {
	return &Store{
		Dir:       dir,
		Source:    DefaultSource,
		Client:    &http.Client{Timeout: 30 * time.Second},
		URLPrefix: "/api/maps/",
		locks:     map[string]*sync.Mutex{},
		missing:   map[string]time.Time{},
	}
}

func (s *Store) lock(name string) func() {
	s.mu.Lock()
	l, ok := s.locks[name]
	if !ok {
		l = &sync.Mutex{}
		s.locks[name] = l
	}
	s.mu.Unlock()
	l.Lock()
	return l.Unlock
}

func imageFile(name, level string) string {
	if level == "lower" {
		return name + "_lower_radar_psd.png"
	}
	return name + "_radar_psd.png"
}

// Info returns calibration and image locations for a map, downloading what
// is missing on first use.
func (s *Store) Info(ctx context.Context, name string) (Info, error) {
	if !validName.MatchString(name) {
		return Info{}, fmt.Errorf("invalid map name %q", name)
	}
	defer s.lock(name)()

	info, ok := s.overview(ctx, name)
	if !ok {
		info, _ = fromBuiltin(name)
	}
	for i := range info.Levels {
		file := imageFile(name, info.Levels[i].Name)
		if s.ensure(ctx, file, "/images/radars/"+file) {
			info.Levels[i].Image = s.URLPrefix + file
		}
	}
	return info, nil
}

func (s *Store) overview(ctx context.Context, name string) (Info, bool) {
	file := name + ".txt"
	if !s.ensure(ctx, file, "/data/radar_info/"+file) {
		return Info{}, false
	}
	b, err := os.ReadFile(filepath.Join(s.Dir, file))
	if err != nil {
		return Info{}, false
	}
	info, err := ParseOverview(name, string(b))
	if err != nil {
		return Info{}, false
	}
	return info, true
}

// ImagePath returns the local path of a radar image if it exists.
func (s *Store) ImagePath(file string) (string, bool) {
	if !validImage.MatchString(file) {
		return "", false
	}
	p := filepath.Join(s.Dir, file)
	if _, err := os.Stat(p); err != nil {
		return "", false
	}
	return p, true
}

// ensure makes sure file exists in Dir, downloading it if allowed.
func (s *Store) ensure(ctx context.Context, file, remote string) bool {
	p := filepath.Join(s.Dir, file)
	if _, err := os.Stat(p); err == nil {
		return true
	}
	if s.Offline || s.Source == "" {
		return false
	}
	s.mu.Lock()
	failed, seen := s.missing[file]
	s.mu.Unlock()
	if seen && time.Since(failed) < time.Hour {
		return false
	}
	if err := s.download(ctx, s.Source+remote, p); err != nil {
		s.mu.Lock()
		s.missing[file] = time.Now()
		s.mu.Unlock()
		return false
	}
	return true
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
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".download-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, io.LimitReader(resp.Body, 32<<20)); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), dst)
}
