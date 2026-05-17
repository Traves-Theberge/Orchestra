package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/studio"
)

// PostStudioSession starts a new studio session.
// POST /api/v1/studio/sessions  body: studio.StartSessionRequest
func (s *Server) PostStudioSession(w http.ResponseWriter, r *http.Request) {
	if s.studioMgr == nil {
		http.Error(w, "studio not configured", http.StatusServiceUnavailable)
		return
	}
	var req studio.StartSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	sess, err := s.studioMgr.StartSession(r.Context(), req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"session_id": sess.ID,
		"sse_url":    "/api/v1/studio/sessions/" + sess.ID + "/events",
	})
}

// PostStudioSessionMessage forwards a message to the runner spawned for this session.
// POST /api/v1/studio/sessions/{id}/message  body: {"message": "..."}
func (s *Server) PostStudioSessionMessage(w http.ResponseWriter, r *http.Request) {
	if s.studioMgr == nil {
		http.Error(w, "studio not configured", http.StatusServiceUnavailable)
		return
	}
	id := chi.URLParam(r, "id")
	var req struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// Run the agent turn in the background so the HTTP request returns
	// immediately (202). The agent can take several minutes; tying it to the
	// request context would kill it when the 30 s router timeout fires.
	// Results arrive via SSE (chat.message / error events).
	go func() {
		_ = s.studioMgr.SendMessage(context.Background(), id, req.Message)
	}()
	w.WriteHeader(http.StatusAccepted)
}

// PostStudioSessionDraft applies field patches to a draft.
// POST /api/v1/studio/sessions/{id}/draft  body: {"title": "...", "description": "...", ...}
func (s *Server) PostStudioSessionDraft(w http.ResponseWriter, r *http.Request) {
	if s.studioMgr == nil {
		http.Error(w, "studio not configured", http.StatusServiceUnavailable)
		return
	}
	id := chi.URLParam(r, "id")
	var patch map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.studioMgr.ApplyDraftPatch(id, patch); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetStudioSessionDraft returns the current draft snapshot.
func (s *Server) GetStudioSessionDraft(w http.ResponseWriter, r *http.Request) {
	if s.studioMgr == nil {
		http.Error(w, "studio not configured", http.StatusServiceUnavailable)
		return
	}
	id := chi.URLParam(r, "id")
	snap, err := s.studioMgr.GetDraft(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snap)
}

// PostStudioSessionPush materializes the draft as a backlog issue.
func (s *Server) PostStudioSessionPush(w http.ResponseWriter, r *http.Request) {
	if s.studioMgr == nil {
		http.Error(w, "studio not configured", http.StatusServiceUnavailable)
		return
	}
	id := chi.URLParam(r, "id")
	issueID, err := s.studioMgr.Push(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"issue_id": issueID})
}

// DeleteStudioSession discards a session.
func (s *Server) DeleteStudioSession(w http.ResponseWriter, r *http.Request) {
	if s.studioMgr == nil {
		http.Error(w, "studio not configured", http.StatusServiceUnavailable)
		return
	}
	id := chi.URLParam(r, "id")
	if err := s.studioMgr.Discard(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetStudioSessionEvents is an SSE endpoint streaming studio events for the session.
func (s *Server) GetStudioSessionEvents(w http.ResponseWriter, r *http.Request) {
	if s.studioMgr == nil || s.pubsub == nil {
		http.Error(w, "studio not configured", http.StatusServiceUnavailable)
		return
	}
	id := chi.URLParam(r, "id")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, unsubscribe := s.pubsub.Subscribe(32)
	defer unsubscribe()

	prefix := "studio." + id

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-ch:
			if !ok {
				return
			}
			// Filter to events for this session only.
			if ev.Type != prefix && !startsWithDotPrefix(ev.Type, prefix) {
				continue
			}
			b, _ := json.Marshal(ev)
			_, _ = w.Write([]byte("data: "))
			_, _ = w.Write(b)
			_, _ = w.Write([]byte("\n\n"))
			flusher.Flush()
		}
	}
}

// startsWithDotPrefix returns true if s starts with prefix+"." — used to allow
// future sub-types (e.g. "studio.<id>.detail").
func startsWithDotPrefix(s, prefix string) bool {
	if len(s) <= len(prefix) {
		return false
	}
	return s[:len(prefix)] == prefix && s[len(prefix)] == '.'
}

// PostStudioSessionApplyTemplate applies a template to a session's draft mid-session.
func (s *Server) PostStudioSessionApplyTemplate(w http.ResponseWriter, r *http.Request) {
	if s.studioMgr == nil {
		http.Error(w, "studio not configured", http.StatusServiceUnavailable)
		return
	}
	id := chi.URLParam(r, "id")
	var req struct {
		Name string            `json:"name"`
		Vars map[string]string `json:"vars"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	if err := s.studioMgr.ApplyTemplate(id, req.Name, req.Vars); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
