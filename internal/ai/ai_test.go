package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const key = "gsk_test_0123456789abcdef"

func fake(t *testing.T, h http.HandlerFunc) string {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestWriteWithOllama(t *testing.T) {
	var got map[string]any
	url := fake(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" || r.Header.Get("Authorization") != "" {
			t.Errorf("path %s auth %q", r.URL.Path, r.Header.Get("Authorization"))
		}
		json.NewDecoder(r.Body).Decode(&got)
		w.Write([]byte(`{"message":{"role":"assistant","content":"<think>hmm</think>\n- Hit B"}}`))
	})
	text, model, err := New().Write(context.Background(), Config{Provider: "ollama", URL: url}, "sys", "facts")
	if err != nil {
		t.Fatal(err)
	}
	if text != "- Hit B" || model != "llama3.1:8b" {
		t.Fatalf("text %q model %q", text, model)
	}
	if got["stream"] != false || got["model"] != "llama3.1:8b" {
		t.Fatalf("body %v", got)
	}
	msgs := got["messages"].([]any)
	if msgs[0].(map[string]any)["content"] != "sys" || msgs[1].(map[string]any)["content"] != "facts" {
		t.Fatalf("messages %v", msgs)
	}
}

func TestWriteWithAKey(t *testing.T) {
	url := fake(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("path %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer "+key {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"Main points"}}]}`))
	})
	text, model, err := New().Write(context.Background(), Config{Provider: "groq", Key: key, URL: url, Model: "mixtral"}, "sys", "facts")
	if err != nil || text != "Main points" || model != "mixtral" {
		t.Fatalf("%q %q %v", text, model, err)
	}
	_, _, err = New().Write(context.Background(), Config{Provider: "groq", Key: "gsk_wrong_key_123456", URL: url}, "sys", "facts")
	if Code(err) != CodeBadKey || strings.Contains(err.Error(), "gsk_") {
		t.Fatalf("err %v", err)
	}
}

func TestWriteErrors(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		cfg    Config
		code   string
	}{
		{"no provider", 0, "", Config{}, CodeOff},
		{"no key", 0, "", Config{Provider: "openrouter"}, CodeOff},
		{"busy", 429, "", Config{Provider: "groq", Key: key}, CodeRateLimited},
		{"no model", 404, `{"error":"model 'x' not found"}`, Config{Provider: "ollama", Model: "x"}, CodeNoModel},
		{"broken", 500, "", Config{Provider: "groq", Key: key}, CodeFailed},
		{"empty", 200, `{"choices":[]}`, Config{Provider: "groq", Key: key}, CodeFailed},
	}
	for _, c := range cases {
		url := fake(t, func(w http.ResponseWriter, r *http.Request) {
			io.Copy(io.Discard, r.Body)
			w.WriteHeader(c.status)
			w.Write([]byte(c.body))
		})
		if c.cfg.Provider != "" {
			c.cfg.URL = url
		}
		_, _, err := New().Write(context.Background(), c.cfg, "s", "u")
		if Code(err) != c.code {
			t.Errorf("%s: %v, want %s", c.name, err, c.code)
		}
	}
	// Nothing listening.
	_, _, err := New().Write(context.Background(), Config{Provider: "ollama", URL: "http://127.0.0.1:1"}, "s", "u")
	if Code(err) != CodeUnreachable || !strings.Contains(err.Error(), "Ollama is not running") {
		t.Fatalf("err %v", err)
	}
}

func TestModels(t *testing.T) {
	url := fake(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"models":[{"name":"llama3.1:8b"},{"name":"qwen2.5:7b"}]}`))
	})
	got, err := New().Models(context.Background(), Config{Provider: "ollama", URL: url})
	if err != nil || strings.Join(got, ",") != "llama3.1:8b,qwen2.5:7b" {
		t.Fatalf("%v %v", got, err)
	}
	if got, _ := New().Models(context.Background(), Config{Provider: "groq"}); got != nil {
		t.Fatalf("groq models %v", got)
	}
}

func TestValidURL(t *testing.T) {
	for s, want := range map[string]bool{
		"http://127.0.0.1:11434": true,
		"https://box.lan":        true,
		"file:///etc/passwd":     false,
		"http://user:pw@host":    false,
		"127.0.0.1:11434":        false,
		"":                       false,
	} {
		if ValidURL(s) != want {
			t.Errorf("%q", s)
		}
	}
}
