package faceit

import (
	"regexp"
	"strings"
)

// Ref is what a pasted link points at.
type Ref struct {
	// Kind is "match" or "team".
	Kind string
	ID   string
}

const uuid = `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`

var (
	matchIDPattern = regexp.MustCompile(`(?:^|[^0-9a-z])(1-` + uuid + `)`)
	teamURLPattern = regexp.MustCompile(`/teams?/(` + uuid + `)(?:$|[/?#])`)
	uuidPattern    = regexp.MustCompile(`^` + uuid + `$`)
	matchIDOnly    = regexp.MustCompile(`^1-` + uuid + `$`)
)

// ParseURL reads a match room link, a match id, a team link or a team id.
// A demo file name such as 1-<uuid>-1-1.dem.zst also counts as its match.
func ParseURL(s string) (Ref, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return Ref{}, false
	}
	if m := matchIDPattern.FindStringSubmatch(s); m != nil {
		return Ref{Kind: "match", ID: m[1]}, true
	}
	if m := teamURLPattern.FindStringSubmatch(s); m != nil {
		return Ref{Kind: "team", ID: m[1]}, true
	}
	if uuidPattern.MatchString(s) {
		return Ref{Kind: "team", ID: s}, true
	}
	return Ref{}, false
}

// ValidMatchID reports whether id looks like a CS2 match id.
func ValidMatchID(id string) bool { return matchIDOnly.MatchString(id) }

// MatchIDIn returns the first match id inside s, for example in a demo file
// name, or "".
func MatchIDIn(s string) string {
	if m := matchIDPattern.FindStringSubmatch(strings.ToLower(s)); m != nil {
		return m[1]
	}
	return ""
}
