// Package plangate derives the local task plan-approval state from durable
// issue history. The fingerprint binds approval to the exact task context.
package plangate

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

type QueryRower interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type Querier interface {
	QueryRower
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func Fingerprint(issue tracker.Issue) string {
	// Tracker projections commonly represent the same empty collection as nil
	// or an empty JSON list. Canonicalize those values so a local SQLite
	// candidate and an exact task reload produce the same approval fingerprint.
	if issue.DisabledTools == nil {
		issue.DisabledTools = []string{}
	}
	if issue.Labels == nil {
		issue.Labels = []string{}
	}
	if issue.BlockedBy == nil {
		issue.BlockedBy = []tracker.Blocker{}
	}
	if issue.AcceptanceCriteria == nil {
		issue.AcceptanceCriteria = []string{}
	}
	if issue.Attachments == nil {
		issue.Attachments = []tracker.Attachment{}
	}
	if issue.AgentGuidance == nil {
		issue.AgentGuidance = map[string]any{}
	}
	value := struct {
		ID, Identifier, Source, SourceProjectID, ProjectID  string
		Title, Description, Feedback, Plan, BaseSHA         string
		BranchName, URL, PRURL                              string
		Priority                                            int
		AssigneeID, Provider, RuntimeTarget, RequestedModel string
		RequestedMaxTurns                                   *int
		DisabledTools, Labels                               []string
		BlockedBy                                           []tracker.Blocker
		AcceptanceCriteria                                  []string
		Attachments                                         []tracker.Attachment
		AgentGuidance                                       map[string]any
		SourceTemplate, AuthoringSessionID                  string
	}{
		ID: issue.ID, Identifier: issue.Identifier, Source: issue.Source,
		SourceProjectID: issue.SourceProjectID, ProjectID: issue.ProjectID,
		Title: issue.Title, Description: issue.Description, Feedback: issue.Feedback,
		Plan: issue.Plan, BaseSHA: issue.BaseSHA, Priority: issue.Priority,
		BranchName: issue.BranchName, URL: issue.URL, PRURL: issue.PRURL,
		AssigneeID: issue.AssigneeID, Provider: issue.Provider, RuntimeTarget: issue.RuntimeTarget,
		RequestedModel: issue.RequestedModel, RequestedMaxTurns: issue.RequestedMaxTurns,
		DisabledTools: issue.DisabledTools, Labels: issue.Labels, BlockedBy: issue.BlockedBy,
		AcceptanceCriteria: issue.AcceptanceCriteria, Attachments: issue.Attachments,
		AgentGuidance: issue.AgentGuidance, SourceTemplate: issue.SourceTemplate,
		AuthoringSessionID: issue.AuthoringSessionID,
	}
	encoded, _ := json.Marshal(value)
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

// LoadLocalTask reads the exact local task and returns its updated_at version.
// It accepts both *sql.DB and *sql.Tx callers.
func LoadLocalTask(ctx context.Context, q QueryRower, taskID, projectID string) (*tracker.Issue, string, error) {
	var issue tracker.Issue
	var title, description, assignee, branch, url, labels, blockedBy, provider, disabledTools string
	var baseSHA, feedback, prURL, plan, runtimeTarget, criteria, attachments, guidance string
	var sourceTemplate, authoringSession, requestedModel sql.NullString
	var requestedMaxTurns sql.NullInt64
	var updatedAt string
	err := q.QueryRowContext(ctx, `SELECT id,identifier,COALESCE(title,''),COALESCE(description,''),COALESCE(state,''),COALESCE(assignee_id,''),project_id,COALESCE(priority,0),COALESCE(branch_name,''),COALESCE(url,''),COALESCE(labels,'[]'),COALESCE(blocked_by,'[]'),COALESCE(provider,''),COALESCE(disabled_tools,''),CAST(updated_at AS TEXT),COALESCE(base_sha,''),COALESCE(feedback,''),COALESCE(pr_url,''),COALESCE(plan,''),COALESCE(runtime_target,''),COALESCE(acceptance_criteria,'[]'),COALESCE(attachments,'[]'),COALESCE(agent_guidance,'{}'),COALESCE(source_template,''),COALESCE(authoring_session_id,''),requested_model,requested_max_turns FROM issues WHERE id=? AND project_id=?`, taskID, projectID).Scan(
		&issue.ID, &issue.Identifier, &title, &description, &issue.State, &assignee, &issue.ProjectID, &issue.Priority,
		&branch, &url, &labels, &blockedBy, &provider, &disabledTools, &updatedAt, &baseSHA, &feedback,
		&prURL, &plan, &runtimeTarget, &criteria, &attachments, &guidance, &sourceTemplate, &authoringSession,
		&requestedModel, &requestedMaxTurns,
	)
	if err != nil {
		return nil, "", err
	}
	issue.Title, issue.Description, issue.AssigneeID = title, description, assignee
	issue.BranchName, issue.URL, issue.Provider = branch, url, provider
	issue.BaseSHA, issue.Feedback, issue.PRURL, issue.Plan = baseSHA, feedback, prURL, plan
	issue.RuntimeTarget = runtimeTarget
	issue.RequestedModel = requestedModel.String
	if requestedMaxTurns.Valid {
		value := int(requestedMaxTurns.Int64)
		issue.RequestedMaxTurns = &value
	}
	issue.DisabledTools = splitStoredList(disabledTools)
	if err := json.Unmarshal([]byte(defaultJSON(labels, "[]")), &issue.Labels); err != nil {
		return nil, "", err
	}
	if err := json.Unmarshal([]byte(defaultJSON(blockedBy, "[]")), &issue.BlockedBy); err != nil {
		return nil, "", err
	}
	if err := json.Unmarshal([]byte(defaultJSON(criteria, "[]")), &issue.AcceptanceCriteria); err != nil {
		return nil, "", err
	}
	if err := json.Unmarshal([]byte(defaultJSON(attachments, "[]")), &issue.Attachments); err != nil {
		return nil, "", err
	}
	if err := json.Unmarshal([]byte(defaultJSON(guidance, "{}")), &issue.AgentGuidance); err != nil {
		return nil, "", err
	}
	issue.SourceTemplate, issue.AuthoringSessionID = sourceTemplate.String, authoringSession.String
	return &issue, updatedAt, nil
}

func defaultJSON(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func splitStoredList(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

// Status reads the latest lifecycle event for the task and compares it with
// the current fingerprint. Invalidation events must remain authoritative even
// when they happen to carry the same fingerprint as an older approval.
// A nonempty legacy plan without a matching plan_ready event is stale and must
// be replanned before it can execute.
func Status(ctx context.Context, q QueryRower, issue tracker.Issue) (tracker.PlanGate, error) {
	if issue.ID == "" || issue.ProjectID == "" {
		return tracker.PlanGate{}, errors.New("plan gate requires exact local task and project identity")
	}
	fingerprint := Fingerprint(issue)
	gate := tracker.PlanGate{Status: "stale", PlanHash: fingerprint}
	if strings.TrimSpace(issue.Plan) == "" {
		gate.Status = "planning"
	}
	var action, eventValue string
	err := q.QueryRowContext(ctx, `SELECT action,new_value FROM issue_history WHERE issue_id=? AND action IN ('plan_ready','plan_approved','plan_failed','replan_requested','review_findings','plan_invalidated') ORDER BY timestamp DESC,rowid DESC LIMIT 1`, issue.ID).Scan(&action, &eventValue)
	if errors.Is(err, sql.ErrNoRows) {
		return gate, nil
	}
	if err != nil {
		return tracker.PlanGate{}, err
	}
	if eventValue != fingerprint {
		return gate, nil
	}
	switch action {
	case "plan_ready":
		gate.Status = "awaiting_approval"
	case "plan_approved":
		gate.Status = "approved"
	case "plan_failed":
		gate.Status = "failed"
	case "replan_requested", "review_findings", "plan_invalidated":
		gate.Status = "stale"
	}
	return gate, nil
}

func IsLocalSource(source string) bool {
	return strings.EqualFold(strings.TrimSpace(source), "sqlite") || strings.TrimSpace(source) == ""
}
