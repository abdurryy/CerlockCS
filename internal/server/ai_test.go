package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const groqKey = "gsk_live_9f8e7d6c5b4a3210"

func newAIServer(t *testing.T, api string) (*Server, http.Handler) {
	t.Helper()
	s, err := New(Config{DataDir: t.TempDir(), Offline: true, Workers: 1, AIAPI: api})
	if err != nil {
		t.Fatal(err)
	}
	return s, s.Handler()
}

func TestAISettingsKeepTheKeyOnTheServer(t *testing.T) {
	s, h := newAIServer(t, "")
	rec := send(h, "PUT", "/api/settings", `{"ai":{"provider":"groq","model":"llama-3.3-70b-versatile","key":"`+groqKey+`"}}`, "Content-Type", "application/json")
	if rec.Code != 200 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), groqKey) {
		t.Fatal("the key came back")
	}
	v := readSettings(t, rec)
	if v.AI.Provider != "groq" || !v.AI.Keys["groq"].Saved || v.AI.Keys["groq"].Hint != "...3210" || v.AI.Keys["openrouter"].Saved {
		t.Fatalf("view %+v", v.AI)
	}
	get := send(h, "GET", "/api/settings", "")
	if strings.Contains(get.Body.String(), groqKey) {
		t.Fatal("the key came back")
	}
	// Switching to Ollama keeps the Groq key for later.
	send(h, "PUT", "/api/settings", `{"ai":{"provider":"ollama","model":"","url":"http://192.168.1.20:11434"}}`, "Content-Type", "application/json")
	if d := s.settings.get(); d.AIKeys["groq"] != groqKey || d.AIURL != "http://192.168.1.20:11434" {
		t.Fatalf("saved %+v", d)
	}
	b, _ := os.ReadFile(filepath.Join(s.cfg.DataDir, "settings.json"))
	if !strings.Contains(string(b), groqKey) {
		t.Fatal("not saved to disk")
	}
	// Removing it.
	send(h, "PUT", "/api/settings", `{"ai":{"provider":"groq","key":""}}`, "Content-Type", "application/json")
	if d := s.settings.get(); d.AIKeys["groq"] != "" {
		t.Fatal("key still there")
	}
}

func TestAISettingsRefuseBadInput(t *testing.T) {
	_, h := newAIServer(t, "")
	for _, body := range []string{
		`{"ai":{"provider":"skynet"}}`,
		`{"ai":{"provider":"ollama","model":"a b; rm"}}`,
		`{"ai":{"provider":"ollama","url":"file:///etc/passwd"}}`,
		`{"ai":{"provider":"ollama","key":"` + groqKey + `"}}`,
		`{"ai":{"provider":"groq","key":"short"}}`,
	} {
		if rec := send(h, "PUT", "/api/settings", body, "Content-Type", "application/json"); rec.Code != 400 {
			t.Errorf("%s: status %d", body, rec.Code)
		}
	}
	if rec := send(h, "PUT", "/api/settings", `{"ai":{"provider":"groq"}}`, "Content-Type", "application/json", "Origin", "https://evil.example"); rec.Code != 403 {
		t.Fatalf("other site: status %d", rec.Code)
	}
}

func TestAIWrite(t *testing.T) {
	var prompt string
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+groqKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body struct {
			Messages []struct{ Content string } `json:"messages"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		prompt = body.Messages[0].Content + "\n---\n" + body.Messages[1].Content
		w.Write([]byte(`{"choices":[{"message":{"content":"Main points\n- Hit B"}}]}`))
	}))
	defer fake.Close()
	_, h := newAIServer(t, fake.URL)

	// Not set up yet.
	rec := send(h, "POST", "/api/ai/write", `{"facts":"Your T side"}`, "Content-Type", "application/json")
	if rec.Code != 400 || errorCode(rec) != "ai_off" {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	send(h, "PUT", "/api/settings", `{"ai":{"provider":"groq","key":"`+groqKey+`"}}`, "Content-Type", "application/json")
	rec = send(h, "POST", "/api/ai/write", `{"facts":"Your T side: hit B"}`, "Content-Type", "application/json")
	if rec.Code != 200 {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	var out struct{ Text, Model, Provider string }
	json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Text != "Main points\n- Hit B" || out.Provider != "Groq" || out.Model != "llama-3.3-70b-versatile" {
		t.Fatalf("out %+v", out)
	}
	if !strings.Contains(prompt, "Use only the facts given") || !strings.HasSuffix(prompt, "Your T side: hit B") {
		t.Fatalf("prompt %q", prompt)
	}
	if rec := send(h, "POST", "/api/ai/write", `{"facts":""}`, "Content-Type", "application/json"); rec.Code != 400 {
		t.Fatalf("empty facts: %d", rec.Code)
	}
	if rec := send(h, "POST", "/api/ai/write", `{"facts":"x"}`, "Content-Type", "application/json", "Origin", "https://evil.example"); rec.Code != 403 {
		t.Fatalf("other site: %d", rec.Code)
	}
}

func TestAIWriteBadKey(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer fake.Close()
	_, h := newAIServer(t, fake.URL)
	send(h, "PUT", "/api/settings", `{"ai":{"provider":"openrouter","key":"`+groqKey+`"}}`, "Content-Type", "application/json")
	rec := send(h, "POST", "/api/ai/write", `{"facts":"x"}`, "Content-Type", "application/json")
	if rec.Code != 400 || errorCode(rec) != "ai_bad_key" || strings.Contains(rec.Body.String(), groqKey) {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
}
