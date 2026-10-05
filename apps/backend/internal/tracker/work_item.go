package tracker

import (
	"context"
)

// Attachment identifies authoring context without implying it has been
// materialized or made available to a provider.
type Attachment struct {
	Kind  string `json:"kind"`
	Path  string `json:"path,omitempty"`
	URL   string `json:"url,omitempty"`
	Label string `json:"label,omitempty"`
}

// WorkItem is the canonical domain type for a tracked work item across all backends.
type WorkItem struct {
	ID string `json:"id"`
	// SourceID is the identifier expected by the source API. ID may include
	// Orchestra's source prefix (for example, "linear:<uuid>").
	SourceID    string `json:"source_id,omitempty"`
	Identifier  string `json:"identifier"`
	Source      string `json:"source,omitempty"` // "github"|"linear"|"jira"|"sqlite"|"memory"
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Priority    int    `json:"priority,omitempty"`
	State       string `json:"state"`
	BranchName  string `json:"branch_name,omitempty"`
	URL         string `json:"url,omitempty"`
	// SourceProjectID identifies the native container (Linear team, Jira project,
	// GitHub repository) independently from Orchestra's local project UUID.
	SourceProjectID string `json:"source_project_id,omitempty"`
	ProjectID       string `json:"project_id,omitempty"`
	// AssigneeID is the single primary assignee — set by all backends.
	AssigneeID string `json:"assignee_id,omitempty"`
	// Assignees is the full set of assignees for backends that support multiple
	// (e.g. Jira, GitHub). Single-assignee backends populate AssigneeID only.
	Assignees        []string  `json:"assignees,omitempty"`
	AssignedToWorker bool      `json:"assigned_to_worker"`
	Labels           []string  `json:"labels,omitempty"`
	BlockedBy        []Blocker `json:"blocked_by,omitempty"`
	CreatedAt        string    `json:"created_at,omitempty"`
	UpdatedAt        string    `json:"updated_at,omitempty"`
	Provider         string    `json:"provider,omitempty"`
	RuntimeTarget    string    `json:"runtime_target,omitempty"`
	// Requested values are authoring intent, not evidence of provider execution.
	RequestedModel     string         `json:"requested_model,omitempty"`
	RequestedMaxTurns  *int           `json:"requested_max_turns"`
	DisabledTools      []string       `json:"disabled_tools,omitempty"`
	BaseSHA            string         `json:"base_sha,omitempty"`
	Feedback           string         `json:"feedback,omitempty"`
	PRURL              string         `json:"pr_url,omitempty"`
	Plan               string         `json:"plan,omitempty"`
	PlanGate           *PlanGate      `json:"plan_gate,omitempty"`
	ReviewGate         *ReviewGate    `json:"review_gate,omitempty"`
	AcceptanceCriteria []string       `json:"acceptance_criteria,omitempty"`
	Attachments        []Attachment   `json:"attachments,omitempty"`
	AgentGuidance      map[string]any `json:"agent_guidance,omitempty"`
	SourceTemplate     string         `json:"source_template,omitempty"`
	AuthoringSessionID string         `json:"authoring_session_id,omitempty"`
	Extra              map[string]any `json:"extra,omitempty"`
}

// PlanGate is Orchestra's human approval state for a task plan. PlanHash is an
// opaque fingerprint of the current task context and plan, not a provider ID.
type PlanGate struct {
	Status   string `json:"status"`
	PlanHash string `json:"plan_hash,omitempty"`
	Reason   string `json:"reason,omitempty"`
}

// ReviewGate is last recorded PR-review evidence, not a fresh remote snapshot.
type ReviewGate struct {
	Status           string `json:"status"`
	Freshness        string `json:"freshness,omitempty"`
	HeadSHA          string `json:"head_sha,omitempty"`
	PRURL            string `json:"pr_url,omitempty"`
	AttemptID        string `json:"attempt_id,omitempty"`
	ReviewerProvider string `json:"reviewer_provider,omitempty"`
	ReviewerAgentID  string `json:"reviewer_agent_id,omitempty"`
	Feedback         string `json:"feedback,omitempty"`
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
	Key  string `json:"key,omitempty"`
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
