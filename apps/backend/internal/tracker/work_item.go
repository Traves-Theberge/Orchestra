package tracker

import "context"

// WorkItem is the canonical domain type for a tracked work item across all backends.
type WorkItem struct {
	ID          string `json:"id"`
	Identifier  string `json:"identifier"`
	Source      string `json:"source,omitempty"` // "github"|"linear"|"jira"|"sqlite"|"memory"
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Priority    int    `json:"priority,omitempty"`
	State       string `json:"state"`
	BranchName  string `json:"branch_name,omitempty"`
	URL         string `json:"url,omitempty"`
	ProjectID   string `json:"project_id,omitempty"`
	// AssigneeID is the single primary assignee — set by all backends.
	AssigneeID string `json:"assignee_id,omitempty"`
	// Assignees is the full set of assignees for backends that support multiple
	// (e.g. Jira, GitHub). Single-assignee backends populate AssigneeID only.
	Assignees        []string       `json:"assignees,omitempty"`
	AssignedToWorker bool           `json:"assigned_to_worker"`
	Labels           []string       `json:"labels,omitempty"`
	BlockedBy        []Blocker      `json:"blocked_by,omitempty"`
	CreatedAt        string         `json:"created_at,omitempty"`
	UpdatedAt        string         `json:"updated_at,omitempty"`
	Provider         string         `json:"provider,omitempty"`
	RuntimeTarget    string         `json:"runtime_target,omitempty"`
	DisabledTools    []string       `json:"disabled_tools,omitempty"`
	BaseSHA          string         `json:"base_sha,omitempty"`
	Feedback         string         `json:"feedback,omitempty"`
	PRURL            string         `json:"pr_url,omitempty"`
	Plan             string         `json:"plan,omitempty"`
	Extra            map[string]any `json:"extra,omitempty"`
}

// Filter narrows which WorkItems are returned by Adapter.Fetch.
type Filter struct {
	States     []string
	ProjectID  string
	AssigneeID string
}

// TrackerProject is a top-level container in a tracker (Linear team, Jira project, GitHub repo).
type TrackerProject struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// TrackerState is a workflow state available in a tracker connection.
type TrackerState struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"` // "todo"|"in_progress"|"done"|"cancelled"
}

// Adapter is the interface each tracker backend implements.
// The Registry wraps Adapter instances into tracker.Client for the rest of the codebase.
type Adapter interface {
	Fetch(ctx context.Context, filter Filter) ([]WorkItem, error)
	FetchByID(ctx context.Context, id string) (*WorkItem, error)
	Search(ctx context.Context, query string) ([]WorkItem, error)
	Create(ctx context.Context, item WorkItem) (*WorkItem, error)
	Update(ctx context.Context, id string, updates map[string]any) (*WorkItem, error)
	Delete(ctx context.Context, id string) error
	Comment(ctx context.Context, id, body string) error
	FetchProjects(ctx context.Context) ([]TrackerProject, error)
	FetchStates(ctx context.Context) ([]TrackerState, error)
	Ping(ctx context.Context) error
}
