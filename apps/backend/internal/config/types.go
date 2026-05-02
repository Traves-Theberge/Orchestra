// Package config defines the application configuration types and loading logic
// for orchestrad, supporting environment variables and WORKFLOW.md overrides.
package config

import (
	"strconv"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

// Config holds the complete runtime configuration for the orchestrad server,
// including networking, agent execution, issue tracking, workspace management,
// telemetry, and speech-to-text settings.
type Config struct {
	// Host is the network address the HTTP server binds to (e.g. "127.0.0.1").
	Host string
	// Port is the TCP port the HTTP server listens on.
	Port int
	// WorkspaceRoot is the filesystem directory where agent workspaces are created.
	WorkspaceRoot string
	// WorktreeRoot is the directory where per-issue git worktrees are created.
	WorktreeRoot string
	// APIToken is the bearer token required for non-loopback API requests.
	APIToken string
	// WorkflowFile is the path to the WORKFLOW.md file used for prompt templates and config overrides.
	WorkflowFile string
	// AgentProvider is the default agent provider name (e.g. "CODEX", "CLAUDE").
	AgentProvider string
	// AgentCommands maps provider names to their CLI command templates.
	AgentCommands map[string]string
	// AgentMaxTurns is the maximum number of consecutive execution turns per issue.
	AgentMaxTurns int
	// TrackerType selects the issue tracker backend (e.g. "github", "sqlite").
	TrackerType string
	// TrackerEndpoint is the tracker-specific endpoint (e.g. "owner/repo" for GitHub).
	TrackerEndpoint string
	// TrackerToken is the authentication token for the issue tracker API.
	TrackerToken string
	// TrackerWorkerAssigneeIDs lists assignee IDs that identify worker agents.
	TrackerWorkerAssigneeIDs []string
	// ActiveStates lists issue states that are eligible for agent dispatch.
	ActiveStates []string
	// TerminalStates lists issue states that indicate completion or cancellation.
	TerminalStates []string
	// MaxConcurrent is the global upper limit on simultaneously running agent sessions.
	MaxConcurrent int
	// MaxConcurrentByState maps normalized state names to per-state concurrency limits.
	MaxConcurrentByState map[string]int
	// WorkspaceHooks defines shell commands to run at workspace lifecycle points.
	WorkspaceHooks workspace.Hooks
	// ProjectRoots lists additional filesystem paths to scan for project telemetry.
	ProjectRoots []string
	// GitHubClientID is the OAuth client ID for GitHub integration.
	GitHubClientID string
	// GitHubClientSecret is the OAuth client secret for GitHub integration.
	GitHubClientSecret string
	// MCPServers maps MCP server names to their command or URL.
	MCPServers map[string]string
	// TelemetryProviders lists provider names whose session logs are ingested for telemetry.
	TelemetryProviders []string
	// TelemetryRetentionDays is the number of days to retain telemetry events before pruning.
	TelemetryRetentionDays int
	// TelemetryStoreRawPayload controls whether raw event payloads are stored in the database.
	TelemetryStoreRawPayload bool
	// STTWhisperBin is the path to the whisper.cpp binary for speech-to-text.
	STTWhisperBin string
	// STTWhisperModelPath is the path to the Whisper model file.
	STTWhisperModelPath string
	// STTWhisperThreads is the number of threads to use for Whisper inference.
	STTWhisperThreads int
	// STTWhisperLanguage is the language code for Whisper transcription (default "en").
	STTWhisperLanguage string
	// AnthropicAdminKey is the Anthropic Admin API key for organization-level usage/cost sync.
	AnthropicAdminKey string
	// OpenAIAdminKey is the OpenAI Organization Admin API key for usage/cost sync.
	OpenAIAdminKey string
	// AnalyticsSyncInterval is the interval between external analytics sync runs.
	AnalyticsSyncInterval time.Duration
	// AnalyticsExternalEnabled controls whether external analytics sync is active.
	AnalyticsExternalEnabled bool

	// Tailscale runtime
	TailscaleSSHHost      string
	TailscaleSSHUser      string
	TailscaleSSHKeyPath   string
	TailscaleSSHPort      int
	TailscaleWorktreeRoot string

	// Kubernetes runtime
	KubeConfigPath       string
	KubeNamespace        string
	KubeImage            string
	KubeGitRepoURL       string
	KubeServiceAccount   string
}

// PortString returns the server port as a string.
func (c Config) PortString() string {
	return strconv.Itoa(c.Port)
}
