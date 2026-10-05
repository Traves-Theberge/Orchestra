package api

import (
	"context"
	"errors"
	"net/http"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacelifecycle"
)

type removeProjectWorktreeRequest struct {
	RequestID string `json:"request_id"`
}

func (s *Server) DeleteProjectWorktree(w http.ResponseWriter, r *http.Request) {
	if s.worktreeRemovals == nil || s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "worktree_removal_unavailable", "Workspace removal controls are unavailable")
		return
	}
	var req removeProjectWorktreeRequest
	if !decodeChat(w, r, &req) {
		return
	}
	projectID := chi.URLParam(r, "project_id")
	workspaceID := chi.URLParam(r, "workspace_id")
	var releaseOrchestrator, releaseTerminal func()
	var beginOnce sync.Once
	var beginErr error
	defer func() {
		if releaseTerminal != nil {
			releaseTerminal()
		}
		if releaseOrchestrator != nil {
			releaseOrchestrator()
		}
	}()

	busyCheck := func(ctx context.Context, project string, target workspace.GitWorktree) error {
		beginOnce.Do(func() {
			if s.orchestrator == nil {
				beginErr = workspacelifecycle.ErrBusy
				return
			}
			releaseOrchestrator, beginErr = s.orchestrator.BeginWorkspaceRemoval(project, target.Path)
			if beginErr != nil {
				beginErr = errors.Join(workspacelifecycle.ErrBusy, beginErr)
				return
			}
			if s.termManager == nil {
				beginErr = workspacelifecycle.ErrBusy
				return
			}
			releaseTerminal, beginErr = s.termManager.BeginDirectoryRemoval(target.Path)
			if beginErr != nil {
				beginErr = errors.Join(workspacelifecycle.ErrBusy, beginErr)
			}
		})
		if beginErr != nil {
			return beginErr
		}
		return s.activeNativeWorkspace(ctx, project, workspaceID, target.Path)
	}

	receipt, err := s.worktreeRemovals.Remove(r.Context(), projectID, workspaceID, req.RequestID, busyCheck)
	if err != nil {
		s.writeWorktreeRemovalError(w, err)
		return
	}
	status := http.StatusOK
	if receipt.Status == "unknown" || receipt.Status == "pending" {
		status = http.StatusAccepted
	}
	writeJSON(w, status, map[string]any{"removal": receipt})
}

func (s *Server) GetProjectWorktreeRemoval(w http.ResponseWriter, r *http.Request) {
	if s.worktreeRemovals == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "worktree_removal_unavailable", "Workspace removal controls are unavailable")
		return
	}
	receipt, err := s.worktreeRemovals.Get(r.Context(), chi.URLParam(r, "project_id"), chi.URLParam(r, "request_id"))
	if err != nil {
		s.writeWorktreeRemovalError(w, err)
		return
	}
	status := http.StatusOK
	if receipt.Status == "unknown" || receipt.Status == "pending" {
		status = http.StatusAccepted
	}
	writeJSON(w, status, map[string]any{"removal": receipt})
}

func (s *Server) writeWorktreeRemovalError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, workspacelifecycle.ErrInvalid):
		writeJSONError(w, http.StatusBadRequest, "invalid_worktree_removal", err.Error())
	case errors.Is(err, workspacelifecycle.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, "worktree_not_found", err.Error())
	case errors.Is(err, workspacelifecycle.ErrConflict):
		writeJSONError(w, http.StatusConflict, "worktree_removal_conflict", err.Error())
	case errors.Is(err, workspacelifecycle.ErrProtected):
		writeJSONError(w, http.StatusConflict, "worktree_protected", err.Error())
	case errors.Is(err, workspacelifecycle.ErrBusy):
		writeJSONError(w, http.StatusConflict, "worktree_in_use", err.Error())
	case errors.Is(err, workspacelifecycle.ErrDirty):
		writeJSONError(w, http.StatusConflict, "worktree_has_changes", err.Error())
	case errors.Is(err, workspacelifecycle.ErrUnknown):
		writeJSON(w, http.StatusAccepted, map[string]any{"removal": map[string]any{"status": "unknown", "message": err.Error()}})
	default:
		writeJSONError(w, http.StatusInternalServerError, "worktree_removal_failed", "Workspace removal failed")
	}
}

func (s *Server) activeNativeWorkspace(ctx context.Context, projectID, workspaceID, path string) error {
	var sessionTable, bindingTable, requestTable int
	for _, table := range []struct {
		name string
		into *int
	}{{"workspace_chat_sessions", &sessionTable}, {"workspace_chat_workspaces", &bindingTable}, {"workspace_chat_requests", &requestTable}} {
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table.name).Scan(table.into); err != nil {
			return workspacelifecycle.ErrBusy
		}
	}
	if sessionTable == 0 {
		if s.workspaceChat != nil {
			return workspacelifecycle.ErrBusy
		}
		return nil
	}
	if bindingTable == 0 {
		return workspacelifecycle.ErrBusy
	}
	requestClause := ""
	if requestTable > 0 {
		requestClause = ` OR EXISTS (SELECT 1 FROM workspace_chat_requests r WHERE r.session_id=s.id AND r.status IN ('pending','sending','unknown'))`
	}
	query := `SELECT COUNT(*) FROM workspace_chat_sessions s JOIN workspace_chat_workspaces w ON w.session_id=s.id
		WHERE s.project_id=? AND w.workspace_id=? AND w.cwd=? AND (s.status IN ('running','stopping')` + requestClause + `)`
	var count int
	if err := s.db.QueryRowContext(ctx, query, projectID, workspaceID, path).Scan(&count); err != nil || count > 0 {
		return workspacelifecycle.ErrBusy
	}
	return nil
}
