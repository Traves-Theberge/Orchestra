package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/mcp"
	"github.com/orchestra/orchestra/apps/backend/internal/presenter"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/utils/git"
	githubutils "github.com/orchestra/orchestra/apps/backend/internal/utils/github"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

// statsCache provides a simple in-memory cache for warehouse stats with a TTL.
type statsCache struct {
	mu   sync.RWMutex
	data map[string]*cachedStats
}

type cachedStats struct {
	stats     *db.GlobalStats
	fetchedAt time.Time
}

const statsCacheTTL = 30 * time.Second

var globalStatsCache = &statsCache{data: make(map[string]*cachedStats)}

func (c *statsCache) get(key string) (*db.GlobalStats, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, ok := c.data[key]
	if !ok || time.Since(entry.fetchedAt) > statsCacheTTL {
		return nil, false
	}
	return entry.stats, true
}

func (c *statsCache) set(key string, stats *db.GlobalStats) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data[key] = &cachedStats{stats: stats, fetchedAt: time.Now()}
}

// CreateGitHubPR handles POST /api/v1/issues/{issue_identifier}/pr by creating
// a GitHub pull request. It attempts to infer owner, repo, and token from the
// associated project, global config, or the GitHub CLI.
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

	// Try to lookup issue to find project ID
	var projectID string
	issue, err := s.orchestrator.FetchIssueByIdentifier(r.Context(), identifier)
	if err == nil && issue != nil {
		projectID = issue.ProjectID
		if projectID != "" {
			project, err := s.db.GetProjectByID(r.Context(), projectID)
			if err == nil {
				if body.Owner == "" {
					body.Owner = project.GitHubOwner
				}
				if body.Repo == "" {
					body.Repo = project.GitHubRepo
				}
				if body.Token == "" && project.GitHubToken != "" {
					if resolved, err := s.resolveGitHubToken(r.Context(), project); err == nil {
						body.Token = resolved
					} else {
						s.logger.Warn().Err(err).Str("project_id", projectID).Msg("failed to resolve github token for PR creation")
						body.Token = project.GitHubToken // fall back to raw token
					}
				}

				// If still missing owner/repo, try to parse from remote URL
				if (body.Owner == "" || body.Repo == "") && project.RemoteURL != "" {
					if o, r, ok := git.ParseGitHubRemote(project.RemoteURL); ok {
						if body.Owner == "" {
							body.Owner = o
						}
						if body.Repo == "" {
							body.Repo = r
						}
					}
				}
			}
		}
	}

	// Fallback to global config if still missing
	if body.Owner == "" || body.Repo == "" {
		parts := strings.Split(s.config.TrackerEndpoint, "/")
		if len(parts) == 2 {
			if body.Owner == "" {
				body.Owner = parts[0]
			}
			if body.Repo == "" {
				body.Repo = parts[1]
			}
		}
	}

	// Fallback to global token
	if body.Token == "" {
		body.Token = s.config.TrackerToken
	}

	// NEW: Fallback to GitHub CLI token if still missing
	if body.Token == "" {
		cmd := exec.Command("gh", "auth", "token")
		if out, err := cmd.Output(); err == nil {
			token := strings.TrimSpace(string(out))
			if token != "" {
				s.logger.Info().Str("issue_identifier", identifier).Msg("using github cli token for pr creation")
				body.Token = token

				// Optional: Save this token back to the project for next time
				if projectID != "" {
					_ = s.updateProjectGitHubToken(r.Context(), projectID, token)
				}
			}
		}
	}

	if body.Owner == "" || body.Repo == "" || body.Token == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_params", "owner, repo, and token are required (could not be inferred from project, config, or GitHub CLI)")
		return
	}

	// Push the branch to the remote before creating the PR.
	// The worktree has local commits that GitHub doesn't know about yet.
	if projectID != "" && body.Head != "" {
		project, projErr := s.db.GetProjectByID(r.Context(), projectID)
		if projErr == nil && project.RootPath != "" {
			// Try pushing from the worktree first, then fall back to project root
			pushDir := project.RootPath
			if s.worktreeRoot != "" {
				wtPath := filepath.Join(s.worktreeRoot, projectID, body.Head)
				if info, statErr := os.Stat(wtPath); statErr == nil && info.IsDir() {
					pushDir = wtPath
				}
			}
			pushCmd := exec.CommandContext(r.Context(), "git", "push", "-u", "origin", body.Head)
			pushCmd.Dir = pushDir
			if pushOut, pushErr := pushCmd.CombinedOutput(); pushErr != nil {
				s.logger.Warn().Err(pushErr).Str("output", string(pushOut)).Str("branch", body.Head).Msg("regular push failed, retrying with --force-with-lease")
				// Retry with --force-with-lease: the branch may have stale history
				// from a previous dispatch (e.g., re-plan or re-execute cycle).
				forceCmd := exec.CommandContext(r.Context(), "git", "push", "--force-with-lease", "-u", "origin", body.Head)
				forceCmd.Dir = pushDir
				if forceOut, forceErr := forceCmd.CombinedOutput(); forceErr != nil {
					s.logger.Error().Err(forceErr).Str("output", string(forceOut)).Str("branch", body.Head).Msg("force push also failed — PR creation may fail")
				} else {
					s.logger.Info().Str("branch", body.Head).Msg("force-pushed branch to origin for PR creation")
				}
			} else {
				s.logger.Info().Str("branch", body.Head).Msg("pushed branch to origin for PR creation")
			}
		}
	}

	pr, err := githubutils.CreatePullRequest(r.Context(), body.Owner, body.Repo, body.Token, githubutils.PRRequest{
		Title: body.Title,
		Body:  body.Body,
		Head:  body.Head,
		Base:  body.Base,
	})
	if err != nil {
		// If a PR already exists for this branch, find and return it instead of failing.
		if strings.Contains(err.Error(), "A pull request already exists") {
			s.logger.Info().Str("head", body.Head).Msg("PR already exists for branch — looking up existing PR")
			existing, lookupErr := githubutils.FindPullRequestByHead(r.Context(), body.Owner, body.Repo, body.Token, body.Head)
			if lookupErr == nil && existing != nil {
				pr = existing
			} else {
				s.logger.Error().Err(lookupErr).Msg("failed to find existing PR")
				writeJSONError(w, http.StatusInternalServerError, "pr_creation_failed", fmt.Sprintf("pull request already exists but could not be found: %v", lookupErr))
				return
			}
		} else {
			s.logger.Error().Err(err).Str("owner", body.Owner).Str("repo", body.Repo).Str("head", body.Head).Msg("github PR creation failed")
			writeJSONError(w, http.StatusInternalServerError, "pr_creation_failed", fmt.Sprintf("pull request creation failed: %v", err))
			return
		}
	}

	// Store the PR URL on the issue so the inspector can display it.
	if pr.HTMLURL != "" {
		if _, updateErr := s.orchestrator.UpdateIssue(r.Context(), identifier, map[string]any{"pr_url": pr.HTMLURL}); updateErr != nil {
			s.logger.Warn().Err(updateErr).Str("issue_identifier", identifier).Msg("failed to store pr_url on issue")
		}
	}

	writeJSON(w, http.StatusCreated, pr)
}

// GetState handles GET /api/v1/state by returning the current orchestrator
// snapshot formatted by the presenter layer.
func (s *Server) GetState(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, presenter.StatePayload(s.orchestrator.Snapshot()))
}

// GetIssues handles GET /api/v1/issues by listing issues with optional
// filtering by state, project_id, and assignee_id, and pagination via
// limit/offset query parameters.
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
		writeJSONError(w, http.StatusInternalServerError, "fetch_failed", "failed to fetch data")
		return
	}

	// Optional pagination via limit/offset query params
	total := len(issues)
	if offsetStr := query.Get("offset"); offsetStr != "" {
		off, parseErr := strconv.Atoi(offsetStr)
		if parseErr == nil && off >= 0 {
			if off >= total {
				issues = nil
			} else {
				issues = issues[off:]
			}
		}
	}
	if limitStr := query.Get("limit"); limitStr != "" {
		if lim, parseErr := strconv.Atoi(limitStr); parseErr == nil && lim > 0 && lim < len(issues) {
			issues = issues[:lim]
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"issues": issues, "total": total})
}

// GetSearch handles GET /api/v1/search by performing a full-text search across
// issues using the "q" query parameter.
func (s *Server) GetSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "query parameter q is required")
		return
	}

	issues, err := s.orchestrator.SearchIssues(r.Context(), query)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "search_failed", "search failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"issues": issues})
}

// PostIssue handles POST /api/v1/issues by creating a new issue with the given
// title, description, state, priority, assignee, project, and provider.
func (s *Server) PostIssue(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title         string   `json:"title"`
		Description   string   `json:"description"`
		State         string   `json:"state"`
		Priority      int      `json:"priority"`
		AssigneeID    string   `json:"assignee_id"`
		ProjectID     string   `json:"project_id"`
		Provider      string   `json:"provider"`
		RuntimeTarget string   `json:"runtime_target"`
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

	issue, err := s.orchestrator.CreateIssue(r.Context(), body.Title, body.Description, body.State, body.Priority, body.AssigneeID, body.ProjectID, body.Provider, body.RuntimeTarget, body.DisabledTools)
	if err != nil {
		s.logger.Error().Err(err).Msg("orchestrator failed to create issue")
		writeJSONError(w, http.StatusInternalServerError, "create_failed", "creation failed")
		return
	}

	s.logger.Info().Str("id", issue.ID).Str("identifier", issue.Identifier).Msg("issue created successfully")

	writeJSON(w, http.StatusCreated, issue)
}

// PostRefresh handles POST /api/v1/refresh by queuing an orchestrator refresh
// cycle and returning immediately with HTTP 202 Accepted.
func (s *Server) PostRefresh(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusAccepted, s.orchestrator.QueueRefresh())
}

// GetIssue handles GET /api/v1/issues/{issue_identifier} by returning the full
// issue detail including runtime state, retry info, workspace path, history,
// and recent events. Falls back to tracker data if the issue is not in memory.
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

		logPath := ""
		if wsPath, err := workspace.WorkspacePath(s.workspaceRoot, issue.Identifier, ""); err == nil {
			logPath = filepath.Join(wsPath, "_logs", issue.Identifier, "latest.log")
		}

		history, _ := s.orchestrator.GetHistory(r.Context(), issue.ID)

		writeJSON(w, http.StatusOK, map[string]any{
			"issue_id":         issue.ID,
			"issue_identifier": issue.Identifier,
			"title":            issue.Title,
			"description":      issue.Description,
			"state":            issue.State,
			"assignee_id":      issue.AssigneeID,
			"priority":         issue.Priority,
			"project_id":       issue.ProjectID,
			"branch_name":      issue.BranchName,
			"url":              issue.URL,
			"labels":           issue.Labels,
			"blocked_by":       issue.BlockedBy,
			"provider":         issue.Provider,
			"disabled_tools":   issue.DisabledTools,
			"created_at":       issue.CreatedAt,
			"updated_at":       issue.UpdatedAt,
			"base_sha":         issue.BaseSHA,
			"feedback":         issue.Feedback,
			"pr_url":           issue.PRURL,
			"plan":             issue.Plan,
			"status":           "IDLE",
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

	logPath := ""
	if runtime.Running != nil && runtime.Running.SessionLogPath != "" {
		logPath = runtime.Running.SessionLogPath
	} else if workspacePath != "" {
		logPath = filepath.Join(workspacePath, "_logs", runtime.IssueIdentifier, "latest.log")
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
		"base_sha":         "",
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

	// Populate provider from running entry when available
	if runtime.Running != nil && runtime.Running.Provider != "" {
		response["provider"] = runtime.Running.Provider
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
		response["base_sha"] = issueDetails.BaseSHA
		response["feedback"] = issueDetails.Feedback
		response["pr_url"] = issueDetails.PRURL
		response["plan"] = issueDetails.Plan
	}

	writeJSON(w, http.StatusOK, response)
}

// validTransitions defines the allowed state changes for issues.
var validTransitions = map[string][]string{
	"Backlog":     {"Todo"},
	"Todo":        {"In Progress", "Backlog"},
	"In Progress": {"Review", "Backlog"},
	"Review":      {"Done", "Todo", "In Progress", "Backlog"},
	"Done":        {},
}

// lockedFields are fields that cannot be changed when an issue is not in Backlog.
var lockedFields = map[string]bool{
	"title":       true,
	"description": true,
	"project_id":  true,
	"assignee_id": true,
}

// validateStateTransition checks whether a state change is allowed and whether
// gating requirements are met. Returns an error string if invalid, or "" if ok.
func validateStateTransition(current, next string, issue *tracker.Issue, updates map[string]any) string {
	allowed, exists := validTransitions[current]
	if !exists {
		return fmt.Sprintf("unknown current state %q", current)
	}
	found := false
	for _, s := range allowed {
		if s == next {
			found = true
			break
		}
	}
	if !found {
		return fmt.Sprintf("transition from %q to %q is not allowed", current, next)
	}

	// Gate: Backlog → Todo requires title, description, assignee_id, project_id all non-empty
	if current == "Backlog" && next == "Todo" {
		title := issue.Title
		if v, ok := updates["title"].(string); ok {
			title = v
		}
		description := issue.Description
		if v, ok := updates["description"].(string); ok {
			description = v
		}
		assigneeID := issue.AssigneeID
		if v, ok := updates["assignee_id"].(string); ok {
			assigneeID = v
		}
		projectID := issue.ProjectID
		if v, ok := updates["project_id"].(string); ok {
			projectID = v
		}
		if title == "" || description == "" || assigneeID == "" || projectID == "" {
			return "cannot move to Todo: title, description, assignee_id, and project_id must all be set"
		}
		if assigneeID == "unassigned" {
			return "cannot move to Todo: assignee must not be \"unassigned\""
		}
	}

	// Gate: Review → Todo and Review → In Progress both require feedback
	if current == "Review" && (next == "Todo" || next == "In Progress") {
		if _, ok := updates["feedback"]; !ok {
			return fmt.Sprintf("cannot move from Review to %s without providing feedback", next)
		}
	}

	return ""
}

// validateFieldLocking rejects updates to locked fields when the issue is not in Backlog.
// Returns an error string if a locked field is being updated, or "" if ok.
func validateFieldLocking(currentState string, updates map[string]any) string {
	if currentState == "Backlog" {
		return ""
	}
	for field := range updates {
		if lockedFields[field] {
			return fmt.Sprintf("field %q is locked when issue is in state %q (only editable in Backlog)", field, currentState)
		}
	}
	return ""
}

// PatchIssue handles PATCH /api/v1/issues/{issue_identifier} by applying
// partial updates to an issue. When the state is changed to "Review" or "Done",
// an auto-commit is triggered on the associated project.
func (s *Server) PatchIssue(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	var updates map[string]any
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}

	// Fetch current issue for validation
	currentIssue, err := s.orchestrator.FetchIssueByIdentifier(r.Context(), identifier)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "issue_lookup_failed", "failed to lookup issue")
		return
	}
	if currentIssue == nil {
		writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue not found")
		return
	}

	// Validate field locking
	if errMsg := validateFieldLocking(currentIssue.State, updates); errMsg != "" {
		writeJSONError(w, http.StatusBadRequest, "field_locked", errMsg)
		return
	}

	// Validate state transition if state is being changed
	if newState, ok := updates["state"].(string); ok && newState != currentIssue.State {
		if errMsg := validateStateTransition(currentIssue.State, newState, currentIssue, updates); errMsg != "" {
			writeJSONError(w, http.StatusBadRequest, "invalid_transition", errMsg)
			return
		}
	}

	issue, err := s.orchestrator.UpdateIssue(r.Context(), identifier, updates)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "update_failed", "update failed")
		return
	}

	if issue == nil {
		writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue not found")
		return
	}

	// Auto-commit when manually moved to Review (agent auto-commit only fires via RecordRunSuccess)
	if newState, ok := updates["state"].(string); ok && (newState == "Review" || newState == "Done") {
		if issue.ProjectID != "" && s.db != nil {
			project, projErr := s.db.GetProjectByID(r.Context(), issue.ProjectID)
			if projErr == nil && project.RootPath != "" {
				// Prefer worktree path if the issue has a branch and the worktree exists
				commitDir := project.RootPath
				if issue.BranchName != "" && s.worktreeRoot != "" {
					wtPath := filepath.Join(s.worktreeRoot, project.ID, issue.BranchName)
					if info, err := os.Stat(wtPath); err == nil && info.IsDir() {
						commitDir = wtPath
					}
				}
				commitMsg := fmt.Sprintf("feat(%s): %s\n\nVia Orchestra", issue.Identifier, issue.Title)
				if commitErr := git.Commit(r.Context(), commitDir, commitMsg); commitErr != nil {
					s.logger.Debug().Err(commitErr).Msg("auto-commit on state change (may have no changes)")
				}

				// Clean up worktree when issue moves to Done
				if newState == "Done" && issue.BranchName != "" && s.worktreeRoot != "" {
					wsSvc := workspace.Service{Root: s.worktreeRoot}
					if cleanupErr := wsSvc.CleanupWorktree(project.RootPath, project.ID, issue.BranchName); cleanupErr != nil {
						s.logger.Warn().Err(cleanupErr).
							Str("issue", issue.Identifier).
							Str("branch", issue.BranchName).
							Msg("worktree cleanup failed on Done transition")
					} else {
						s.logger.Info().
							Str("issue", issue.Identifier).
							Str("branch", issue.BranchName).
							Msg("worktree cleaned up on Done transition")
					}
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, issue)
}

// GetIssueHistory handles GET /api/v1/issues/{issue_identifier}/history by
// returning the run history for the identified issue.
func (s *Server) GetIssueHistory(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	runtime, ok := s.orchestrator.LookupIssue(identifier)

	var issueID string
	if ok {
		issueID = runtime.IssueID
	} else {
		// Issue not running; try to find it via search
		issues, err := s.orchestrator.SearchIssues(r.Context(), identifier)
		if err != nil || len(issues) == 0 {
			writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue not found")
			return
		}
		issueID = issues[0].ID
	}

	history, err := s.orchestrator.GetHistory(r.Context(), issueID)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "history_failed", "failed to fetch history")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"history": history})
}

// GetIssueLogs handles GET /api/v1/issues/{issue_identifier}/logs by serving
// the most recent log file for the identified issue as plain text.
func (s *Server) GetIssueLogs(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	runtime, ok := s.orchestrator.LookupIssue(identifier)

	logPath := ""
	if ok && runtime.Running != nil && runtime.Running.SessionLogPath != "" {
		logPath = runtime.Running.SessionLogPath
	} else {
		// Verify the issue actually has sessions before serving file-based logs.
		// Without this check, a newly created issue that reuses an identifier
		// (e.g. FETCH-1 deleted then recreated) would serve stale logs.
		var issueID string
		if ok {
			issueID = runtime.IssueID
		} else if issues, err := s.orchestrator.SearchIssues(r.Context(), identifier); err == nil && len(issues) > 0 {
			issueID = issues[0].ID
		}
		hasSessions := false
		if issueID != "" && s.db != nil {
			if history, err := s.db.GetUnifiedHistory(r.Context(), issueID); err == nil && len(history) > 0 {
				// Check for at least one agent-sourced entry (not just metadata)
				for _, h := range history {
					if src, _ := h["source"].(string); src == "agent" {
						hasSessions = true
						break
					}
				}
			}
		}

		if !hasSessions {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			return
		}

		// Try latest.log symlink first
		candidate := filepath.Join(s.workspaceRoot, "_logs", identifier, "latest.log")
		if _, err := os.Stat(candidate); err == nil {
			logPath = candidate
		} else {
			// Scan for most recent .log file in the directory
			logsDir := filepath.Join(s.workspaceRoot, "_logs", identifier)
			entries, dirErr := os.ReadDir(logsDir)
			if dirErr == nil {
				var newest string
				var newestTime time.Time
				for _, e := range entries {
					if e.IsDir() || !strings.HasSuffix(e.Name(), ".log") || e.Name() == "latest.log" {
						continue
					}
					info, infoErr := e.Info()
					if infoErr != nil {
						continue
					}
					if newest == "" || info.ModTime().After(newestTime) {
						newest = filepath.Join(logsDir, e.Name())
						newestTime = info.ModTime()
					}
				}
				logPath = newest
			}
		}
	}

	if logPath == "" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("# No logs available yet\n\nThis issue hasn't started processing or logs haven't been created."))
		return
	}

	if _, err := os.Stat(logPath); os.IsNotExist(err) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("# No logs available yet\n\nThis issue hasn't started processing or logs haven't been created."))
		return
	}

	http.ServeFile(w, r, logPath)
}

// GetArtifacts handles GET /api/v1/issues/{issue_identifier}/artifacts by
// listing all artifacts produced during runs of the identified issue.
func (s *Server) GetArtifacts(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	provider := r.URL.Query().Get("provider")
	artifacts, err := s.orchestrator.ListArtifacts(identifier, provider)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "list_failed", "failed to list items")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"artifacts": artifacts})
}

// GetArtifactContent handles GET /api/v1/issues/{issue_identifier}/artifacts/*
// by returning the raw content of a specific artifact file.
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
		writeJSONError(w, http.StatusNotFound, "fetch_failed", "failed to fetch data")
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

// GetIssueDiff handles GET /api/v1/issues/{issue_identifier}/diff by computing
// and returning the git diff for the issue's workspace. It checks the project
// directory first for uncommitted and recent changes, then falls back to the
// workspace-based diff.
func (s *Server) GetIssueDiff(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	provider := r.URL.Query().Get("provider")

	if s.db != nil {
		issue, fetchErr := s.orchestrator.FetchIssueByIdentifier(r.Context(), identifier)
		if fetchErr == nil && issue != nil && issue.ProjectID != "" {
			project, projErr := s.db.GetProjectByID(r.Context(), issue.ProjectID)
			if projErr == nil && project.RootPath != "" && filepath.IsAbs(project.RootPath) {

				s.logger.Info().
					Str("identifier", identifier).
					Str("worktree_root", s.worktreeRoot).
					Str("project_id", issue.ProjectID).
					Str("project_root", project.RootPath).
					Str("branch_name", issue.BranchName).
					Str("base_sha", issue.BaseSHA).
					Msg("GetIssueDiff: computing diff")

				// Branch-scoped diff: use base_sha...branch_name when available
				if issue.BaseSHA != "" && issue.BranchName != "" {
					var allDiff []byte

					// Committed changes on branch relative to base
					committed, err := git.BranchDiff(r.Context(), project.RootPath, issue.BaseSHA, issue.BranchName)
					if err == nil && len(committed) > 0 {
						allDiff = append(allDiff, []byte(committed)...)
					}

					// Uncommitted changes inside the worktree (if it exists)
					wtPath := filepath.Join(s.worktreeRoot, project.ID, issue.BranchName)
					s.logger.Info().Str("wt_path", wtPath).Msg("GetIssueDiff: checking worktree")
					if info, statErr := os.Stat(wtPath); statErr == nil && info.IsDir() {
						s.logger.Info().Str("wt_path", wtPath).Msg("GetIssueDiff: worktree exists")
						uncommitted, err := git.WorktreeDiff(r.Context(), wtPath)
						if err == nil && len(uncommitted) > 0 {
							allDiff = append(allDiff, []byte(uncommitted)...)
						}
					} else {
						s.logger.Info().Str("wt_path", wtPath).Err(statErr).Msg("GetIssueDiff: worktree not found")
					}

					w.Header().Set("Content-Type", "text/plain; charset=utf-8")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write(allDiff)
					return
				}

				// Fallback: no base_sha/branch_name — try to find the worktree by
				// scanning the worktree root for a directory belonging to this project.
				// This avoids diffing the shared project root which leaks other issues' changes.
				if s.worktreeRoot != "" {
					projectWTDir := filepath.Join(s.worktreeRoot, project.ID)
					s.logger.Info().Str("project_wt_dir", projectWTDir).Msg("GetIssueDiff: fallback scanning worktree dir")
					if entries, err := os.ReadDir(projectWTDir); err == nil {
						dirNames := make([]string, 0, len(entries))
						for _, e := range entries {
							dirNames = append(dirNames, e.Name())
						}
						s.logger.Info().Strs("entries", dirNames).Msg("GetIssueDiff: found entries in project worktree dir")
						for _, entry := range entries {
							if !entry.IsDir() {
								continue
							}
							wtPath := filepath.Join(projectWTDir, entry.Name())
							// Check if this worktree belongs to the current issue by looking
							// for the issue identifier in the branch name or directory name
							if !strings.Contains(strings.ToLower(entry.Name()), strings.ToLower(identifier)) {
								continue
							}
							// Compute diff inside the worktree: committed + uncommitted
							var allDiff []byte
							baseSHA, baseErr := git.MergeBase(r.Context(), wtPath, "HEAD", "main")
							if baseErr == nil && baseSHA != "" {
								committed, err := git.BranchDiff(r.Context(), wtPath, baseSHA, "HEAD")
								if err == nil && len(committed) > 0 {
									allDiff = append(allDiff, []byte(committed)...)
								}
							}
							uncommitted, err := git.WorktreeDiff(r.Context(), wtPath)
							if err == nil && len(uncommitted) > 0 {
								allDiff = append(allDiff, []byte(uncommitted)...)
							}
							if len(allDiff) > 0 {
								w.Header().Set("Content-Type", "text/plain; charset=utf-8")
								w.WriteHeader(http.StatusOK)
								_, _ = w.Write(allDiff)
								return
							}
						}
					}
				}

				// Last resort: diff the project root (may include other issues' changes)
				if diff := s.legacyDiff(r, project.RootPath); len(diff) > 0 {
					w.Header().Set("Content-Type", "text/plain; charset=utf-8")
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write(diff)
					return
				}
			}
		}
	}

	// Final fallback to workspace-based diff
	diff, err := s.orchestrator.GetDiff(identifier, provider)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "diff_failed", "failed to compute diff")
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(diff))
}

// legacyDiff computes a diff for issues that lack base_sha/branch_name metadata.
// It collects staged, unstaged, last-commit, and untracked file diffs from the
// given project root directory.
func (s *Server) legacyDiff(r *http.Request, rootPath string) []byte {
	var allDiff []byte

	// Staged changes
	cmd := exec.CommandContext(r.Context(), "git", "diff", "--cached")
	cmd.Dir = rootPath
	if staged, _ := cmd.CombinedOutput(); len(staged) > 0 {
		allDiff = append(allDiff, staged...)
	}

	// Unstaged changes
	cmd2 := exec.CommandContext(r.Context(), "git", "diff")
	cmd2.Dir = rootPath
	if unstaged, _ := cmd2.CombinedOutput(); len(unstaged) > 0 {
		allDiff = append(allDiff, unstaged...)
	}

	// If no uncommitted changes, show the most recent commit's diff
	if len(allDiff) == 0 {
		cmd3 := exec.CommandContext(r.Context(), "git", "diff", "HEAD~1..HEAD")
		cmd3.Dir = rootPath
		if committed, _ := cmd3.CombinedOutput(); len(committed) > 0 {
			allDiff = append(allDiff, committed...)
		}
	}

	// Include untracked (new) files
	cmd3 := exec.CommandContext(r.Context(), "git", "ls-files", "--others", "--exclude-standard")
	cmd3.Dir = rootPath
	untrackedList, _ := cmd3.Output()
	for _, fname := range strings.Split(strings.TrimSpace(string(untrackedList)), "\n") {
		fname = strings.TrimSpace(fname)
		if fname == "" {
			continue
		}
		cmd4 := exec.CommandContext(r.Context(), "git", "diff", "--no-index", "/dev/null", fname)
		cmd4.Dir = rootPath
		if out4, err := cmd4.CombinedOutput(); err != nil || len(out4) > 0 {
			allDiff = append(allDiff, out4...)
		}
	}

	return allDiff
}

// GetAgentConfig handles GET /api/v1/config/agents by returning the current
// agent command mappings, default provider, and max turns setting.
func (s *Server) GetAgentConfig(w http.ResponseWriter, _ *http.Request) {
	commands, provider := s.orchestrator.GetAgentConfig()
	writeJSON(w, http.StatusOK, map[string]any{
		"commands":       commands,
		"agent_provider": provider,
		"max_turns":      s.orchestrator.GetMaxTurns(),
	})
}

// PatchAgentConfig handles PATCH /api/v1/config/agents by updating the
// max_turns setting (must be between 1 and 100).
func (s *Server) PatchAgentConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MaxTurns *int `json:"max_turns"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
		return
	}
	if req.MaxTurns != nil {
		if *req.MaxTurns < 1 || *req.MaxTurns > 100 {
			writeJSONError(w, http.StatusBadRequest, "invalid_value", "max_turns must be between 1 and 100")
			return
		}
		s.orchestrator.SetMaxTurns(*req.MaxTurns)
	}
	// Return updated config
	commands, provider := s.orchestrator.GetAgentConfig()
	writeJSON(w, http.StatusOK, map[string]any{
		"commands":       commands,
		"agent_provider": provider,
		"max_turns":      s.orchestrator.GetMaxTurns(),
	})
}

// DeleteIssueSession handles DELETE /api/v1/issues/{issue_identifier}/session
// by stopping the active agent session(s) for the identified issue and resetting
// the issue state to "Todo".
func (s *Server) DeleteIssueSession(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")
	provider := r.URL.Query().Get("provider")

	runtime, ok := s.orchestrator.LookupIssue(identifier)
	if !ok {
		issue, err := s.orchestrator.FetchIssueByIdentifier(r.Context(), identifier)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "issue_lookup_failed", "failed to lookup issue")
			return
		}
		if issue == nil {
			writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue not found")
			return
		}

		if _, err := s.orchestrator.UpdateIssue(r.Context(), identifier, map[string]any{"state": "Todo"}); err != nil {
			s.logger.Warn().Err(err).Str("issue_identifier", identifier).Msg("failed to set issue to todo when stopping without active runtime")
		}

		w.WriteHeader(http.StatusNoContent)
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

	if _, err := s.orchestrator.UpdateIssue(r.Context(), identifier, map[string]any{"state": "Todo"}); err != nil {
		s.logger.Warn().Err(err).Str("issue_identifier", identifier).Msg("failed to set issue to todo after stop")
	}

	w.WriteHeader(http.StatusNoContent)
}

// PostIssueStop handles POST /api/v1/issues/{issue_identifier}/stop by stopping
// all active sessions and resetting the issue to Backlog with empty feedback.
// This bypasses normal state transition validation as a special reset operation.
func (s *Server) PostIssueStop(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")

	// Look up issue to get branch/project info for cleanup
	issueData, _ := s.orchestrator.FetchIssueByIdentifier(r.Context(), identifier)

	// Stop all sessions if the issue has an active runtime
	runtime, ok := s.orchestrator.LookupIssue(identifier)
	if ok {
		s.orchestrator.StopAllSessionsForIssue(runtime.IssueID)
	}

	// Clean up worktree and branch
	if issueData != nil && issueData.BranchName != "" && issueData.ProjectID != "" {
		if project, projErr := s.db.GetProjectByID(r.Context(), issueData.ProjectID); projErr == nil && project.RootPath != "" {
			wtPath := filepath.Join(s.worktreeRoot, issueData.ProjectID, issueData.BranchName)
			_ = os.RemoveAll(wtPath)
			pruneCmd := exec.CommandContext(r.Context(), "git", "worktree", "prune")
			pruneCmd.Dir = project.RootPath
			_ = pruneCmd.Run()
			delCmd := exec.CommandContext(r.Context(), "git", "branch", "-D", issueData.BranchName)
			delCmd.Dir = project.RootPath
			_ = delCmd.Run()
			s.logger.Info().Str("branch", issueData.BranchName).Msg("cleaned up worktree on stop & reset")
		}
	}

	// Reset state to Backlog and clear feedback, plan, branch, base_sha
	issue, err := s.orchestrator.UpdateIssue(r.Context(), identifier, map[string]any{
		"state":       "Backlog",
		"feedback":    "",
		"plan":        "",
		"branch_name": "",
		"base_sha":    "",
	})
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "update_failed", "failed to reset issue")
		return
	}
	if issue == nil {
		writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue not found")
		return
	}

	writeJSON(w, http.StatusOK, issue)
}

// DeleteIssue handles DELETE /api/v1/issues/{issue_identifier} by permanently
// deleting the identified issue from the tracker, cleaning up the worktree and branch.
func (s *Server) DeleteIssue(w http.ResponseWriter, r *http.Request) {
	identifier := chi.URLParam(r, "issue_identifier")

	// Look up issue to get branch/project info BEFORE deleting
	issue, _ := s.orchestrator.FetchIssueByIdentifier(r.Context(), identifier)

	// Stop any running sessions
	s.orchestrator.StopAllSessionsForIssue(identifier)

	// Clean up worktree and branch if they exist
	if issue != nil && issue.BranchName != "" && issue.ProjectID != "" {
		if project, projErr := s.db.GetProjectByID(r.Context(), issue.ProjectID); projErr == nil && project.RootPath != "" {
			// Remove worktree directory
			wtPath := filepath.Join(s.worktreeRoot, issue.ProjectID, issue.BranchName)
			if err := os.RemoveAll(wtPath); err != nil && !os.IsNotExist(err) {
				s.logger.Warn().Err(err).Str("path", wtPath).Msg("failed to remove worktree directory")
			}
			// Prune and delete branch
			pruneCmd := exec.CommandContext(r.Context(), "git", "worktree", "prune")
			pruneCmd.Dir = project.RootPath
			_ = pruneCmd.Run()
			delCmd := exec.CommandContext(r.Context(), "git", "branch", "-D", issue.BranchName)
			delCmd.Dir = project.RootPath
			_ = delCmd.Run()
			s.logger.Info().Str("branch", issue.BranchName).Str("worktree", wtPath).Msg("cleaned up worktree and branch on delete")
		}
	}

	// Delete from tracker
	if err := s.orchestrator.DeleteIssue(r.Context(), identifier); err != nil {
		s.logger.Error().Err(err).Str("issue_identifier", identifier).Msg("failed to delete issue")
		if errors.Is(err, sql.ErrNoRows) {
			writeJSONError(w, http.StatusNotFound, "issue_not_found", "issue not found")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "delete_failed", "deletion failed")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetAgents handles GET /api/v1/agents by returning the list of configured
// agent providers.
func (s *Server) GetAgents(w http.ResponseWriter, _ *http.Request) {
	providers := s.orchestrator.GetProviders()
	writeJSON(w, http.StatusOK, map[string]any{
		"agents": providers,
	})
}

func markLegacyAgentConfigRoute(w http.ResponseWriter) {
	w.Header().Set("Deprecation", "true")
	w.Header().Set("Sunset", "Wed, 31 Dec 2026 23:59:59 GMT")
	w.Header().Set("Link", `</api/v1/agents>; rel="successor-version"`)
}

// GetAgentConfigs handles the legacy generic config-item listing route
// GET /api/v1/config/agents/items. Provider-native agent configuration should
// prefer /api/v1/agents/{provider}/... routes instead.
func (s *Server) GetAgentConfigs(w http.ResponseWriter, r *http.Request) {
	markLegacyAgentConfigRoute(w)
	projectID := r.URL.Query().Get("project_id")
	configs, err := s.orchestrator.ListAgentConfigs(projectID)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "configs_failed", "failed to fetch configs")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"configs": configs,
	})
}

// PostAgentConfigNew handles the legacy generic creation route
// POST /api/v1/config/agents/new. Provider-native agent configuration should
// prefer /api/v1/agents/{provider}/... routes instead.
func (s *Server) PostAgentConfigNew(w http.ResponseWriter, r *http.Request) {
	markLegacyAgentConfigRoute(w)
	var body struct {
		Provider string `json:"provider"`
		Type     string `json:"type"` // "core", "skill", "mcp"
		Name     string `json:"name"`
		Scope    string `json:"scope"`
		Project  string `json:"project_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}

	// Implementation detail: orchestrator resolves the directory and creates the file
	path, err := s.orchestrator.CreateAgentResource(body.Provider, body.Type, body.Name, body.Scope, body.Project)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "create_failed", "creation failed")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"path": path})
}

// PostAgentConfigUpdate handles the legacy generic config-item update route
// POST /api/v1/config/agents/items. Provider-native agent configuration should
// prefer /api/v1/agents/{provider}/... routes instead.
func (s *Server) PostAgentConfigUpdate(w http.ResponseWriter, r *http.Request) {
	markLegacyAgentConfigRoute(w)
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}

	if err := s.orchestrator.UpdateConfigByPath(body.Path, body.Content); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "update_failed", "update failed")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// PostAgentConfig handles POST /api/v1/config/agents by replacing the agent
// command mappings and default provider in the orchestrator.
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

// GetMCPTools handles GET /api/v1/mcp/tools by listing all tools available
// from connected MCP servers.
func (s *Server) GetMCPTools(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	mcpReg := s.orchestrator.GetMCPRegistry()
	if mcpReg == nil {
		writeJSON(w, http.StatusOK, map[string]any{"tools": []any{}})
		return
	}

	tools, err := mcpReg.ListTools(ctx)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "mcp_failed", "MCP operation failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"tools": tools,
	})
}

// GetMCPServers handles GET /api/v1/mcp/servers by listing all registered
// MCP server entries from the database.
func (s *Server) GetMCPServers(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusOK, map[string]any{"servers": []any{}})
		return
	}
	servers, err := s.db.ListMCPServers(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_failed", "database operation failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"servers": servers})
}

// PostMCPServer handles POST /api/v1/mcp/servers by creating a new MCP server
// entry and hot-reloading the MCP registry in the orchestrator.
func (s *Server) PostMCPServer(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string `json:"name"`
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}

	server, err := s.db.CreateMCPServer(r.Context(), body.Name, body.Command)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_failed", "database operation failed")
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

	writeJSON(w, http.StatusCreated, server)
}

// DeleteMCPServer handles DELETE /api/v1/mcp/servers/{id} by removing the MCP
// server entry and rebuilding the MCP registry from the remaining database
// entries and static configuration.
func (s *Server) DeleteMCPServer(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}
	id := chi.URLParam(r, "id")
	if err := s.db.DeleteMCPServer(r.Context(), id); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_failed", "database operation failed")
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
