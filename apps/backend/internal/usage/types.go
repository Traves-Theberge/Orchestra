// Package usage tracks per-provider agent usage by scanning local CLI session
// logs (Claude, Codex, Gemini, OpenCode), aggregating tokens & cost, and
// exposing a query API for the desktop UI.
//
// Architecture mirrors Orca's claude-usage / codex-usage stack: a
// per-provider Scanner reads local files, a Store persists incremental
// state to JSON, and the Service exposes scoped/ranged queries.
package usage

import "time"

// Provider identifies a coding-agent CLI we track usage for.
type Provider string

const (
	ProviderClaude   Provider = "claude"
	ProviderCodex    Provider = "codex"
	ProviderGemini   Provider = "gemini"
	ProviderOpenCode Provider = "opencode"
)

func (p Provider) Valid() bool {
	switch p {
	case ProviderClaude, ProviderCodex, ProviderGemini, ProviderOpenCode:
		return true
	}
	return false
}

// Scope filters usage to project-scoped sessions only or all local sessions.
type Scope string

const (
	ScopeOrchestra Scope = "orchestra" // sessions inside a known project worktree
	ScopeAll       Scope = "all"       // all local CLI usage
)

func (s Scope) Valid() bool { return s == ScopeOrchestra || s == ScopeAll }

// Range cutoff for time-windowed queries.
type Range string

const (
	Range7d  Range = "7d"
	Range30d Range = "30d"
	Range90d Range = "90d"
	RangeAll Range = "all"
)

func (r Range) Valid() bool {
	switch r {
	case Range7d, Range30d, Range90d, RangeAll:
		return true
	}
	return false
}

// Cutoff returns the start time for the range, or zero time for "all".
func (r Range) Cutoff(now time.Time) time.Time {
	switch r {
	case Range7d:
		return now.AddDate(0, 0, -7)
	case Range30d:
		return now.AddDate(0, 0, -30)
	case Range90d:
		return now.AddDate(0, 0, -90)
	}
	return time.Time{}
}

// BreakdownKind selects the dimension of a breakdown query.
type BreakdownKind string

const (
	BreakdownByModel   BreakdownKind = "model"
	BreakdownByProject BreakdownKind = "project"
)

func (k BreakdownKind) Valid() bool {
	return k == BreakdownByModel || k == BreakdownByProject
}

// ScanState reports the live state of a provider scanner.
type ScanState struct {
	Provider            Provider `json:"provider"`
	Enabled             bool     `json:"enabled"`
	IsScanning          bool     `json:"is_scanning"`
	LastScanStartedAt   *int64   `json:"last_scan_started_at,omitempty"`
	LastScanCompletedAt *int64   `json:"last_scan_completed_at,omitempty"`
	LastScanError       string   `json:"last_scan_error,omitempty"`
	HasAnyData          bool     `json:"has_any_data"`
	SourcePathExists    bool     `json:"source_path_exists"`
	SourcePath          string   `json:"source_path,omitempty"`
}

// Session is the canonical per-session record produced by a scanner. Token
// fields use a unified shape; providers that don't track a particular bucket
// (e.g. cache writes for Codex) leave it zero.
type Session struct {
	Provider           Provider  `json:"provider"`
	SessionID          string    `json:"session_id"`
	FirstTimestamp     time.Time `json:"first_timestamp"`
	LastTimestamp      time.Time `json:"last_timestamp"`
	PrimaryModel       string    `json:"primary_model"` // "" if unknown
	HasMixedModels     bool      `json:"has_mixed_models"`
	ProjectKey         string    `json:"project_key"`   // canonical project id
	ProjectLabel       string    `json:"project_label"` // human-friendly
	WorktreeID         string    `json:"worktree_id,omitempty"`
	RepoID             string    `json:"repo_id,omitempty"`
	Branch             string    `json:"branch,omitempty"`
	TurnCount          int       `json:"turn_count"` // turns or events depending on provider
	InputTokens        int64     `json:"input_tokens"`
	CachedInputTokens  int64     `json:"cached_input_tokens"`
	OutputTokens       int64     `json:"output_tokens"`
	CacheReadTokens    int64     `json:"cache_read_tokens"`
	CacheWriteTokens   int64     `json:"cache_write_tokens"`
	ReasoningTokens    int64     `json:"reasoning_tokens"`
	HasInferredPricing bool      `json:"has_inferred_pricing"`
}

// DailyAggregate is a per-(day,model,project) rollup used to drive both the
// daily stacked chart and the breakdown tables.
type DailyAggregate struct {
	Provider           Provider `json:"provider"`
	Day                string   `json:"day"` // YYYY-MM-DD
	Model              string   `json:"model"`
	ProjectKey         string   `json:"project_key"`
	ProjectLabel       string   `json:"project_label"`
	WorktreeID         string   `json:"worktree_id,omitempty"`
	RepoID             string   `json:"repo_id,omitempty"`
	TurnCount          int      `json:"turn_count"`
	ZeroCacheReadTurns int      `json:"zero_cache_read_turns"`
	InputTokens        int64    `json:"input_tokens"`
	CachedInputTokens  int64    `json:"cached_input_tokens"`
	OutputTokens       int64    `json:"output_tokens"`
	CacheReadTokens    int64    `json:"cache_read_tokens"`
	CacheWriteTokens   int64    `json:"cache_write_tokens"`
	ReasoningTokens    int64    `json:"reasoning_tokens"`
	HasInferredPricing bool     `json:"has_inferred_pricing"`
}

// ProcessedFile tracks scanner incremental state — files we've already parsed.
type ProcessedFile struct {
	Path    string `json:"path"`
	MtimeMs int64  `json:"mtime_ms"`
	Size    int64  `json:"size"`
}

// PersistedState is what we serialize per provider to
// {workspace}/.orchestra/usage-{provider}.json.
type PersistedState struct {
	SchemaVersion       int                `json:"schema_version"`
	Provider            Provider           `json:"provider"`
	WorktreeFingerprint string             `json:"worktree_fingerprint,omitempty"`
	ProcessedFiles      []ProcessedFile    `json:"processed_files"`
	Sessions            []Session          `json:"sessions"`
	DailyAggregates     []DailyAggregate   `json:"daily_aggregates"`
	ScanState           PersistedScanState `json:"scan_state"`
}

type PersistedScanState struct {
	Enabled             bool   `json:"enabled"`
	LastScanStartedAt   int64  `json:"last_scan_started_at"`
	LastScanCompletedAt int64  `json:"last_scan_completed_at"`
	LastScanError       string `json:"last_scan_error"`
}

// Summary is the headline KPI block for a provider.
type Summary struct {
	Provider           Provider `json:"provider"`
	Scope              Scope    `json:"scope"`
	Range              Range    `json:"range"`
	Sessions           int      `json:"sessions"`
	Turns              int      `json:"turns"`
	ZeroCacheReadTurns int      `json:"zero_cache_read_turns"`
	InputTokens        int64    `json:"input_tokens"`
	CachedInputTokens  int64    `json:"cached_input_tokens"`
	OutputTokens       int64    `json:"output_tokens"`
	CacheReadTokens    int64    `json:"cache_read_tokens"`
	CacheWriteTokens   int64    `json:"cache_write_tokens"`
	ReasoningTokens    int64    `json:"reasoning_tokens"`
	TotalTokens        int64    `json:"total_tokens"`
	CacheReuseRate     *float64 `json:"cache_reuse_rate,omitempty"` // nil if N/A
	EstimatedCostUSD   *float64 `json:"estimated_cost_usd,omitempty"`
	TopModel           string   `json:"top_model,omitempty"`
	TopProject         string   `json:"top_project,omitempty"`
	HasAnyData         bool     `json:"has_any_data"`
	HasInferredPricing bool     `json:"has_inferred_pricing"`
}

// DailyPoint is a single time-series datum for the stacked chart.
type DailyPoint struct {
	Day               string `json:"day"`
	InputTokens       int64  `json:"input_tokens"`
	CachedInputTokens int64  `json:"cached_input_tokens"`
	OutputTokens      int64  `json:"output_tokens"`
	CacheReadTokens   int64  `json:"cache_read_tokens"`
	CacheWriteTokens  int64  `json:"cache_write_tokens"`
	ReasoningTokens   int64  `json:"reasoning_tokens"`
}

// BreakdownRow is one row in a model-or-project breakdown table.
type BreakdownRow struct {
	Key                string   `json:"key"`
	Label              string   `json:"label"`
	Sessions           int      `json:"sessions"`
	Turns              int      `json:"turns"`
	InputTokens        int64    `json:"input_tokens"`
	CachedInputTokens  int64    `json:"cached_input_tokens"`
	OutputTokens       int64    `json:"output_tokens"`
	CacheReadTokens    int64    `json:"cache_read_tokens"`
	CacheWriteTokens   int64    `json:"cache_write_tokens"`
	ReasoningTokens    int64    `json:"reasoning_tokens"`
	TotalTokens        int64    `json:"total_tokens"`
	EstimatedCostUSD   *float64 `json:"estimated_cost_usd,omitempty"`
	HasInferredPricing bool     `json:"has_inferred_pricing"`
}

// SessionRow is a recent-sessions list entry.
type SessionRow struct {
	Provider           Provider  `json:"provider"`
	SessionID          string    `json:"session_id"`
	LastActiveAt       time.Time `json:"last_active_at"`
	DurationMinutes    int       `json:"duration_minutes"`
	ProjectLabel       string    `json:"project_label"`
	Branch             string    `json:"branch,omitempty"`
	Model              string    `json:"model,omitempty"`
	Turns              int       `json:"turns"`
	InputTokens        int64     `json:"input_tokens"`
	CachedInputTokens  int64     `json:"cached_input_tokens"`
	OutputTokens       int64     `json:"output_tokens"`
	CacheReadTokens    int64     `json:"cache_read_tokens"`
	CacheWriteTokens   int64     `json:"cache_write_tokens"`
	ReasoningTokens    int64     `json:"reasoning_tokens"`
	EstimatedCostUSD   *float64  `json:"estimated_cost_usd,omitempty"`
	HasInferredPricing bool      `json:"has_inferred_pricing"`
}

// RateLimitWindow describes one quota window (session/weekly).
type RateLimitWindow struct {
	UsedPercent      float64 `json:"used_percent"`
	WindowMinutes    int     `json:"window_minutes"`
	ResetsAt         *int64  `json:"resets_at,omitempty"`
	ResetDescription string  `json:"reset_description,omitempty"`
}

// ProviderRateLimits captures a provider's quota state.
type ProviderRateLimits struct {
	Provider  Provider         `json:"provider"`
	Session   *RateLimitWindow `json:"session,omitempty"`
	Weekly    *RateLimitWindow `json:"weekly,omitempty"`
	UpdatedAt int64            `json:"updated_at"`
	Status    RateLimitStatus  `json:"status"`
	Error     string           `json:"error,omitempty"`
}

type RateLimitStatus string

const (
	RateLimitIdle        RateLimitStatus = "idle"
	RateLimitFetching    RateLimitStatus = "fetching"
	RateLimitOK          RateLimitStatus = "ok"
	RateLimitErrored     RateLimitStatus = "error"
	RateLimitUnavailable RateLimitStatus = "unavailable"
)

// RateLimitState is the bundled state for all providers.
type RateLimitState struct {
	Claude   *ProviderRateLimits `json:"claude,omitempty"`
	Codex    *ProviderRateLimits `json:"codex,omitempty"`
	Gemini   *ProviderRateLimits `json:"gemini,omitempty"`
	OpenCode *ProviderRateLimits `json:"opencode,omitempty"`
}
