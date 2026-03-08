package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/mcp"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

type CodexTotals struct {
	InputTokens  int64   `json:"input_tokens"`
	OutputTokens int64   `json:"output_tokens"`
	TotalTokens  int64   `json:"total_tokens"`
	SecondsRun   float64 `json:"seconds_running"`
}

type RunningEntry struct {
	IssueID         string `json:"issue_id"`
	IssueIdentifier string `json:"issue_identifier"`
	Title           string `json:"title,omitempty"`
	State           string `json:"state"`
	AssigneeID      string `json:"assignee_id,omitempty"`
	SessionID       string `json:"session_id"`
	Provider        string `json:"provider"`
	SessionLogPath  string `json:"session_log_path,omitempty"`
	TurnCount       int64  `json:"turn_count"`
	LastEvent       string `json:"last_event"`
	LastMessage     string `json:"last_message"`
	StartedAt       string `json:"started_at"`
	LastEventAt     string `json:"last_event_at"`
	Tokens          struct {
		InputTokens  int64 `json:"input_tokens"`
		OutputTokens int64 `json:"output_tokens"`
		TotalTokens  int64 `json:"total_tokens"`
	} `json:"tokens"`
}

type RetryEntry struct {
	IssueID         string `json:"issue_id"`
	IssueIdentifier string `json:"issue_identifier"`
	State           string `json:"state,omitempty"`
	AssigneeID      string `json:"assignee_id,omitempty"`
	Provider        string `json:"provider,omitempty"`
	Attempt         int64  `json:"attempt"`
	DueAt           string `json:"due_at"`
	Error           string `json:"error"`
}

type Snapshot struct {
	GeneratedAt string            `json:"generated_at"`
	Counts      SnapshotCount     `json:"counts"`
	Running     []RunningEntry    `json:"running"`
	Retrying    []RetryEntry      `json:"retrying"`
	CodexTotals CodexTotals       `json:"codex_totals"`
	RateLimits  any               `json:"rate_limits"`
	MCPServers  map[string]string `json:"mcp_servers,omitempty"`
}

type SnapshotCount struct {
	Running  int `json:"running"`
	Retrying int `json:"retrying"`
}

type RefreshResult struct {
	Queued      bool     `json:"queued"`
	Coalesced   bool     `json:"coalesced"`
	RequestedAt string   `json:"requested_at"`
	Operations  []string `json:"operations"`
}

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

type IssueRuntime struct {
	IssueIdentifier string
	IssueID         string
	Running         *RunningEntry
	Retry           *RetryEntry
}

func NewService() *Service {
	return &Service{
		running:          make([]RunningEntry, 0),
		retrying:         make([]RetryEntry, 0),
		activeStates:     []string{"Todo", "In Progress"},
		terminalStates:   []string{"Done", "Cancelled", "Canceled", "Closed", "Duplicate"},
		maxConcurrent:    4,
		maxByState:       map[string]int{},
		claimed:          map[string]bool{},
		cancels:          make(map[string]context.CancelFunc),
		maxRetryAttempts: 5,
		retryBaseDelay:   5 * time.Second,
		retryMaxDelay:    10 * time.Minute,
		stallTimeout:     20 * time.Minute,
	}
}

func (s *Service) RegisterCancel(issueID string, cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancels[issueID] = cancel
}

func (s *Service) DeregisterCancel(issueID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.cancels, issueID)
}

func (s *Service) StopSession(issueID string) bool {
	s.mu.Lock()
	cancel, ok := s.cancels[issueID]
	s.mu.Unlock()

	if ok && cancel != nil {
		cancel()
		return true
	}
	return false
}

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

func (s *Service) CompleteRefreshCycle() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshPending = false
}

func (s *Service) RefreshPending() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.refreshPending
}

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

func (s *Service) SetRunningForTest(entries []RunningEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.running = append([]RunningEntry(nil), entries...)
}

func (s *Service) SetRetryingForTest(entries []RetryEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retrying = append([]RetryEntry(nil), entries...)
}

func (s *Service) SetTrackerClient(client tracker.Client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trackerClient = client
}

func (s *Service) SetDB(database *db.DB) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.db = database
}

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

func (s *Service) GetAgentConfig() (map[string]string, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	commands := make(map[string]string)
	for k, v := range s.agentCommands {
		commands[k] = v
	}
	return commands, s.agentProvider
}

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

func (s *Service) SetWorkspaceService(svc workspace.Service) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.workspaceService = svc
}

func (s *Service) SetWorkspaceRoot(root string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.workspaceRoot = root
}

func (s *Service) ListArtifacts(issueIdentifier string) ([]string, error) {
	return s.workspaceService.ListArtifacts(issueIdentifier)
}

func (s *Service) GetArtifactContent(issueIdentifier string, relPath string) ([]byte, error) {
	return s.workspaceService.GetArtifactContent(issueIdentifier, relPath)
}

func (s *Service) GetDiff(issueIdentifier string) (string, error) {
	return s.workspaceService.GetDiff(issueIdentifier)
}

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

func (s *Service) UpdateConfigByPath(path string, content string) error {
	return agents.UpdateConfigByPath(path, content)
}

func (s *Service) CreateAgentResource(provider, resourceType, name, scope, projectID string) (string, error) {
	home, _ := os.UserHomeDir()
	var baseDir string

	// 1. Resolve Base Directory
	if scope == "project" && projectID != "" {
		if p, err := s.db.GetProjectByID(context.Background(), projectID); err == nil {
			baseDir = p.RootPath
		} else {
			return "", fmt.Errorf("project not found: %w", err)
		}
	} else {
		baseDir = home
	}

	// 2. Resolve Sub-directory based on agent metadata
	meta, ok := agents.AgentMeta[provider]
	if !ok {
		// Fallback for internal orchestra files
		if provider == "Orchestra" {
			if resourceType == "skill" {
				baseDir = filepath.Join(s.workspaceRoot, ".codex", "skills")
			} else {
				baseDir = filepath.Join(s.workspaceRoot, ".orchestra", "agents")
			}
		} else {
			return "", fmt.Errorf("unknown provider: %s", provider)
		}
	} else {
		// Use first skill path as default for new skills
		if len(meta.SkillPaths) > 0 {
			if scope == "project" {
				// For project scope, we use relative paths if they don't start with .config
				rel := meta.SkillPaths[0]
				if strings.HasPrefix(rel, ".config") {
					// Hack: OpenCode uses .config in home but usually .opencode in projects
					baseDir = filepath.Join(baseDir, ".opencode", "skills")
				} else {
					baseDir = filepath.Join(baseDir, rel)
				}
			} else {
				baseDir = filepath.Join(home, meta.SkillPaths[0])
			}
		}
	}

	// 3. Ensure extension
	ext := ".json"
	if resourceType == "skill" {
		ext = ".md"
	}
	if !strings.HasSuffix(name, ext) {
		name += ext
	}

	fullPath := filepath.Join(baseDir, name)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return "", err
	}

	// 4. Initial Content
	content := "{}"
	if resourceType == "skill" {
		content = "---\nname: " + strings.TrimSuffix(name, ".md") + "\ndescription: New agent skill\n---\n\n# New Skill\n"
	}

	if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
		return "", err
	}

	return fullPath, nil
}

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

func (s *Service) SetMaxConcurrent(maxConcurrent int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if maxConcurrent > 0 {
		s.maxConcurrent = maxConcurrent
	}
}

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

func (s *Service) SetStallTimeout(timeout time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if timeout > 0 {
		s.stallTimeout = timeout
	}
}

func (s *Service) ShouldRetryAttempt(attempt int64) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return attempt > 0 && attempt <= s.maxRetryAttempts
}

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

func (s *Service) ListIssues(ctx context.Context, filter tracker.IssueFilter) ([]tracker.Issue, error) {
	s.mu.RLock()
	client := s.trackerClient
	s.mu.RUnlock()

	if client == nil {
		return []tracker.Issue{}, nil
	}

	return client.FetchIssues(ctx, filter)
}

func (s *Service) SearchIssues(ctx context.Context, query string) ([]tracker.Issue, error) {
	s.mu.RLock()
	client := s.trackerClient
	s.mu.RUnlock()

	if client == nil {
		return []tracker.Issue{}, nil
	}

	return client.SearchIssues(ctx, query)
}

func (s *Service) CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID string) (*tracker.Issue, error) {
	s.mu.RLock()
	client := s.trackerClient
	s.mu.RUnlock()

	if client == nil {
		return nil, fmt.Errorf("tracker client not available")
	}

	return client.CreateIssue(ctx, title, description, state, priority, assigneeID, projectID)
}

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

	issue, err := client.UpdateIssue(ctx, identifier, updates)
	if err != nil {
		return nil, err
	}

	// Trigger refresh to reflect changes immediately in snapshot
	s.QueueRefresh()
	return issue, nil
}

func (s *Service) DeleteIssue(ctx context.Context, identifier string) error {
	s.mu.RLock()
	client := s.trackerClient
	s.mu.RUnlock()

	if client == nil {
		return fmt.Errorf("tracker client not available")
	}

	// 1. Stop any active session for this issue
	s.StopSession(identifier)

	// 2. Delete the issue from the tracker
	if err := client.DeleteIssue(ctx, identifier); err != nil {
		return err
	}

	// 3. Trigger refresh to reflect changes
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
		if s.isRunningLocked(issue.ID) || s.isRetryingLocked(issue.ID) {
			continue
		}
		if !s.stateSlotsAvailableLocked(issue.State) {
			continue
		}
		if isBlockedTodoByNonTerminal(issue, terminal) {
			continue
		}

		entry := RunningEntry{
			IssueID:         issue.ID,
			IssueIdentifier: issue.Identifier,
			Title:           issue.Title,
			State:           issue.State,
			AssigneeID:      issue.AssigneeID,
			Provider:        s.agentProvider,
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
			state = "retrying"
		}

		s.running = append(s.running, RunningEntry{
			IssueID:         retry.IssueID,
			IssueIdentifier: retry.IssueIdentifier,
			Title:           "",
			State:           state,
			AssigneeID:      retry.AssigneeID,
			Provider:        retry.Provider,
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

func (s *Service) RecordRunFailure(issueID string, issueIdentifier string, attempt int64, dueAt time.Time, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := make([]RunningEntry, 0, len(s.running))
	issueState := ""
	issueAssigneeID := ""
	lastProvider := ""
	for _, entry := range s.running {
		if entry.IssueID != issueID {
			filtered = append(filtered, entry)
			continue
		}
		issueState = entry.State
		issueAssigneeID = entry.AssigneeID
		lastProvider = entry.Provider
		s.accumulateEntryTotalsLocked(entry)
	}
	s.running = filtered

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
		Attempt:         attempt,
		DueAt:           dueAt.UTC().Format(time.RFC3339),
		Error:           message,
	})
	delete(s.claimed, issueID)
}

func (s *Service) RecordRunSuccess(issueID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := make([]RunningEntry, 0, len(s.running))
	for _, entry := range s.running {
		if entry.IssueID == issueID {
			s.codexTotals.SecondsRun += elapsedSeconds(entry.StartedAt)
			continue
		}

		if entry.IssueID != issueID {
			filtered = append(filtered, entry)
		}
	}
	s.running = filtered
	delete(s.claimed, issueID)
}

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

func (s *Service) ReleaseClaim(issueID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.claimed, issueID)
}

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

func (s *Service) RecordRunResult(issueID string, sessionID string, usageInput int64, usageOutput int64, usageTotal int64) {
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

func (s *Service) RecordRunArtifact(issueID string, sessionID string, logPath string) {
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

func (s *Service) ShouldContinueTurn(ctx context.Context, issueID string, attempt int64, maxTurns int) (bool, error) {
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

func (s *Service) PrepareNextTurn(issueID string, attempt int64) {
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

func (s *Service) ActiveStates() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]string(nil), s.activeStates...)
}

func (s *Service) TerminalStates() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]string(nil), s.terminalStates...)
}

func (s *Service) RecordRunEvent(issueID string, event agents.Event) {
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

	stmt, err := tx.PrepareContext(ctx, `INSERT INTO runs (id, issue_id, session_id, state, last_event, last_message, turn_count, input_tokens, output_tokens, total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, entry := range running {
		runID := "run_" + entry.IssueID
		_, err = stmt.ExecContext(ctx, runID, entry.IssueID, entry.SessionID, entry.State, entry.LastEvent, entry.LastMessage, entry.TurnCount, entry.Tokens.InputTokens, entry.Tokens.OutputTokens, entry.Tokens.TotalTokens)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Service) RestoreStateFromDB(ctx context.Context) error {
	if s.db == nil {
		return nil
	}

	rows, err := s.db.QueryContext(ctx, `SELECT issue_id, session_id, state, last_event, last_message, turn_count, input_tokens, output_tokens, total_tokens FROM runs`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var recovered []RunningEntry
	now := time.Now().UTC().Format(time.RFC3339)

	for rows.Next() {
		var entry RunningEntry
		if err := rows.Scan(&entry.IssueID, &entry.SessionID, &entry.State, &entry.LastEvent, &entry.LastMessage, &entry.TurnCount, &entry.Tokens.InputTokens, &entry.Tokens.OutputTokens, &entry.Tokens.TotalTokens); err != nil {
			return err
		}
		entry.StartedAt = now
		entry.LastEventAt = now
		entry.IssueIdentifier = entry.IssueID // Best effort fallback
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

func (s *Service) SetMCPRegistry(r *mcp.Registry, servers map[string]string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mcpRegistry = r
	s.mcpServers = make(map[string]string)
	for k, v := range servers {
		s.mcpServers[k] = v
	}
}

func (s *Service) GetMCPRegistry() *mcp.Registry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.mcpRegistry
}
