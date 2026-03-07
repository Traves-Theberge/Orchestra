package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/presenter"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

func (s *Server) GetState(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(presenter.StatePayload(s.orchestrator.Snapshot()))
}

func (s *Server) PostRefresh(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(s.orchestrator.QueueRefresh())
}

func (s *Server) GetIssue(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	snapshot := s.orchestrator.Snapshot()
	presented, ok := presenter.IssuePayload(snapshot, identifier)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue is not tracked in memory")
		return
	}
	runtime, _ := s.orchestrator.LookupIssue(identifier)

	restartCount := int64(0)
	currentRetryAttempt := int64(0)
	if runtime.Retry != nil {
		currentRetryAttempt = runtime.Retry.Attempt
	}

	recentEvents := make([]map[string]any, 0, 1)
	logPath := ""
	if runtime.Running != nil && runtime.Running.LastEvent != "" {
		recentEvents = append(recentEvents, map[string]any{
			"at":      runtime.Running.LastEventAt,
			"event":   runtime.Running.LastEvent,
			"message": runtime.Running.LastMessage,
		})
		logPath = runtime.Running.SessionLogPath
	}

	workspacePath, workspaceErr := workspace.WorkspacePath(s.workspaceRoot, runtime.IssueIdentifier)
	if workspaceErr != nil {
		workspacePath = ""
	}

	var lastError any = nil
	if runtime.Retry != nil && runtime.Retry.Error != "" {
		lastError = map[string]any{
			"message": runtime.Retry.Error,
			"at":      runtime.Retry.DueAt,
		}
	}

	response := map[string]any{
		"issue_identifier": runtime.IssueIdentifier,
		"issue_id":         runtime.IssueID,
		"status":           presented["status"],
		"attempts": map[string]any{
			"restart_count":         restartCount,
			"current_retry_attempt": currentRetryAttempt,
		},
		"workspace": map[string]any{
			"path": workspacePath,
		},
		"running": presented["running"],
		"retry":   presented["retry"],
		"logs": map[string]any{
			"codex_session_logs": []map[string]any{
				{
					"label": "latest",
					"path":  logPath,
					"url":   nil,
				},
			},
		},
		"recent_events": recentEvents,
		"last_error":    lastError,
		"tracked":       map[string]any{},
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(response)
}
