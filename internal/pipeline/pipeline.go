// Package pipeline runs the full path from demo bytes to a compressed replay.
package pipeline

import (
	"bufio"
	"bytes"
	"compress/bzip2"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"strconv"
	"time"

	"github.com/klauspost/compress/gzip"
	"github.com/klauspost/compress/zstd"

	"github.com/abdurryy/CerlockCS/internal/analysis"
	"github.com/abdurryy/CerlockCS/internal/match"
	"github.com/abdurryy/CerlockCS/internal/parse"
	"github.com/abdurryy/CerlockCS/internal/replay"
)

// FingerprintBytes is how much of a file goes into its fingerprint.
const FingerprintBytes = 1 << 20

// Fingerprint identifies a demo file from its size and first megabyte, so a
// file can be recognised before it is uploaded or read in full. The web
// client computes the same value.
func Fingerprint(size int64, head []byte) string {
	if len(head) > FingerprintBytes {
		head = head[:FingerprintBytes]
	}
	h := sha256.New()
	var sz [8]byte
	binary.LittleEndian.PutUint64(sz[:], uint64(size))
	h.Write(sz[:])
	h.Write(head)
	return hex.EncodeToString(h.Sum(nil))[:20]
}

var ErrNotDemo = errors.New("not a CS2 demo")

// Decompress detects gzip, bzip2 and zstd compressed demos (FACEIT and Valve
// matchmaking ship them compressed) and returns a reader for the raw demo.
func Decompress(r io.Reader) (io.Reader, func(), error) {
	br := bufio.NewReaderSize(r, 64<<10)
	magic, err := br.Peek(8)
	if err != nil && len(magic) < 4 {
		return nil, nil, ErrNotDemo
	}
	noop := func() {}
	switch {
	case bytes.HasPrefix(magic, []byte("PBDEMS2")):
		return br, noop, nil
	case bytes.HasPrefix(magic, []byte("HL2DEMO")):
		return nil, nil, errors.New("CS:GO demos are not supported, only CS2")
	case bytes.HasPrefix(magic, []byte{0x1f, 0x8b}):
		gz, err := gzip.NewReader(br)
		if err != nil {
			return nil, nil, err
		}
		return gz, func() { gz.Close() }, nil
	case bytes.HasPrefix(magic, []byte("BZh")):
		return bzip2.NewReader(br), noop, nil
	case bytes.HasPrefix(magic, []byte{0x28, 0xb5, 0x2f, 0xfd}):
		zr, err := zstd.NewReader(br)
		if err != nil {
			return nil, nil, err
		}
		return zr, zr.Close, nil
	}
	return nil, nil, ErrNotDemo
}

type Summary struct {
	Map      string       `json:"map"`
	Teams    [2]Team      `json:"teams"`
	Rounds   int          `json:"rounds"`
	Players  []string     `json:"players"`
	SteamIDs []string     `json:"steamIds"`
	Duration float64      `json:"duration"`
	ParseMs  int64        `json:"parseMs"`
	Server   string       `json:"server"`
	Match    *match.Match `json:"-"`
}

type Team struct {
	Name  string `json:"name"`
	Score int    `json:"score"`
}

type Options struct {
	SampleInterval int
	Progress       func(float32)
}

// Players returns the names and SteamID64s of the match players, in the
// same order.
func Players(m *match.Match) (names, steamIDs []string) {
	for _, p := range m.Players {
		names = append(names, p.Name)
		steamIDs = append(steamIDs, strconv.FormatUint(p.SteamID, 10))
	}
	return names, steamIDs
}

// Run parses the demo in r and writes a gzip compressed replay to w.
func Run(r io.Reader, w io.Writer, opts Options) (*Summary, error) {
	start := time.Now()
	raw, closeFn, err := Decompress(r)
	if err != nil {
		return nil, err
	}
	defer closeFn()

	m, err := parse.Parse(raw, parse.Options{SampleInterval: opts.SampleInterval, Progress: opts.Progress})
	if err != nil {
		return nil, err
	}
	report := analysis.Analyze(m)
	parseMs := time.Since(start).Milliseconds()

	zw, err := gzip.NewWriterLevel(w, gzip.BestSpeed)
	if err != nil {
		return nil, err
	}
	extra := map[string]any{
		"analysis": report,
		"parseMs":  parseMs,
	}
	if err := replay.Write(zw, m, extra); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}

	s := &Summary{
		Map:      m.Map,
		Rounds:   len(m.Rounds),
		Duration: float64(m.LastTick-m.FirstTick) / m.TickRate,
		ParseMs:  parseMs,
		Server:   m.Server,
		Match:    m,
	}
	for t := 0; t < 2; t++ {
		s.Teams[t] = Team{Name: m.Teams[t].Name, Score: m.Teams[t].Score}
	}
	s.Players, s.SteamIDs = Players(m)
	return s, nil
}
