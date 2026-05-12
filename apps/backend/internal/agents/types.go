// Package agents provides runner implementations for dispatching work to
// machine-learning coding agents (Claude, Gemini, OpenCode, Codex via app-server,
// Tailscale SSH, and Kubernetes pods) and a registry that maps provider names to
// their concrete runners.
package agents

import (
	"context"
	"strings"
	"time"
)

// Provider identifies a machine-learning agent backend (e.g. "CLAUDE", "CODEX").
type Provider string

const (
	// ProviderCodex identifies the OpenAI Codex agent.
	ProviderCodex Provider = "CODEX"
	// ProviderClaude identifies the Anthropic Claude agent.
	ProviderClaude Provider = "CLAUDE"
	// ProviderOpenCode identifies the OpenCode agent.
	ProviderOpenCode Provider = "OPENCODE"
	// ProviderGemini identifies the Google Gemini agent.
	ProviderGemini Provider = "GEMINI"
	// Provider8gent identifies the 8gent Code open-source agent.
	Provider8gent Provider = "8GENT"
)

// RuntimeTarget identifies where an agent turn executes.
type RuntimeTarget string

const (
	RuntimeLocal      RuntimeTarget = "LOCAL"
	RuntimeTailscale  RuntimeTarget = "TAILSCALE"
	RuntimeKubernetes RuntimeTarget = "KUBERNETES"
)

// NormalizeRuntimeTarget upper-cases and trims. Empty string returns RuntimeLocal.
func NormalizeRuntimeTarget(s string) RuntimeTarget {
	if strings.TrimSpace(s) == "" {
		return RuntimeLocal
	}
	return RuntimeTarget(strings.ToUpper(strings.TrimSpace(s)))
}

// RuntimeTransport wraps a command string to execute on a remote target.
// WrapCommand takes the AI provider and its CLI command string, returning
// a Runner that will invoke the command on the remote infrastructure.
type RuntimeTransport interface {
	WrapCommand(provider Provider, command string) Runner
}

// NormalizeProvider normalizes a provider string to UPPERCASE for backward compatibility.
func NormalizeProvider(s string) Provider {
	return Provider(strings.ToUpper(strings.TrimSpace(s)))
}

// TurnRequest encapsulates all parameters needed to execute a single agent turn,
// including the prompt, workspace paths, timeout, and optional tool specifications.
type TurnRequest struct {
	SessionID       string
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
	ResourceSpecs   []map[string]any
	RuntimeTarget   RuntimeTarget
}

// TokenUsage tracks the token consumption for a single agent turn, including
// input tokens, output tokens, and the computed total.
type TokenUsage struct {
	InputTokens      int64 `json:"input_tokens"`
	OutputTokens     int64 `json:"output_tokens"`
	TotalTokens      int64 `json:"total_tokens"`
	CacheReadTokens  int64 `json:"cache_read_tokens,omitempty"`
	CacheWriteTokens int64 `json:"cache_write_tokens,omitempty"`
	ThinkingTokens   int64 `json:"thinking_tokens,omitempty"`
	ToolTokens       int64 `json:"tool_tokens,omitempty"`
}

// Event represents a single streaming event emitted by an agent during a turn.
// Events carry the provider, event kind, human-readable message, raw JSON payload,
// token usage updates, and a timestamp.
type Event struct {
	Provider  Provider       `json:"provider"`
	SessionID string         `json:"session_id,omitempty"`
	Kind      string         `json:"kind"`
	Message   string         `json:"message,omitempty"`
	RawLine   string         `json:"raw_line,omitempty"`
	Raw       map[string]any `json:"raw,omitempty"`
	Usage     TokenUsage     `json:"usage,omitempty"`
	Timestamp time.Time      `json:"timestamp"`
}

// TurnResult contains the outcome of a completed agent turn, including the
// process exit code, captured output, and cumulative token usage.
type TurnResult struct {
	Provider  Provider   `json:"provider"`
	SessionID string     `json:"session_id"`
	ExitCode  int        `json:"exit_code"`
	Output    string     `json:"output"`
	Usage     TokenUsage `json:"usage"`
}

// EventHandler is a callback invoked for each streaming Event during a turn.
type EventHandler func(Event)

// ToolExecutor is a callback that executes a named tool with the given arguments
// and returns the result as a JSON-compatible map. The context is propagated
// from the active turn so cancellation reaches the underlying tracker / IO.
type ToolExecutor func(ctx context.Context, tool string, arguments map[string]any) map[string]any

// Runner is the interface that all agent backends must implement. RunTurn
// executes a single agent turn, streaming events via onEvent and returning
// the final result.
type Runner interface {
	RunTurn(ctx context.Context, request TurnRequest, onEvent EventHandler) (TurnResult, error)
}
