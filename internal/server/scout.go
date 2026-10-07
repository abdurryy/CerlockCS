package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/abdurryy/CerlockCS/internal/faceit"
)

// codeError answers with a message for the user and a code the web app can
// act on.
func codeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{"error": msg, "code": code})
}

var codeStatus = map[string]int{
	faceit.CodeNoKey:       http.StatusBadRequest,
	faceit.CodeBadKey:      http.StatusBadRequest,
	faceit.CodeNotFound:    http.StatusNotFound,
	faceit.CodeRateLimited: http.StatusTooManyRequests,
	faceit.CodeNoDownloads: http.StatusForbidden,
	faceit.CodeUnreachable: http.StatusBadGateway,
	faceit.CodeBadRequest:  http.StatusBadRequest,
}

// faceitError answers with a failed FACEIT call.
func faceitError(w http.ResponseWriter, err error) {
	if code := faceit.Code(err); code != "" {
		codeError(w, codeStatus[code], code, err.Error())
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		codeError(w, http.StatusGatewayTimeout, faceit.CodeUnreachable, "FACEIT took too long to answer, try again")
		return
	}
	if errors.Is(err, context.Canceled) {
		return
	}
	log.Printf("scout: %v", err)
	codeError(w, http.StatusBadGateway, faceit.CodeUnreachable, "Something went wrong while talking to FACEIT")
}

// readJSON reads a small JSON body. It also turns away requests that a page
// on another site sent, since they could spend the user's FACEIT quota.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if !sameSite(r) {
		codeError(w, http.StatusForbidden, faceit.CodeBadRequest, "Requests from other sites are not allowed")
		return false
	}
	body := http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(body).Decode(v); err != nil && !errors.Is(err, io.EOF) {
		codeError(w, http.StatusBadRequest, faceit.CodeBadRequest, "Could not read the request")
		return false
	}
	return true
}

// sameSite accepts requests without an Origin, from the page this server
// serves, and from local dev servers.
func sameSite(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	if u.Host == r.Host {
		return true
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (s *Server) requireKey(w http.ResponseWriter) bool {
	if s.faceitKey() == "" {
		codeError(w, http.StatusBadRequest, faceit.CodeNoKey, "Add your FACEIT API key in the settings first")
		return false
	}
	return true
}

func (s *Server) scoutMatch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
	}
	if !readJSON(w, r, &body) || !s.requireKey(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	l, err := s.faceit.Lookup(ctx, body.URL)
	if err != nil {
		faceitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, l)
}

const maxScoutPlayers = 10

func (s *Server) scoutFind(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Players     []faceit.Member `json:"players"`
		MinTogether int             `json:"minTogether"`
		Limit       int             `json:"limit"`
	}
	if !readJSON(w, r, &body) || !s.requireKey(w) {
		return
	}
	if len(body.Players) == 0 {
		codeError(w, http.StatusBadRequest, faceit.CodeBadRequest, "Pick the players to look for")
		return
	}
	if len(body.Players) > maxScoutPlayers {
		codeError(w, http.StatusBadRequest, faceit.CodeBadRequest, "Pick at most 10 players")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	found, err := s.faceit.FindTogether(ctx, body.Players, body.MinTogether, body.Limit)
	if err != nil {
		faceitError(w, err)
		return
	}
	for i := range found.Matches {
		found.Matches[i].ReplayID = s.lib.FindByName(found.Matches[i].MatchID)
	}
	writeJSON(w, http.StatusOK, found)
}

type failedDownload struct {
	MatchID string `json:"matchId"`
	Error   string `json:"error"`
}

type downloadResult struct {
	Queued           []string         `json:"queued"`
	Failed           []failedDownload `json:"failed"`
	DownloadsAllowed bool             `json:"downloadsAllowed"`
}

func (s *Server) scoutDownload(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MatchIDs []string `json:"matchIds"`
	}
	if !readJSON(w, r, &body) || !s.requireKey(w) {
		return
	}
	if len(body.MatchIDs) == 0 || len(body.MatchIDs) > faceit.MaxFound {
		codeError(w, http.StatusBadRequest, faceit.CodeBadRequest, "Pick between 1 and 60 matches")
		return
	}
	res := downloadResult{Queued: []string{}, Failed: []failedDownload{}, DownloadsAllowed: true}
	var todo []string
	seen := map[string]bool{}
	for _, id := range body.MatchIDs {
		id = strings.ToLower(strings.TrimSpace(id))
		switch {
		case seen[id]:
			continue
		case !faceit.ValidMatchID(id):
			res.Failed = append(res.Failed, failedDownload{id, "Not a FACEIT match id"})
		case s.lib.FindByName(id) != "" || s.dl.pending(id):
			res.Queued = append(res.Queued, id)
		case s.dl.local(id):
			res.Queued = append(res.Queued, id)
		default:
			todo = append(todo, id)
		}
		seen[id] = true
	}

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	tasks := make([]*downloadTask, len(todo))
	errs := make([]error, len(todo))
	// The first one shows whether the key may download at all, the rest
	// only run when it may.
	if len(todo) > 0 {
		tasks[0], errs[0] = s.resolveDemo(ctx, todo[0])
		code := faceit.Code(errs[0])
		if isFatal(code) {
			faceitError(w, errs[0])
			return
		}
		if code != faceit.CodeNoDownloads {
			var wg sync.WaitGroup
			for i := 1; i < len(todo); i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					tasks[i], errs[i] = s.resolveDemo(ctx, todo[i])
				}()
			}
			wg.Wait()
		}
	}
	for _, err := range errs {
		if faceit.Code(err) == faceit.CodeNoDownloads {
			res.DownloadsAllowed = false
		}
	}
	for i, id := range todo {
		switch {
		case !res.DownloadsAllowed:
			res.Failed = append(res.Failed, failedDownload{id, faceit.NoDownloadsMsg})
		case errs[i] != nil:
			res.Failed = append(res.Failed, failedDownload{id, userMessage(errs[i])})
		case !s.dl.add(tasks[i]):
			res.Failed = append(res.Failed, failedDownload{id, "Too many downloads are waiting, try again later"})
		default:
			res.Queued = append(res.Queued, id)
		}
	}
	writeJSON(w, http.StatusOK, res)
}

func isFatal(code string) bool {
	return code == faceit.CodeBadKey || code == faceit.CodeRateLimited || code == faceit.CodeUnreachable
}

func userMessage(err error) string {
	if faceit.Code(err) != "" {
		return err.Error()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "FACEIT took too long to answer"
	}
	return "Could not get the demo"
}

// resolveDemo finds the demo of a match and asks for a download link.
func (s *Server) resolveDemo(ctx context.Context, id string) (*downloadTask, error) {
	m, err := s.faceit.Match(ctx, id)
	if err != nil {
		if faceit.Code(err) == faceit.CodeNotFound {
			return nil, &faceit.Error{Code: faceit.CodeNotFound, Msg: "FACEIT has no match with that id"}
		}
		return nil, err
	}
	resource := ""
	for _, u := range m.DemoURL {
		if u = strings.TrimSpace(u); u != "" {
			resource = u
			break
		}
	}
	if resource == "" {
		return nil, &faceit.Error{Code: faceit.CodeNotFound, Msg: "This match has no demo yet"}
	}
	link, err := s.faceit.DemoURL(ctx, resource)
	if err != nil {
		return nil, err
	}
	return &downloadTask{matchID: id, resource: resource, link: link, linkAt: time.Now()}, nil
}

type downloadTask struct {
	matchID  string
	resource string
	link     string
	linkAt   time.Time
}

func (t *downloadTask) ext() string { return faceit.DemoExt(t.link, t.resource) }

func (t *downloadTask) name() string {
	if ext := t.ext(); ext != "" {
		return t.matchID + ext
	}
	return t.matchID + ".dem.zst"
}

func downloadJobID(matchID string) string { return "faceit-" + matchID }

// downloader fetches demos one at a time into dir and hands them to the
// library to parse.
type downloader struct {
	dir     string
	lib     *Library
	fc      *faceit.Client
	maxSize int64
	mu      sync.Mutex
	waiting map[string]bool
	queue   chan *downloadTask
}

func newDownloader(dir string, lib *Library, fc *faceit.Client, maxSize int64) *downloader {
	// Leftovers of downloads that were cut off by a restart.
	if parts, err := filepath.Glob(filepath.Join(dir, ".*.part")); err == nil {
		for _, p := range parts {
			os.Remove(p)
		}
	}
	d := &downloader{dir: dir, lib: lib, fc: fc, maxSize: maxSize, waiting: map[string]bool{}, queue: make(chan *downloadTask, 256)}
	go d.run()
	return d
}

func (d *downloader) pending(id string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.waiting[id]
}

// local queues a demo that was downloaded before but is not parsed yet.
func (d *downloader) local(id string) bool {
	for _, ext := range demoExt {
		p := filepath.Join(d.dir, id+ext)
		if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
			return d.lib.Enqueue(p) == nil
		}
	}
	return false
}

func (d *downloader) add(t *downloadTask) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.waiting[t.matchID] {
		return true
	}
	select {
	case d.queue <- t:
		d.waiting[t.matchID] = true
		d.lib.SetJob(Job{ID: downloadJobID(t.matchID), Name: t.name(), Status: "queued"})
		return true
	default:
		return false
	}
}

func (d *downloader) run() {
	for t := range d.queue {
		err := d.fetch(t)
		d.mu.Lock()
		delete(d.waiting, t.matchID)
		d.mu.Unlock()
		if err != nil {
			log.Printf("download of %s failed: %v", t.matchID, err)
			d.lib.SetJob(Job{ID: downloadJobID(t.matchID), Name: t.name(), Status: "error", Error: downloadMessage(err)})
		}
	}
}

func downloadMessage(err error) string {
	switch faceit.Code(err) {
	case faceit.CodeNoDownloads, faceit.CodeBadKey, faceit.CodeRateLimited, faceit.CodeNotFound:
		return err.Error()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "Download failed: it took too long"
	}
	return "Download failed: " + err.Error()
}

// linkMaxAge is how long a signed link is trusted before a new one is asked
// for. Links are only valid for a while and the queue can be long.
const linkMaxAge = 10 * time.Minute

func (d *downloader) fetch(t *downloadTask) error {
	ctx, cancel := context.WithTimeout(context.Background(), time.Hour)
	defer cancel()
	if err := os.MkdirAll(d.dir, 0o755); err != nil {
		return err
	}
	for attempt := 0; ; attempt++ {
		if t.link == "" || time.Since(t.linkAt) > linkMaxAge {
			link, err := d.fc.DemoURL(ctx, t.resource)
			if err != nil {
				return err
			}
			t.link, t.linkAt = link, time.Now()
		}
		path, err := d.save(ctx, t)
		if errors.Is(err, faceit.ErrLinkExpired) && attempt == 0 {
			t.link = ""
			continue
		}
		if err != nil {
			return err
		}
		d.lib.DropJob(downloadJobID(t.matchID))
		log.Printf("downloaded %s", filepath.Base(path))
		return d.lib.Enqueue(path)
	}
}

// save streams the demo into a temp file and renames it once complete.
func (d *downloader) save(ctx context.Context, t *downloadTask) (string, error) {
	jobID, name := downloadJobID(t.matchID), t.name()
	d.lib.SetJob(Job{ID: jobID, Name: name, Status: "downloading"})
	tmp, err := os.CreateTemp(d.dir, "."+t.matchID+"-*.part")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	_, err = d.fc.Fetch(ctx, t.link, tmp, d.maxSize, func(done, total int64) {
		if total > 0 {
			d.lib.SetJob(Job{ID: jobID, Name: name, Status: "downloading", Progress: float32(done) / float32(total)})
		}
	})
	if err != nil {
		tmp.Close()
		return "", err
	}
	ext := t.ext()
	if ext == "" {
		head := make([]byte, 8)
		n, _ := tmp.ReadAt(head, 0)
		ext = faceit.SniffExt(head[:n])
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	os.Chmod(tmp.Name(), 0o644)
	final := filepath.Join(d.dir, t.matchID+ext)
	if err := os.Rename(tmp.Name(), final); err != nil {
		return "", err
	}
	return final, nil
}
