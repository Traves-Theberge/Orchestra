package api

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
)

// Rewind routes may restore files in a large folder, which takes longer than
// an ordinary request; they get rewindRequestTimeout instead of the global one.
const (
	globalRequestTimeoutDuration = 30 * time.Second
	rewindRequestTimeout         = 90 * time.Second
	maxListedRestoreFailures     = 5
)

var rewindPath = regexp.MustCompile(`^/api/v1/(projects/[^/]+|orchestrator)/chat/sessions/[^/]+/(rewind/preview|edit|regenerate|restore/undo|branches/[^/]+/activate)$`)

// globalRequestTimeout is the router-wide timeout, skipping the rewind routes
// so their longer timeout is not cut short by it.
func globalRequestTimeout(next http.Handler) http.Handler {
	limited := middleware.Timeout(globalRequestTimeoutDuration)(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if rewindPath.MatchString(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		limited.ServeHTTP(w, r)
	})
}

type rewindPreviewRequest struct {
	MessageID string `json:"message_id"`
}

type activateBranchRequest struct {
	RestoreFiles bool `json:"restore_files"`
}

// restoreFailureMessage names the first few unrestored paths with their reasons.
func restoreFailureMessage(e *workspacechat.RestoreError) string {
	msg := "The files could not all be restored"
	if e.Err != nil {
		msg += " (" + e.Err.Error() + ")"
	}
	if len(e.Failed) == 0 {
		return msg + "."
	}
	shown := e.Failed
	if len(shown) > maxListedRestoreFailures {
		shown = shown[:maxListedRestoreFailures]
	}
	items := make([]string, 0, len(shown))
	for _, f := range shown {
		items = append(items, fmt.Sprintf("%s (%s)", f.Path, f.Reason))
	}
	msg += ": " + strings.Join(items, "; ")
	if more := len(e.Failed) - len(shown); more > 0 {
		msg += fmt.Sprintf("; and %d more", more)
	}
	return msg + "."
}

// rewindError maps the rewind-specific errors; ok is false for any other.
func rewindError(err error) (code string, status int, message string, ok bool) {
	var restore *workspacechat.RestoreError
	var restored *workspacechat.FilesRestoredError
	switch {
	case errors.As(err, &restore):
		return "restore_partial", 409, restoreFailureMessage(restore), true
	case errors.As(err, &restored):
		return "files_restored", 409, fmt.Sprintf("The files were restored to the earlier state but the message was not sent (%v). Use \"Undo restore\" to bring the files back.", restored.Err), true
	case errors.Is(err, workspacechat.ErrCheckpointUnavailable):
		return "checkpoint_unavailable", 409, err.Error(), true
	}
	return "", 0, "", false
}

func (s *Server) PostWorkspaceChatRewindPreview(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var req rewindPreviewRequest
	if !decodeChat(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.MessageID) == "" {
		s.chatError(w, workspacechat.ErrInvalid)
		return
	}
	v, err := s.workspaceChat.PreviewRewind(chatContext(r), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), req.MessageID)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 200, v)
}

func (s *Server) PostWorkspaceChatEdit(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var req workspacechat.EditRequest
	if !decodeChat(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.MessageID) == "" {
		s.chatError(w, workspacechat.ErrInvalid)
		return
	}
	v, err := s.workspaceChat.Edit(chatContext(r), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), req)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 202, v)
}

func (s *Server) PostWorkspaceChatRegenerate(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var req workspacechat.RegenerateRequest
	if !decodeChat(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.MessageID) == "" {
		s.chatError(w, workspacechat.ErrInvalid)
		return
	}
	v, err := s.workspaceChat.Regenerate(chatContext(r), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), req)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 202, v)
}

func (s *Server) PostWorkspaceChatActivateBranch(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	var req activateBranchRequest
	if !decodeChat(w, r, &req) {
		return
	}
	v, err := s.workspaceChat.ActivateBranch(chatContext(r), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"), chi.URLParam(r, "branch_id"), req.RestoreFiles)
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 200, v)
}

func (s *Server) PostWorkspaceChatUndoRestore(w http.ResponseWriter, r *http.Request) {
	if !s.chatReady(w) {
		return
	}
	v, err := s.workspaceChat.UndoRestore(chatContext(r), chi.URLParam(r, "project_id"), chi.URLParam(r, "session_id"))
	if err != nil {
		s.chatError(w, err)
		return
	}
	writeJSON(w, 200, v)
}
