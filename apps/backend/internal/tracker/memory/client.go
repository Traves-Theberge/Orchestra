package memory

import (
	"context"
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

func (c *Client) FetchIssuesByStates(_ context.Context, states []string) ([]tracker.Issue, error) {
	stateSet := normalizeStateSet(states)
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
