package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/presenter"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"github.com/orchestra/orchestra/apps/backend/internal/mcp"
	githubutils "github.com/orchestra/orchestra/apps/backend/internal/utils/github"
)

func (s *Server) CreateGitHubPR(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	s.logger.Info().Str("issue_identifier", identifier).Msg("received request to create github pull request")
	
	var body struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		Head  string `json:"head"`
		Base  string `json:"base"`
		Owner string `json:"owner"`
		Repo  string `json:"repo"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}

	// Default to project-level settings if missing in request
	if body.Owner == "" && body.Repo == "" {
		parts := strings.Split(s.config.TrackerEndpoint, "/")
		if len(parts) == 2 {
			body.Owner = parts[0]
			body.Repo = parts[1]
		}
	}
	if body.Token == "" {
		body.Token = s.config.TrackerToken
	}
	
	if body.Owner == "" || body.Repo == "" || body.Token == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_params", "owner, repo, and token are required (could not be inferred from config)")
		return
	}

	pr, err := githubutils.CreatePullRequest(r.Context(), body.Owner, body.Repo, body.Token, githubutils.PRRequest{
		Title: body.Title,
		Body:  body.Body,
		Head:  body.Head,
		Base:  body.Base,
	})
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "pr_creation_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(pr)
}

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
		Title         string   `json:"title"`
		Description   string   `json:"description"`
		State         string   `json:"state"`
		Priority      int      `json:"priority"`
		AssigneeID    string   `json:"assignee_id"`
		ProjectID     string   `json:"project_id"`
		Provider      string   `json:"provider"`
		DisabledTools []string `json:"disabled_tools"`
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

	issue, err := s.orchestrator.CreateIssue(r.Context(), body.Title, body.Description, body.State, body.Priority, body.AssigneeID, body.ProjectID, body.Provider, body.DisabledTools)
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

		logPath := ""
		if wsPath, err := workspace.WorkspacePath(s.workspaceRoot, issue.Identifier, ""); err == nil {
			logPath = filepath.Join(wsPath, "_logs", issue.Identifier, "latest.log")
		}

		history, _ := s.orchestrator.GetHistory(r.Context(), issue.ID)

		json.NewEncoder(w).Encode(map[string]any{
			"issue_id":         issue.ID,
			"issue_identifier": issue.Identifier,
			"title":            issue.Title,
			"description":      issue.Description,
			"state":            issue.State,
			"assignee_id":      issue.AssigneeID,
			"priority":         issue.Priority,
			"project_id":       issue.ProjectID,
			"branch_name":      issue.BranchName,
			"url":               issue.URL,
			"labels":            issue.Labels,
			"blocked_by":        issue.BlockedBy,
			"provider":          issue.Provider,
			"disabled_tools":    issue.DisabledTools,
			"created_at":        issue.CreatedAt,
			"updated_at":        issue.UpdatedAt,
			"status":           "idle",
			"history":          history,
			"attempts": map[string]any{
				"restart_count":         0,
				"current_retry_attempt": 0,
			},
			"recent_events": []any{},
			"logs": map[string]any{
				"codex_session_logs": []map[string]any{
					{
						"label": "latest",
						"path":  logPath,
						"url":   nil,
					},
				},
			},
		})
		return
	}

	runtime, _ := s.orchestrator.LookupIssue(identifier)

	// Fetch full issue details from tracker to ensure consistent response
	var issueDetails *tracker.Issue
	issues, err := s.orchestrator.SearchIssues(r.Context(), identifier)
	if err == nil && len(issues) > 0 {
		issueDetails = &issues[0]
	}

	restartCount := int64(0)
	currentRetryAttempt := int64(0)
	if runtime.Retry != nil {
		currentRetryAttempt = runtime.Retry.Attempt
	}
	recentEvents := make([]map[string]any, 0, 1)
	if runtime.Running != nil && runtime.Running.LastEvent != "" {
		recentEvents = append(recentEvents, map[string]any{
			"at":      runtime.Running.LastEventAt,
			"event":   runtime.Running.LastEvent,
			"message": runtime.Running.LastMessage,
		})
	}

	workspacePath, workspaceErr := workspace.WorkspacePath(s.workspaceRoot, runtime.IssueIdentifier, "")
	if workspaceErr != nil {
		workspacePath = ""
	}

	lastError := ""
	if runtime.Retry != nil && runtime.Retry.Error != "" {
		lastError = runtime.Retry.Error
	}

	history, _ := s.orchestrator.FetchIssueHistory(r.Context(), runtime.IssueID)

	presented["history"] = history
	presented["workspace_path"] = workspacePath

	// Build consistent response with all fields from tracker when available
	response := map[string]any{
		"id":               runtime.IssueID,
		"issue_id":         runtime.IssueID,
		"identifier":       runtime.IssueIdentifier,
		"issue_identifier": runtime.IssueIdentifier,
		"title":            "",
		"description":      "",
		"state":            "",
		"assignee_id":      "",
		"priority":         0,
		"project_id":       "",
		"branch_name":      "",
		"url":              "",
		"labels":           []string{},
		"blocked_by":       []tracker.Blocker{},
		"provider":         "",
		"disabled_tools":   []string{},
		"created_at":       "",
		"updated_at":       "",
		"status":           presented["status"],
		"attempts": map[string]any{
			"restart_count":         restartCount,
			"current_retry_attempt": currentRetryAttempt,
		},
		"workspace": map[string]any{
			"path": workspacePath,
		},
		"running":       presented["running"],
		"retry":         presented["retry"],
		"recent_events": recentEvents,
		"last_error":    lastError,
		"tracked":       map[string]any{},
	}

	// Merge tracker issue details if available
	if issueDetails != nil {
		response["title"] = issueDetails.Title
		response["description"] = issueDetails.Description
		response["state"] = issueDetails.State
		response["assignee_id"] = issueDetails.AssigneeID
		response["priority"] = issueDetails.Priority
		response["project_id"] = issueDetails.ProjectID
		response["branch_name"] = issueDetails.BranchName
		response["url"] = issueDetails.URL
		if issueDetails.Labels != nil {
			response["labels"] = issueDetails.Labels
		}
		if issueDetails.BlockedBy != nil {
			response["blocked_by"] = issueDetails.BlockedBy
		}
		response["provider"] = issueDetails.Provider
		if issueDetails.DisabledTools != nil {
			response["disabled_tools"] = issueDetails.DisabledTools
		}
		response["created_at"] = issueDetails.CreatedAt
		response["updated_at"] = issueDetails.UpdatedAt
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

func (s *Server) GetIssueHistory(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	runtime, ok := s.orchestrator.LookupIssue(identifier)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue not found")
		return
	}

	history, err := s.orchestrator.GetHistory(r.Context(), runtime.IssueID)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "history_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"history": history})
}

func (s *Server) GetIssueLogs(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	runtime, ok := s.orchestrator.LookupIssue(identifier)

	logPath := ""
	if ok && runtime.Running != nil && runtime.Running.SessionLogPath != "" {
		logPath = runtime.Running.SessionLogPath
	} else {
		// Try fallback to disk in the global logs directory
		logPath = filepath.Join(s.workspaceRoot, "_logs", identifier, "latest.log")
	}

	// Check if log file exists
	if logPath == "" {
		writeJSONError(w, http.StatusNotFound, "logs_not_found", "no logs found for this issue")
		return
	}

	// Check if file actually exists
	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		// Return empty logs response instead of 404 for issues that haven't started
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("# No logs available yet\n\nThis issue hasn't started processing or logs haven't been created."))
		return
	}

	http.ServeFile(w, r, logPath)
}

func (s *Server) GetArtifacts(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	provider := r.URL.Query().Get("provider")
	artifacts, err := s.orchestrator.ListArtifacts(identifier, provider)
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
	provider := r.URL.Query().Get("provider")
	if relPath == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "artifact path is required")
		return
	}

	content, err := s.orchestrator.GetArtifactContent(identifier, provider, relPath)
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
	provider := r.URL.Query().Get("provider")
	diff, err := s.orchestrator.GetDiff(identifier, provider)
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
	provider := r.URL.Query().Get("provider")
	
	runtime, ok := s.orchestrator.LookupIssue(identifier)
	if !ok {
		writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue not found")
		return
	}

	// If provider is specified, stop only that one. Otherwise stop all for this issue.
	if provider != "" {
		if stopped := s.orchestrator.StopSession(runtime.IssueID, provider); !stopped {
			writeJSONError(w, http.StatusConflict, "no_active_session", "no active session for this provider to stop")
			return
		}
	} else {
		s.orchestrator.StopAllSessionsForIssue(runtime.IssueID)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) DeleteIssue(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	if err := s.orchestrator.DeleteIssue(r.Context(), identifier); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "delete_failed", err.Error())
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

func (s *Server) GetAgentConfigs(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("project_id")
	configs, err := s.orchestrator.ListAgentConfigs(projectID)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "configs_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"configs": configs,
	})
}

func (s *Server) PostAgentConfigNew(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Provider string      `json:"provider"`
		Type     string      `json:"type"` // "core", "skill", "mcp"
		Name     string      `json:"name"`
		Scope    string      `json:"scope"`
		Project  string      `json:"project_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}

	// Implementation detail: orchestrator resolves the directory and creates the file
	path, err := s.orchestrator.CreateAgentResource(body.Provider, body.Type, body.Name, body.Scope, body.Project)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{"path": path})
}

func (s *Server) PostAgentConfigUpdate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}

	if err := s.orchestrator.UpdateConfigByPath(body.Path, body.Content); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
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

func (s *Server) GetMCPTools(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	mcpReg := s.orchestrator.GetMCPRegistry()
	if mcpReg == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{"tools": []any{}})
		return
	}

	tools, err := mcpReg.ListTools(ctx)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "mcp_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"tools": tools,
	})
}

func (s *Server) GetMCPServers(w http.ResponseWriter, r *http.Request) {
	servers, err := s.db.ListMCPServers(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_failed", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"servers": servers})
}

func (s *Server) PostMCPServer(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string `json:"name"`
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}

	server, err := s.db.CreateMCPServer(r.Context(), body.Name, body.Command)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_failed", err.Error())
		return
	}

	// Hot reload orchestrator
	snapshot := s.orchestrator.Snapshot()
	allServers := snapshot.MCPServers
	if allServers == nil {
		allServers = make(map[string]string)
	}
	allServers[body.Name] = body.Command
	
	// Create fresh registry
	newReg := mcp.NewRegistry(allServers, s.logger)
	newReg.StartAll(r.Context())
	s.orchestrator.SetMCPRegistry(newReg, allServers)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(server)
}

func (s *Server) DeleteMCPServer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.db.DeleteMCPServer(r.Context(), id); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_failed", err.Error())
		return
	}

	// Reload all from DB + config to sync orchestrator
	// Simplest: just tell user to restart OR implement full sync
	// Let's implement sync
	dbServers, _ := s.db.ListMCPServers(r.Context())
	allServers := make(map[string]string)
	for k, v := range s.config.MCPServers {
		allServers[k] = v
	}
	for _, s := range dbServers {
		allServers[s.Name] = s.Command
	}

	newReg := mcp.NewRegistry(allServers, s.logger)
	newReg.StartAll(r.Context())
	s.orchestrator.SetMCPRegistry(newReg, allServers)

	w.WriteHeader(http.StatusNoContent)
}
