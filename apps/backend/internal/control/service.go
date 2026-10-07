// Package control exposes the same bounded project/task controls to CLI and native chat.
package control

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/plangate"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	trackerregistry "github.com/orchestra/orchestra/apps/backend/internal/tracker/registry"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

type Request struct {
	Operation        string `json:"operation"`
	ProjectID        string `json:"project_id,omitempty"`
	TaskID           string `json:"task_id,omitempty"`
	RequestID        string `json:"request_id,omitempty"`
	ExpectedState    string `json:"expected_state,omitempty"`
	Title            string `json:"title,omitempty"`
	Description      string `json:"description,omitempty"`
	AssigneeID       string `json:"assignee_id,omitempty"`
	Provider         string `json:"provider,omitempty"`
	ExpectedPlanHash string `json:"expected_plan_hash,omitempty"`
	Feedback         string `json:"feedback,omitempty"`
	ExpectedPRURL    string `json:"expected_pr_url,omitempty"`
	ExpectedHeadSHA  string `json:"expected_head_sha,omitempty"`
	ReviewAttemptID  string `json:"review_attempt_id,omitempty"`
	ReviewerAgentID  string `json:"reviewer_agent_id,omitempty"`
	Unassigned       bool   `json:"unassigned,omitempty"`
}
type Service struct {
	db               *db.DB
	orchestrator     *orchestrator.Service
	registry         *trackerregistry.Registry
	mu               sync.Mutex
	roots            []string
	resourceExecutor func(context.Context, map[string]any) map[string]any
	reviewExecutor   func(context.Context, Request) map[string]any
}

func New(database *db.DB, orchestratorService *orchestrator.Service, registry *trackerregistry.Registry, roots ...[]string) (*Service, error) {
	if database == nil || orchestratorService == nil {
		return nil, errors.New("control dependencies unavailable")
	}
	_, err := database.Exec(`CREATE TABLE IF NOT EXISTS orchestrator_control_operations (request_id TEXT PRIMARY KEY, digest TEXT NOT NULL, operation TEXT NOT NULL, project_id TEXT NOT NULL, task_id TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
	if err != nil {
		return nil, err
	}
	service := &Service{db: database, orchestrator: orchestratorService, registry: registry}
	orchestratorService.SetDB(database)
	if len(roots) > 0 {
		service.roots = append([]string(nil), roots[0]...)
	}
	return service, nil
}
func failure(code, message string) map[string]any {
	return map[string]any{"success": false, "error": map[string]string{"code": code, "message": message}}
}
func success(data any) map[string]any { return map[string]any{"success": true, "data": data} }

// Execute is shared by authenticated HTTP/CLI and the scoped native-tool adapter.
func (s *Service) Execute(ctx context.Context, name string, arguments map[string]any) map[string]any {
	if name == "orchestra_resources" {
		if s.resourceExecutor == nil {
			return failure("unsupported_tool", "Agent and skill authoring is unavailable")
		}
		result := s.resourceExecutor(ctx, arguments)
		if message, ok := result["error"].(string); ok && message != "" {
			return map[string]any{"success": false, "error": map[string]any{"code": "resource_operation_failed", "message": message}, "data": result}
		}
		return success(result)
	}
	if name != "orchestra_control" {
		return failure("unsupported_tool", "Only declared Orchestra control tools are available")
	}
	raw, err := json.Marshal(arguments)
	if err != nil {
		return failure("invalid_request", "Invalid tool arguments")
	}
	var req Request
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&req); err != nil {
		return failure("invalid_request", "Unknown fields or invalid argument types")
	}
	if req.Operation == "projects" {
		projects, err := s.db.GetProjects(ctx)
		if err != nil {
			return failure("observation_failed", "Project inventory unavailable")
		}
		result := []map[string]string{}
		for _, p := range projects {
			result = append(result, map[string]string{"id": p.ID, "name": p.Name, "root_path": p.RootPath, "issue_source_type": p.IssueSourceType})
		}
		return success(result)
	}
	if req.Operation == "status" {
		return success(s.orchestrator.Snapshot())
	}
	if req.Operation == "receipt" {
		return s.receipt(ctx, req.RequestID)
	}
	if req.Operation == "reviewers" {
		if s.reviewExecutor == nil {
			return failure("review_unavailable", "PR reviewer stage is not configured")
		}
		return s.reviewExecutor(ctx, req)
	}
	if req.Operation == "worktrees" {
		project, err := s.db.GetProjectByID(ctx, req.ProjectID)
		if err != nil {
			return failure("project_unavailable", "Exact registered project_id is required")
		}
		rows, err := workspace.ListGitWorktrees(ctx, project.RootPath, s.roots)
		if err != nil {
			return failure("observation_failed", "Authorized Git worktree registry unavailable")
		}
		return success(map[string]any{"project_id": project.ID, "worktrees": rows, "observation": "git_registry_only"})
	}
	if req.Operation != "tasks" && req.Operation != "create" && req.Operation != "queue" && req.Operation != "assign" && req.Operation != "approve_plan" && req.Operation != "replan" && !reviewMutation(req.Operation) {
		return failure("unsupported_operation", "Supported operations: projects, tasks, worktrees, status, create, assign, queue, approve_plan, replan, receipt; pause/stop/delete are unavailable")
	}
	client, err := s.projectClient(ctx, req.ProjectID)
	if err != nil {
		return failure("project_unavailable", err.Error())
	}
	if req.Operation == "tasks" {
		if req.Unassigned && req.AssigneeID != "" {
			return failure("invalid_request", "tasks accepts either unassigned=true or an exact assignee_id filter, not both")
		}
		tasks, err := client.FetchIssues(ctx, tracker.IssueFilter{ProjectID: req.ProjectID})
		if err != nil {
			return failure("observation_failed", "Project task inventory unavailable; no global fallback performed")
		}
		// Do not silently turn an unconfirmed tracker scope into an empty project.
		scoped := []tracker.Issue{}
		for _, task := range tasks {
			if task.ProjectID != req.ProjectID || task.ID == "" {
				return failure("scope_conflict", "Tracker returned task identity outside the requested registered project; inventory not confirmed")
			}
			if req.Unassigned && strings.TrimSpace(task.AssigneeID) != "" || req.AssigneeID != "" && task.AssigneeID != req.AssigneeID {
				continue
			}
			task.PlanGate = planGatePointer(s.orchestrator.PlanGate(ctx, task))
			task.ReviewGate = s.orchestrator.ReviewGate(ctx, task)
			scoped = append(scoped, task)
		}
		return success(map[string]any{"project_id": req.ProjectID, "tasks": scoped})
	}
	if id, err := uuid.Parse(req.RequestID); err != nil || id == uuid.Nil || id.String() != req.RequestID {
		return failure("invalid_request", "Mutations require a canonical UUID request_id; retain it for reconciliation")
	}
	if reviewMutation(req.Operation) {
		if err := ValidateReviewRequest(req); err != nil {
			return failure("invalid_request", err.Error())
		}
		if s.reviewExecutor == nil {
			return failure("review_unavailable", "PR reviewer stage is not configured")
		}
	} else if req.ExpectedPRURL != "" || req.ExpectedHeadSHA != "" || req.ReviewAttemptID != "" || req.ReviewerAgentID != "" {
		return failure("invalid_request", "Review identity fields require a review control operation")
	}
	if req.Operation == "create" && (strings.TrimSpace(req.Title) == "" || len(req.Title) > 500 || len(req.Description) > 65536 || req.TaskID != "" || req.ExpectedState != "") {
		return failure("invalid_request", "Create requires a title and no existing task/state identity")
	}
	if req.Operation == "create" && req.Provider != "" {
		req.Provider = string(agents.NormalizeProvider(req.Provider))
		if !validAssignmentProvider(agents.Provider(req.Provider)) {
			return failure("invalid_request", "Task provider must be a registered harness name")
		}
	}
	if req.Operation == "queue" && (req.TaskID == "" || req.ExpectedState != "Backlog" || req.Title != "" || req.Description != "" || req.AssigneeID != "" || req.Provider != "") {
		return failure("invalid_request", "Queue requires exact project/task IDs and expected_state Backlog; metadata edits are unavailable")
	}
	if req.Operation == "assign" && (req.TaskID == "" || req.ExpectedState != "Backlog" || strings.TrimSpace(req.AssigneeID) == "" || req.Title != "" || req.Description != "" || req.Unassigned) {
		return failure("invalid_request", "Assign requires exact project/task IDs, assignee_id and expected_state Backlog")
	}
	if req.Operation == "approve_plan" && (req.TaskID == "" || req.ExpectedState != "Todo" || req.ExpectedPlanHash == "" || req.Feedback != "" || req.Title != "" || req.Description != "" || req.AssigneeID != "" || req.Provider != "") {
		return failure("invalid_request", "Approve plan requires exact project/task IDs, expected_state Todo, expected_plan_hash, and no task metadata edits")
	}
	if req.Operation == "replan" && (req.TaskID == "" || (req.ExpectedState != "Todo" && req.ExpectedState != "In Progress" && req.ExpectedState != "Review") || req.ExpectedPlanHash == "" || strings.TrimSpace(req.Feedback) == "" || len(req.Feedback) > 65536 || req.Title != "" || req.Description != "" || req.AssigneeID != "" || req.Provider != "") {
		return failure("invalid_request", "Replan requires exact project/task IDs, expected_state Todo/In Progress/Review, expected_plan_hash, nonblank feedback, and no task metadata edits")
	}
	if req.Operation == "assign" && req.Provider != "" {
		req.Provider = string(agents.NormalizeProvider(req.Provider))
		if !validAssignmentProvider(agents.Provider(req.Provider)) {
			return failure("invalid_request", "Assignment provider must be a registered harness name")
		}
	}
	sum := sha256.Sum256(raw)
	digest := hex.EncodeToString(sum[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	var priorDigest, status, result string
	err = s.db.QueryRowContext(ctx, `SELECT digest,status,result FROM orchestrator_control_operations WHERE request_id=?`, req.RequestID).Scan(&priorDigest, &status, &result)
	if err == nil {
		if priorDigest != digest {
			return failure("request_identity_conflict", "This request_id belongs to different arguments")
		}
		return decodeReceipt(req.RequestID, status, result)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return failure("receipt_unavailable", "Could not inspect mutation receipt; no mutation sent")
	}
	// Durable intent precedes the external effect. An incomplete receipt is never replayed.
	if _, err = s.db.ExecContext(ctx, `INSERT INTO orchestrator_control_operations(request_id,digest,operation,project_id,task_id,status) VALUES(?,?,?,?,?,'pending')`, req.RequestID, digest, req.Operation, req.ProjectID, req.TaskID); err != nil {
		return failure("receipt_unavailable", "Could not persist mutation intent; no mutation sent")
	}
	out := s.mutate(ctx, client, req)
	encoded, err := json.Marshal(out)
	if err != nil {
		return failure("mutation_unknown", "Result could not be encoded; inspect receipt before sending another mutation")
	}
	state := "completed"
	if ok, _ := out["success"].(bool); !ok {
		state = "rejected"
		if e, ok := out["error"].(map[string]string); ok && e["code"] == "mutation_unknown" {
			state = "unknown"
		}
	}
	// Persist even if the requesting connection/turn has gone away. This is an
	// owned backend effect receipt, not a retry of the task mutation.
	if _, err = s.db.Exec(`UPDATE orchestrator_control_operations SET status=?,result=?,updated_at=CURRENT_TIMESTAMP WHERE request_id=?`, state, string(encoded), req.RequestID); err != nil {
		return failure("mutation_unknown", "Mutation may have landed; inspect tasks and this request_id before retrying")
	}
	out["request_id"] = req.RequestID
	out["receipt_status"] = state
	return out
}

// ConfigureResourceExecutor binds native authoring to the same scoped domain used by HTTP.
// Configure this before publishing the executor to a running provider session.
func (s *Service) ConfigureResourceExecutor(executor func(context.Context, map[string]any) map[string]any) {
	s.resourceExecutor = executor
}

func (s *Service) projectClient(ctx context.Context, pid string) (tracker.Client, error) {
	if pid == "" {
		return nil, errors.New("Exact project_id is required")
	}
	p, err := s.db.GetProjectByID(ctx, pid)
	if err != nil {
		return nil, errors.New("Registered project unavailable")
	}
	if p.IssueSourceType == "" && p.TrackerConfigID == "" {
		client := s.orchestrator.LocalSQLiteClient()
		if client == nil {
			return nil, errors.New("Local project tracker unavailable")
		}
		return client, nil
	}
	if s.registry == nil {
		return nil, errors.New("Project tracker unavailable; global tracker fallback prohibited")
	}
	var client tracker.Client
	if p.IssueSourceType != "" {
		client, err = s.registry.GetForProjectDirect(p)
	} else {
		client, err = s.registry.GetForProject(ctx, pid)
	}
	if err != nil || client == nil {
		return nil, errors.New("Project tracker unavailable; global tracker fallback prohibited")
	}
	return client, nil
}
func (s *Service) mutate(ctx context.Context, client tracker.Client, req Request) map[string]any {
	if reviewMutation(req.Operation) {
		return s.reviewExecutor(ctx, req)
	}
	if req.Operation == "create" {
		task, err := client.CreateIssue(ctx, req.Title, req.Description, "Backlog", 0, req.AssigneeID, req.ProjectID, req.Provider, nil)
		if err != nil || task == nil {
			return failure("mutation_unknown", "Task creation may have landed; inspect project tasks before creating again")
		}
		if task.ProjectID != req.ProjectID {
			return failure("mutation_unknown", "Created task scope not confirmed; inspect selected tracker before repeating")
		}
		return success(map[string]any{"task": task, "effect": "backlog_created", "execution": "not_started"})
	}
	if req.Operation == "approve_plan" || req.Operation == "replan" {
		return s.mutatePlanGate(ctx, client, req)
	}
	if req.Operation == "assign" {
		if _, local := client.(*trackersqlite.Client); !local {
			return failure("unsupported_transition", "Guarded assignment is available only for project-local SQLite tasks; hosted task assignment is not implemented for this source")
		}
		tasks, err := client.FetchIssuesByIDs(ctx, []string{req.TaskID})
		if err != nil {
			return failure("observation_failed", "Task lookup failed; assignment mutation not sent")
		}
		var task *tracker.Issue
		for i := range tasks {
			if tasks[i].ID == req.TaskID && tasks[i].ProjectID == req.ProjectID {
				if task != nil {
					return failure("identity_ambiguous", "Multiple tasks match this identity; assignment not sent")
				}
				task = &tasks[i]
			}
		}
		if task == nil {
			return failure("task_not_found", "Exact task not found in selected project; assignment not sent")
		}
		if task.State != req.ExpectedState {
			return failure("state_conflict", "Task is no longer in expected Backlog state; assignment not sent")
		}
		if strings.TrimSpace(task.AssigneeID) != "" {
			return failure("assignee_conflict", "Task already has an assignee; assignment not sent")
		}
		changed, err := s.db.ExecContext(ctx, `UPDATE issues SET assignee_id=?,provider=CASE WHEN ?='' THEN provider ELSE ? END,updated_at=datetime('now') WHERE id=? AND project_id=? AND state='Backlog' AND TRIM(COALESCE(assignee_id,''))=''`, req.AssigneeID, req.Provider, req.Provider, task.ID, req.ProjectID)
		if err != nil {
			return failure("mutation_unknown", "Assignment result not confirmed; inspect project tasks and receipt before repeating")
		}
		rows, err := changed.RowsAffected()
		if err != nil {
			return failure("mutation_unknown", "Assignment result not confirmed; inspect project tasks and receipt before repeating")
		}
		if rows != 1 {
			return failure("state_conflict", "Task state, project or assignee changed; assignment not sent")
		}
		expectedProvider := task.Provider
		if req.Provider != "" {
			expectedProvider = req.Provider
		}
		updated, err := client.FetchIssueByIdentifier(ctx, task.ID)
		if err != nil || updated == nil || updated.ID != task.ID || updated.ProjectID != req.ProjectID || updated.State != "Backlog" || updated.AssigneeID != req.AssigneeID || updated.Provider != expectedProvider || updated.PRURL != task.PRURL {
			return failure("mutation_unknown", "Assignment may have landed; inspect exact task and receipt before trying again")
		}
		s.orchestrator.LogIssueEvent(task.ID, "User", "assignee_change", "", req.AssigneeID)
		s.orchestrator.QueueRefresh()
		return success(map[string]any{"task": updated, "effect": "assigned", "execution": "not_started"})
	}
	tasks, err := client.FetchIssuesByIDs(ctx, []string{req.TaskID})
	if err != nil {
		return failure("observation_failed", "Task lookup failed; queue mutation not sent")
	}
	var task *tracker.Issue
	for i := range tasks {
		if tasks[i].ID == req.TaskID && tasks[i].ProjectID == req.ProjectID {
			if task != nil {
				return failure("identity_ambiguous", "Multiple tasks match this identity; queue mutation not sent")
			}
			task = &tasks[i]
		}
	}
	if task == nil {
		return failure("task_not_found", "Exact task not found in selected project; queue mutation not sent")
	}
	if task.State != req.ExpectedState {
		return failure("state_conflict", "Task no longer in expected Backlog state; queue mutation not sent")
	}
	if strings.TrimSpace(task.Title) == "" || strings.TrimSpace(task.Description) == "" || task.AssigneeID == "" || task.Provider == "" {
		return failure("incomplete_task", "Queue requires title, description, assignee and provider; mutation not sent")
	}
	// A generic tracker read followed by UpdateIssue cannot prevent overwriting
	// a newer state. SQLite supports this guarded transition; hosted adapters
	// must add an equivalent conditional transition before queue is exposed.
	if _, local := client.(*trackersqlite.Client); !local {
		return failure("unsupported_transition", "Hosted tracker queue requires a guarded state transition; mutation not sent")
	}
	changed, err := s.db.ExecContext(ctx, `UPDATE issues SET state='Todo',updated_at=datetime('now') WHERE id=? AND project_id=? AND state='Backlog' AND TRIM(title)<>'' AND TRIM(description)<>'' AND TRIM(assignee_id)<>'' AND TRIM(provider)<>''`, task.ID, req.ProjectID)
	if err != nil {
		return failure("mutation_unknown", "Queue result not confirmed; inspect task and receipt before repeating")
	}
	rows, err := changed.RowsAffected()
	if err != nil {
		return failure("mutation_unknown", "Queue result not confirmed; inspect task and receipt before repeating")
	}
	if rows != 1 {
		return failure("state_conflict", "Task state or required metadata changed; queue mutation not sent")
	}
	updated, err := client.FetchIssueByIdentifier(ctx, task.ID)
	if err != nil || updated == nil || updated.ID != task.ID || updated.ProjectID != req.ProjectID || updated.State != "Todo" {
		return failure("mutation_unknown", "Queue may have landed; inspect task state before trying again")
	}
	s.orchestrator.LogIssueEvent(task.ID, "Orchestrator", "state_change", "Backlog", "Todo")
	s.orchestrator.QueueRefresh()
	return success(map[string]any{"task": updated, "effect": "queued", "execution": "not_observed", "worktree": "not_observed"})
}

func (s *Service) mutatePlanGate(ctx context.Context, client tracker.Client, req Request) map[string]any {
	if _, local := client.(*trackersqlite.Client); !local {
		return failure("unsupported_transition", "Durable plan approval is available only for project-local SQLite tasks")
	}
	err := s.orchestrator.WithSettledTask(req.TaskID, func() error {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		var sourceType, trackerConfigID sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT issue_source_type,tracker_config_id FROM projects WHERE id=?`, req.ProjectID).Scan(&sourceType, &trackerConfigID); err != nil || strings.TrimSpace(sourceType.String) != "" || strings.TrimSpace(trackerConfigID.String) != "" {
			return errors.New("plan approval is available only for source-empty local projects")
		}
		issue, updatedAt, err := plangate.LoadLocalTask(ctx, tx, req.TaskID, req.ProjectID)
		if err != nil {
			return err
		}
		if issue.State != req.ExpectedState {
			return errControlStateConflict
		}
		currentHash := plangate.Fingerprint(*issue)
		if currentHash != req.ExpectedPlanHash {
			return errControlPlanConflict
		}
		if req.Operation == "approve_plan" {
			gate, err := plangate.Status(ctx, tx, *issue)
			if err != nil {
				return err
			}
			if gate.Status != "awaiting_approval" || strings.TrimSpace(issue.Plan) == "" {
				return errControlPlanConflict
			}
			result, err := tx.ExecContext(ctx, `UPDATE issues SET state='In Progress',updated_at=datetime('now') WHERE id=? AND project_id=? AND state='Todo' AND updated_at=?`, req.TaskID, req.ProjectID, updatedAt)
			if err != nil {
				return err
			}
			if rows, _ := result.RowsAffected(); rows != 1 {
				return errControlStateConflict
			}
			if err := insertControlHistory(ctx, tx, req.TaskID, "User", "plan_approved", "", currentHash); err != nil {
				return err
			}
			if err := insertControlHistory(ctx, tx, req.TaskID, "User", "state_change", "Todo", "In Progress"); err != nil {
				return err
			}
		} else {
			if issue.State != "Todo" && issue.State != "In Progress" && issue.State != "Review" {
				return errControlStateConflict
			}
			oldState, oldFeedback := issue.State, issue.Feedback
			issue.Feedback = strings.TrimSpace(req.Feedback)
			newHash := plangate.Fingerprint(*issue)
			result, err := tx.ExecContext(ctx, `UPDATE issues SET state='Todo',feedback=?,updated_at=datetime('now') WHERE id=? AND project_id=? AND state=? AND updated_at=?`, issue.Feedback, req.TaskID, req.ProjectID, oldState, updatedAt)
			if err != nil {
				return err
			}
			if rows, _ := result.RowsAffected(); rows != 1 {
				return errControlStateConflict
			}
			if err := insertControlHistory(ctx, tx, req.TaskID, "User", "replan_requested", oldFeedback, newHash); err != nil {
				return err
			}
			if oldState != "Todo" {
				if err := insertControlHistory(ctx, tx, req.TaskID, "User", "state_change", oldState, "Todo"); err != nil {
					return err
				}
			}
		}
		return tx.Commit()
	})
	if err != nil {
		switch {
		case errors.Is(err, orchestrator.ErrTaskUnsettled):
			return failure("task_unsettled", "Task has an active or unresolved run; approval or replan was not applied")
		case errors.Is(err, errControlPlanConflict):
			return failure("plan_conflict", "Plan or execution context changed; reload the task and use its current plan_hash")
		case errors.Is(err, errControlStateConflict):
			return failure("state_conflict", "Task is no longer in the expected state; mutation was not applied")
		case errors.Is(err, sql.ErrNoRows):
			return failure("task_not_found", "Exact local task not found in selected project")
		default:
			return failure("mutation_rejected", err.Error())
		}
	}
	updated, err := client.FetchIssueByIdentifier(ctx, req.TaskID)
	if err != nil || updated == nil || updated.ID != req.TaskID || updated.ProjectID != req.ProjectID {
		return failure("mutation_unknown", "Plan gate may have changed; inspect the exact task and request receipt before retrying")
	}
	updated.PlanGate = planGatePointer(s.orchestrator.PlanGate(ctx, *updated))
	s.orchestrator.QueueRefresh()
	if req.Operation == "approve_plan" {
		return success(map[string]any{"task": updated, "effect": "plan_approved", "execution": "queued"})
	}
	return success(map[string]any{"task": updated, "effect": "replan_requested", "execution": "not_started"})
}

var (
	errControlPlanConflict  = errors.New("plan fingerprint conflict")
	errControlStateConflict = errors.New("task state conflict")
)

func insertControlHistory(ctx context.Context, tx *sql.Tx, taskID, userID, action, oldValue, newValue string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO issue_history(id,issue_id,user_id,action,old_value,new_value) VALUES(?,?,?,?,?,?)`, "hist_"+uuid.NewString(), taskID, userID, action, oldValue, newValue)
	return err
}

func planGatePointer(gate tracker.PlanGate) *tracker.PlanGate { return &gate }

func validAssignmentProvider(provider agents.Provider) bool {
	switch provider {
	case agents.ProviderCodex, agents.ProviderClaude, agents.ProviderOpenCode, agents.Provider8gent, agents.ProviderAntigravity, agents.ProviderOMP:
		return true
	default:
		return false
	}
}
func decodeReceipt(id, status, raw string) map[string]any {
	if status == "pending" || raw == "" {
		out := failure("mutation_unknown", "Durable intent exists without confirmed outcome; inspect project tasks, do not blindly repeat")
		out["request_id"] = id
		return out
	}
	var result map[string]any
	if json.Unmarshal([]byte(raw), &result) != nil {
		return failure("receipt_unavailable", "Stored receipt unreadable; mutation not repeated")
	}
	result["request_id"] = id
	result["receipt_status"] = status
	return result
}
func (s *Service) receipt(ctx context.Context, id string) map[string]any {
	var status, raw string
	if err := s.db.QueryRowContext(ctx, `SELECT status,result FROM orchestrator_control_operations WHERE request_id=?`, id).Scan(&status, &raw); err != nil {
		return failure("receipt_not_found", "No durable receipt observed for this request_id")
	}
	return decodeReceipt(id, status, raw)
}

func ToolSpecs() []map[string]any {
	stringField := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	return []map[string]any{{"type": "function", "name": "orchestra_control", "description": "Observe all registered projects, exact issue-backed tasks and authorized Git worktree registry. Create Backlog tasks, assign an explicit worker to an unassigned Backlog task, queue complete Backlog tasks, explicitly approve a ready local plan, or request a replan with feedback. Assignment never infers a provider or starts execution. Planning remains read-only in Todo until explicit approval. Never infer running/worktree readiness from state alone. Mutations require stable UUID request_id; inspect receipts and tasks after uncertainty. PR review controls bind exact task, PR, head and reviewer attempt; clean review requires explicit human approval, and completion requires fresh merged evidence. No pause/stop/delete or PR publication mutations.", "inputSchema": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"operation"}, "properties": map[string]any{
		"operation":  map[string]any{"type": "string", "enum": []string{"projects", "tasks", "worktrees", "status", "create", "assign", "queue", "approve_plan", "replan", "reviewers", "request_review", "approve_review", "complete_review", "receipt"}},
		"project_id": stringField("Exact registered project ID; required for tasks/create/assign/queue/approve_plan/replan"), "task_id": stringField("Exact task ID; required for assign/queue/approve_plan/replan"), "request_id": stringField("Canonical UUID retained for mutation reconciliation"), "expected_state": stringField("Assign/queue require Backlog; approve_plan requires Todo; replan requires Todo, In Progress or Review"), "expected_plan_hash": stringField("Opaque exact current plan/context fingerprint required for approve_plan/replan"), "feedback": stringField("Nonblank durable human or agent feedback required for replan"), "title": stringField("New Backlog task title"), "description": stringField("New Backlog task description"), "assignee_id": stringField("Exact task owner identity; assignment does not infer it from provider"), "provider": stringField("Provider harness for task creation, explicit assignment or request_review"), "expected_pr_url": stringField("Exact stored canonical PR URL required for review controls"), "expected_head_sha": stringField("Fresh full PR head SHA required for review controls"), "review_attempt_id": stringField("Exact reviewer attempt UUID required for approval/completion"), "reviewer_agent_id": stringField("Supported provider-default native profile required for request_review"), "unassigned": map[string]any{"type": "boolean", "description": "Return only tasks with no assignee; mutually exclusive with assignee_id on tasks operation"},
	}}}}
}

var _ agents.ToolExecutor = (*Service)(nil).Execute
