// Package tracker defines the interface and types for issue tracking backends.
package tracker

import "context"

// Issue is a backward-compatible alias for WorkItem.
// All existing code using tracker.Issue continues to compile unchanged.
type Issue = WorkItem

// Blocker represents an issue that blocks another issue from progressing.
type Blocker struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier,omitempty"`
	State      string `json:"state,omitempty"`
}

// IssueFilter is a backward-compatible alias for Filter.
type IssueFilter = Filter

// Client defines the interface for issue tracker operations including
// fetching, creating, updating, and deleting issues.
type Client interface {
	// FetchCandidateIssues returns issues whose state matches one of the given active states.
	FetchCandidateIssues(ctx context.Context, activeStates []string) ([]Issue, error)
	// FetchIssuesByIDs returns issues matching the given IDs.
	FetchIssuesByIDs(ctx context.Context, issueIDs []string) ([]Issue, error)
	// FetchIssuesByStates returns issues filtered by the given states.
	FetchIssuesByStates(ctx context.Context, states []string) ([]Issue, error)
	// FetchIssueStatesByIDs returns a map of issue ID to current state for the given IDs.
	FetchIssueStatesByIDs(ctx context.Context, issueIDs []string) (map[string]string, error)
	// FetchIssues returns issues matching the given filter criteria.
	FetchIssues(ctx context.Context, filter IssueFilter) ([]Issue, error)
	// SearchIssues performs a text search across issues and returns matches.
	SearchIssues(ctx context.Context, query string) ([]Issue, error)
	// FetchIssueByIdentifier returns a single issue by its identifier or ID.
	FetchIssueByIdentifier(ctx context.Context, identifier string) (*Issue, error)
	// CreateIssue creates a new issue with the given attributes and returns it.
	CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID string, provider string, disabledTools []string) (*Issue, error)
	// UpdateIssue applies the given field updates to the issue identified by its identifier.
	UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*Issue, error)
	// DeleteIssue removes the issue identified by the given identifier.
	DeleteIssue(ctx context.Context, identifier string) error
}
