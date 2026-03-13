package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

type Client struct {
	db                *db.DB
	workerAssigneeIDs map[string]struct{}
}

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

func (c *Client) FetchCandidateIssues(ctx context.Context, activeStates []string) ([]tracker.Issue, error) {
	if len(activeStates) == 0 {
		return []tracker.Issue{}, nil
	}

	query := "SELECT id, identifier, title, description, state, assignee_id, project_id, priority, branch_name, url, labels, blocked_by, provider, disabled_tools, created_at, updated_at FROM issues WHERE LOWER(TRIM(state)) IN ("
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

func (c *Client) FetchIssuesByIDs(ctx context.Context, issueIDs []string) ([]tracker.Issue, error) {
	if len(issueIDs) == 0 {
		return []tracker.Issue{}, nil
	}

	query := "SELECT id, identifier, title, description, state, assignee_id, project_id, priority, branch_name, url, labels, blocked_by, provider, disabled_tools, created_at, updated_at FROM issues WHERE id IN ("
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

func (c *Client) FetchIssuesByStates(ctx context.Context, states []string) ([]tracker.Issue, error) {
	return c.FetchCandidateIssues(ctx, states)
}

func (c *Client) FetchIssues(ctx context.Context, filter tracker.IssueFilter) ([]tracker.Issue, error) {
	query := "SELECT id, identifier, title, description, state, assignee_id, project_id, priority, branch_name, url, labels, blocked_by, provider, disabled_tools, created_at, updated_at FROM issues"
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

func (c *Client) SearchIssues(ctx context.Context, query string) ([]tracker.Issue, error) {
	if query == "" {
		return []tracker.Issue{}, nil
	}

	sqlQuery := "SELECT id, identifier, title, description, state, assignee_id, project_id, priority, branch_name, url, labels, blocked_by, provider, disabled_tools, created_at, updated_at FROM issues WHERE title LIKE ? OR identifier LIKE ? OR id LIKE ?;"
	pattern := "%" + query + "%"
	return c.queryIssues(ctx, sqlQuery, pattern, pattern, pattern)
}

func (c *Client) CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID string, provider string, disabledTools []string) (*tracker.Issue, error) {
	id := uuid.New().String()

	// Simple identifier generation: OPS-count+1
	var count int
	_ = c.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM issues").Scan(&count)
	identifier := fmt.Sprintf("OPS-%d", count+1)

	disabledToolsStr := strings.Join(disabledTools, ",")

	query := `
		INSERT INTO issues (id, identifier, title, description, state, assignee_id, project_id, priority, branch_name, url, labels, blocked_by, provider, disabled_tools)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`
	_, err := c.db.ExecContext(ctx, query, id, identifier, title, description, state, assigneeID, projectID, priority, "", "", "[]", "[]", provider, disabledToolsStr)
	if err != nil {
		return nil, fmt.Errorf("create issue: %w", err)
	}

	return c.FetchIssueByIdentifier(ctx, id)
}

func (c *Client) UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*tracker.Issue, error) {
	if len(updates) == 0 {
		return c.FetchIssueByIdentifier(ctx, identifier)
	}

	query := "UPDATE issues SET "
	var args []any

	cols := make([]string, 0, len(updates))
	for col, val := range updates {
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

func (c *Client) DeleteIssue(ctx context.Context, identifier string) error {
	query := "DELETE FROM issues WHERE id = ? OR identifier = ?;"
	_, err := c.db.ExecContext(ctx, query, identifier, identifier)
	if err != nil {
		return fmt.Errorf("delete issue: %w", err)
	}
	return nil
}

func (c *Client) FetchIssueByIdentifier(ctx context.Context, identifier string) (*tracker.Issue, error) {
	query := "SELECT id, identifier, title, description, state, assignee_id, project_id, priority, branch_name, url, labels, blocked_by, provider, disabled_tools, created_at, updated_at FROM issues WHERE id = ? OR identifier = ?;"
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
		var title, description, assigneeID, projectID, branchName, url, labelsRaw, blockedByRaw, provider, disabledToolsRaw, createdAt, updatedAt sql.NullString

		if err := rows.Scan(
			&issue.ID, &issue.Identifier, &title, &description, &issue.State, &assigneeID, &projectID, &issue.Priority,
			&branchName, &url, &labelsRaw, &blockedByRaw, &provider, &disabledToolsRaw, &createdAt, &updatedAt,
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
