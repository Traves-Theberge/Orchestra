// Package sqlite provides a SQLite-backed implementation of the tracker.Client interface.
package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

// All task reads share the same projection and scan contract.
const issueColumns = "id, identifier, title, description, state, assignee_id, project_id, priority, branch_name, url, labels, blocked_by, provider, disabled_tools, created_at, updated_at, base_sha, feedback, pr_url, plan, runtime_target, acceptance_criteria, attachments, agent_guidance, source_template, authoring_session_id, requested_model, requested_max_turns"

// Client is a SQLite-backed tracker that persists issues in a local database.
type Client struct {
	db                *db.DB
	workerAssigneeIDs map[string]struct{}
}

// NewClient creates a new SQLite-backed Client using the given database connection
// and a list of worker assignee IDs used to determine issue ownership.
func NewClient(localDB *db.DB, workerAssigneeIDs []string) *Client {
	assigneeSet := map[string]struct{}{}
	for _, value := range workerAssigneeIDs {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			assigneeSet[trimmed] = struct{}{}
		}
	}
	return &Client{
		db:                localDB,
		workerAssigneeIDs: assigneeSet,
	}
}

// FetchCandidateIssues returns issues whose state matches one of the given active states, ordered by identifier.
func (c *Client) FetchCandidateIssues(ctx context.Context, activeStates []string) ([]tracker.Issue, error) {
	if len(activeStates) == 0 {
		return []tracker.Issue{}, nil
	}

	query := "SELECT " + issueColumns + " FROM issues WHERE LOWER(TRIM(state)) IN ("
	args := make([]any, len(activeStates))
	for i, state := range activeStates {
		args[i] = strings.ToLower(strings.TrimSpace(state))
		query += "?"
		if i < len(activeStates)-1 {
			query += ", "
		}
	}
	query += ") ORDER BY identifier ASC, id ASC;"

	return c.queryIssues(ctx, query, args...)
}

// FetchIssuesByIDs returns issues matching the given IDs.
func (c *Client) FetchIssuesByIDs(ctx context.Context, issueIDs []string) ([]tracker.Issue, error) {
	if len(issueIDs) == 0 {
		return []tracker.Issue{}, nil
	}

	query := "SELECT " + issueColumns + " FROM issues WHERE id IN ("
	args := make([]any, len(issueIDs))
	for i, id := range issueIDs {
		args[i] = id
		query += "?"
		if i < len(issueIDs)-1 {
			query += ", "
		}
	}
	query += ");"

	return c.queryIssues(ctx, query, args...)
}

// FetchIssueStatesByIDs returns a map of issue ID to current state for the given IDs.
func (c *Client) FetchIssueStatesByIDs(ctx context.Context, issueIDs []string) (map[string]string, error) {
	issues, err := c.FetchIssuesByIDs(ctx, issueIDs)
	if err != nil {
		return nil, err
	}

	states := make(map[string]string, len(issues))
	for _, issue := range issues {
		states[issue.ID] = issue.State
	}
	return states, nil
}

// FetchIssuesByStates returns issues filtered by the given states.
func (c *Client) FetchIssuesByStates(ctx context.Context, states []string) ([]tracker.Issue, error) {
	return c.FetchCandidateIssues(ctx, states)
}

// FetchIssues returns issues matching the given filter criteria including state, project, and assignee.
func (c *Client) FetchIssues(ctx context.Context, filter tracker.IssueFilter) ([]tracker.Issue, error) {
	query := "SELECT " + issueColumns + " FROM issues"
	var where []string
	var args []any

	if len(filter.States) > 0 {
		placeholders := make([]string, len(filter.States))
		for i, s := range filter.States {
			placeholders[i] = "?"
			args = append(args, strings.ToLower(strings.TrimSpace(s)))
		}
		where = append(where, fmt.Sprintf("LOWER(TRIM(state)) IN (%s)", strings.Join(placeholders, ",")))
	}

	if filter.ProjectID != "" {
		where = append(where, "project_id = ?")
		args = append(args, filter.ProjectID)
	}

	if filter.AssigneeID != "" {
		where = append(where, "assignee_id = ?")
		args = append(args, filter.AssigneeID)
	}

	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}

	query += " ORDER BY created_at DESC"
	return c.queryIssues(ctx, query, args...)
}

// SearchIssues performs a LIKE-based text search across issue titles, identifiers, and IDs.
func (c *Client) SearchIssues(ctx context.Context, query string) ([]tracker.Issue, error) {
	if query == "" {
		return []tracker.Issue{}, nil
	}

	sqlQuery := "SELECT " + issueColumns + " FROM issues WHERE title LIKE ? OR identifier LIKE ? OR id LIKE ?;"
	pattern := "%" + query + "%"
	return c.queryIssues(ctx, sqlQuery, pattern, pattern, pattern)
}

// CreateIssue inserts a new issue into the database with an auto-generated identifier
// based on the project prefix and returns the created issue.
func (c *Client) CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID string, provider string, disabledTools []string) (*tracker.Issue, error) {
	id := uuid.New().String()

	// Identifier generation: use project name as prefix (e.g. FETCH-1, NUDGE-1)
	prefix := "OPS"
	if projectID != "" {
		var projName string
		_ = c.db.QueryRowContext(ctx, "SELECT name FROM projects WHERE id = ?", projectID).Scan(&projName)
		if projName != "" {
			// Uppercase, remove spaces, max 10 chars
			clean := strings.ToUpper(strings.ReplaceAll(projName, " ", ""))
			if len(clean) > 10 {
				clean = clean[:10]
			}
			prefix = clean
		}
	}
	var maxNum int
	_ = c.db.QueryRowContext(ctx, "SELECT COALESCE(MAX(CAST(SUBSTR(identifier, LENGTH(?) + 2) AS INTEGER)), 0) FROM issues WHERE identifier LIKE ? || '-%'", prefix, prefix).Scan(&maxNum)
	identifier := fmt.Sprintf("%s-%d", prefix, maxNum+1)

	disabledToolsStr := strings.Join(disabledTools, ",")

	query := `
		INSERT INTO issues (id, identifier, title, description, state, assignee_id, project_id, priority, branch_name, url, labels, blocked_by, provider, disabled_tools, base_sha)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := c.db.ExecContext(ctx, query, id, identifier, title, description, state, assigneeID, projectID, priority, "", "", "[]", "[]", provider, disabledToolsStr, "")
	if err != nil {
		return nil, fmt.Errorf("create issue: %w", err)
	}

	return c.FetchIssueByIdentifier(ctx, id)
}

// UpdateIssue applies field updates to the issue matching the given identifier or ID.
// Only whitelisted columns are accepted to prevent injection.
func (c *Client) UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*tracker.Issue, error) {
	if len(updates) == 0 {
		return c.FetchIssueByIdentifier(ctx, identifier)
	}

	// Whitelist of allowed columns to prevent SQL injection via dynamic column names.
	allowedColumns := map[string]bool{
		"title": true, "description": true, "state": true, "assignee_id": true,
		"project_id": true, "priority": true, "branch_name": true, "url": true,
		"labels": true, "blocked_by": true, "provider": true, "disabled_tools": true,
		"base_sha": true, "feedback": true, "pr_url": true, "plan": true,
		// Studio-authored issue fields (added in Task 2 schema migration).
		"acceptance_criteria": true, "attachments": true, "agent_guidance": true,
		"source_template": true, "authoring_session_id": true, "runtime_target": true,
		"requested_model": true, "requested_max_turns": true,
	}

	query := "UPDATE issues SET "
	var args []any

	cols := make([]string, 0, len(updates))
	for col, val := range updates {
		if !allowedColumns[col] {
			return nil, fmt.Errorf("unsupported issue update field: %s", col)
		}
		if col == "requested_model" && val != nil {
			if _, ok := val.(string); !ok {
				return nil, fmt.Errorf("invalid requested_model: must be a string or null")
			}
		}
		if col == "requested_max_turns" {
			normalized, err := normalizeRequestedMaxTurns(val)
			if err != nil {
				return nil, err
			}
			val = normalized
		}
		if col == "acceptance_criteria" || col == "attachments" || col == "agent_guidance" {
			encoded, err := encodeAuthoringMetadata(col, val)
			if err != nil {
				return nil, err
			}
			val = encoded
		}
		if col == "disabled_tools" {
			if slice, ok := val.([]any); ok {
				strs := make([]string, 0, len(slice))
				for _, s := range slice {
					if str, ok := s.(string); ok {
						strs = append(strs, str)
					}
				}
				val = strings.Join(strs, ",")
			} else if slice, ok := val.([]string); ok {
				val = strings.Join(slice, ",")
			}
		} else if col == "labels" || col == "blocked_by" {
			if data, err := json.Marshal(val); err == nil {
				val = string(data)
			}
		}
		cols = append(cols, fmt.Sprintf("%s = ?", col))
		args = append(args, val)
	}

	if len(cols) == 0 {
		return c.FetchIssueByIdentifier(ctx, identifier)
	}

	cols = append(cols, "updated_at = CURRENT_TIMESTAMP")
	query += strings.Join(cols, ", ")
	query += " WHERE id = ? OR identifier = ?;"
	args = append(args, identifier, identifier)

	_, err := c.db.ExecContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("update issue: %w", err)
	}

	return c.FetchIssueByIdentifier(ctx, identifier)
}

// Studio historically passes pre-encoded JSON strings, while API callers pass
// decoded values. Validate both forms before the single UPDATE executes.
func encodeAuthoringMetadata(column string, value any) (string, error) {
	var raw []byte
	var err error
	if encoded, ok := value.(string); ok {
		raw = []byte(encoded)
	} else {
		raw, err = json.Marshal(value)
		if err != nil {
			return "", fmt.Errorf("encode issue %s: %w", column, err)
		}
	}
	var canonical any
	switch column {
	case "acceptance_criteria":
		var entries []any
		if err := json.Unmarshal(raw, &entries); err != nil {
			return "", fmt.Errorf("invalid issue acceptance_criteria: %w", err)
		}
		for _, entry := range entries {
			if _, ok := entry.(string); !ok {
				return "", fmt.Errorf("invalid issue acceptance_criteria: entries must be strings")
			}
		}
		items := []string{}
		err = json.Unmarshal(raw, &items)
		if items == nil {
			items = []string{}
		}
		canonical = items
	case "attachments":
		var entries []map[string]any
		if err := json.Unmarshal(raw, &entries); err != nil {
			return "", fmt.Errorf("invalid issue attachments: %w", err)
		}
		for _, entry := range entries {
			if entry == nil {
				return "", fmt.Errorf("invalid issue attachments: entries must be objects")
			}
			for field, value := range entry {
				switch field {
				case "kind", "path", "url", "label":
					if _, ok := value.(string); !ok {
						return "", fmt.Errorf("invalid issue attachments: %s must be a string", field)
					}
				default:
					return "", fmt.Errorf("invalid issue attachments: unknown field %s", field)
				}
			}
		}
		items := []tracker.Attachment{}
		err = json.Unmarshal(raw, &items)
		for _, attachment := range items {
			switch attachment.Kind {
			case "file":
				if strings.TrimSpace(attachment.Path) == "" || attachment.URL != "" {
					return "", fmt.Errorf("invalid issue attachments: file requires path and no url")
				}
			case "link":
				if strings.TrimSpace(attachment.URL) == "" || attachment.Path != "" {
					return "", fmt.Errorf("invalid issue attachments: link requires url and no path")
				}
			default:
				return "", fmt.Errorf("invalid issue attachments: kind must be file or link")
			}
		}
		if items == nil {
			items = []tracker.Attachment{}
		}
		canonical = items
	case "agent_guidance":
		guidance := map[string]any{}
		err = json.Unmarshal(raw, &guidance)
		if guidance == nil {
			guidance = map[string]any{}
		}
		canonical = guidance
	}
	if err != nil {
		return "", fmt.Errorf("invalid issue %s: %w", column, err)
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return "", fmt.Errorf("encode issue %s: %w", column, err)
	}
	return string(encoded), nil
}

// DeleteIssue removes the issue and its associated runs, history, and session references
// within a single transaction.
func (c *Client) DeleteIssue(ctx context.Context, identifier string) error {
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("delete issue begin tx: %w", err)
	}
	defer tx.Rollback()

	// Delete runs referencing this issue
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM runs
		WHERE issue_id IN (
			SELECT id FROM issues WHERE id = ? OR identifier = ?
		)
	`, identifier, identifier); err != nil {
		return fmt.Errorf("delete issue runs: %w", err)
	}

	// Delete issue history
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM issue_history
		WHERE issue_id IN (
			SELECT id FROM issues WHERE id = ? OR identifier = ?
		)
	`, identifier, identifier); err != nil {
		return fmt.Errorf("delete issue history: %w", err)
	}

	// Clear session.issue_id references
	if _, err := tx.ExecContext(ctx, `
		UPDATE sessions SET issue_id = NULL
		WHERE issue_id IN (
			SELECT id FROM issues WHERE id = ? OR identifier = ?
		)
	`, identifier, identifier); err != nil {
		return fmt.Errorf("clear session issue refs: %w", err)
	}

	// Delete the issue itself
	result, err := tx.ExecContext(ctx, "DELETE FROM issues WHERE id = ? OR identifier = ?;", identifier, identifier)
	if err != nil {
		return fmt.Errorf("delete issue: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete issue rows affected: %w", err)
	}
	if affected == 0 {
		return sql.ErrNoRows
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("delete issue commit: %w", err)
	}

	return nil
}

// FetchIssueByIdentifier returns a single issue matching the given identifier or ID,
// or nil if not found.
func (c *Client) FetchIssueByIdentifier(ctx context.Context, identifier string) (*tracker.Issue, error) {
	query := "SELECT " + issueColumns + " FROM issues WHERE id = ? OR identifier = ?;"
	issues, err := c.queryIssues(ctx, query, identifier, identifier)
	if err != nil {
		return nil, err
	}
	if len(issues) == 0 {
		return nil, nil // Not found
	}
	return &issues[0], nil
}

func (c *Client) queryIssues(ctx context.Context, query string, args ...any) ([]tracker.Issue, error) {
	rows, err := c.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query issues: %w", err)
	}
	defer rows.Close()

	var issues []tracker.Issue
	for rows.Next() {
		var issue tracker.Issue
		var title, description, assigneeID, projectID, branchName, url, labelsRaw, blockedByRaw, provider, disabledToolsRaw, createdAt, updatedAt, baseSHA, feedback, prURL, plan sql.NullString
		var runtimeTarget, criteriaRaw, attachmentsRaw, guidanceRaw, sourceTemplate, authoringSessionID, requestedModel sql.NullString
		var requestedMaxTurns sql.NullInt64

		if err := rows.Scan(
			&issue.ID, &issue.Identifier, &title, &description, &issue.State, &assigneeID, &projectID, &issue.Priority,
			&branchName, &url, &labelsRaw, &blockedByRaw, &provider, &disabledToolsRaw, &createdAt, &updatedAt, &baseSHA, &feedback, &prURL, &plan,
			&runtimeTarget, &criteriaRaw, &attachmentsRaw, &guidanceRaw, &sourceTemplate, &authoringSessionID, &requestedModel, &requestedMaxTurns,
		); err != nil {
			return nil, fmt.Errorf("scan issue: %w", err)
		}

		if title.Valid {
			issue.Title = title.String
		}
		if description.Valid {
			issue.Description = description.String
		}
		if assigneeID.Valid {
			issue.AssigneeID = assigneeID.String
		}
		if projectID.Valid {
			issue.ProjectID = projectID.String
		}
		if branchName.Valid {
			issue.BranchName = branchName.String
		}
		if url.Valid {
			issue.URL = url.String
		}
		if provider.Valid {
			issue.Provider = provider.String
		}
		if labelsRaw.Valid && labelsRaw.String != "" {
			_ = json.Unmarshal([]byte(labelsRaw.String), &issue.Labels)
		}
		if blockedByRaw.Valid && blockedByRaw.String != "" {
			_ = json.Unmarshal([]byte(blockedByRaw.String), &issue.BlockedBy)
		}
		if createdAt.Valid {
			issue.CreatedAt = createdAt.String
		}
		if updatedAt.Valid {
			issue.UpdatedAt = updatedAt.String
		}
		if disabledToolsRaw.Valid && disabledToolsRaw.String != "" {
			parts := strings.Split(disabledToolsRaw.String, ",")
			for _, p := range parts {
				t := strings.TrimSpace(p)
				if t != "" {
					issue.DisabledTools = append(issue.DisabledTools, t)
				}
			}
		}
		if baseSHA.Valid {
			issue.BaseSHA = baseSHA.String
		}
		if feedback.Valid {
			issue.Feedback = feedback.String
		}
		if prURL.Valid {
			issue.PRURL = prURL.String
		}
		if plan.Valid {
			issue.Plan = plan.String
		}

		issue.RuntimeTarget = runtimeTarget.String
		issue.RequestedModel = requestedModel.String
		if requestedMaxTurns.Valid {
			if requestedMaxTurns.Int64 < 1 || requestedMaxTurns.Int64 > 100 {
				return nil, fmt.Errorf("invalid stored requested_max_turns for %s", issue.Identifier)
			}
			value := int(requestedMaxTurns.Int64)
			issue.RequestedMaxTurns = &value
		}
		issue.SourceTemplate = sourceTemplate.String
		issue.AuthoringSessionID = authoringSessionID.String
		for _, field := range []struct {
			name, raw string
			target    any
		}{
			{"acceptance_criteria", criteriaRaw.String, &issue.AcceptanceCriteria},
			{"attachments", attachmentsRaw.String, &issue.Attachments},
			{"agent_guidance", guidanceRaw.String, &issue.AgentGuidance},
		} {
			if strings.TrimSpace(field.raw) == "" {
				continue
			}
			if err := json.Unmarshal([]byte(field.raw), field.target); err != nil {
				return nil, fmt.Errorf("decode issue %s %s: %w", issue.Identifier, field.name, err)
			}
		}

		if len(c.workerAssigneeIDs) == 0 {
			issue.AssignedToWorker = true
		} else {
			assignee := strings.TrimSpace(issue.AssigneeID)
			if assignee == "" {
				// If no assignee but we HAVE worker IDs, it's not assigned to worker
				issue.AssignedToWorker = false
			} else {
				_, issue.AssignedToWorker = c.workerAssigneeIDs[assignee]
			}
		}

		issues = append(issues, issue)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error: %w", err)
	}

	return issues, nil
}

// Normalize Studio values and decoded JSON numbers before the single SQL update.
func normalizeRequestedMaxTurns(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	if ptr, ok := value.(*int); ok {
		if ptr == nil {
			return nil, nil
		}
		value = *ptr
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("invalid requested_max_turns: %w", err)
	}
	number, ok := new(big.Rat).SetString(string(raw))
	if !ok || !number.IsInt() || !number.Num().IsInt64() {
		return nil, fmt.Errorf("invalid requested_max_turns: integer from 1 to 100 or null required")
	}
	turns := number.Num().Int64()
	if turns < 1 || turns > 100 {
		return nil, fmt.Errorf("invalid requested_max_turns: integer from 1 to 100 required")
	}
	return turns, nil
}
