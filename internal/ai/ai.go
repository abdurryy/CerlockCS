// Package ai writes the game plan up in plain words with a language model:
// Ollama running on the user's own computer, or Groq or OpenRouter with the
// user's own key. It only ever gets the facts Cerlock measured.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Error codes, the server passes them on to the browser.
const (
	CodeOff         = "ai_off"
	CodeBadKey      = "ai_bad_key"
	CodeNoModel     = "ai_no_model"
	CodeRateLimited = "ai_rate_limited"
	CodeUnreachable = "ai_unreachable"
	CodeFailed      = "ai_failed"
)

const maxResponseBytes = 4 << 20

// Error is a failed call. The message is meant for the user and never
// contains the key.
type Error struct {
	Code string
	Msg  string
	err  error
}

func (e *Error) Error() string { return e.Msg }
func (e *Error) Unwrap() error { return e.err }

// Code returns the error code of err, or "" when it is not one of ours.
func Code(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

// Provider is a service that runs the model.
type Provider struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	URL   string `json:"url"`
	Model string `json:"model"`
	// NeedsKey is false for Ollama, which runs on the user's computer.
	NeedsKey bool `json:"needsKey"`
	// KeyPage is where the user gets a key.
	KeyPage string `json:"keyPage,omitempty"`
}

var Providers = []Provider{
	{ID: "ollama", Name: "Ollama", URL: "http://127.0.0.1:11434", Model: "llama3.1:8b"},
	{ID: "groq", Name: "Groq", URL: "https://api.groq.com/openai/v1", Model: "llama-3.3-70b-versatile", NeedsKey: true, KeyPage: "https://console.groq.com/keys"},
	{ID: "openrouter", Name: "OpenRouter", URL: "https://openrouter.ai/api/v1", Model: "meta-llama/llama-3.3-70b-instruct:free", NeedsKey: true, KeyPage: "https://openrouter.ai/keys"},
}

// ProviderByID returns the provider with that id.
func ProviderByID(id string) (Provider, bool) {
	for _, p := range Providers {
		if p.ID == id {
			return p, true
		}
	}
	return Provider{}, false
}

// Config is what the user picked. Empty fields take the provider's
// defaults.
type Config struct {
	Provider string
	Model    string
	Key      string
	// URL replaces the provider's address, for Ollama on another computer
	// or a fake in tests.
	URL string
}

// Client is safe for concurrent use.
type Client struct {
	HTTP *http.Client
}

func New() *Client {
	return &Client{HTTP: &http.Client{Timeout: 4 * time.Minute}}
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Write sends the system prompt and the facts and returns the model's text
// and the model that wrote it.
func (c *Client) Write(ctx context.Context, cfg Config, system, user string) (string, string, error) {
	p, ok := ProviderByID(cfg.Provider)
	if !ok {
		return "", "", &Error{Code: CodeOff, Msg: "Pick a model to write with first"}
	}
	if p.NeedsKey && cfg.Key == "" {
		return "", "", &Error{Code: CodeOff, Msg: fmt.Sprintf("Add your %s key first", p.Name)}
	}
	base := strings.TrimRight(p.URL, "/")
	if cfg.URL != "" {
		base = strings.TrimRight(cfg.URL, "/")
	}
	model := cfg.Model
	if model == "" {
		model = p.Model
	}
	msgs := []message{{Role: "system", Content: system}, {Role: "user", Content: user}}
	var (
		endpoint string
		body     any
	)
	if p.ID == "ollama" {
		endpoint = base + "/api/chat"
		body = map[string]any{"model": model, "messages": msgs, "stream": false, "options": map[string]any{"temperature": 0.3}}
	} else {
		endpoint = base + "/chat/completions"
		body = map[string]any{"model": model, "messages": msgs, "temperature": 0.3, "max_tokens": 1400}
	}
	b, err := json.Marshal(body)
	if err != nil {
		return "", "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(b))
	if err != nil {
		return "", "", &Error{Code: CodeUnreachable, Msg: "That address does not work", err: err}
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.Key != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Key)
	}
	if p.ID == "openrouter" {
		req.Header.Set("X-Title", "CerlockCS")
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return "", "", unreachable(p, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes))
	if err != nil {
		return "", "", &Error{Code: CodeFailed, Msg: fmt.Sprintf("%s stopped answering", p.Name), err: err}
	}
	if res.StatusCode != http.StatusOK {
		return "", "", statusError(p, model, res.StatusCode, data)
	}
	text, err := parse(p, data)
	if err != nil {
		return "", "", err
	}
	return text, model, nil
}

func parse(p Provider, data []byte) (string, error) {
	var text string
	if p.ID == "ollama" {
		var out struct {
			Message message `json:"message"`
		}
		if err := json.Unmarshal(data, &out); err != nil {
			return "", &Error{Code: CodeFailed, Msg: "Ollama sent something we could not read", err: err}
		}
		text = out.Message.Content
	} else {
		var out struct {
			Choices []struct {
				Message message `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(data, &out); err != nil {
			return "", &Error{Code: CodeFailed, Msg: fmt.Sprintf("%s sent something we could not read", p.Name), err: err}
		}
		if len(out.Choices) > 0 {
			text = out.Choices[0].Message.Content
		}
	}
	text = strings.TrimSpace(stripThinking(text))
	if text == "" {
		return "", &Error{Code: CodeFailed, Msg: "The model sent back nothing, try again or pick another model"}
	}
	return text, nil
}

// stripThinking drops the <think> part some models write before the answer.
func stripThinking(s string) string {
	for {
		i := strings.Index(s, "<think>")
		if i < 0 {
			return s
		}
		j := strings.Index(s[i:], "</think>")
		if j < 0 {
			return s[:i]
		}
		s = s[:i] + s[i+j+len("</think>"):]
	}
}

func unreachable(p Provider, err error) error {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return &Error{Code: CodeUnreachable, Msg: "The model took too long, try a smaller one", err: err}
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return &Error{Code: CodeUnreachable, Msg: "The model took too long, try a smaller one", err: err}
	}
	if p.ID == "ollama" {
		return &Error{Code: CodeUnreachable, Msg: "Ollama is not running. Start it, or check the address", err: err}
	}
	return &Error{Code: CodeUnreachable, Msg: fmt.Sprintf("Could not reach %s, check your internet", p.Name), err: err}
}

func statusError(p Provider, model string, status int, data []byte) error {
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return &Error{Code: CodeBadKey, Msg: fmt.Sprintf("%s did not accept the key", p.Name)}
	case status == http.StatusTooManyRequests:
		return &Error{Code: CodeRateLimited, Msg: fmt.Sprintf("%s says too many requests, wait a minute", p.Name)}
	case status == http.StatusNotFound || (p.ID == "ollama" && strings.Contains(string(data), "not found")):
		if p.ID == "ollama" {
			return &Error{Code: CodeNoModel, Msg: fmt.Sprintf("Ollama does not have %s yet, run: ollama pull %s", model, model)}
		}
		return &Error{Code: CodeNoModel, Msg: fmt.Sprintf("%s does not have the model %s", p.Name, model)}
	}
	return &Error{Code: CodeFailed, Msg: fmt.Sprintf("%s answered with an error (%d)", p.Name, status)}
}

// Models lists the models Ollama has, for picking one.
func (c *Client) Models(ctx context.Context, cfg Config) ([]string, error) {
	p, ok := ProviderByID(cfg.Provider)
	if !ok || p.ID != "ollama" {
		return nil, nil
	}
	base := strings.TrimRight(p.URL, "/")
	if cfg.URL != "" {
		base = strings.TrimRight(cfg.URL, "/")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/tags", nil)
	if err != nil {
		return nil, &Error{Code: CodeUnreachable, Msg: "That address does not work", err: err}
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, unreachable(p, err)
	}
	defer res.Body.Close()
	var out struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if res.StatusCode != http.StatusOK {
		return nil, statusError(p, "", res.StatusCode, nil)
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxResponseBytes)).Decode(&out); err != nil {
		return nil, &Error{Code: CodeFailed, Msg: "Ollama sent something we could not read", err: err}
	}
	names := make([]string, 0, len(out.Models))
	for _, m := range out.Models {
		names = append(names, m.Name)
	}
	return names, nil
}

// ValidURL is true for an http or https address with a host.
func ValidURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil
}
