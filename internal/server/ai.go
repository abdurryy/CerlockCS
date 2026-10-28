package server

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/abdurryy/CerlockCS/internal/ai"
	"github.com/abdurryy/CerlockCS/internal/faceit"
)

// The facts of one map stay well under this.
const maxFacts = 48 << 10

// planPrompt tells the model what to do with the facts. It may only use
// what Cerlock measured.
const planPrompt = `You are an experienced CS2 coach. You get facts measured from demos of an opponent team: a game plan made from their rounds, their tendencies and their roles. Write a short game plan for the team that is about to play against them.

Rules:
- Use only the facts given. Never make up players, callouts, numbers, utility lineups or habits that are not in the facts.
- Keep numbers like "4 of 6" where they help, and say it when something rests on few rounds.
- Write callouts and player names exactly as they are in the facts.
- Plain, simple English, short sentences, no hype.
- Layout: a title line, then "Main points" with 3 to 5 bullets, then "Your T side" and "Your CT side" with short bullets grouped by their round type, then "Watch out" with 1 to 3 risks. Use "- " for bullets. No tables, no bold.
- At most 400 words.`

var aiStatus = map[string]int{
	ai.CodeOff:         http.StatusBadRequest,
	ai.CodeBadKey:      http.StatusBadRequest,
	ai.CodeNoModel:     http.StatusBadRequest,
	ai.CodeRateLimited: http.StatusTooManyRequests,
	ai.CodeUnreachable: http.StatusBadGateway,
	ai.CodeFailed:      http.StatusBadGateway,
}

// aiConfig is what the settings say, with Ollama's address only for
// Ollama.
func (s *Server) aiConfig() ai.Config {
	d := s.settings.get()
	cfg := ai.Config{Provider: d.AIProvider, Model: d.AIModel, Key: d.AIKeys[d.AIProvider]}
	if d.AIProvider == "ollama" {
		cfg.URL = d.AIURL
	}
	if s.cfg.AIAPI != "" {
		cfg.URL = s.cfg.AIAPI
	}
	return cfg
}

func aiError(w http.ResponseWriter, err error) {
	code := ai.Code(err)
	status, ok := aiStatus[code]
	if !ok {
		code, status = ai.CodeFailed, http.StatusBadGateway
	}
	codeError(w, status, code, err.Error())
}

// aiWrite writes the game plan up from the facts in the request.
func (s *Server) aiWrite(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Facts string `json:"facts"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	facts := strings.TrimSpace(body.Facts)
	if facts == "" || len(facts) > maxFacts {
		codeError(w, http.StatusBadRequest, faceit.CodeBadRequest, "Nothing to write up")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Minute)
	defer cancel()
	text, model, err := s.ai.Write(ctx, s.aiConfig(), planPrompt, facts)
	if err != nil {
		aiError(w, err)
		return
	}
	p, _ := ai.ProviderByID(s.aiConfig().Provider)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"text": text, "model": model, "provider": p.Name})
}

// aiModels lists the models Ollama has.
func (s *Server) aiModels(w http.ResponseWriter, r *http.Request) {
	if !sameSite(r) {
		codeError(w, http.StatusForbidden, faceit.CodeBadRequest, "Requests from other sites are not allowed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	models, err := s.ai.Models(ctx, s.aiConfig())
	if err != nil {
		aiError(w, err)
		return
	}
	if models == nil {
		models = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}
