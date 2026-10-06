package maps

import (
	"errors"
	"strings"
	"unicode"
)

// KV is a parsed Valve KeyValues node. Leaf values are strings, blocks are
// nested KV maps. Keys are lower cased since Valve files are not consistent.
type KV map[string]any

func (kv KV) Block(key string) KV {
	if v, ok := kv[strings.ToLower(key)].(KV); ok {
		return v
	}
	return nil
}

func (kv KV) String(key string) (string, bool) {
	v, ok := kv[strings.ToLower(key)].(string)
	return v, ok
}

// ParseKeyValues parses the text KeyValues format used by the overview files:
// quoted or bare tokens, braces for blocks and // comments.
func ParseKeyValues(src string) (KV, error) {
	toks, err := tokenize(src)
	if err != nil {
		return nil, err
	}
	pos := 0
	root, err := parseBlock(toks, &pos, false)
	if err != nil {
		return nil, err
	}
	return root, nil
}

type token struct {
	text  string
	brace bool
}

func tokenize(src string) ([]token, error) {
	var toks []token
	r := []rune(src)
	for i := 0; i < len(r); {
		c := r[i]
		switch {
		case unicode.IsSpace(c):
			i++
		case c == '/' && i+1 < len(r) && r[i+1] == '/':
			for i < len(r) && r[i] != '\n' {
				i++
			}
		case c == '{' || c == '}':
			toks = append(toks, token{text: string(c), brace: true})
			i++
		case c == '"':
			j := i + 1
			var b strings.Builder
			for j < len(r) && r[j] != '"' {
				if r[j] == '\\' && j+1 < len(r) {
					j++
				}
				b.WriteRune(r[j])
				j++
			}
			if j >= len(r) {
				return nil, errors.New("keyvalues: unterminated string")
			}
			toks = append(toks, token{text: b.String()})
			i = j + 1
		default:
			j := i
			for j < len(r) && !unicode.IsSpace(r[j]) && r[j] != '{' && r[j] != '}' && r[j] != '"' {
				j++
			}
			toks = append(toks, token{text: string(r[i:j])})
			i = j
		}
	}
	return toks, nil
}

func parseBlock(toks []token, pos *int, nested bool) (KV, error) {
	kv := KV{}
	for *pos < len(toks) {
		t := toks[*pos]
		if t.brace && t.text == "}" {
			if !nested {
				return nil, errors.New("keyvalues: unexpected }")
			}
			*pos++
			return kv, nil
		}
		if t.brace {
			return nil, errors.New("keyvalues: expected key")
		}
		key := strings.ToLower(t.text)
		*pos++
		if *pos >= len(toks) {
			return nil, errors.New("keyvalues: missing value for " + key)
		}
		v := toks[*pos]
		if v.brace && v.text == "{" {
			*pos++
			child, err := parseBlock(toks, pos, true)
			if err != nil {
				return nil, err
			}
			kv[key] = child
			continue
		}
		if v.brace {
			return nil, errors.New("keyvalues: unexpected }")
		}
		kv[key] = v.text
		*pos++
	}
	if nested {
		return nil, errors.New("keyvalues: missing }")
	}
	return kv, nil
}
