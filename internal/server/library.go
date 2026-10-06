package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/abdurryy/CerlockCS/internal/pipeline"
)

// Entry describes a parsed demo in the library.
type Entry struct {
	ID       string           `json:"id"`
	Name     string           `json:"name"`
	Map      string           `json:"map"`
	Teams    [2]pipeline.Team `json:"teams"`
	Rounds   int              `json:"rounds"`
	Players  []string         `json:"players"`
	Duration float64          `json:"duration"`
	DemoSize int64            `json:"demoSize"`
	ParseMs  int64            `json:"parseMs"`
	Replay   int64            `json:"replaySize"`
	Created  time.Time        `json:"created"`
}

// Job is a parse that is running or queued.
type Job struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Path     string  `json:"path,omitempty"`
	Status   string  `json:"status"`
	Progress float32 `json:"progress"`
	Error    string  `json:"error,omitempty"`
}

// Library stores replays as <id>.crlk.gz next to a <id>.json entry.
type Library struct {
	dir     string
	sample  int
	mu      sync.Mutex
	entries map[string]*Entry
	jobs    map[string]*Job
	// known caches fingerprints of local files by path, size and mtime.
	known map[string]string
	queue chan *Job
}

func OpenLibrary(dir string, workers, sampleInterval int) (*Library, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	l := &Library{
		dir:     dir,
		sample:  sampleInterval,
		entries: map[string]*Entry{},
		jobs:    map[string]*Job{},
		known:   map[string]string{},
		queue:   make(chan *Job, 1024),
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, err
	}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var e Entry
		if json.Unmarshal(b, &e) != nil || e.ID == "" {
			continue
		}
		if _, err := os.Stat(l.replayPath(e.ID)); err != nil {
			continue
		}
		l.entries[e.ID] = &e
	}
	if workers < 1 {
		workers = 1
	}
	for i := 0; i < workers; i++ {
		go l.worker()
	}
	return l, nil
}

func (l *Library) replayPath(id string) string { return filepath.Join(l.dir, id+".crlk.gz") }

func (l *Library) Entries() []Entry {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]Entry, 0, len(l.entries))
	for _, e := range l.entries {
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created.After(out[j].Created) })
	return out
}

func (l *Library) Get(id string) (*Entry, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[id]
	return e, ok
}

func (l *Library) Jobs() []Job {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]Job, 0, len(l.jobs))
	for _, j := range l.jobs {
		out = append(out, *j)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func (l *Library) Delete(id string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.entries[id]; !ok {
		return fs.ErrNotExist
	}
	delete(l.entries, id)
	for path, known := range l.known {
		if known == id {
			delete(l.known, path)
		}
	}
	os.Remove(filepath.Join(l.dir, id+".json"))
	return os.Remove(l.replayPath(id))
}

// claim registers a job for id. It returns false when the demo is already
// parsed or being parsed.
func (l *Library) claim(job *Job) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.entries[job.ID]; ok {
		return false
	}
	// A failed job can be claimed again, that is how retries work.
	if j, ok := l.jobs[job.ID]; ok && j.Status != "error" {
		return false
	}
	l.jobs[job.ID] = job
	return true
}

func (l *Library) setProgress(id string, p float32) {
	l.mu.Lock()
	if j, ok := l.jobs[id]; ok {
		j.Status = "parsing"
		j.Progress = p
	}
	l.mu.Unlock()
}

// Process parses a demo stream into the library. size is the size of the
// file as it was uploaded or found on disk.
func (l *Library) Process(job *Job, r io.Reader, size int64) (*Entry, error) {
	tmp, err := os.CreateTemp(l.dir, ".replay-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(tmp.Name())

	sum, err := pipeline.Run(r, tmp, pipeline.Options{
		SampleInterval: l.sample,
		Progress:       func(p float32) { l.setProgress(job.ID, p) },
	})
	if err != nil {
		tmp.Close()
		l.fail(job, err)
		return nil, err
	}
	st, err := tmp.Stat()
	if err != nil {
		tmp.Close()
		return nil, err
	}
	if err := tmp.Close(); err != nil {
		return nil, err
	}
	os.Chmod(tmp.Name(), 0o644)
	if err := os.Rename(tmp.Name(), l.replayPath(job.ID)); err != nil {
		l.fail(job, err)
		return nil, err
	}

	e := &Entry{
		ID:       job.ID,
		Name:     job.Name,
		Map:      sum.Map,
		Teams:    sum.Teams,
		Rounds:   sum.Rounds,
		Players:  sum.Players,
		Duration: sum.Duration,
		DemoSize: size,
		ParseMs:  sum.ParseMs,
		Replay:   st.Size(),
		Created:  time.Now().UTC(),
	}
	b, _ := json.MarshalIndent(e, "", "  ")
	if err := os.WriteFile(filepath.Join(l.dir, e.ID+".json"), b, 0o644); err != nil {
		return nil, err
	}
	l.mu.Lock()
	l.entries[e.ID] = e
	delete(l.jobs, job.ID)
	l.mu.Unlock()
	log.Printf("parsed %s (%s, %d rounds) in %d ms", e.Name, e.Map, e.Rounds, e.ParseMs)
	return e, nil
}

func (l *Library) fail(job *Job, err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if j, ok := l.jobs[job.ID]; ok {
		j.Status = "error"
		j.Error = err.Error()
	}
	log.Printf("failed to parse %s: %v", job.Name, err)
}

func (l *Library) worker() {
	for job := range l.queue {
		f, err := os.Open(job.Path)
		if err != nil {
			l.fail(job, err)
			continue
		}
		st, _ := f.Stat()
		l.Process(job, f, st.Size())
		f.Close()
	}
}

var demoExt = []string{".dem", ".dem.gz", ".dem.bz2", ".dem.zst"}

func isDemoFile(name string) bool {
	name = strings.ToLower(name)
	for _, ext := range demoExt {
		if strings.HasSuffix(name, ext) {
			return true
		}
	}
	return false
}

// LocalDemo is a demo file found in one of the watched folders.
type LocalDemo struct {
	Path     string    `json:"path"`
	Name     string    `json:"name"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
	ID       string    `json:"id"`
	Status   string    `json:"status"`
	Progress float32   `json:"progress"`
	Error    string    `json:"error,omitempty"`
}

// Scan lists demo files in dirs and, when queue is true, starts parsing the
// ones that are new.
func (l *Library) Scan(dirs []string, queue bool) []LocalDemo {
	var out []LocalDemo
	for _, dir := range dirs {
		filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !isDemoFile(d.Name()) {
				return nil
			}
			// Stat follows symlinks, DirEntry.Info would describe the link.
			info, err := os.Stat(path)
			if err != nil {
				return nil
			}
			ld := LocalDemo{Path: path, Name: d.Name(), Size: info.Size(), Modified: info.ModTime()}
			id, err := l.fingerprintFile(path, info)
			if err != nil {
				return nil
			}
			ld.ID = id
			ld.Status = "new"
			l.mu.Lock()
			if _, ok := l.entries[id]; ok {
				ld.Status = "ready"
			} else if j, ok := l.jobs[id]; ok {
				ld.Status, ld.Progress, ld.Error = j.Status, j.Progress, j.Error
			}
			l.mu.Unlock()
			if queue && ld.Status == "new" {
				if err := l.Enqueue(path); err == nil {
					ld.Status = "queued"
				}
			}
			out = append(out, ld)
			return nil
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Modified.After(out[j].Modified) })
	return out
}

func (l *Library) fingerprintFile(path string, info fs.FileInfo) (string, error) {
	key := fmt.Sprintf("%s|%d|%d", path, info.Size(), info.ModTime().UnixNano())
	l.mu.Lock()
	id, ok := l.known[key]
	l.mu.Unlock()
	if ok {
		return id, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	head := make([]byte, pipeline.FingerprintBytes)
	n, err := io.ReadFull(f, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
		return "", err
	}
	id = pipeline.Fingerprint(info.Size(), head[:n])
	l.mu.Lock()
	l.known[key] = id
	l.mu.Unlock()
	return id, nil
}

// Enqueue queues a local file for parsing.
func (l *Library) Enqueue(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	id, err := l.fingerprintFile(path, info)
	if err != nil {
		return err
	}
	job := &Job{ID: id, Name: filepath.Base(path), Path: path, Status: "queued"}
	if !l.claim(job) {
		return nil
	}
	select {
	case l.queue <- job:
		return nil
	default:
		l.mu.Lock()
		delete(l.jobs, id)
		l.mu.Unlock()
		return errors.New("parse queue is full")
	}
}

// readHead reads up to the fingerprint size from r and returns the bytes
// together with a reader that replays them.
func readHead(r io.Reader) ([]byte, io.Reader, error) {
	head := make([]byte, pipeline.FingerprintBytes)
	n, err := io.ReadFull(r, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return nil, nil, err
	}
	head = head[:n]
	return head, io.MultiReader(bytes.NewReader(head), r), nil
}
