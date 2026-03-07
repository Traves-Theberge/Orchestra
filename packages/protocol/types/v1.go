package protocol

type StateResponseV1 struct {
	GeneratedAt string             `json:"generated_at"`
	Counts      StateCountsV1      `json:"counts"`
	Running     []map[string]any   `json:"running"`
	Retrying    []map[string]any   `json:"retrying"`
	CodexTotals StateCodexTotalsV1 `json:"codex_totals"`
	RateLimits  any                `json:"rate_limits"`
}

type StateCountsV1 struct {
	Running  int `json:"running"`
	Retrying int `json:"retrying"`
}

type StateCodexTotalsV1 struct {
	InputTokens    int64   `json:"input_tokens"`
	OutputTokens   int64   `json:"output_tokens"`
	TotalTokens    int64   `json:"total_tokens"`
	SecondsRunning float64 `json:"seconds_running"`
}

type RefreshResponseV1 struct {
	Queued      bool     `json:"queued"`
	Coalesced   bool     `json:"coalesced"`
	RequestedAt string   `json:"requested_at"`
	Operations  []string `json:"operations"`
}

type IssueResponseV1 struct {
	IssueIdentifier string         `json:"issue_identifier"`
	IssueID         string         `json:"issue_id"`
	Status          string         `json:"status"`
	Workspace       map[string]any `json:"workspace"`
	Attempts        map[string]any `json:"attempts,omitempty"`
	Running         any            `json:"running,omitempty"`
	Retry           any            `json:"retry,omitempty"`
	Logs            any            `json:"logs,omitempty"`
	RecentEvents    []any          `json:"recent_events,omitempty"`
	LastError       any            `json:"last_error,omitempty"`
	Tracked         map[string]any `json:"tracked"`
}

type WorkspaceMigrateResponseV1 struct {
	From   string                     `json:"from"`
	To     string                     `json:"to"`
	DryRun bool                       `json:"dry_run"`
	Result WorkspaceMigrationResultV1 `json:"result"`
}

type WorkspaceMigrationPlanResponseV1 struct {
	From   string                     `json:"from"`
	To     string                     `json:"to"`
	Result WorkspaceMigrationResultV1 `json:"result"`
}

type WorkspaceMigrationResultV1 struct {
	Applied bool                         `json:"applied"`
	Actions []WorkspaceMigrationActionV1 `json:"actions"`
}

type WorkspaceMigrationActionV1 struct {
	Type   string `json:"type"`
	Source string `json:"source"`
	Target string `json:"target"`
	Note   string `json:"note,omitempty"`
}
