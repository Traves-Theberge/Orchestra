package memory

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

type Client struct {
	mu     sync.RWMutex
	issues map[string]tracker.Issue
}

func NewClient(seed []tracker.Issue) *Client {
	return NewClientWithWorkerAssignees(seed, nil)
}

func NewClientWithWorkerAssignees(seed []tracker.Issue, workerAssigneeIDs []string) *Client {
	assigneeSet := map[string]struct{}{}
	for _, value := range workerAssigneeIDs {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			assigneeSet[trimmed] = struct{}{}
		}
	}

	issues := make(map[string]tracker.Issue, len(seed))
	for _, issue := range seed {
		if len(assigneeSet) == 0 {
			issue.AssignedToWorker = true
		} else {
			_, issue.AssignedToWorker = assigneeSet[strings.TrimSpace(issue.AssigneeID)]
		}
		issues[issue.ID] = issue
	}
	return &Client{issues: issues}
}

func (c *Client) FetchCandidateIssues(_ context.Context, activeStates []string) ([]tracker.Issue, error) {
	stateSet := normalizeStateSet(activeStates)
	c.mu.RLock()
	defer c.mu.RUnlock()

	out := make([]tracker.Issue, 0)
	for _, issue := range c.issues {
		if _, ok := stateSet[normalize(issue.State)]; ok {
			out = append(out, issue)
		}
	}
	sortIssues(out)

	return out, nil
}

func (c *Client) FetchIssueStatesByIDs(_ context.Context, issueIDs []string) (map[string]string, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	out := map[string]string{}
	for _, issueID := range issueIDs {
		issue, ok := c.issues[issueID]
		if ok {
			out[issueID] = issue.State
		}
	}

	return out, nil
}

func (c *Client) FetchIssuesByIDs(_ context.Context, issueIDs []string) ([]tracker.Issue, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	out := make([]tracker.Issue, 0, len(issueIDs))
	for _, issueID := range issueIDs {
		issue, ok := c.issues[issueID]
		if ok {
			out = append(out, issue)
		}
	}
	return out, nil
}

func (c *Client) FetchIssues(_ context.Context, filter tracker.IssueFilter) ([]tracker.Issue, error) {
	stateSet := normalizeStateSet(filter.States)
	c.mu.RLock()
	defer c.mu.RUnlock()

	out := make([]tracker.Issue, 0)
	for _, issue := range c.issues {
		if len(filter.States) > 0 {
			if _, ok := stateSet[normalize(issue.State)]; !ok {
				continue
			}
		}
		if filter.ProjectID != "" && issue.ProjectID != filter.ProjectID {
			continue
		}
		if filter.AssigneeID != "" && issue.AssigneeID != filter.AssigneeID {
			continue
		}
		out = append(out, issue)
	}
	sortIssues(out)

	return out, nil
}

func (c *Client) FetchIssuesByStates(ctx context.Context, states []string) ([]tracker.Issue, error) {
	return c.FetchIssues(ctx, tracker.IssueFilter{States: states})
}

func (c *Client) SetIssueState(issueID string, state string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	issue, ok := c.issues[issueID]
	if !ok {
		return
	}
	issue.State = state
	c.issues[issueID] = issue
}

func (c *Client) SearchIssues(_ context.Context, query string) ([]tracker.Issue, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var out []tracker.Issue
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return []tracker.Issue{}, nil
	}

	for _, issue := range c.issues {
		if strings.Contains(strings.ToLower(issue.Identifier), q) ||
			strings.Contains(strings.ToLower(issue.Title), q) ||
			strings.Contains(strings.ToLower(issue.Description), q) {
			out = append(out, issue)
		}
	}

	sortIssues(out)
	return out, nil
}

func (c *Client) CreateIssue(_ context.Context, title, description, state string, priority int, assigneeID, projectID string) (*tracker.Issue, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	id := fmt.Sprintf("%d", len(c.issues)+1)
	identifier := fmt.Sprintf("OPS-%s", id)

	issue := tracker.Issue{
		ID:         id,
		Identifier: identifier,
		Title:      title,
		Description: description,
		State:      state,
		Priority:   priority,
		AssigneeID: assigneeID,
		ProjectID:  projectID,
	}

	c.issues[id] = issue
	return &issue, nil
}

func (c *Client) UpdateIssue(_ context.Context, identifier string, updates map[string]any) (*tracker.Issue, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	var target *tracker.Issue
	for id, issue := range c.issues {
		if issue.Identifier == identifier || issue.ID == identifier {
			copy := issue
			target = &copy
			defer func(id string) {
				c.issues[id] = *target
			}(id)
			break
		}
	}

	if target == nil {
		return nil, nil
	}

	if val, ok := updates["state"]; ok {
		if s, ok := val.(string); ok {
			target.State = s
		}
	}
	if val, ok := updates["assignee_id"]; ok {
		if s, ok := val.(string); ok {
			target.AssigneeID = s
		}
	}
	if val, ok := updates["project_id"]; ok {
		if s, ok := val.(string); ok {
			target.ProjectID = s
		}
	}
	if val, ok := updates["priority"]; ok {
		if n, ok := val.(int); ok {
			target.Priority = n
		} else if f, ok := val.(float64); ok {
			target.Priority = int(f)
		}
	}

	return target, nil
}

func normalizeStateSet(values []string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, value := range values {
		n := normalize(value)
		if n != "" {
			out[n] = struct{}{}
		}
	}
	return out
}

func normalize(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func sortIssues(issues []tracker.Issue) {
	sort.SliceStable(issues, func(i int, j int) bool {
		left := strings.TrimSpace(issues[i].Identifier)
		right := strings.TrimSpace(issues[j].Identifier)
		if left == right {
			return issues[i].ID < issues[j].ID
		}
		return left < right
	})
}
