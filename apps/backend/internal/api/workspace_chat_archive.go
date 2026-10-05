package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
)

func (s *Server) PostWorkspaceChatArchive(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var req workspacechat.ArchiveRequest
	if !decodeChat(w, r, &req) {
		return
	}
	v, err := s.workspaceChat.Archive(chatContext(r), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), req)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": v})
}

func (s *Server) PostWorkspaceChatUnarchive(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var req workspacechat.ArchiveRequest
	if !decodeChat(w, r, &req) {
		return
	}
	v, err := s.workspaceChat.Unarchive(chatContext(r), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), req)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": v})
}

func (s *Server) GetWorkspaceChatArchives(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	workspaceID, cwd := r.URL.Query().Get("workspace_id"), r.URL.Query().Get("cwd")
	var v []workspacechat.Session
	var err error
	if workspaceID == "" && cwd == "" {
		v, err = s.workspaceChat.ArchivedCatalog(r.Context(), chi.URLParam(r, "project_id"))
	} else if workspaceID != "" && cwd != "" {
		v, err = s.workspaceChat.ArchivedList(r.Context(), chi.URLParam(r, "project_id"), workspaceID, cwd)
	} else {
		err = workspacechat.ErrInvalid
	}
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": v})
}

func (s *Server) GetWorkspaceChatArchiveHistory(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var after int64
	if raw := r.URL.Query().Get("after"); raw != "" {
		var err error
		after, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || after < 0 {
			s.chatError(w, workspacechat.ErrInvalid)
			return
		}
	}
	v, err := s.workspaceChat.ArchivedDetailAfter(r.Context(), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), r.URL.Query().Get("workspace_id"), r.URL.Query().Get("cwd"), after)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}
