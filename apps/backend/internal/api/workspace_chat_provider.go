package api

import (
	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
	"net/http"
)

func (s *Server) PatchWorkspaceChatProvider(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var req workspacechat.SwitchProviderRequest
	if !decodeChat(w, r, &req) {
		return
	}
	v, err := s.workspaceChat.SwitchProvider(chatContext(r), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), req)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 200, v)
}
