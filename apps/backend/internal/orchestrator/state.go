// Package orchestrator manages the lifecycle of agent execution runs, including
// dispatch scheduling, concurrency control, retry logic, and real-time state
// tracking for issues being processed by machine learning agents.
package orchestrator

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/mcp"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

// CodexTotals holds cumulative token usage and wall-clock time across all completed runs.
type CodexTotals struct {
	InputTokens  int64   `json:"input_tokens"`
	OutputTokens int64   `json:"output_tokens"`
	TotalTokens  int64   `json:"total_tokens"`
	SecondsRun   float64 `json:"seconds_running"`
}

// RunningEntry represents an issue currently being executed by an agent, including
// its session metadata, token usage, and the most recent event received.
type RunningEntry struct {
	IssueID         string   `json:"issue_id"`
	IssueIdentifier string   `json:"issue_identifier"`
	Title           string   `json:"title,omitempty"`
	Description     string   `json:"description,omitempty"`
	State           string   `json:"state"`
	AssigneeID      string   `json:"assignee_id,omitempty"`
	ProjectID       string   `json:"project_id,omitempty"`
	SessionID       string   `json:"session_id"`
	Provider        string   `json:"provider"`
	RuntimeTarget   string   `json:"runtime_target,omitempty"`
	SessionLogPath  string   `json:"session_log_path,omitempty"`
	WorktreePath    string   `json:"worktree_path,omitempty"`
	DisabledTools   []string `json:"disabled_tools,omitempty"`
	TurnCount       int64    `json:"turn_count"`
	LastEvent       string   `json:"last_event"`
	LastMessage     string   `json:"last_message"`
	StartedAt       string   `json:"started_at"`
	LastEventAt     string   `json:"last_event_at"`
	Tokens          struct {
		InputTokens  int64 `json:"input_tokens"`
		OutputTokens int64 `json:"output_tokens"`
		TotalTokens  int64 `json:"total_tokens"`
	} `json:"tokens"`
}

// RetryEntry represents a failed run that is scheduled for a future retry attempt.
type RetryEntry struct {
	IssueID         string   `json:"issue_id"`
	IssueIdentifier string   `json:"issue_identifier"`
	State           string   `json:"state,omitempty"`
	AssigneeID      string   `json:"assignee_id,omitempty"`
	Provider        string   `json:"provider,omitempty"`
	RuntimeTarget   string   `json:"runtime_target,omitempty"`
	DisabledTools   []string `json:"disabled_tools,omitempty"`
	Attempt         int64    `json:"attempt"`
	DueAt           string   `json:"due_at"`
	Error           string   `json:"error"`
}

// Snapshot is a point-in-time view of the orchestrator state, including all
// running entries, pending retries, cumulative totals, and MCP server status.
type Snapshot struct {
	GeneratedAt string            `json:"generated_at"`
	Counts      SnapshotCount     `json:"counts"`
	Running     []RunningEntry    `json:"running"`
	Retrying    []RetryEntry      `json:"retrying"`
	CodexTotals CodexTotals       `json:"codex_totals"`
	RateLimits  any               `json:"rate_limits"`
	MCPServers  map[string]string `json:"mcp_servers,omitempty"`
}

// SnapshotCount holds the count of currently running and retrying entries.
type SnapshotCount struct {
	Running  int `json:"running"`
	Retrying int `json:"retrying"`
}

// RefreshResult describes the outcome of a refresh request, including whether
// it was coalesced with a pending refresh and which operations were queued.
type RefreshResult struct {
	Queued      bool     `json:"queued"`
	Coalesced   bool     `json:"coalesced"`
	RequestedAt string   `json:"requested_at"`
	Operations  []string `json:"operations"`
}

// Service is the central orchestrator that coordinates agent runs, manages
// concurrency limits, tracks running and retrying issues, and interfaces with
// the issue tracker, workspace, and MCP subsystems.
type Service struct {
	mu               sync.RWMutex
	running          []RunningEntry
	retrying         []RetryEntry
	codexTotals      CodexTotals
	rateLimits       any
	refreshPending   bool
	trackerClient    tracker.Client
	agentRegistry    *agents.Registry
	agentCommands    map[string]string
	agentProvider    string
	activeStates     []string
	terminalStates   []string
	maxConcurrent    int
	maxTurns         int
	maxByState       map[string]int
	claimed          map[string]bool
	cancels          map[string]context.CancelFunc
	maxRetryAttempts int64
	workspaceService workspace.Service
	workspaceRoot    string
	retryBaseDelay   time.Duration
	retryMaxDelay    time.Duration
	stallTimeout     time.Duration
	db               *db.DB
	mcpRegistry      *mcp.Registry
	mcpServers       map[string]string
}

// IssueRuntime bundles the running and retry state for a single issue,
// used by lookup operations that need both views at once.
type IssueRuntime struct {
	IssueIdentifier string
	IssueID         string
	Running         *RunningEntry
	Retry           *RetryEntry
}

// NewService creates a new orchestrator Service with sensible defaults for
// concurrency, retry policy, and stall detection.
func NewService() *Service {
	return &Service{
		running:          make([]RunningEntry, 0),
		retrying:         make([]RetryEntry, 0),
		activeStates:     []string{"todo", "in progress"},
		terminalStates:   []string{"done", "cancelled", "canceled", "closed", "duplicate"},
		maxConcurrent:    16,
		maxByState:       map[string]int{},
		claimed:          map[string]bool{},
		cancels:          make(map[string]context.CancelFunc),
		maxRetryAttempts: 5,
		retryBaseDelay:   5 * time.Second,
		retryMaxDelay:    10 * time.Minute,
		stallTimeout:     20 * time.Minute,
	}
}

// RegisterCancel stores a cancellation function for an active run, keyed by issue ID.
func (s *Service) RegisterCancel(issueID string, provider string, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancels[issueID] = cancel
}

// DeregisterCancel removes the cancellation function for the given issue ID.
func (s *Service) DeregisterCancel(issueID string, provider string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.cancels, issueID)
}

// StopSession cancels the active run for the given issue, returning true if a
// cancellation was triggered. Both the lookup and the cancel() call happen
// under the mutex so a concurrent DeregisterCancel can't drop the func before
// we invoke it. cancel() itself is non-blocking (it just signals the context).
func (s *Service) StopSession(issueID string, provider string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	cancel, ok := s.cancels[issueID]
	if !ok || cancel == nil {
		return false
	}
	cancel()
	return true
}

// StopAllSessionsForIssue cancels every active session for the given issue and
// removes its cancel registration.
func (s *Service) StopAllSessionsForIssue(issueID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cancel, ok := s.cancels[issueID]
	if ok && cancel != nil {
		cancel()
	}
	delete(s.cancels, issueID)
}

// Snapshot returns a consistent point-in-time copy of the orchestrator state,
// safe to serialize and broadcast to clients.
func (s *Service) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	running := append([]RunningEntry(nil), s.running...)
	retrying := append([]RetryEntry(nil), s.retrying...)
	if running == nil {
		running = []RunningEntry{}
	}
	if retrying == nil {
		retrying = []RetryEntry{}
	}

	totals := s.codexTotals
	totals.SecondsRun = s.codexTotals.SecondsRun + runningSecondsNow(running)

	mcpServers := make(map[string]string)
	for k, v := range s.mcpServers {
		mcpServers[k] = v
	}

	return Snapshot{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Counts: SnapshotCount{
			Running:  len(running),
			Retrying: len(retrying),
		},
		Running:     running,
		Retrying:    retrying,
		CodexTotals: totals,
		RateLimits:  s.rateLimits,
		MCPServers:  mcpServers,
	}
}

// QueueRefresh marks a refresh as pending. If one is already pending, the
// request is coalesced to avoid redundant tracker polls.
func (s *Service) QueueRefresh() RefreshResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	coalesced := s.refreshPending
	s.refreshPending = true

	return RefreshResult{
		Queued:      true,
		Coalesced:   coalesced,
		RequestedAt: time.Now().UTC().Format(time.RFC3339),
		Operations:  []string{"poll", "reconcile"},
	}
}

// CompleteRefreshCycle clears the refresh-pending flag after a refresh cycle completes.
func (s *Service) CompleteRefreshCycle() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshPending = false
}

// RefreshPending reports whether a refresh cycle has been requested but not yet completed.
func (s *Service) RefreshPending() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.refreshPending
}

// LookupIssue searches both the running and retrying lists for the given issue
// identifier, returning a combined IssueRuntime and whether it was found.
func (s *Service) LookupIssue(issueIdentifier string) (IssueRuntime, bool) {
	identifier := strings.TrimSpace(issueIdentifier)
	if identifier == "" {
		return IssueRuntime{}, false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	var runtime IssueRuntime
	for _, entry := range s.running {
		if entry.IssueIdentifier == identifier {
			entryCopy := entry
			runtime = IssueRuntime{
				IssueIdentifier: identifier,
				IssueID:         entry.IssueID,
				Running:         &entryCopy,
			}
			break
		}
	}

	for _, entry := range s.retrying {
		if entry.IssueIdentifier == identifier {
			entryCopy := entry
			if runtime.IssueIdentifier == "" {
				runtime.IssueIdentifier = identifier
			}
			if runtime.IssueID == "" {
				runtime.IssueID = entry.IssueID
			}
			runtime.Retry = &entryCopy
			break
		}
	}

	if runtime.IssueIdentifier == "" {
		return IssueRuntime{}, false
	}

	return runtime, true
}

// SetRunningForTest replaces the running entries list. Intended for use in tests only.
func (s *Service) SetRunningForTest(entries []RunningEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running = append([]RunningEntry(nil), entries...)
}

// SetRetryingForTest replaces the retrying entries list. Intended for use in tests only.
func (s *Service) SetRetryingForTest(entries []RetryEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retrying = append([]RetryEntry(nil), entries...)
}

// SetTrackerClient configures the issue tracker client used for fetching and updating issues.
func (s *Service) SetTrackerClient(client tracker.Client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trackerClient = client
}

// FetchIssueByID retrieves a single issue from the configured tracker by its ID.
func (s *Service) FetchIssueByID(ctx context.Context, issueID string) (*tracker.Issue, error) {
	s.mu.RLock()
	client := s.trackerClient
	s.mu.RUnlock()
	if client == nil {
		return nil, fmt.Errorf("no tracker client configured")
	}
	issues, err := client.FetchIssuesByIDs(ctx, []string{issueID})
	if err != nil {
		return nil, err
	}
	if len(issues) == 0 {
		return nil, fmt.Errorf("issue not found: %s", issueID)
	}
	return &issues[0], nil
}

// SetDB assigns the warehouse database used for state persistence and history queries.
func (s *Service) SetDB(database *db.DB) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.db = database
}

// SetAgentRegistry configures the agent registry, per-provider commands, and
// the default provider used for dispatching new runs.
func (s *Service) SetAgentRegistry(registry *agents.Registry, commands map[string]string, provider string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agentRegistry = registry
	s.agentCommands = make(map[string]string)
	for k, v := range commands {
		s.agentCommands[k] = v
	}
	s.agentProvider = provider
}

// GetAgentConfig returns a copy of the current agent commands map and the default provider name.
func (s *Service) GetAgentConfig() (map[string]string, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	commands := make(map[string]string)
	for k, v := range s.agentCommands {
		commands[k] = v
	}
	return commands, s.agentProvider
}

// GetProviders returns the list of available agent provider names.
func (s *Service) GetProviders() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.agentRegistry != nil {
		providers := s.agentRegistry.Providers()
		out := make([]string, len(providers))
		for i, p := range providers {
			out[i] = string(p)
		}
		return out
	}
	out := make([]string, 0, len(s.agentCommands))
	for k := range s.agentCommands {
		out = append(out, k)
	}
	return out
}

// SetWorkspaceService configures the workspace service used for managing issue workspaces.
func (s *Service) SetWorkspaceService(svc workspace.Service) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.workspaceService = svc
}

// SetWorkspaceRoot sets the filesystem root directory for agent workspaces.
func (s *Service) SetWorkspaceRoot(root string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.workspaceRoot = root
}

// ListArtifacts returns the list of artifact file paths in the workspace for the given issue.
func (s *Service) ListArtifacts(issueIdentifier string, provider string) ([]string, error) {
	return s.workspaceService.ListArtifacts(issueIdentifier, provider)
}

// GetArtifactContent reads and returns the content of a specific artifact file.
func (s *Service) GetArtifactContent(issueIdentifier string, provider string, relPath string) ([]byte, error) {
	return s.workspaceService.GetArtifactContent(issueIdentifier, provider, relPath)
}

// GetDiff returns the git diff output for changes made in the issue workspace.
func (s *Service) GetDiff(issueIdentifier string, provider string) (string, error) {
	return s.workspaceService.GetDiff(issueIdentifier, provider)
}

// UpdateAgentConfig merges new agent commands and optionally updates the default provider.
func (s *Service) UpdateAgentConfig(commands map[string]string, provider string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if provider != "" {
		s.agentProvider = provider
	}
	if s.agentCommands == nil {
		s.agentCommands = make(map[string]string)
	}
	for k, v := range commands {
		s.agentCommands[k] = v
		if s.agentRegistry != nil {
			s.agentRegistry.SetCommand(agents.Provider(k), v)
		}
	}
}

// ListAgentConfigs discovers agent configuration files in the workspace and project directories.
func (s *Service) ListAgentConfigs(projectID string) ([]agents.AgentConfig, error) {
	projectRoot := ""
	if projectID != "" && s.db != nil {
		if p, err := s.db.GetProjectByID(context.Background(), projectID); err == nil {
			projectRoot = p.RootPath
		}
	}
	s.mu.RLock()
	workspaceRoot := s.workspaceRoot
	s.mu.RUnlock()
	return agents.ListAgentConfigs(workspaceRoot, projectRoot)
}

// UpdateConfigByPath writes new content to an agent configuration file at the given path.
func (s *Service) UpdateConfigByPath(path string, content string) error {
	return agents.UpdateConfigByPath(path, content)
}

// CreateAgentResource creates a new agent resource file (skill or config) for the
// specified provider and scope, returning the full path to the created file.
func (s *Service) CreateAgentResource(provider, resourceType, name, scope, projectID string) (string, error) {
	home, _ := os.UserHomeDir()
	var rootDir string

	// 1. Resolve Base Directory
	if scope == "project" && projectID != "" {
		if p, err := s.db.GetProjectByID(context.Background(), projectID); err == nil {
			rootDir = p.RootPath
		} else {
			return "", fmt.Errorf("project not found: %w", err)
		}
	} else {
		rootDir = home
	}

	fullPath, content, err := buildAgentResource(rootDir, provider, resourceType, name, scope)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
		return "", err
	}

	return fullPath, nil
}

func buildAgentResource(rootDir, provider, resourceType, name, scope string) (string, string, error) {
	slug := sanitizeAgentResourceName(name)
	switch provider {
	case "codex":
		return buildCodexResource(rootDir, resourceType, slug, scope)
	case "gemini":
		return buildGeminiResource(rootDir, resourceType, slug, scope)
	case "opencode":
		return buildOpenCodeResource(rootDir, resourceType, slug, scope)
	case "claude":
		return buildClaudeResource(rootDir, resourceType, slug, scope)
	case "Orchestra":
		if resourceType == "skill" {
			return filepath.Join(rootDir, ".codex", "skills", slug+".md"), "---\nname: " + slug + "\ndescription: New agent skill\n---\n\n# " + humanizeAgentResourceName(slug) + "\n", nil
		}
		return filepath.Join(rootDir, ".orchestra", "agents", slug+".json"), "{}", nil
	default:
		return "", "", fmt.Errorf("unknown provider: %s", provider)
	}
}

func buildClaudeResource(rootDir, resourceType, slug, scope string) (string, string, error) {
	switch resourceType {
	case "agents":
		return filepath.Join(rootDir, ".claude", "agents", slug, "AGENT.md"), fmt.Sprintf("---\nname: %s\ndescription: Describe what this agent does\nmodel: sonnet\ntools: Read, Grep, Glob, Bash\npermissionMode: default\nmaxTurns: 50\n---\n\nYou are a specialized agent. Describe your role and instructions here.\n", slug), nil
	case "skills", "skill":
		return filepath.Join(rootDir, ".claude", "skills", slug+".md"), fmt.Sprintf("---\nname: %s\ndescription: Describe what this skill does\ntrigger: manual\n---\n\n# %s\n\nSkill instructions go here.\n", slug, humanizeAgentResourceName(slug)), nil
	case "rules", "rule":
		return filepath.Join(rootDir, ".claude", "rules", slug+".md"), fmt.Sprintf("---\npaths:\n  - \"src/**/*.ts\"\n  - \"src/**/*.tsx\"\n---\n\n# %s\n\nDescribe the rule here.\n", humanizeAgentResourceName(slug)), nil
	default:
		return "", "", fmt.Errorf("unsupported Claude resource type: %s", resourceType)
	}
}

func buildCodexResource(rootDir, resourceType, slug, scope string) (string, string, error) {
	switch resourceType {
	case "config":
		return filepath.Join(rootDir, ".codex", "config.toml"), "# Codex configuration\n", nil
	case "instructions":
		if scope == "project" {
			return filepath.Join(rootDir, "AGENTS.md"), "# Project Instructions\n", nil
		}
		return filepath.Join(rootDir, ".codex", "AGENTS.md"), "# Global Instructions\n", nil
	case "agents":
		return filepath.Join(rootDir, ".codex", "agents", slug+".md"), fmt.Sprintf("---\nname: %s\ndescription: Describe what this sub-agent does\nmodel: gpt-5.3-codex\n---\n\nYou are %s. Describe your role and instructions here.\n", slug, humanizeAgentResourceName(slug)), nil
	case "skills", "skill":
		return filepath.Join(rootDir, ".agents", "skills", slug, "SKILL.md"), fmt.Sprintf("---\nname: %s\ndescription: Describe what this skill does\n---\n\n# %s\n\nSkill instructions go here.\n", slug, humanizeAgentResourceName(slug)), nil
	default:
		return "", "", fmt.Errorf("unsupported Codex resource type: %s", resourceType)
	}
}

func buildGeminiResource(rootDir, resourceType, slug, scope string) (string, string, error) {
	switch resourceType {
	case "settings":
		return filepath.Join(rootDir, ".gemini", "settings.json"), "{\n  \"mcpServers\": {}\n}\n", nil
	case "context":
		if scope == "project" {
			return filepath.Join(rootDir, "GEMINI.md"), "# Project Context\n", nil
		}
		return filepath.Join(rootDir, ".gemini", "GEMINI.md"), "# Global Context\n", nil
	case "commands":
		return filepath.Join(rootDir, ".gemini", "commands", slug+".md"), fmt.Sprintf("---\ndescription: %s\n---\n\nDescribe the task this command should run.\n", humanizeAgentResourceName(slug)), nil
	default:
		return "", "", fmt.Errorf("unsupported Gemini resource type: %s", resourceType)
	}
}

func buildOpenCodeResource(rootDir, resourceType, slug, scope string) (string, string, error) {
	switch resourceType {
	case "config":
		base := filepath.Join(".opencode", "opencode.json")
		if scope != "project" {
			base = filepath.Join(".config", "opencode", "opencode.json")
		}
		return filepath.Join(rootDir, base), "{\n  \"$schema\": \"https://opencode.ai/config.json\"\n}\n", nil
	case "agents":
		dir := ".opencode/agents"
		if scope != "project" {
			dir = ".config/opencode/agents"
		}
		return filepath.Join(rootDir, dir, slug+".md"), fmt.Sprintf("---\ndescription: Describe what this agent does\nmode: subagent\n---\n\nYou are %s. Describe your role and instructions here.\n", humanizeAgentResourceName(slug)), nil
	case "commands":
		dir := ".opencode/commands"
		if scope != "project" {
			dir = ".config/opencode/commands"
		}
		return filepath.Join(rootDir, dir, slug+".md"), fmt.Sprintf("---\ndescription: Describe what this command does\nagent: build\n---\n\nRun %s.\n", humanizeAgentResourceName(slug)), nil
	case "skills", "skill":
		dir := ".opencode/skills"
		if scope != "project" {
			dir = ".config/opencode/skills"
		}
		return filepath.Join(rootDir, dir, slug, "SKILL.md"), fmt.Sprintf("# %s\n\nDescribe what this skill does.\n", humanizeAgentResourceName(slug)), nil
	default:
		return "", "", fmt.Errorf("unsupported OpenCode resource type: %s", resourceType)
	}
}

func sanitizeAgentResourceName(name string) string {
	slug := strings.TrimSpace(strings.ToLower(name))
	slug = strings.ReplaceAll(slug, " ", "-")
	slug = strings.ReplaceAll(slug, ":", "-")
	if slug == "" {
		return "new-resource"
	}
	return slug
}

func humanizeAgentResourceName(name string) string {
	parts := strings.FieldsFunc(name, func(r rune) bool { return r == '-' || r == '_' })
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	if len(parts) == 0 {
		return "New Resource"
	}
	return strings.Join(parts, " ")
}

// SetStateSets configures which issue states are considered active (dispatchable)
// and which are terminal (completed/cancelled).
func (s *Service) SetStateSets(activeStates []string, terminalStates []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(activeStates) > 0 {
		s.activeStates = append([]string(nil), activeStates...)
	}
	if len(terminalStates) > 0 {
		s.terminalStates = append([]string(nil), terminalStates...)
	}
}

// SetMaxConcurrent sets the global upper limit on simultaneously running agent sessions.
func (s *Service) SetMaxConcurrent(maxConcurrent int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if maxConcurrent > 0 {
		s.maxConcurrent = maxConcurrent
	}
}

// GetMaxTurns returns the maximum number of consecutive turns an agent may execute per issue.
func (s *Service) GetMaxTurns() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.maxTurns
}

// SetMaxTurns sets the maximum number of consecutive turns an agent may execute per issue.
func (s *Service) SetMaxTurns(turns int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.maxTurns = turns
}

// SetMaxConcurrentByState sets per-state concurrency limits, restricting how many
// issues in a given state can run simultaneously.
func (s *Service) SetMaxConcurrentByState(limits map[string]int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	normalized := map[string]int{}
	for state, limit := range limits {
		if limit <= 0 {
			continue
		}
		key := normalizeState(state)
		if key == "" {
			continue
		}
		normalized[key] = limit
	}
	s.maxByState = normalized
}

// SetRetryPolicy configures the retry backoff parameters: maximum attempts,
// base delay, and maximum delay cap.
func (s *Service) SetRetryPolicy(maxAttempts int64, baseDelay time.Duration, maxDelay time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if maxAttempts > 0 {
		s.maxRetryAttempts = maxAttempts
	}
	if baseDelay > 0 {
		s.retryBaseDelay = baseDelay
	}
	if maxDelay > 0 {
		s.retryMaxDelay = maxDelay
	}
}

// SetStallTimeout sets the duration after which a claimed run with no events
// is considered stalled and moved to the retry queue.
func (s *Service) SetStallTimeout(timeout time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if timeout > 0 {
		s.stallTimeout = timeout
	}
}

// ShouldRetryAttempt reports whether the given attempt number is within the
// configured maximum retry limit.
func (s *Service) ShouldRetryAttempt(attempt int64) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return attempt > 0 && attempt <= s.maxRetryAttempts
}

// PerformRefresh executes a full refresh cycle: reconciles stalled runs, fetches
// candidate issues from the tracker, filters retries, promotes due retries, and
// reconciles running states against the tracker's current view.
func (s *Service) PerformRefresh(ctx context.Context) error {
	s.mu.RLock()
	client := s.trackerClient
	activeStates := append([]string(nil), s.activeStates...)
	terminalStates := append([]string(nil), s.terminalStates...)
	s.mu.RUnlock()

	if client == nil {
		s.CompleteRefreshCycle()
		return nil
	}
	defer s.CompleteRefreshCycle()

	s.reconcileStalledRunningIssues()

	candidates, err := client.FetchCandidateIssues(ctx, activeStates)
	if err != nil {
		return err
	}

	s.enqueueCandidates(candidates)
	if err := s.filterRetryingByCurrentStates(ctx, client, activeStates, terminalStates); err != nil {
		return err
	}
	s.releaseDueRetries()

	s.mu.RLock()
	runningIssueIDs := make([]string, 0, len(s.running))
	for _, entry := range s.running {
		runningIssueIDs = append(runningIssueIDs, entry.IssueID)
	}
	s.mu.RUnlock()

	runningIssues, err := client.FetchIssuesByIDs(ctx, runningIssueIDs)
	if err != nil {
		return err
	}
	stateMap := make(map[string]string, len(runningIssues))
	for _, issue := range runningIssues {
		stateMap[issue.ID] = issue.State
	}

	s.ReconcileRunningStates(activeStates, terminalStates, stateMap)
	s.reconcileRunningDispatchConstraints(runningIssues, terminalStates)
	return nil
}

// ListIssues delegates to the tracker client to fetch issues matching the given filter.
func (s *Service) ListIssues(ctx context.Context, filter tracker.IssueFilter) ([]tracker.Issue, error) {
	s.mu.RLock()
	client := s.trackerClient
	s.mu.RUnlock()

	if client == nil {
		return []tracker.Issue{}, nil
	}

	return client.FetchIssues(ctx, filter)
}

// FetchIssueByIdentifier retrieves a single issue from the tracker by its human-readable identifier.
func (s *Service) FetchIssueByIdentifier(ctx context.Context, identifier string) (*tracker.Issue, error) {
	s.mu.RLock()
	client := s.trackerClient
	s.mu.RUnlock()

	if client == nil {
		return nil, errors.New("tracker client not available")
	}

	return client.FetchIssueByIdentifier(ctx, identifier)
}

// SearchIssues performs a free-text search for issues via the tracker client.
func (s *Service) SearchIssues(ctx context.Context, query string) ([]tracker.Issue, error) {
	s.mu.RLock()
	client := s.trackerClient
	s.mu.RUnlock()

	if client == nil {
		return []tracker.Issue{}, nil
	}

	return client.SearchIssues(ctx, query)
}

// CreateIssue creates a new issue in the configured tracker with the given metadata.
func (s *Service) CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID string, provider string, runtimeTarget string, disabledTools []string) (*tracker.Issue, error) {
	s.mu.RLock()
	client := s.trackerClient
	s.mu.RUnlock()

	if client == nil {
		return nil, fmt.Errorf("tracker client not available")
	}

	issue, err := client.CreateIssue(ctx, title, description, state, priority, assigneeID, projectID, provider, disabledTools)
	if err != nil {
		return nil, err
	}
	if issue != nil && runtimeTarget != "" {
		issue.RuntimeTarget = runtimeTarget
	}
	return issue, nil
}

// UpdateIssue applies field updates to an issue, logs audit history for changed
// fields, and queues a refresh to reflect changes in the snapshot.
func (s *Service) UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*tracker.Issue, error) {
	s.mu.Lock()
	client := s.trackerClient

	// Handle manual provider override
	if provider, ok := updates["provider"].(string); ok {
		// Update in running entries
		for i, entry := range s.running {
			if entry.IssueIdentifier == identifier {
				s.running[i].Provider = provider
				break
			}
		}
		// Update in retrying entries
		for i, entry := range s.retrying {
			if entry.IssueIdentifier == identifier {
				s.retrying[i].Provider = provider
				break
			}
		}
	}
	s.mu.Unlock()

	if client == nil {
		return nil, nil
	}

	// 1. Fetch current issue for audit comparison (best effort)
	oldIssue, _ := client.FetchIssueByIdentifier(ctx, identifier)

	issue, err := client.UpdateIssue(ctx, identifier, updates)
	if err != nil {
		return nil, err
	}

	// 2. Log changes to history
	if oldIssue != nil {
		if state, ok := updates["state"].(string); ok && state != oldIssue.State {
			s.LogIssueEvent(issue.ID, "User", "state_change", oldIssue.State, state)
		}
		if priority, ok := updates["priority"].(int); ok && priority != oldIssue.Priority {
			s.LogIssueEvent(issue.ID, "User", "priority_change", fmt.Sprintf("%d", oldIssue.Priority), fmt.Sprintf("%d", priority))
		}
		if assignee, ok := updates["assignee_id"].(string); ok && assignee != oldIssue.AssigneeID {
			s.LogIssueEvent(issue.ID, "User", "assignee_change", oldIssue.AssigneeID, assignee)
		}
	}

	// Trigger refresh to reflect changes immediately in snapshot
	s.QueueRefresh()
	return issue, nil
}

// LogIssueEvent writes an audit trail entry for an issue metadata change to the database.
func (s *Service) LogIssueEvent(issueID, userID, action, oldVal, newVal string) {
	if s.db == nil {
		return
	}
	id := fmt.Sprintf("hist_%s", uuid.New().String())
	_, err := s.db.Exec("INSERT INTO issue_history (id, issue_id, user_id, action, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)",
		id, issueID, userID, action, oldVal, newVal)
	if err != nil {
		log.Printf("WARN: failed to log issue event for issue_id=%s: %v", issueID, err)
	}
}

// DeleteIssue removes an issue from both in-memory state and the tracker backend,
// cancelling any active sessions. On tracker failure, in-memory state is rolled back.
func (s *Service) DeleteIssue(ctx context.Context, identifier string) error {
	s.mu.Lock()
	client := s.trackerClient

	// Save originals for rollback
	origRunning := make([]RunningEntry, len(s.running))
	copy(origRunning, s.running)
	origRetrying := make([]RetryEntry, len(s.retrying))
	copy(origRetrying, s.retrying)
	origClaimed := make(map[string]bool, len(s.claimed))
	for k, v := range s.claimed {
		origClaimed[k] = v
	}

	// Find the issue ID and remove from running/retrying
	var issueID string

	filteredRunning := make([]RunningEntry, 0, len(s.running))
	for _, entry := range s.running {
		if entry.IssueIdentifier == identifier {
			issueID = entry.IssueID
		} else {
			filteredRunning = append(filteredRunning, entry)
		}
	}
	s.running = filteredRunning

	filteredRetrying := make([]RetryEntry, 0, len(s.retrying))
	for _, entry := range s.retrying {
		if entry.IssueIdentifier == identifier {
			if issueID == "" {
				issueID = entry.IssueID
			}
		} else {
			filteredRetrying = append(filteredRetrying, entry)
		}
	}
	s.retrying = filteredRetrying

	// Collect cancel keys to clean up
	var cancelKeys []string
	if issueID != "" {
		delete(s.claimed, issueID)
		for key, cancel := range s.cancels {
			if strings.HasPrefix(key, issueID+":") {
				if cancel != nil {
					cancel()
				}
				cancelKeys = append(cancelKeys, key)
			}
		}
		for _, key := range cancelKeys {
			delete(s.cancels, key)
		}
	}
	s.mu.Unlock()

	if client == nil {
		// Rollback in-memory state
		s.mu.Lock()
		s.running = origRunning
		s.retrying = origRetrying
		s.claimed = origClaimed
		s.mu.Unlock()
		return fmt.Errorf("tracker client not available")
	}

	// Delete the issue from the tracker
	if err := client.DeleteIssue(ctx, identifier); err != nil {
		// Rollback in-memory state
		s.mu.Lock()
		s.running = origRunning
		s.retrying = origRetrying
		s.claimed = origClaimed
		s.mu.Unlock()
		return err
	}

	// Trigger refresh to reflect changes
	s.QueueRefresh()
	return nil
}

func (s *Service) enqueueCandidates(candidates []tracker.Issue) {
	now := time.Now().UTC().Format(time.RFC3339)
	s.mu.Lock()
	defer s.mu.Unlock()
	active := normalizeStateSet(s.activeStates)
	terminal := normalizeStateSet(s.terminalStates)

	for _, issue := range candidates {
		if len(s.running) >= s.maxConcurrent {
			return
		}
		if _, ok := active[normalizeState(issue.State)]; !ok {
			continue
		}
		if !issue.AssignedToWorker {
			continue
		}

		targetProvider := s.agentProvider
		if issue.Provider != "" {
			targetProvider = strings.ToUpper(strings.TrimSpace(issue.Provider))
		} else if issue.AssigneeID != "" && strings.HasPrefix(issue.AssigneeID, "agent-") {
			targetProvider = strings.ToUpper(strings.TrimPrefix(issue.AssigneeID, "agent-"))
		}

		if s.isRunningLocked(issue.ID) || s.isRetryingLocked(issue.ID) {
			continue
		}
		if !s.stateSlotsAvailableLocked(issue.State) {
			continue
		}
		if isBlockedTodoByNonTerminal(issue, terminal) {
			continue
		}

		desc := issue.Description
		if strings.EqualFold(issue.State, "Todo") {
			planInstr := "\n\n---\nMODE: PLAN ONLY — BE FAST.\n\nYour ONLY job is to output a plan. Do NOT write code, create files, or make changes.\n\n"
			if issue.Feedback != "" && issue.Plan != "" {
				// Re-plan with context: show what was already done and what needs to change.
				planInstr += "CONTEXT: This task was previously executed. The reviewer sent it back for changes.\n\n"
				planInstr += "FEEDBACK FROM REVIEW (address this):\n" + issue.Feedback + "\n\n"
				planInstr += "PREVIOUS PLAN (already executed — build on this, do NOT start from scratch):\n" + issue.Plan + "\n\n"
				planInstr += "Create an UPDATED plan that addresses the feedback. Keep completed work, add new steps for the requested changes.\n"
			} else if issue.Feedback != "" {
				planInstr += "FEEDBACK FROM REVIEW (address this):\n" + issue.Feedback + "\n\n"
			}
			planInstr += "1. Spend at most 2-3 tool calls understanding the project structure (ls, read key files)\n2. Then IMMEDIATELY output your plan as markdown checkboxes:\n   - [ ] Step 1: ...\n   - [ ] Step 2: ...\n3. Stop after outputting the plan. Do NOT explore further.\n\nKeep the plan concise — 5-10 steps maximum. The human will review it before you execute."
			desc = desc + planInstr
		} else if strings.EqualFold(issue.State, "In Progress") {
			// Build execution prompt: instruction + plan + task description
			execInstr := "IMPORTANT: YOU ARE IN EXECUTION MODE. DO NOT CREATE A NEW PLAN.\n\nExecute the plan below step by step. START WRITING CODE IMMEDIATELY.\nWrite code, run tests, commit when all steps are done.\n\nCRITICAL — YOUR FINAL MESSAGE MUST contain the full plan with checkboxes updated:\n  - [x] for completed steps\n  - [ ] for incomplete steps\nThis is required for tracking. Do NOT end with a prose summary instead.\n\n"
			if issue.Feedback != "" {
				execInstr += "FEEDBACK FROM REVIEW (address this): " + issue.Feedback + "\n\n"
			}
			if issue.Plan != "" {
				execInstr += "## YOUR PLAN\n\n" + issue.Plan + "\n\n---\n\n"
			}
			execInstr += "## TASK\n\n"
			desc = execInstr + desc
		}

		entry := RunningEntry{
			IssueID:         issue.ID,
			IssueIdentifier: issue.Identifier,
			Title:           issue.Title,
			Description:     desc,
			State:           issue.State,
			AssigneeID:      issue.AssigneeID,
			ProjectID:       issue.ProjectID,
			Provider:        targetProvider,
			RuntimeTarget:   issue.RuntimeTarget,
			DisabledTools:   append([]string(nil), issue.DisabledTools...),
			StartedAt:       now,
			LastEventAt:     now,
			LastEvent:       "dispatch_queued",
			LastMessage:     "Issue queued for agent execution",
		}
		s.running = append(s.running, entry)
	}
}

func isBlockedTodoByNonTerminal(issue tracker.Issue, terminal map[string]struct{}) bool {
	if normalizeState(issue.State) != "todo" {
		return false
	}
	for _, blocker := range issue.BlockedBy {
		normalized := normalizeState(blocker.State)
		if normalized == "" {
			return true
		}
		if _, ok := terminal[normalized]; !ok {
			return true
		}
	}
	return false
}

func (s *Service) stateSlotsAvailableLocked(issueState string) bool {
	if len(s.maxByState) == 0 {
		return true
	}
	normalized := normalizeState(issueState)
	limit, ok := s.maxByState[normalized]
	if !ok || limit <= 0 {
		return true
	}
	used := 0
	for _, entry := range s.running {
		if normalizeState(entry.State) == normalized {
			used++
		}
	}
	return used < limit
}

func (s *Service) releaseDueRetries() {
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()

	remaining := make([]RetryEntry, 0, len(s.retrying))
	for _, retry := range s.retrying {
		dueAt, err := time.Parse(time.RFC3339, retry.DueAt)
		if err != nil || dueAt.After(now) || len(s.running) >= s.maxConcurrent {
			remaining = append(remaining, retry)
			continue
		}
		if retry.State != "" && !s.stateSlotsAvailableLocked(retry.State) {
			remaining = append(remaining, retry)
			continue
		}
		if s.isRunningLocked(retry.IssueID) {
			continue
		}
		state := strings.TrimSpace(retry.State)
		if state == "" {
			state = "RETRYING"
		}

		s.running = append(s.running, RunningEntry{
			IssueID:         retry.IssueID,
			IssueIdentifier: retry.IssueIdentifier,
			Title:           "",
			State:           state,
			AssigneeID:      retry.AssigneeID,
			Provider:        retry.Provider,
			RuntimeTarget:   retry.RuntimeTarget,
			DisabledTools:   append([]string(nil), retry.DisabledTools...),
			StartedAt:       now.Format(time.RFC3339),
			LastEventAt:     now.Format(time.RFC3339),
			LastEvent:       "retry_due",
			LastMessage:     retry.Error,
			TurnCount:       retry.Attempt,
		})
	}

	s.retrying = remaining
}

func (s *Service) filterRetryingByCurrentStates(ctx context.Context, client tracker.Client, activeStates []string, terminalStates []string) error {
	if client == nil {
		return nil
	}

	s.mu.RLock()
	if len(s.retrying) == 0 {
		s.mu.RUnlock()
		return nil
	}
	ids := make([]string, 0, len(s.retrying))
	for _, entry := range s.retrying {
		ids = append(ids, entry.IssueID)
	}
	s.mu.RUnlock()

	issues, err := client.FetchIssuesByIDs(ctx, ids)
	if err != nil {
		return err
	}
	issueByID := map[string]tracker.Issue{}
	for _, issue := range issues {
		issueByID[issue.ID] = issue
	}

	active := normalizeStateSet(activeStates)
	terminal := normalizeStateSet(terminalStates)

	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := make([]RetryEntry, 0, len(s.retrying))
	for _, entry := range s.retrying {
		issue, ok := issueByID[entry.IssueID]
		if !ok {
			filtered = append(filtered, entry)
			continue
		}
		if !issue.AssignedToWorker {
			continue
		}
		if isBlockedTodoByNonTerminal(issue, terminal) {
			continue
		}
		state := issue.State
		normalized := normalizeState(state)
		if _, isTerminal := terminal[normalized]; isTerminal {
			continue
		}
		if _, isActive := active[normalized]; !isActive {
			continue
		}
		if strings.TrimSpace(entry.State) == "" {
			entry.State = state
		}
		entry.AssigneeID = issue.AssigneeID
		filtered = append(filtered, entry)
	}

	s.retrying = filtered
	return nil
}

// RecordRunFailure removes the issue from the running list, accumulates its
// totals, and schedules a retry entry if the attempt count is within limits.
// On high attempt counts, it cascades to an alternate provider if available.
func (s *Service) RecordRunFailure(issueID string, provider string, issueIdentifier string, attempt int64, dueAt time.Time, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := make([]RunningEntry, 0, len(s.running))
	issueState := ""
	issueAssigneeID := ""
	lastProvider := ""
	lastRuntimeTarget := ""
	var disabledTools []string
	found := false
	for _, entry := range s.running {
		if entry.IssueID != issueID {
			filtered = append(filtered, entry)
			continue
		}
		issueState = entry.State
		issueAssigneeID = entry.AssigneeID
		lastProvider = entry.Provider
		lastRuntimeTarget = entry.RuntimeTarget
		disabledTools = append([]string(nil), entry.DisabledTools...)
		s.accumulateEntryTotalsLocked(entry)
		found = true
	}
	s.running = filtered

	if !found {
		// If entry not found in running (maybe already failed/stopped), just return
		return
	}

	message := "run failed"
	if err != nil {
		message = err.Error()
	}

	if attempt > s.maxRetryAttempts {
		delete(s.claimed, issueID)
		return
	}

	nextProvider := lastProvider
	if attempt >= 3 && s.agentRegistry != nil {
		// Cascade: Try a different provider if the current one has failed multiple times
		allProviders := s.agentRegistry.Providers()
		if len(allProviders) > 1 {
			for i, p := range allProviders {
				if string(p) == lastProvider {
					// Pick the next one in the ring
					next := allProviders[(i+1)%len(allProviders)]
					nextProvider = string(next)
					break
				}
			}
		}
	}

	s.retrying = append(s.retrying, RetryEntry{
		IssueID:         issueID,
		IssueIdentifier: issueIdentifier,
		State:           issueState,
		AssigneeID:      issueAssigneeID,
		Provider:        nextProvider,
		RuntimeTarget:   lastRuntimeTarget,
		DisabledTools:   disabledTools,
		Attempt:         attempt,
		DueAt:           dueAt.UTC().Format(time.RFC3339),
		Error:           message,
	})
	delete(s.claimed, issueID)
}

// RecordRunSuccess removes the issue from the running list and accumulates
// its elapsed time into the cumulative totals.
func (s *Service) RecordRunSuccess(issueID string, provider string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := make([]RunningEntry, 0, len(s.running))
	for _, entry := range s.running {
		if entry.IssueID == issueID {
			s.codexTotals.SecondsRun += elapsedSeconds(entry.StartedAt)
			continue
		}

		filtered = append(filtered, entry)
	}
	s.running = filtered
	delete(s.claimed, issueID)
}

// ClaimNextRunnable finds the first unclaimed running entry, marks it as claimed,
// and returns it. Returns false if no unclaimed entries are available.
func (s *Service) ClaimNextRunnable() (RunningEntry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for idx, entry := range s.running {
		if s.claimed[entry.IssueID] {
			continue
		}
		s.claimed[entry.IssueID] = true
		now := time.Now().UTC().Format(time.RFC3339)
		entry.LastEvent = "run_claimed"
		entry.LastEventAt = now
		entry.LastMessage = "Issue claimed for execution"
		s.running[idx] = entry
		return entry, true
	}

	return RunningEntry{}, false
}

// ReleaseClaim removes the claim on an issue, making it available for re-dispatch.
func (s *Service) ReleaseClaim(issueID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.claimed, issueID)
}

// RevalidateClaimedIssue checks with the tracker whether a claimed issue is still
// in a dispatchable state. Returns false and drops the entry if the issue has
// been reassigned, moved to a terminal state, or is blocked.
func (s *Service) RevalidateClaimedIssue(ctx context.Context, issueID string) (bool, error) {
	s.mu.RLock()
	client := s.trackerClient
	activeStates := append([]string(nil), s.activeStates...)
	terminalStates := append([]string(nil), s.terminalStates...)
	s.mu.RUnlock()

	if client == nil {
		return true, nil
	}

	issues, err := client.FetchIssuesByIDs(ctx, []string{issueID})
	if err != nil {
		return false, err
	}

	if len(issues) == 0 {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.dropRunningIssueLocked(issueID)
		delete(s.claimed, issueID)
		return false, nil
	}
	issue := issues[0]
	state := issue.State
	if !issue.AssignedToWorker {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.dropRunningIssueLocked(issueID)
		delete(s.claimed, issueID)
		return false, nil
	}
	terminalForBlockers := normalizeStateSet(terminalStates)
	if isBlockedTodoByNonTerminal(issue, terminalForBlockers) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.dropRunningIssueLocked(issueID)
		delete(s.claimed, issueID)
		return false, nil
	}

	normalized := normalizeState(state)
	terminal := terminalForBlockers
	if _, isTerminal := terminal[normalized]; isTerminal {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.dropRunningIssueLocked(issueID)
		delete(s.claimed, issueID)
		return false, nil
	}
	active := normalizeStateSet(activeStates)
	if _, isActive := active[normalized]; !isActive {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.dropRunningIssueLocked(issueID)
		delete(s.claimed, issueID)
		return false, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for idx, entry := range s.running {
		if entry.IssueID == issueID {
			entry.State = issue.State
			if strings.TrimSpace(issue.Title) != "" {
				entry.Title = issue.Title
			}
			s.running[idx] = entry
			break
		}
	}

	return true, nil
}

func (s *Service) dropRunningIssueLocked(issueID string) {
	if issueID == "" {
		return
	}
	filtered := make([]RunningEntry, 0, len(s.running))
	for _, entry := range s.running {
		if entry.IssueID == issueID {
			continue
		}
		filtered = append(filtered, entry)
	}
	s.running = filtered
}

// RecordRunResult updates the running entry with final session ID and token usage,
// accumulates totals, and releases the claim.
func (s *Service) RecordRunResult(issueID string, provider string, sessionID string, usageInput int64, usageOutput int64, usageTotal int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	for idx, entry := range s.running {
		if entry.IssueID != issueID {
			continue
		}
		entry.SessionID = sessionID
		entry.LastEvent = "run_completed"
		entry.LastEventAt = now
		entry.LastMessage = "Issue execution completed"
		entry.Tokens.InputTokens = usageInput
		entry.Tokens.OutputTokens = usageOutput
		entry.Tokens.TotalTokens = usageTotal
		s.running[idx] = entry
		break
	}

	s.codexTotals.InputTokens += usageInput
	s.codexTotals.OutputTokens += usageOutput
	s.codexTotals.TotalTokens += usageTotal
	delete(s.claimed, issueID)
}

// SetWorktreePath stores the worktree directory on the running entry so other
// subsystems (cleanup, terminal CWD) can locate the agent's working directory.
func (s *Service) SetWorktreePath(issueID, wtPath string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for idx, entry := range s.running {
		if entry.IssueID == issueID {
			entry.WorktreePath = wtPath
			s.running[idx] = entry
			break
		}
	}
}

// RecordRunArtifact updates the running entry with the session ID and log file path.
func (s *Service) RecordRunArtifact(issueID string, provider string, sessionID string, logPath string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for idx, entry := range s.running {
		if entry.IssueID != issueID {
			continue
		}
		if strings.TrimSpace(sessionID) != "" {
			entry.SessionID = strings.TrimSpace(sessionID)
		}
		if strings.TrimSpace(logPath) != "" {
			entry.SessionLogPath = strings.TrimSpace(logPath)
		}
		s.running[idx] = entry
		break
	}
}

// ShouldContinueTurn checks whether the agent should execute another turn for the
// issue, considering the max-turns limit and the current tracker state.
func (s *Service) ShouldContinueTurn(ctx context.Context, issueID string, provider string, attempt int64, maxTurns int) (bool, error) {
	if maxTurns > 0 && int(attempt) >= maxTurns {
		return false, nil
	}

	s.mu.RLock()
	client := s.trackerClient
	activeStates := append([]string(nil), s.activeStates...)
	terminalStates := append([]string(nil), s.terminalStates...)
	s.mu.RUnlock()

	if client == nil {
		return false, nil
	}

	issues, err := client.FetchIssuesByIDs(ctx, []string{issueID})
	if err != nil {
		return false, err
	}
	if len(issues) == 0 {
		return false, nil
	}
	issue := issues[0]
	if !issue.AssignedToWorker {
		return false, nil
	}
	if isBlockedTodoByNonTerminal(issue, normalizeStateSet(terminalStates)) {
		return false, nil
	}
	state := issue.State

	active := normalizeStateSet(activeStates)
	_, isActive := active[normalizeState(state)]
	return isActive, nil
}

func (s *Service) reconcileRunningDispatchConstraints(issues []tracker.Issue, terminalStates []string) {
	if len(issues) == 0 {
		return
	}

	issueByID := map[string]tracker.Issue{}
	for _, issue := range issues {
		issueByID[issue.ID] = issue
	}
	terminal := normalizeStateSet(terminalStates)

	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := make([]RunningEntry, 0, len(s.running))
	retained := make(map[string]struct{}, len(s.running))
	for _, entry := range s.running {
		issue, ok := issueByID[entry.IssueID]
		if !ok {
			filtered = append(filtered, entry)
			retained[entry.IssueID] = struct{}{}
			continue
		}
		if !issue.AssignedToWorker {
			continue
		}
		if isBlockedTodoByNonTerminal(issue, terminal) {
			continue
		}
		filtered = append(filtered, entry)
		retained[entry.IssueID] = struct{}{}
	}

	s.running = filtered
	for issueID := range s.claimed {
		if _, ok := retained[issueID]; !ok {
			delete(s.claimed, issueID)
		}
	}
}

// PrepareNextTurn updates the running entry's turn count and releases the claim
// so the execution worker can pick it up for the next iteration.
func (s *Service) PrepareNextTurn(issueID string, provider string, attempt int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC().Format(time.RFC3339)
	for idx, entry := range s.running {
		if entry.IssueID != issueID {
			continue
		}
		entry.TurnCount = attempt
		entry.LastEvent = "turn_continue"
		entry.LastEventAt = now
		entry.LastMessage = "Preparing next turn"
		s.running[idx] = entry
		break
	}
	delete(s.claimed, issueID)
}

// NextRetryDue calculates the next retry time for the given issue and attempt
// using quadratic backoff with deterministic jitter.
func (s *Service) NextRetryDue(issueID string, attempt int64) time.Time {
	s.mu.RLock()
	base := s.retryBaseDelay
	maxDelay := s.retryMaxDelay
	s.mu.RUnlock()
	return computeRetryDue(issueID, attempt, base, maxDelay)
}

func computeRetryDue(issueID string, attempt int64, base time.Duration, maxDelay time.Duration) time.Time {
	now := time.Now().UTC()
	if attempt < 1 {
		attempt = 1
	}
	delay := time.Duration(attempt*attempt) * base
	if delay > maxDelay {
		delay = maxDelay
	}

	return now.Add(delay + retryJitter(issueID, now))
}

func retryJitter(issueID string, now time.Time) time.Duration {
	hasher := fnv.New32a()
	_, _ = hasher.Write([]byte(issueID + ":" + now.UTC().Format("2006-01-02T15:04")))
	return time.Duration(hasher.Sum32()%1000) * time.Millisecond
}

func (s *Service) reconcileStalledRunningIssues() {
	now := time.Now().UTC()

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.stallTimeout <= 0 || len(s.running) == 0 {
		return
	}

	kept := make([]RunningEntry, 0, len(s.running))
	for _, entry := range s.running {
		if !s.claimed[entry.IssueID] {
			kept = append(kept, entry)
			continue
		}

		reference := parseFirstTime(entry.LastEventAt, entry.StartedAt)
		if reference.IsZero() || now.Sub(reference) < s.stallTimeout {
			kept = append(kept, entry)
			continue
		}

		attempt := entry.TurnCount + 1
		s.accumulateEntryTotalsLocked(entry)
		if attempt > s.maxRetryAttempts {
			delete(s.claimed, entry.IssueID)
			continue
		}

		dueAt := computeRetryDue(entry.IssueID, attempt, s.retryBaseDelay, s.retryMaxDelay)
		s.retrying = append(s.retrying, RetryEntry{
			IssueID:         entry.IssueID,
			IssueIdentifier: entry.IssueIdentifier,
			State:           entry.State,
			Attempt:         attempt,
			DueAt:           dueAt.UTC().Format(time.RFC3339),
			Error:           "stalled run exceeded timeout",
		})
		delete(s.claimed, entry.IssueID)
	}

	s.running = kept
}

func (s *Service) accumulateEntryTotalsLocked(entry RunningEntry) {
	s.codexTotals.SecondsRun += elapsedSeconds(entry.StartedAt)
	s.codexTotals.InputTokens += entry.Tokens.InputTokens
	s.codexTotals.OutputTokens += entry.Tokens.OutputTokens
	if entry.Tokens.TotalTokens > 0 {
		s.codexTotals.TotalTokens += entry.Tokens.TotalTokens
	} else if entry.Tokens.InputTokens > 0 || entry.Tokens.OutputTokens > 0 {
		s.codexTotals.TotalTokens += entry.Tokens.InputTokens + entry.Tokens.OutputTokens
	}
}

func parseFirstTime(values ...string) time.Time {
	for _, raw := range values {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
		if err == nil {
			return parsed
		}
	}
	return time.Time{}
}

// ActiveStates returns a copy of the currently configured active state names.
func (s *Service) ActiveStates() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]string(nil), s.activeStates...)
}

// TerminalStates returns a copy of the currently configured terminal state names.
func (s *Service) TerminalStates() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]string(nil), s.terminalStates...)
}

// RecordRunEvent updates the running entry for the given issue with the latest
// event data, including kind, message, timestamp, token usage, and rate limits.
func (s *Service) RecordRunEvent(issueID string, provider string, event agents.Event) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := event.Timestamp.UTC().Format(time.RFC3339)
	if now == "0001-01-01T00:00:00Z" {
		now = time.Now().UTC().Format(time.RFC3339)
	}

	for idx, entry := range s.running {
		if entry.IssueID != issueID {
			continue
		}
		if kind := strings.TrimSpace(event.Kind); kind != "" {
			entry.LastEvent = kind
		}
		if message := strings.TrimSpace(event.Message); message != "" {
			entry.LastMessage = message
		}
		entry.LastEventAt = now
		if event.Usage.InputTokens > 0 {
			entry.Tokens.InputTokens = event.Usage.InputTokens
		}
		if event.Usage.OutputTokens > 0 {
			entry.Tokens.OutputTokens = event.Usage.OutputTokens
		}
		if event.Usage.TotalTokens > 0 {
			entry.Tokens.TotalTokens = event.Usage.TotalTokens
		} else if entry.Tokens.InputTokens > 0 || entry.Tokens.OutputTokens > 0 {
			entry.Tokens.TotalTokens = entry.Tokens.InputTokens + entry.Tokens.OutputTokens
		}
		s.running[idx] = entry
		break
	}

	if limits, ok := extractRateLimits(event.Raw); ok {
		s.rateLimits = limits
	}
}

func extractRateLimits(payload map[string]any) (any, bool) {
	if payload == nil {
		return nil, false
	}
	if limits, ok := payload["rate_limits"]; ok {
		return limits, true
	}
	if limits, ok := payload["rateLimits"]; ok {
		return limits, true
	}
	if limits, ok := payload["rate-limits"]; ok {
		return limits, true
	}

	for _, key := range []string{"params", "meta", "result", "message", "data"} {
		node, _ := payload[key].(map[string]any)
		if limits, ok := extractRateLimits(node); ok {
			return limits, true
		}
		if arr, ok := payload[key].([]any); ok {
			for _, item := range arr {
				itemMap, _ := item.(map[string]any)
				if limits, ok := extractRateLimits(itemMap); ok {
					return limits, true
				}
			}
		}
		if encoded, ok := payload[key].(string); ok {
			decoded := parseJSONMap(encoded)
			if limits, ok := extractRateLimits(decoded); ok {
				return limits, true
			}
		}
	}

	return nil, false
}

func parseJSONMap(raw string) map[string]any {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	decoded := map[string]any{}
	if err := json.Unmarshal([]byte(trimmed), &decoded); err != nil {
		return nil
	}
	return decoded
}

func runningSecondsNow(entries []RunningEntry) float64 {
	seconds := 0.0
	for _, entry := range entries {
		seconds += elapsedSeconds(entry.StartedAt)
	}
	return seconds
}

func elapsedSeconds(startedAt string) float64 {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(startedAt))
	if err != nil {
		return 0
	}
	delta := time.Since(parsed)
	if delta < 0 {
		return 0
	}
	return delta.Seconds()
}

func (s *Service) isRunningLocked(issueID string) bool {
	for _, entry := range s.running {
		if entry.IssueID == issueID {
			return true
		}
	}
	return false
}

func (s *Service) isRetryingLocked(issueID string) bool {
	for _, entry := range s.retrying {
		if entry.IssueID == issueID {
			return true
		}
	}
	return false
}

// PersistStateToDB writes the current running entries to the database so state
// can be recovered after a restart.
func (s *Service) PersistStateToDB(ctx context.Context) error {
	if s.db == nil {
		return nil
	}

	s.mu.RLock()
	running := append([]RunningEntry(nil), s.running...)
	s.mu.RUnlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, "DELETE FROM runs")
	if err != nil {
		return err
	}

	stmt, err := tx.PrepareContext(ctx, `INSERT INTO runs (id, issue_id, issue_identifier, provider, session_id, state, last_event, last_message, turn_count, input_tokens, output_tokens, total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range running {
		runID := fmt.Sprintf("run_%s_%s", entry.IssueID, entry.Provider)
		_, err = stmt.ExecContext(ctx, runID, entry.IssueID, entry.IssueIdentifier, entry.Provider, entry.SessionID, entry.State, entry.LastEvent, entry.LastMessage, entry.TurnCount, entry.Tokens.InputTokens, entry.Tokens.OutputTokens, entry.Tokens.TotalTokens)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

// RestoreStateFromDB recovers running entries from the database on startup.
// Only populates state if the in-memory running list is empty.
func (s *Service) RestoreStateFromDB(ctx context.Context) error {
	if s.db == nil {
		return nil
	}

	rows, err := s.db.QueryContext(ctx, `SELECT issue_id, issue_identifier, provider, session_id, state, last_event, last_message, turn_count, input_tokens, output_tokens, total_tokens FROM runs`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var recovered []RunningEntry
	now := time.Now().UTC().Format(time.RFC3339)

	for rows.Next() {
		var entry RunningEntry
		var identifier sql.NullString
		if err := rows.Scan(&entry.IssueID, &identifier, &entry.Provider, &entry.SessionID, &entry.State, &entry.LastEvent, &entry.LastMessage, &entry.TurnCount, &entry.Tokens.InputTokens, &entry.Tokens.OutputTokens, &entry.Tokens.TotalTokens); err != nil {
			return err
		}
		entry.StartedAt = now
		entry.LastEventAt = now
		if identifier.Valid && identifier.String != "" {
			entry.IssueIdentifier = identifier.String
		} else {
			entry.IssueIdentifier = entry.IssueID
		}
		recovered = append(recovered, entry)
	}

	if err := rows.Err(); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	// Only restore if we are currently empty (e.g. on boot)
	if len(s.running) == 0 {
		s.running = recovered
	}

	return nil
}

// FetchIssueHistory returns the audit trail of metadata changes for an issue.
func (s *Service) FetchIssueHistory(ctx context.Context, issueID string) ([]map[string]any, error) {
	if s.db == nil {
		return []map[string]any{}, nil
	}
	rows, err := s.db.QueryContext(ctx, "SELECT user_id, action, old_value, new_value, timestamp FROM issue_history WHERE issue_id = ? ORDER BY timestamp DESC", issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var history []map[string]any
	for rows.Next() {
		var userID, action, oldVal, newVal, timestamp string
		if err := rows.Scan(&userID, &action, &oldVal, &newVal, &timestamp); err != nil {
			return nil, err
		}
		history = append(history, map[string]any{
			"user_id":   userID,
			"action":    action,
			"old_value": oldVal,
			"new_value": newVal,
			"timestamp": timestamp,
		})
	}
	return history, nil
}

// GetActiveWorkspaceIdentifiers returns issue identifiers for all running and
// retrying entries, used to determine which workspaces are still in use.
func (s *Service) GetActiveWorkspaceIdentifiers() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ids := make([]string, 0, len(s.running)+len(s.retrying))
	for _, entry := range s.running {
		ids = append(ids, entry.IssueIdentifier)
	}
	for _, entry := range s.retrying {
		ids = append(ids, entry.IssueIdentifier)
	}
	return ids
}

// SetMCPRegistry configures the MCP server registry and the name-to-command mapping.
func (s *Service) SetMCPRegistry(r *mcp.Registry, servers map[string]string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mcpRegistry = r
	s.mcpServers = make(map[string]string)
	for k, v := range servers {
		s.mcpServers[k] = v
	}
}

// GetMCPRegistry returns the currently configured MCP server registry.
func (s *Service) GetMCPRegistry() *mcp.Registry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.mcpRegistry
}

// GetHistory returns a unified timeline of issue metadata changes and agent events.
func (s *Service) GetHistory(ctx context.Context, issueID string) ([]map[string]any, error) {
	if s.db == nil {
		return []map[string]any{}, nil
	}
	return s.db.GetUnifiedHistory(ctx, issueID)
}

// ClearIssuePlan removes the given issue from the running entries list by identifier.
// This is used by the Stop endpoint to clean up planning-mode runs.
func (s *Service) ClearIssuePlan(ctx context.Context, identifier string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	newRunning := make([]RunningEntry, 0, len(s.running))
	for _, entry := range s.running {
		if entry.IssueIdentifier != identifier {
			newRunning = append(newRunning, entry)
		}
	}
	s.running = newRunning
}
