package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/presenter"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

func (s *Server) GetState(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(presenter.StatePayload(s.orchestrator.Snapshot()))
}

func (s *Server) GetIssues(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	statesParam := query.Get("states")
	projectID := query.Get("project_id")
	assigneeID := query.Get("assignee_id")

	filter := tracker.IssueFilter{
		ProjectID:  projectID,
		AssigneeID: assigneeID,
	}

	if statesParam != "" {
		filter.States = strings.Split(statesParam, ",")
	}

	issues, err := s.orchestrator.ListIssues(r.Context(), filter)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "fetch_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"issues": issues})
}

func (s *Server) GetSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "query parameter q is required")
		return
	}

	issues, err := s.orchestrator.SearchIssues(r.Context(), query)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "search_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"issues": issues})
}

func (s *Server) PostIssue(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		State       string `json:"state"`
		Priority    int    `json:"priority"`
		AssigneeID  string `json:"assignee_id"`
		ProjectID   string `json:"project_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		s.logger.Error().Err(err).Msg("failed to decode post issue body")
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}

	s.logger.Info().
		Str("title", body.Title).
		Str("state", body.State).
		Str("project_id", body.ProjectID).
		Msg("creating new issue")

	issue, err := s.orchestrator.CreateIssue(r.Context(), body.Title, body.Description, body.State, body.Priority, body.AssigneeID, body.ProjectID)
	if err != nil {
		s.logger.Error().Err(err).Msg("orchestrator failed to create issue")
		writeJSONError(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}

	s.logger.Info().Str("id", issue.ID).Str("identifier", issue.Identifier).Msg("issue created successfully")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(issue)
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
	
	// If not in memory (not running/retrying), try to fetch from tracker
	if !ok {
		issues, err := s.orchestrator.SearchIssues(r.Context(), identifier)
		if err != nil || len(issues) == 0 {
			writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue not found in memory or tracker")
			return
		}
		issue := issues[0]
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"issue_id":         issue.ID,
			"issue_identifier": issue.Identifier,
			"title":            issue.Title,
			"description":      issue.Description,
			"state":            issue.State,
			"assignee_id":      issue.AssigneeID,
			"priority":         issue.Priority,
			"project_id":       issue.ProjectID,
			"status":           "idle",
			"attempts": map[string]any{
				"restart_count":         0,
				"current_retry_attempt": 0,
			},
			"recent_events": []any{},
			"logs": map[string]any{
				"codex_session_logs": []map[string]any{
					{
						"label": "latest",
						"path":  "",
						"url":   nil,
					},
				},
			},
		})
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

func (s *Server) PatchIssue(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	var updates map[string]any
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}

	issue, err := s.orchestrator.UpdateIssue(r.Context(), identifier, updates)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}

	if issue == nil {
		writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue not found")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(issue)
}

func (s *Server) GetIssueLogs(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	runtime, ok := s.orchestrator.LookupIssue(identifier)
	if !ok || runtime.Running == nil || runtime.Running.SessionLogPath == "" {
		writeJSONError(w, http.StatusNotFound, "logs_not_found", "no active logs found for this issue")
		return
	}

	http.ServeFile(w, r, runtime.Running.SessionLogPath)
}

func (s *Server) GetArtifacts(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	artifacts, err := s.orchestrator.ListArtifacts(identifier)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"artifacts": artifacts})
}

func (s *Server) GetArtifactContent(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	relPath := chi.URLParam(r, "*")
	if relPath == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "artifact path is required")
		return
	}

	content, err := s.orchestrator.GetArtifactContent(identifier, relPath)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "fetch_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func (s *Server) GetIssueDiff(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	diff, err := s.orchestrator.GetDiff(identifier)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "diff_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(diff))
}

func (s *Server) GetAgentConfig(w http.ResponseWriter, _ *http.Request) {
	commands, provider := s.orchestrator.GetAgentConfig()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"commands":       commands,
		"agent_provider": provider,
	})
}

func (s *Server) DeleteIssueSession(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	runtime, ok := s.orchestrator.LookupIssue(identifier)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue not found")
		return
	}

	if stopped := s.orchestrator.StopSession(runtime.IssueID); !stopped {
		writeJSONError(w, http.StatusConflict, "no_active_session", "no active session to stop")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) GetAgents(w http.ResponseWriter, _ *http.Request) {
	providers := s.orchestrator.GetProviders()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"agents": providers,
	})
}

func (s *Server) PostAgentConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Commands      map[string]string `json:"commands"`
		AgentProvider string            `json:"agent_provider"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}

	s.orchestrator.UpdateAgentConfig(body.Commands, body.AgentProvider)
	w.WriteHeader(http.StatusNoContent)
}
