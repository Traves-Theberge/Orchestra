// Package automations runs saved prompts on a schedule through the workspace
// chat engine. Each run is one chat session with one message.
package automations

import (
	"errors"
)

var (
	ErrNotFound    = errors.New("automation not found")
	ErrInvalid     = errors.New("invalid automation request")
	ErrConflict    = errors.New("automation conflict")
	ErrUnavailable = errors.New("automations unavailable")
)

// Run statuses.
const (
	StatusQueued             = "queued"
	StatusStarting           = "starting"
	StatusRunning            = "running"
	StatusSucceeded          = "succeeded"
	StatusFailed             = "failed"
	StatusCancelled          = "cancelled"
	StatusSkippedPrecheck    = "skipped_precheck"
	StatusSkippedMissed      = "skipped_missed"
	StatusSkippedBusy        = "skipped_busy"
	StatusSkippedUnavailable = "skipped_unavailable"
)

const (
	TriggerScheduled = "scheduled"
	TriggerManual    = "manual"

	WorkspaceProject     = "project"
	WorkspaceNewWorktree = "new_worktree"

	DefaultGraceMinutes    = 720
	DefaultPrecheckTimeout = 60
	RunRetention           = 100
	MaxOutputBytes         = 64 * 1024
)

// IsActive reports whether a run status is non-terminal.
func IsActive(status string) bool {
	return status == StatusQueued || status == StatusStarting || status == StatusRunning
}

type Precheck struct {
	Command        string `json:"command"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

// AutomationInput is the create/patch body. Pointer fields distinguish
// "absent" from zero values for defaults.
type AutomationInput struct {
	Name            string    `json:"name"`
	Prompt          string    `json:"prompt"`
	Provider        string    `json:"provider"`
	Model           string    `json:"model"`
	ReasoningEffort string    `json:"reasoning_effort"`
	AgentID         string    `json:"agent_id"`
	ProjectID       string    `json:"project_id"`
	TaskID          string    `json:"task_id"`
	WorkspaceMode   string    `json:"workspace_mode"`
	BaseBranch      string    `json:"base_branch"`
	Schedule        Schedule  `json:"schedule"`
	GraceMinutes    *int      `json:"grace_minutes"`
	Precheck        *Precheck `json:"precheck"`
	Enabled         *bool     `json:"enabled"`
}

type Automation struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	Prompt              string   `json:"prompt"`
	Provider            string   `json:"provider"`
	Model               string   `json:"model"`
	ReasoningEffort     string   `json:"reasoning_effort"`
	AgentID             string   `json:"agent_id"`
	ProjectID           string   `json:"project_id"`
	TaskID              string   `json:"task_id"`
	WorkspaceMode       string   `json:"workspace_mode"`
	BaseBranch          string   `json:"base_branch"`
	Schedule            Schedule `json:"schedule"`
	GraceMinutes        int      `json:"grace_minutes"`
	Precheck            Precheck `json:"precheck"`
	Enabled             bool     `json:"enabled"`
	CreatedAt           string   `json:"created_at"`
	UpdatedAt           string   `json:"updated_at"`
	NextRunAt           string   `json:"next_run_at"`
	LastRunAt           string   `json:"last_run_at"`
	LastRunStatus       string   `json:"last_run_status"`
	ScheduleDescription string   `json:"schedule_description"`
	ProjectName         string   `json:"project_name"`
	TaskIdentifier      string   `json:"task_identifier"`
	TaskTitle           string   `json:"task_title"`
}

func (a Automation) input() AutomationInput {
	grace, enabled, pre := a.GraceMinutes, a.Enabled, a.Precheck
	return AutomationInput{Name: a.Name, Prompt: a.Prompt, Provider: a.Provider, Model: a.Model, ReasoningEffort: a.ReasoningEffort, AgentID: a.AgentID, ProjectID: a.ProjectID, TaskID: a.TaskID, WorkspaceMode: a.WorkspaceMode, BaseBranch: a.BaseBranch, Schedule: a.Schedule, GraceMinutes: &grace, Precheck: &pre, Enabled: &enabled}
}

type PrecheckResult struct {
	ExitCode   int    `json:"exit_code"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMS int64  `json:"duration_ms"`
}

type Usage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
	TotalTokens  int64 `json:"total_tokens"`
}

type Run struct {
	ID              string         `json:"id"`
	AutomationID    string         `json:"automation_id"`
	AutomationName  string         `json:"automation_name"`
	RunNumber       int64          `json:"run_number"`
	Title           string         `json:"title"`
	Trigger         string         `json:"trigger"`
	Status          string         `json:"status"`
	ScheduledFor    string         `json:"scheduled_for"`
	StartedAt       string         `json:"started_at"`
	FinishedAt      string         `json:"finished_at"`
	ProjectID       string         `json:"project_id"`
	WorkspaceID     string         `json:"workspace_id"`
	WorkspacePath   string         `json:"workspace_path"`
	Branch          string         `json:"branch"`
	ChatProjectID   string         `json:"chat_project_id"`
	ChatSessionID   string         `json:"chat_session_id"`
	TaskID          string         `json:"task_id"`
	Provider        string         `json:"provider"`
	Model           string         `json:"model"`
	AgentID         string         `json:"agent_id"`
	Output          string         `json:"output"`
	OutputTruncated bool           `json:"output_truncated"`
	Error           string         `json:"error"`
	Precheck        PrecheckResult `json:"precheck"`
	Usage           Usage          `json:"usage"`
	OccurrenceCount int            `json:"occurrence_count"`
	CreatedAt       string         `json:"created_at"`
	UpdatedAt       string         `json:"updated_at"`
}

// SchedulePreview is the /schedule/preview response.
type SchedulePreview struct {
	Valid       bool     `json:"valid"`
	Description string   `json:"description"`
	NextRuns    []string `json:"next_runs"`
	Error       string   `json:"error,omitempty"`
}

// TaskInfo is the subset of an issue used for linking and prompt prefixing.
type TaskInfo struct {
	ID          string
	Identifier  string
	Title       string
	Description string
	ProjectID   string
}
