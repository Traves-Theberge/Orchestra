package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/workflow"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

// Load reads configuration from environment variables and the workflow file,
// applying defaults where values are not explicitly set, and returns a
// fully resolved Config.
func Load() (Config, error) {
	workspaceDefault := filepath.Join(os.Getenv("HOME"), ".orchestra", "workspaces")
	if os.Getenv("HOME") == "" {
		workspaceDefault = filepath.Join(os.TempDir(), "orchestra_workspaces")
	}
	agentProviderDefault := "CODEX"
	agentMaxTurnsDefault := 25
	agentCommandsDefault := map[string]string{
		"CLAUDE":   "claude -p {{prompt}} --output-format stream-json --verbose --dangerously-skip-permissions",
		"CODEX":    "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {{prompt}}",
		"GEMINI":   "gemini -p {{prompt}} --output-format stream-json --approval-mode yolo",
		"OPENCODE": "opencode -p {{prompt}} -f json",
		"8GENT":    "8gent run --yes --output-format stream-json {{prompt}}",
	}

	host := getenvOrEmpty("ORCHESTRA_SERVER_HOST")
	portRaw := getenvOrEmpty("ORCHESTRA_SERVER_PORT")
	workspaceRoot := getenvOrEmpty("ORCHESTRA_WORKSPACE_ROOT")
	worktreeRoot := getenvOrEmpty("ORCHESTRA_WORKTREE_ROOT")
	apiToken := getenvOrEmpty("ORCHESTRA_API_TOKEN")
	workflowPath := getenvOrDefault("ORCHESTRA_WORKFLOW_FILE", "WORKFLOW.md")
	workflowPath = resolveWorkflowPath(strings.TrimSpace(workflowPath))
	agentProvider := getenvOrEmpty("ORCHESTRA_AGENT_PROVIDER")
	agentMaxTurnsRaw := getenvOrEmpty("ORCHESTRA_AGENT_MAX_TURNS")

	agentCommandCodex := getenvOrEmpty("ORCHESTRA_AGENT_COMMAND_CODEX")
	agentCommandClaude := getenvOrEmpty("ORCHESTRA_AGENT_COMMAND_CLAUDE")
	agentCommandOpenCode := getenvOrEmpty("ORCHESTRA_AGENT_COMMAND_OPENCODE")
	agentCommandGemini := getenvOrEmpty("ORCHESTRA_AGENT_COMMAND_GEMINI")
	agentCommand8gent := getenvOrEmpty("ORCHESTRA_AGENT_COMMAND_8GENT")
	agentCommandUnsandbox := getenvOrEmpty("ORCHESTRA_AGENT_COMMAND_UNSANDBOX")
	trackerType := getenvOrEmpty("ORCHESTRA_TRACKER_TYPE")
	trackerEndpoint := getenvOrEmpty("ORCHESTRA_TRACKER_ENDPOINT")
	trackerToken := getenvOrEmpty("ORCHESTRA_TRACKER_TOKEN")
	trackerWorkerAssigneeIDsRaw := getenvOrEmpty("ORCHESTRA_TRACKER_WORKER_ASSIGNEE_IDS")
	activeStatesRaw := getenvOrEmpty("ORCHESTRA_ACTIVE_STATES")
	terminalStatesRaw := getenvOrEmpty("ORCHESTRA_TERMINAL_STATES")
	maxConcurrentRaw := getenvOrEmpty("ORCHESTRA_MAX_CONCURRENT")
	maxConcurrentByStateRaw := getenvOrEmpty("ORCHESTRA_MAX_CONCURRENT_BY_STATE")
	workspaceAfterCreate := getenvOrEmpty("ORCHESTRA_WORKSPACE_AFTER_CREATE")
	workspaceBeforeRemove := getenvOrEmpty("ORCHESTRA_WORKSPACE_BEFORE_REMOVE")
	workspaceBeforeRun := getenvOrEmpty("ORCHESTRA_WORKSPACE_BEFORE_RUN")
	workspaceAfterRun := getenvOrEmpty("ORCHESTRA_WORKSPACE_AFTER_RUN")
	projectRootsRaw := getenvOrEmpty("ORCHESTRA_PROJECT_ROOTS")
	githubClientID := getenvOrEmpty("ORCHESTRA_GITHUB_CLIENT_ID")
	githubClientSecret := getenvOrEmpty("ORCHESTRA_GITHUB_CLIENT_SECRET")
	mcpServersRaw := getenvOrEmpty("ORCHESTRA_MCP_SERVERS")
	telemetryProvidersRaw := getenvOrEmpty("ORCHESTRA_TELEMETRY_PROVIDERS")
	telemetryRetentionDaysRaw := getenvOrEmpty("ORCHESTRA_TELEMETRY_RETENTION_DAYS")
	telemetryStoreRawPayloadRaw := getenvOrEmpty("ORCHESTRA_TELEMETRY_STORE_RAW_PAYLOAD")
	sttWhisperBin := getenvOrEmpty("ORCHESTRA_STT_WHISPER_BIN")
	sttWhisperModelPath := getenvOrEmpty("ORCHESTRA_STT_WHISPER_MODEL")
	sttWhisperThreadsRaw := getenvOrEmpty("ORCHESTRA_STT_WHISPER_THREADS")
	sttWhisperLanguage := getenvOrDefault("ORCHESTRA_STT_WHISPER_LANGUAGE", "en")

	anthropicAdminKey := getenvOrEmpty("ORCHESTRA_ANTHROPIC_ADMIN_KEY")
	openaiAdminKey := getenvOrEmpty("ORCHESTRA_OPENAI_ADMIN_KEY")
	analyticsSyncIntervalRaw := getenvOrDefault("ORCHESTRA_ANALYTICS_SYNC_INTERVAL", "1h")
	analyticsExternalEnabledRaw := getenvOrDefault("ORCHESTRA_ANALYTICS_EXTERNAL_ENABLED", "false")

	workflowOverrides := loadWorkflowOverrides(strings.TrimSpace(workflowPath))
	if host == "" {
		host = workflowOverrides.Host
	}
	if portRaw == "" {
		portRaw = workflowOverrides.Port
	}
	if workspaceRoot == "" {
		workspaceRoot = workflowOverrides.WorkspaceRoot
	}
	if apiToken == "" {
		apiToken = workflowOverrides.APIToken
	}
	if agentProvider == "" {
		agentProvider = workflowOverrides.AgentProvider
	}
	if strings.TrimSpace(agentMaxTurnsRaw) == "" {
		agentMaxTurnsRaw = workflowOverrides.AgentMaxTurns
	}
	if strings.TrimSpace(trackerType) == "" {
		trackerType = workflowOverrides.TrackerType
	}
	if strings.TrimSpace(trackerEndpoint) == "" {
		trackerEndpoint = workflowOverrides.TrackerEndpoint
	}
	if strings.TrimSpace(trackerToken) == "" {
		trackerToken = workflowOverrides.TrackerToken
	}
	if strings.TrimSpace(trackerWorkerAssigneeIDsRaw) == "" {
		trackerWorkerAssigneeIDsRaw = workflowOverrides.TrackerWorkerAssigneeIDs
	}
	if len(activeStatesRaw) == 0 {
		activeStatesRaw = workflowOverrides.ActiveStates
	}
	if len(terminalStatesRaw) == 0 {
		terminalStatesRaw = workflowOverrides.TerminalStates
	}
	if strings.TrimSpace(maxConcurrentRaw) == "" {
		maxConcurrentRaw = workflowOverrides.MaxConcurrent
	}
	if strings.TrimSpace(maxConcurrentByStateRaw) == "" {
		maxConcurrentByStateRaw = workflowOverrides.MaxConcurrentByStateRaw
	}
	if strings.TrimSpace(workspaceAfterCreate) == "" {
		workspaceAfterCreate = workflowOverrides.WorkspaceAfterCreate
	}
	if strings.TrimSpace(workspaceBeforeRemove) == "" {
		workspaceBeforeRemove = workflowOverrides.WorkspaceBeforeRemove
	}
	if strings.TrimSpace(workspaceBeforeRun) == "" {
		workspaceBeforeRun = workflowOverrides.WorkspaceBeforeRun
	}
	if strings.TrimSpace(workspaceAfterRun) == "" {
		workspaceAfterRun = workflowOverrides.WorkspaceAfterRun
	}
	if strings.TrimSpace(projectRootsRaw) == "" {
		projectRootsRaw = workflowOverrides.ProjectRoots
	}
	if githubClientID == "" {
		githubClientID = workflowOverrides.GitHubClientID
	}
	if githubClientSecret == "" {
		githubClientSecret = workflowOverrides.GitHubClientSecret
	}

	if strings.TrimSpace(host) == "" {
		host = "127.0.0.1"
	}
	if strings.TrimSpace(portRaw) == "" {
		portRaw = "4010"
	}
	if strings.TrimSpace(workspaceRoot) == "" {
		workspaceRoot = workspaceDefault
	}

	if strings.TrimSpace(agentProvider) == "" {
		agentProvider = agentProviderDefault
	}
	if strings.TrimSpace(agentMaxTurnsRaw) == "" {
		agentMaxTurnsRaw = strconv.Itoa(agentMaxTurnsDefault)
	}

	agentCommands := map[string]string{}
	for key, value := range agentCommandsDefault {
		agentCommands[key] = value
	}

	if value := strings.TrimSpace(workflowOverrides.AgentCommandCodex); value != "" {
		agentCommands["CODEX"] = value
	}
	if value := strings.TrimSpace(workflowOverrides.AgentCommandClaude); value != "" {
		agentCommands["CLAUDE"] = value
	}
	if value := strings.TrimSpace(workflowOverrides.AgentCommandOpenCode); value != "" {
		agentCommands["OPENCODE"] = value
	}
	if value := strings.TrimSpace(workflowOverrides.AgentCommandGemini); value != "" {
		agentCommands["GEMINI"] = value
	}
	if value := strings.TrimSpace(workflowOverrides.AgentCommand8gent); value != "" {
		agentCommands["8GENT"] = value
	}

	if value := strings.TrimSpace(agentCommandCodex); value != "" {
		agentCommands["CODEX"] = value
	}
	if value := strings.TrimSpace(agentCommandClaude); value != "" {
		agentCommands["CLAUDE"] = value
	}
	if value := strings.TrimSpace(agentCommandOpenCode); value != "" {
		agentCommands["OPENCODE"] = value
	}
	if value := strings.TrimSpace(agentCommandGemini); value != "" {
		agentCommands["GEMINI"] = value
	}
	if value := strings.TrimSpace(agentCommand8gent); value != "" {
		agentCommands["8GENT"] = value
	}
	if value := strings.TrimSpace(agentCommandUnsandbox); value != "" {
		agentCommands["UNSANDBOX"] = value
	}

	port, err := strconv.Atoi(strings.TrimSpace(portRaw))
	if err != nil || port <= 0 || port > 65535 {
		return Config{}, fmt.Errorf("invalid port %q", portRaw)
	}

	agentMaxTurns, err := strconv.Atoi(strings.TrimSpace(agentMaxTurnsRaw))
	if err != nil || agentMaxTurns <= 0 {
		agentMaxTurns = agentMaxTurnsDefault
	}

	maxConcurrent := 0
	if maxConcurrentRaw != "" {
		if parsed, err := strconv.Atoi(strings.TrimSpace(maxConcurrentRaw)); err == nil && parsed > 0 {
			maxConcurrent = parsed
		}
	}
	if maxConcurrent == 0 {
		maxConcurrent = 6
	}
	maxConcurrentByState := parseStateConcurrencyCSV(maxConcurrentByStateRaw)
	if len(maxConcurrentByState) == 0 {
		maxConcurrentByState = workflowOverrides.MaxConcurrentByState
	}

	activeStates := parseStateList(activeStatesRaw)
	if len(activeStates) == 0 {
		activeStates = []string{"Todo", "In Progress"}
	}

	terminalStates := parseStateList(terminalStatesRaw)
	if len(terminalStates) == 0 {
		terminalStates = []string{"Done", "Cancelled", "Canceled", "Closed", "Duplicate"}
	}
	trackerWorkerAssigneeIDs := parseStateList(trackerWorkerAssigneeIDsRaw)
	projectRoots := parseStateList(projectRootsRaw)
	mcpServers := parseMCPServers(mcpServersRaw)

	// Merge with Claude Code MCP servers
	claudeCodeServers := readClaudeCodeMCPServers()
	for name, command := range claudeCodeServers {
		// Environment variable servers take precedence over Claude Code
		if _, exists := mcpServers[name]; !exists {
			mcpServers[name] = command
		}
	}
	telemetryProviders := parseStateList(telemetryProvidersRaw)
	if len(telemetryProviders) == 0 {
		telemetryProviders = []string{"CLAUDE", "CODEX", "GEMINI", "OPENCODE"}
	}
	telemetryRetentionDays := 7
	if strings.TrimSpace(telemetryRetentionDaysRaw) != "" {
		if parsed, err := strconv.Atoi(strings.TrimSpace(telemetryRetentionDaysRaw)); err == nil && parsed > 0 {
			telemetryRetentionDays = parsed
		}
	}
	telemetryStoreRawPayload := parseBoolWithDefault(telemetryStoreRawPayloadRaw, false)
	sttWhisperThreads := 0
	if strings.TrimSpace(sttWhisperThreadsRaw) != "" {
		if parsed, err := strconv.Atoi(strings.TrimSpace(sttWhisperThreadsRaw)); err == nil && parsed > 0 {
			sttWhisperThreads = parsed
		}
	}

	if strings.TrimSpace(worktreeRoot) == "" {
		// Default to workspace root so worktrees and diffs use the same base path
		if strings.TrimSpace(workspaceRoot) != "" {
			worktreeRoot = strings.TrimSpace(workspaceRoot)
		} else {
			worktreeRoot = filepath.Join(os.Getenv("HOME"), ".orchestra", "worktrees")
		}
	}

	analyticsSyncInterval, err := time.ParseDuration(strings.TrimSpace(analyticsSyncIntervalRaw))
	if err != nil || analyticsSyncInterval < 0 {
		analyticsSyncInterval = time.Hour
	}
	analyticsExternalEnabled := parseBoolWithDefault(analyticsExternalEnabledRaw, false)

	// Tailscale runtime
	tailscaleSSHHost := getenvOrEmpty("ORCHESTRA_TAILSCALE_SSH_HOST")
	tailscaleSSHUser := getenvOrDefault("ORCHESTRA_TAILSCALE_SSH_USER", "root")
	tailscaleSSHKeyPath := getenvOrEmpty("ORCHESTRA_TAILSCALE_SSH_KEY")
	tailscaleWorktreeRoot := getenvOrDefault("ORCHESTRA_TAILSCALE_WORKTREE_ROOT", "/tmp/orchestra-worktrees")
	tailscaleSSHPort := 22
	if portStr := getenvOrEmpty("ORCHESTRA_TAILSCALE_SSH_PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil {
			tailscaleSSHPort = p
		}
	}

	// Kubernetes runtime
	kubeConfigPath := getenvOrEmpty("ORCHESTRA_KUBE_CONFIG")
	kubeNamespace := getenvOrDefault("ORCHESTRA_KUBE_NAMESPACE", "orchestra-agents")
	kubeImage := getenvOrDefault("ORCHESTRA_KUBE_IMAGE", "ghcr.io/orchestra/agent-runner:latest")
	kubeGitRepoURL := getenvOrEmpty("ORCHESTRA_KUBE_GIT_REPO_URL")
	kubeServiceAccount := getenvOrEmpty("ORCHESTRA_KUBE_SERVICE_ACCOUNT")

	return Config{
		Host:                     strings.TrimSpace(host),
		Port:                     port,
		WorkspaceRoot:            strings.TrimSpace(workspaceRoot),
		WorktreeRoot:             worktreeRoot,
		APIToken:                 strings.TrimSpace(apiToken),
		WorkflowFile:             strings.TrimSpace(workflowPath),
		AgentProvider:            strings.TrimSpace(strings.ToUpper(agentProvider)),
		AgentCommands:            agentCommands,
		AgentMaxTurns:            agentMaxTurns,
		TrackerType:              strings.TrimSpace(strings.ToLower(trackerType)),
		TrackerEndpoint:          strings.TrimSpace(trackerEndpoint),
		TrackerToken:             strings.TrimSpace(trackerToken),
		TrackerWorkerAssigneeIDs: trackerWorkerAssigneeIDs,
		ActiveStates:             activeStates,
		TerminalStates:           terminalStates,
		MaxConcurrent:            maxConcurrent,
		MaxConcurrentByState:     maxConcurrentByState,
		WorkspaceHooks: workspace.Hooks{
			AfterCreate:  strings.TrimSpace(workspaceAfterCreate),
			BeforeRemove: strings.TrimSpace(workspaceBeforeRemove),
			BeforeRun:    strings.TrimSpace(workspaceBeforeRun),
			AfterRun:     strings.TrimSpace(workspaceAfterRun),
		},
		ProjectRoots:             projectRoots,
		GitHubClientID:           githubClientID,
		GitHubClientSecret:       githubClientSecret,
		MCPServers:               mcpServers,
		TelemetryProviders:       telemetryProviders,
		TelemetryRetentionDays:   telemetryRetentionDays,
		TelemetryStoreRawPayload: telemetryStoreRawPayload,
		STTWhisperBin:            strings.TrimSpace(sttWhisperBin),
		STTWhisperModelPath:      strings.TrimSpace(sttWhisperModelPath),
		STTWhisperThreads:        sttWhisperThreads,
		STTWhisperLanguage:       strings.TrimSpace(sttWhisperLanguage),
		AnthropicAdminKey:        strings.TrimSpace(anthropicAdminKey),
		OpenAIAdminKey:           strings.TrimSpace(openaiAdminKey),
		AnalyticsSyncInterval:    analyticsSyncInterval,
		AnalyticsExternalEnabled: analyticsExternalEnabled,
		TailscaleSSHHost:         tailscaleSSHHost,
		TailscaleSSHUser:         tailscaleSSHUser,
		TailscaleSSHKeyPath:      tailscaleSSHKeyPath,
		TailscaleSSHPort:         tailscaleSSHPort,
		TailscaleWorktreeRoot:    tailscaleWorktreeRoot,
		KubeConfigPath:           kubeConfigPath,
		KubeNamespace:            kubeNamespace,
		KubeImage:                kubeImage,
		KubeGitRepoURL:           kubeGitRepoURL,
		KubeServiceAccount:       kubeServiceAccount,
	}, nil
}

func parseMCPServers(raw string) map[string]string {
	out := make(map[string]string)
	if strings.TrimSpace(raw) == "" {
		return out
	}
	parts := strings.Split(raw, ",")
	for _, p := range parts {
		kv := strings.SplitN(p, "=", 2)
		if len(kv) == 2 {
			out[strings.TrimSpace(kv[0])] = strings.TrimSpace(kv[1])
		}
	}
	return out
}

// claudeCodeSettings represents the Claude Code settings.json structure
type claudeCodeSettings struct {
	MCPServers map[string]struct {
		Command string            `json:"command"`
		Args    []string          `json:"args,omitempty"`
		Env     map[string]string `json:"env,omitempty"`
	} `json:"mcpServers,omitempty"`
	EnabledPlugins map[string]bool `json:"enabledPlugins,omitempty"`
}

// readClaudeCodeMCPServers attempts to read MCP servers from Claude Code configuration
func readClaudeCodeMCPServers() map[string]string {
	out := make(map[string]string)

	// Try standard Claude Code config locations
	home, err := os.UserHomeDir()
	if err != nil {
		return out
	}

	configPaths := []string{
		filepath.Join(home, ".claude", "settings.json"), // Claude Code CLI
	}

	var configData []byte
	for _, path := range configPaths {
		if data, err := os.ReadFile(path); err == nil {
			configData = data
			break
		}
	}

	if len(configData) == 0 {
		return out
	}

	var config claudeCodeSettings
	if err := json.Unmarshal(configData, &config); err != nil {
		return out
	}

	// Convert Claude Code format to Orchestra format
	for name, server := range config.MCPServers {
		command := server.Command
		if len(server.Args) > 0 {
			command += " " + strings.Join(server.Args, " ")
		}
		out[name] = command
	}

	// Read from enabled plugins
	cacheDir := filepath.Join(home, ".claude", "plugins", "cache")
	pluginsDir := filepath.Join(home, ".claude", "plugins", "marketplaces")

	for pluginName, enabled := range config.EnabledPlugins {
		if !enabled {
			continue
		}

		// Parse plugin name format: "plugin-name@marketplace-name"
		parts := strings.Split(pluginName, "@")
		if len(parts) != 2 {
			continue
		}
		plugin, marketplace := parts[0], parts[1]

		// Try cache directory first (latest versions)
		cachePath := filepath.Join(cacheDir, marketplace, plugin, "latest", ".mcp.json")
		if mcpData, err := os.ReadFile(cachePath); err == nil {
			var mcpConfig map[string]struct {
				Command string   `json:"command"`
				Args    []string `json:"args"`
			}
			if json.Unmarshal(mcpData, &mcpConfig) == nil {
				for serverName, server := range mcpConfig {
					command := server.Command
					if len(server.Args) > 0 {
						command += " " + strings.Join(server.Args, " ")
					}
					out[serverName] = command
				}
				continue // Found in cache, skip other locations
			}
		}

		// Try marketplace directory as fallback
		pluginPath := filepath.Join(pluginsDir, marketplace, "external_plugins", plugin, ".claude-plugin", "plugin.json")
		if pluginData, err := os.ReadFile(pluginPath); err == nil {
			var pluginConfig struct {
				MCPServers map[string]struct {
					Command string   `json:"command"`
					Args    []string `json:"args"`
				} `json:"mcpServers,omitempty"`
			}
			if json.Unmarshal(pluginData, &pluginConfig) == nil {
				for serverName, server := range pluginConfig.MCPServers {
					command := server.Command
					if len(server.Args) > 0 {
						command += " " + strings.Join(server.Args, " ")
					}
					out[serverName] = command
				}
			}
		}

		// Also try reading .mcp.json directly from marketplace
		mcpPath := filepath.Join(pluginsDir, marketplace, ".mcp.json")
		if mcpData, err := os.ReadFile(mcpPath); err == nil {
			var mcpConfig map[string]struct {
				Command string   `json:"command"`
				Args    []string `json:"args"`
			}
			if json.Unmarshal(mcpData, &mcpConfig) == nil {
				for serverName, server := range mcpConfig {
					command := server.Command
					if len(server.Args) > 0 {
						command += " " + strings.Join(server.Args, " ")
					}
					out[serverName] = command
				}
			}
		}
	}

	return out
}

type workflowConfigOverrides struct {
	Host                     string
	Port                     string
	WorkspaceRoot            string
	APIToken                 string
	AgentProvider            string
	AgentCommandCodex        string
	AgentCommandClaude       string
	AgentCommandOpenCode     string
	AgentCommandGemini       string
	AgentCommand8gent        string
	AgentMaxTurns            string
	TrackerType              string
	TrackerEndpoint          string
	TrackerToken             string
	TrackerWorkerAssigneeIDs string
	ActiveStates             string
	TerminalStates           string
	MaxConcurrent            string
	MaxConcurrentByStateRaw  string
	MaxConcurrentByState     map[string]int
	WorkspaceAfterCreate     string
	WorkspaceBeforeRemove    string
	WorkspaceBeforeRun       string
	WorkspaceAfterRun        string
	ProjectRoots             string
	GitHubClientID           string
	GitHubClientSecret       string
	MCPServersRaw            string
}

func loadWorkflowOverrides(path string) workflowConfigOverrides {
	if path == "" {
		return workflowConfigOverrides{}
	}

	doc, err := workflow.LoadFile(path)
	if err != nil {
		return workflowConfigOverrides{}
	}

	return workflowConfigOverrides{
		Host: firstStringValue(
			lookupNested(doc.Config, []string{"server", "host"}),
		),
		Port: firstStringValue(
			lookupNested(doc.Config, []string{"server", "port"}),
		),
		WorkspaceRoot: firstStringValue(
			lookupNested(doc.Config, []string{"workspace", "root"}),
		),
		APIToken: firstStringValue(
			lookupNested(doc.Config, []string{"server", "api_token"}),
		),
		AgentProvider: firstStringValue(
			lookupNested(doc.Config, []string{"agent", "provider"}),
		),
		AgentCommandCodex: firstStringValue(
			lookupNested(doc.Config, []string{"agent", "commands", "codex"}),
		),
		AgentCommandClaude: firstStringValue(
			lookupNested(doc.Config, []string{"agent", "commands", "claude"}),
		),
		AgentCommandOpenCode: firstStringValue(
			lookupNested(doc.Config, []string{"agent", "commands", "opencode"}),
		),
		AgentCommandGemini: firstStringValue(
			lookupNested(doc.Config, []string{"agent", "commands", "gemini"}),
		),
		AgentCommand8gent: firstStringValue(
			lookupNested(doc.Config, []string{"agent", "commands", "8gent"}),
		),
		AgentMaxTurns: firstStringValue(
			lookupNested(doc.Config, []string{"agent", "max_turns"}),
		),
		TrackerType: firstStringValue(
			lookupNested(doc.Config, []string{"tracker", "type"}),
		),
		TrackerEndpoint: firstStringValue(
			lookupNested(doc.Config, []string{"tracker", "endpoint"}),
		),
		TrackerToken: firstStringValue(
			lookupNested(doc.Config, []string{"tracker", "token"}),
		),
		TrackerWorkerAssigneeIDs: firstCSVValue(
			lookupNested(doc.Config, []string{"tracker", "worker_assignee_ids"}),
		),
		ActiveStates: firstCSVValue(
			lookupNested(doc.Config, []string{"tracker", "active_states"}),
		),
		TerminalStates: firstCSVValue(
			lookupNested(doc.Config, []string{"tracker", "terminal_states"}),
		),
		MaxConcurrent: firstStringValue(
			lookupNested(doc.Config, []string{"agent", "max_concurrent"}),
		),
		MaxConcurrentByStateRaw: firstStringValue(
			lookupNested(doc.Config, []string{"agent", "max_concurrent_by_state"}),
		),
		MaxConcurrentByState: parseStateConcurrencyMap(
			lookupNested(doc.Config, []string{"agent", "max_concurrent_by_state"}),
		),
		WorkspaceAfterCreate: firstStringValue(
			lookupNested(doc.Config, []string{"workspace", "after_create"}),
		),
		WorkspaceBeforeRemove: firstStringValue(
			lookupNested(doc.Config, []string{"workspace", "before_remove"}),
		),
		WorkspaceBeforeRun: firstStringValue(
			lookupNested(doc.Config, []string{"workspace", "before_run"}),
		),
		WorkspaceAfterRun: firstStringValue(
			lookupNested(doc.Config, []string{"workspace", "after_run"}),
		),
		ProjectRoots: firstStringValue(
			lookupNested(doc.Config, []string{"workspace", "project_roots"}),
		),
		GitHubClientID: firstStringValue(
			lookupNested(doc.Config, []string{"github", "client_id"}),
		),
		GitHubClientSecret: firstStringValue(
			lookupNested(doc.Config, []string{"github", "client_secret"}),
		),
		MCPServersRaw: firstStringValue(
			lookupNested(doc.Config, []string{"mcp", "servers"}),
		),
	}
}

func resolveWorkflowPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	return trimmed
}

func firstStringValue(values ...any) string {
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		case int:
			return strconv.Itoa(typed)
		case int64:
			return strconv.FormatInt(typed, 10)
		}
	}

	return ""
}

func firstCSVValue(values ...any) string {
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed != "" {
				return trimmed
			}
		case []string:
			parts := make([]string, 0, len(typed))
			for _, item := range typed {
				trimmed := strings.TrimSpace(item)
				if trimmed != "" {
					parts = append(parts, trimmed)
				}
			}
			if len(parts) > 0 {
				return strings.Join(parts, ",")
			}
		case []any:
			parts := make([]string, 0, len(typed))
			for _, item := range typed {
				str, ok := item.(string)
				if !ok {
					continue
				}
				trimmed := strings.TrimSpace(str)
				if trimmed != "" {
					parts = append(parts, trimmed)
				}
			}
			if len(parts) > 0 {
				return strings.Join(parts, ",")
			}
		}
	}

	return ""
}

func lookupNested(root map[string]any, path []string) any {
	if len(path) == 0 {
		return nil
	}

	var current any = root
	for _, segment := range path {
		node, ok := current.(map[string]any)
		if !ok {
			return nil
		}

		value, found := node[segment]
		if !found {
			return nil
		}

		current = value
	}

	return current
}

func getenvOrEmpty(key string) string {
	value, ok := os.LookupEnv(key)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func getenvOrDefault(key string, defaultValue string) string {
	value := getenvOrEmpty(key)
	if value == "" {
		return defaultValue
	}
	return value
}

func parseStateList(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func parseStateConcurrencyCSV(raw string) map[string]int {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	out := map[string]int{}
	parts := strings.Split(trimmed, ",")
	for _, part := range parts {
		pair := strings.SplitN(part, ":", 2)
		if len(pair) != 2 {
			continue
		}
		state := strings.TrimSpace(pair[0])
		limitRaw := strings.TrimSpace(pair[1])
		if state == "" || limitRaw == "" {
			continue
		}
		limit, err := strconv.Atoi(limitRaw)
		if err != nil || limit <= 0 {
			continue
		}
		out[state] = limit
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func parseStateConcurrencyMap(raw any) map[string]int {
	node, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	out := map[string]int{}
	for key, value := range node {
		state := strings.TrimSpace(key)
		if state == "" {
			continue
		}
		switch typed := value.(type) {
		case int:
			if typed > 0 {
				out[state] = typed
			}
		case int64:
			if typed > 0 {
				out[state] = int(typed)
			}
		case float64:
			if typed > 0 {
				out[state] = int(typed)
			}
		case string:
			if parsed, err := strconv.Atoi(strings.TrimSpace(typed)); err == nil && parsed > 0 {
				out[state] = parsed
			}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func parseBoolWithDefault(raw string, fallback bool) bool {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	if trimmed == "" {
		return fallback
	}
	switch trimmed {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
