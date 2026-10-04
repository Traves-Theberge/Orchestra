package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
)

func (s *Server) chatError(w http.ResponseWriter, err error) {
	code, status := "workspace_chat_failed", http.StatusInternalServerError
	message := "Workspace chat operation failed"
	switch {
	case errors.Is(err, workspacechat.ErrNotFound):
		code, status, message = "chat_not_found", 404, err.Error()
	case errors.Is(err, workspacechat.ErrForbidden):
		code, status, message = "unauthorized_project_path", 403, err.Error()
	case errors.Is(err, workspacechat.ErrBusy):
		code, status, message = "chat_busy", 409, err.Error()
	case errors.Is(err, workspacechat.ErrConflict):
		code, status, message = "chat_identity_conflict", 409, err.Error()
	case errors.Is(err, workspacechat.ErrInvalid):
		code, status, message = "invalid_chat_request", 400, err.Error()
	case errors.Is(err, workspacechat.ErrUnsupported):
		code, status, message = "chat_provider_unavailable", 422, err.Error()
	}
	writeJSONError(w, status, code, message)
}
func (s *Server) chatReady(w http.ResponseWriter) bool {
	if s.workspaceChat == nil {
		writeJSONError(w, 503, "workspace_chat_unavailable", "Workspace chat is unavailable")
		return false
	}
	return true
}
func decodeChat(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 128*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(v); err != nil {
		writeJSONError(w, 400, "invalid_json", "Invalid chat request body")
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeJSONError(w, 400, "invalid_json", "One JSON object is required")
		return false
	}
	return true
}
func (s *Server) GetWorkspaceChatProviders(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	v, err := s.workspaceChat.Providers(r.Context(), chi.URLParam(r, "project_id"))
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"providers": v})
}
func (s *Server) GetWorkspaceChatModels(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	v, err := s.workspaceChat.Models(r.Context(), chi.URLParam(r, "project_id"), chi.URLParam(r, "provider"))
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (s *Server) GetWorkspaceChatSessions(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	v, err := s.workspaceChat.List(r.Context(), chi.URLParam(r, "project_id"))
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"sessions": v})
}
func (s *Server) PostWorkspaceChatSession(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var req workspacechat.CreateRequest
	if !decodeChat(w, r, &req) {
		return
	}
	v, err := s.workspaceChat.CreateWithRequest(r.Context(), chi.URLParam(r, "project_id"), req)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 201, v)
}
func (s *Server) GetWorkspaceChatSession(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var after int64
	if raw := r.URL.Query().Get("after"); raw != "" {
		var e error
		after, e = strconv.ParseInt(raw, 10, 64)
		if e != nil || after < 0 {
			s.chatError(w, workspacechat.ErrInvalid)
			return
		}
	}
	v, err := s.workspaceChat.DetailAfter(r.Context(), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), after)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 200, v)
}

func (s *Server) PostWorkspaceChatReply(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var req workspacechat.ReplyRequest
	if !decodeChat(w, r, &req) {
		return
	}
	requestID := chi.URLParam(r, "request_id")
	// Chi matches RawPath when present. Provider IDs are opaque and the browser
	// escapes them as one path segment, so decode exactly once in that case.
	if r.URL.RawPath != "" {
		var err error
		requestID, err = url.PathUnescape(requestID)
		if err != nil {
			s.chatError(w, workspacechat.ErrInvalid)
			return
		}
	}
	v, err := s.workspaceChat.Reply(r.Context(), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), requestID, req)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (s *Server) PostWorkspaceChatMessage(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var req workspacechat.SendRequest
	if !decodeChat(w, r, &req) {
		return
	}
	v, err := s.workspaceChat.Send(r.Context(), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), req)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 202, v)
}
func (s *Server) PostWorkspaceChatStop(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	v, err := s.workspaceChat.Stop(r.Context(), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"))
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"session": v})
}
