// Package types defines shared enumerations and value types used across
// the Orchestra backend, including issue statuses, agent categories, and
// server-sent event types.
package types

// IssueStatus represents the computed runtime status of an issue.
type IssueStatus string

const (
	// IssueStatusRunning indicates the issue is currently being processed by an agent.
	IssueStatusRunning IssueStatus = "RUNNING"
	// IssueStatusRetrying indicates the issue encountered a failure and is scheduled for retry.
	IssueStatusRetrying IssueStatus = "RETRYING"
	// IssueStatusTracked indicates the issue is known to the tracker but not actively running.
	IssueStatusTracked IssueStatus = "TRACKED"
	// IssueStatusIdle indicates the issue has no active runtime state.
	IssueStatusIdle IssueStatus = "IDLE"
)

// AgentCategory represents the type of agent configuration.
type AgentCategory string

const (
	// CategoryCore identifies a built-in core agent configuration.
	CategoryCore AgentCategory = "CORE"
	// CategorySkill identifies a user-defined skill or sub-agent configuration.
	CategorySkill AgentCategory = "SKILL"
)

// SSEEventType represents the type of a server-sent event emitted by the
// orchestrator to connected clients.
type SSEEventType string

const (
	// SSERunEvent is a generic run event carrying incremental agent output.
	SSERunEvent SSEEventType = "RUN_EVENT"
	// SSERunStarted signals that an agent run has begun for an issue.
	SSERunStarted SSEEventType = "RUN_STARTED"
	// SSERunFailed signals that an agent run ended with a failure.
	SSERunFailed SSEEventType = "RUN_FAILED"
	// SSERunContinues signals that the orchestrator is continuing a multi-turn run.
	SSERunContinues SSEEventType = "RUN_CONTINUES"
	// SSERunSucceeded signals that an agent run completed successfully.
	SSERunSucceeded SSEEventType = "RUN_SUCCEEDED"
	// SSERetryScheduled signals that a failed run has been queued for retry.
	SSERetryScheduled SSEEventType = "RETRY_SCHEDULED"
	// SSEHookStarted signals that a lifecycle hook has begun execution.
	SSEHookStarted SSEEventType = "HOOK_STARTED"
	// SSEHookCompleted signals that a lifecycle hook finished successfully.
	SSEHookCompleted SSEEventType = "HOOK_COMPLETED"
	// SSEHookFailed signals that a lifecycle hook ended with a failure.
	SSEHookFailed SSEEventType = "HOOK_FAILED"
)
