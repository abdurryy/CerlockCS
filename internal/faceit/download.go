package faceit

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
)

// NoDownloadsMsg tells the user what to do when the key cannot download.
const NoDownloadsMsg = "Your FACEIT API key cannot download demos. Download them from the match rooms on faceit.com and drop them into Cerlock."

// ErrLinkExpired means a signed download link is no longer valid and a new
// one has to be requested.
var ErrLinkExpired = errors.New("the download link expired")

// DemoURL asks the Downloads API for a signed link to one of a match's
// demo_url entries.
func (c *Client) DemoURL(ctx context.Context, resourceURL string) (string, error) {
	body := map[string]string{"resource_url": resourceURL}
	var out struct {
		Payload struct {
			DownloadURL string `json:"download_url"`
		} `json:"payload"`
	}
	var err error
	// The path is documented both ways, try the newer one first.
	for _, p := range []string{"/demos/download-url", "/demos/download"} {
		err = c.call(ctx, http.MethodPost, c.Download+p, body, &out)
		if Code(err) != CodeNotFound {
			break
		}
	}
	switch Code(err) {
	case "":
	case CodeBadKey:
		return "", &Error{Code: CodeNoDownloads, Msg: NoDownloadsMsg, err: err}
	case CodeNotFound:
		return "", &Error{Code: CodeNotFound, Msg: "FACEIT no longer has the demo of this match", err: err}
	default:
		return "", err
	}
	if err != nil {
		return "", err
	}
	link := strings.TrimSpace(out.Payload.DownloadURL)
	if !isHTTP(link) {
		return "", newError(CodeUnreachable, "FACEIT did not send a download link")
	}
	return link, nil
}

func isHTTP(link string) bool {
	u, err := url.Parse(link)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != ""
}

// Fetch streams the file behind a signed link into w and returns its size.
// The key is never sent along. progress gets the bytes so far and the total,
// which is -1 when unknown.
func (c *Client) Fetch(ctx context.Context, link string, w io.Writer, maxBytes int64, progress func(done, total int64)) (int64, error) {
	if !isHTTP(link) {
		return 0, errors.New("not a download link")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, link, nil)
	if err != nil {
		return 0, err
	}
	resp, err := c.Files.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		return 0, &Error{Code: CodeUnreachable, Msg: "the demo server cannot be reached", err: err}
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized:
		return 0, ErrLinkExpired
	case resp.StatusCode != http.StatusOK:
		return 0, fmt.Errorf("the demo server answered %d", resp.StatusCode)
	}
	total := resp.ContentLength
	if total > maxBytes {
		return 0, errors.New("the demo is too large")
	}
	cw := &countWriter{w: w, total: total, progress: progress}
	n, err := io.Copy(cw, io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return n, err
	}
	if n > maxBytes {
		return n, errors.New("the demo is too large")
	}
	if total > 0 && n != total {
		return n, errors.New("the download was cut off")
	}
	return n, nil
}

type countWriter struct {
	w        io.Writer
	n, last  int64
	total    int64
	progress func(done, total int64)
}

func (c *countWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += int64(n)
	if c.progress != nil && c.n-c.last >= 1<<20 {
		c.last = c.n
		c.progress(c.n, c.total)
	}
	return n, err
}

var demoExts = []string{".dem.zst", ".dem.gz", ".dem.bz2", ".dem"}

// DemoExt returns the demo extension found in the path of the first link
// that has one, or "".
func DemoExt(links ...string) string {
	for _, l := range links {
		u, err := url.Parse(l)
		if err != nil {
			continue
		}
		base := strings.ToLower(path.Base(u.Path))
		for _, ext := range demoExts {
			if strings.HasSuffix(base, ext) {
				return ext
			}
		}
	}
	return ""
}

// SniffExt picks the extension from the first bytes of a demo file.
func SniffExt(head []byte) string {
	switch {
	case bytes.HasPrefix(head, []byte{0x28, 0xb5, 0x2f, 0xfd}):
		return ".dem.zst"
	case bytes.HasPrefix(head, []byte{0x1f, 0x8b}):
		return ".dem.gz"
	case bytes.HasPrefix(head, []byte("BZh")):
		return ".dem.bz2"
	}
	return ".dem"
}
