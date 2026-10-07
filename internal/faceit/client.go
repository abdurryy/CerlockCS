// Package faceit talks to the FACEIT Data API and the Downloads API to find
// the matches a group of players played together and to fetch their demos.
package faceit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultAPI      = "https://open.faceit.com/data/v4"
	DefaultDownload = "https://open.faceit.com/download/v2"
)

// Error codes, the server passes them on to the browser.
const (
	CodeNoKey        = "no_key"
	CodeBadKey       = "bad_key"
	CodeNotFound     = "not_found"
	CodeRateLimited  = "rate_limited"
	CodeNoDownloads  = "downloads_not_allowed"
	CodeUnreachable  = "faceit_unreachable"
	CodeBadRequest   = "bad_request"
	maxInFlight      = 4
	maxResponseBytes = 16 << 20
)

// Error is a failed FACEIT call. The message is meant for the user and never
// contains the key.
type Error struct {
	Code   string
	Msg    string
	Status int
	err    error
}

func (e *Error) Error() string { return e.Msg }
func (e *Error) Unwrap() error { return e.err }

// Code returns the error code of err, or "" when it is not a FACEIT error.
func Code(err error) string {
	var fe *Error
	if errors.As(err, &fe) {
		return fe.Code
	}
	return ""
}

func newError(code, msg string) *Error { return &Error{Code: code, Msg: msg} }

// Client is safe for concurrent use. At most four requests are in flight at
// once, so the Data API's rate limit is rarely hit.
type Client struct {
	API      string
	Download string
	HTTP     *http.Client
	// Files fetches demo files from the signed URLs. It has no overall
	// timeout since demos are a few hundred MB.
	Files *http.Client
	// MaxRetryWait caps how long a 429 answer may make us wait.
	MaxRetryWait time.Duration

	key func() string
	sem chan struct{}
}

// New returns a client that reads the key from key on every request, so the
// key can change while the client is in use.
func New(api, download string, key func() string) *Client {
	if api == "" {
		api = DefaultAPI
	}
	if download == "" {
		download = DefaultDownload
	}
	return &Client{
		API:          strings.TrimRight(api, "/"),
		Download:     strings.TrimRight(download, "/"),
		HTTP:         &http.Client{Timeout: 20 * time.Second},
		Files:        &http.Client{Transport: fileTransport()},
		MaxRetryWait: 30 * time.Second,
		key:          key,
		sem:          make(chan struct{}, maxInFlight),
	}
}

func fileTransport() http.RoundTripper {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.ResponseHeaderTimeout = 30 * time.Second
	return t
}

// WithKey returns a copy that uses key and shares the request limit.
func (c *Client) WithKey(key string) *Client {
	cp := *c
	cp.key = func() string { return key }
	return &cp
}

// HasKey reports whether a key is set.
func (c *Client) HasKey() bool { return c.key != nil && c.key() != "" }

func (c *Client) acquire(ctx context.Context) error {
	select {
	case c.sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *Client) release() { <-c.sem }

// call sends one request and retries once when FACEIT answers 429. body is
// sent as JSON when it is not nil.
func (c *Client) call(ctx context.Context, method, rawURL string, body, out any) error {
	if !c.HasKey() {
		return newError(CodeNoKey, "Add your FACEIT API key in the settings first")
	}
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return err
		}
	}
	for attempt := 0; ; attempt++ {
		resp, err := c.send(ctx, method, rawURL, payload)
		if err != nil {
			return err
		}
		if resp.StatusCode == http.StatusTooManyRequests && attempt == 0 {
			wait := retryAfter(resp.Header.Get("Retry-After"))
			drain(resp)
			if wait > c.MaxRetryWait {
				return newError(CodeRateLimited, "FACEIT is rate limiting requests, try again in a minute")
			}
			if err := sleep(ctx, wait); err != nil {
				return err
			}
			continue
		}
		defer drain(resp)
		if err := statusError(resp.StatusCode); err != nil {
			return err
		}
		if out == nil {
			return nil
		}
		return decode(resp.Body, out)
	}
}

func (c *Client) send(ctx context.Context, method, rawURL string, payload []byte) (*http.Response, error) {
	if err := c.acquire(ctx); err != nil {
		return nil, err
	}
	defer c.release()
	var rd io.Reader
	if payload != nil {
		rd = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, rd)
	if err != nil {
		return nil, newError(CodeBadRequest, "bad FACEIT address")
	}
	req.Header.Set("Authorization", "Bearer "+c.key())
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, &Error{Code: CodeUnreachable, Msg: "FACEIT cannot be reached", err: err}
	}
	return resp, nil
}

// decode reads a JSON answer. A field of an unexpected type is skipped
// instead of failing the whole answer.
func decode(r io.Reader, out any) error {
	err := json.NewDecoder(io.LimitReader(r, maxResponseBytes)).Decode(out)
	var typeErr *json.UnmarshalTypeError
	if err == nil || errors.As(err, &typeErr) {
		return nil
	}
	return &Error{Code: CodeUnreachable, Msg: "FACEIT sent an answer that could not be read", err: err}
}

func statusError(status int) error {
	switch {
	case status >= 200 && status < 300:
		return nil
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return &Error{Code: CodeBadKey, Msg: "FACEIT did not accept the API key", Status: status}
	case status == http.StatusNotFound:
		return &Error{Code: CodeNotFound, Msg: "FACEIT could not find that", Status: status}
	case status == http.StatusTooManyRequests:
		return &Error{Code: CodeRateLimited, Msg: "FACEIT is rate limiting requests, try again in a minute", Status: status}
	case status >= 400 && status < 500:
		return &Error{Code: CodeBadRequest, Msg: fmt.Sprintf("FACEIT rejected the request (%d)", status), Status: status}
	}
	return &Error{Code: CodeUnreachable, Msg: fmt.Sprintf("FACEIT answered with an error (%d)", status), Status: status}
}

// retryAfter reads a Retry-After header in seconds or as an HTTP date.
func retryAfter(h string) time.Duration {
	h = strings.TrimSpace(h)
	if h == "" {
		return 2 * time.Second
	}
	if s, err := strconv.Atoi(h); err == nil {
		return time.Duration(max(s, 0)) * time.Second
	}
	if t, err := http.ParseTime(h); err == nil {
		return max(time.Until(t), 0)
	}
	return 2 * time.Second
}

func sleep(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func drain(resp *http.Response) {
	io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
}

func (c *Client) get(ctx context.Context, p string, q url.Values, out any) error {
	u := c.API + p
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	return c.call(ctx, http.MethodGet, u, nil, out)
}

// Check makes one cheap call to see whether FACEIT accepts the key.
func (c *Client) Check(ctx context.Context) error {
	return c.get(ctx, "/games/cs2", nil, nil)
}

// Match fetches the details of a match.
func (c *Client) Match(ctx context.Context, id string) (*Match, error) {
	var m Match
	if err := c.get(ctx, "/matches/"+url.PathEscape(id), nil, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// MatchStats fetches the scoreboard of a finished match.
func (c *Client) MatchStats(ctx context.Context, id string) (*Stats, error) {
	var s Stats
	if err := c.get(ctx, "/matches/"+url.PathEscape(id)+"/stats", nil, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

// Team fetches a team and its members.
func (c *Client) Team(ctx context.Context, id string) (*Team, error) {
	var t Team
	if err := c.get(ctx, "/teams/"+url.PathEscape(id), nil, &t); err != nil {
		return nil, err
	}
	return &t, nil
}

// Player fetches a player by FACEIT id.
func (c *Client) Player(ctx context.Context, id string) (*Player, error) {
	var p Player
	if err := c.get(ctx, "/players/"+url.PathEscape(id), nil, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// PlayerByNickname looks up a CS2 player by FACEIT nickname.
func (c *Client) PlayerByNickname(ctx context.Context, nickname string) (*Player, error) {
	var p Player
	q := url.Values{"nickname": {nickname}, "game": {"cs2"}}
	if err := c.get(ctx, "/players", q, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// PlayerBySteamID looks up a CS2 player by SteamID64.
func (c *Client) PlayerBySteamID(ctx context.Context, steamID string) (*Player, error) {
	var p Player
	q := url.Values{"game": {"cs2"}, "game_player_id": {steamID}}
	if err := c.get(ctx, "/players", q, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

const (
	historyPage = 100
	// historyFrom is before CS2 came out. Without it FACEIT only returns
	// the last month.
	historyFrom = 1672531200
)

// History returns up to limit of the player's latest CS2 matches, newest
// first, paging through the API 100 at a time.
func (c *Client) History(ctx context.Context, playerID string, limit int) ([]HistoryItem, error) {
	var out []HistoryItem
	for offset := 0; offset < limit; {
		n := min(historyPage, limit-offset)
		q := url.Values{
			"game":   {"cs2"},
			"from":   {strconv.Itoa(historyFrom)},
			"offset": {strconv.Itoa(offset)},
			"limit":  {strconv.Itoa(n)},
		}
		var page struct {
			Items []HistoryItem `json:"items"`
		}
		if err := c.get(ctx, "/players/"+url.PathEscape(playerID)+"/history", q, &page); err != nil {
			return out, err
		}
		out = append(out, page.Items...)
		if len(page.Items) < n {
			break
		}
		offset += len(page.Items)
	}
	return out, nil
}
