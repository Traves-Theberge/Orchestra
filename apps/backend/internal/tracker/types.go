package tracker

import "context"

type Issue struct {
	ID               string    `json:"id"`
	Identifier       string    `json:"identifier"`
	Title            string    `json:"title"`
	Description      string    `json:"description,omitempty"`
	Priority         int       `json:"priority,omitempty"`
	State            string    `json:"state"`
	BranchName       string    `json:"branch_name,omitempty"`
	URL              string    `json:"url,omitempty"`
	ProjectID        string    `json:"project_id,omitempty"`
	AssigneeID       string    `json:"assignee_id,omitempty"`
	AssignedToWorker bool      `json:"assigned_to_worker"`
	Labels           []string  `json:"labels,omitempty"`
	BlockedBy        []Blocker `json:"blocked_by,omitempty"`
	CreatedAt        string    `json:"created_at,omitempty"`
	UpdatedAt        string    `json:"updated_at,omitempty"`
	Provider         string    `json:"provider,omitempty"`
	DisabledTools    []string  `json:"disabled_tools,omitempty"`
}

type Blocker struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier,omitempty"`
	State      string `json:"state,omitempty"`
}

type IssueFilter struct {
	States     []string
	ProjectID  string
	AssigneeID string
}

type Client interface {
	FetchCandidateIssues(ctx context.Context, activeStates []string) ([]Issue, error)
	FetchIssuesByIDs(ctx context.Context, issueIDs []string) ([]Issue, error)
	FetchIssuesByStates(ctx context.Context, states []string) ([]Issue, error)
	FetchIssueStatesByIDs(ctx context.Context, issueIDs []string) (map[string]string, error)
	FetchIssues(ctx context.Context, filter IssueFilter) ([]Issue, error)
	SearchIssues(ctx context.Context, query string) ([]Issue, error)
	FetchIssueByIdentifier(ctx context.Context, identifier string) (*Issue, error)
	CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID string, provider string, disabledTools []string) (*Issue, error)
	UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*Issue, error)
	DeleteIssue(ctx context.Context, identifier string) error
}
