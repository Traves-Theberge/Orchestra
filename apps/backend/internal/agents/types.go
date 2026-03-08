package agents

import (
	"context"
	"time"
)

type Provider string

const (
	ProviderCodex    Provider = "codex"
	ProviderClaude   Provider = "claude"
	ProviderOpenCode Provider = "opencode"
	ProviderGemini   Provider = "gemini"
)

type TurnRequest struct {
	Workspace       string
	WorkspaceRoot   string
	Prompt          string
	IssueIdentifier string
	Attempt         int
	Timeout         time.Duration
	CommandOverride string
	AutoApprove     bool
	ToolExecutor    ToolExecutor
	ToolSpecs       []map[string]any
}

type TokenUsage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
	TotalTokens  int64 `json:"total_tokens"`
}

type Event struct {
	Provider  Provider       `json:"provider"`
	Kind      string         `json:"kind"`
	Message   string         `json:"message,omitempty"`
	Raw       map[string]any `json:"raw,omitempty"`
	Usage     TokenUsage     `json:"usage,omitempty"`
	Timestamp time.Time      `json:"timestamp"`
}

type TurnResult struct {
	Provider  Provider   `json:"provider"`
	SessionID string     `json:"session_id"`
	ExitCode  int        `json:"exit_code"`
	Output    string     `json:"output"`
	Usage     TokenUsage `json:"usage"`
}

type EventHandler func(Event)

type ToolExecutor func(tool string, arguments map[string]any) map[string]any

type Runner interface {
	RunTurn(ctx context.Context, request TurnRequest, onEvent EventHandler) (TurnResult, error)
}
