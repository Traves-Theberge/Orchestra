package api

import (
	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
	"net/http"
)

func (s *Server) PatchWorkspaceChatTitle(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var req workspacechat.RenameRequest
	if !decodeChat(w, r, &req) {
		return
	}
	v, err := s.workspaceChat.Rename(chatContext(r), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), req)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 200, v)
}
