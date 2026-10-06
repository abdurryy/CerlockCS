package analysis

import (
	"regexp"
	"strings"
)

var (
	placeOf    = regexp.MustCompile(`([a-z])of([A-Z])`)
	placeCase  = regexp.MustCompile(`([a-z])([A-Z0-9])`)
	placeUpper = regexp.MustCompile(`([A-Z])([A-Z][a-z])`)
)

// prettyPlace turns the game's callout names like "BombsiteA", "CTSpawn" or
// "TopofMid" into "Bombsite A", "CT Spawn" and "Top of Mid".
func prettyPlace(s string) string {
	if s == "" {
		return ""
	}
	s = placeOf.ReplaceAllString(s, "$1 of $2")
	s = placeCase.ReplaceAllString(s, "$1 $2")
	s = placeUpper.ReplaceAllString(s, "$1 $2")
	return strings.TrimSpace(s)
}
