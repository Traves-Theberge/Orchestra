package api

import (
	"github.com/go-chi/chi/v5"
	"net/http"
)

func (s *Server) DeleteWorkspaceChatSession(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	if err := s.workspaceChat.Delete(chatContext(r), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id")); err != nil {
		s.chatError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
