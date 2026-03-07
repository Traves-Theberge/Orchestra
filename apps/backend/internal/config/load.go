package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/workflow"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

func Load() (Config, error) {
	workspaceDefault := filepath.Join(os.TempDir(), "orchestra_workspaces")
	agentProviderDefault := "codex"
	agentMaxTurnsDefault := 3
	agentCommandsDefault := map[string]string{
		"codex":    "codex exec {{prompt}}",
		"claude":   "claude -p {{prompt}}",
		"opencode": "opencode run {{prompt}}",
	}

	host := getenvOrEmpty("ORCHESTRA_SERVER_HOST")
	portRaw := getenvOrEmpty("ORCHESTRA_SERVER_PORT")
	workspaceRoot := getenvOrEmpty("ORCHESTRA_WORKSPACE_ROOT")
	apiToken := getenvOrEmpty("ORCHESTRA_API_TOKEN")
	workflowPath := getenvOrDefault("ORCHESTRA_WORKFLOW_FILE", "WORKFLOW.md")
	workflowPath = resolveWorkflowPath(strings.TrimSpace(workflowPath))
	agentProvider := getenvOrEmpty("ORCHESTRA_AGENT_PROVIDER")
	agentMaxTurnsRaw := getenvOrEmpty("ORCHESTRA_AGENT_MAX_TURNS")

	agentCommandCodex := getenvOrEmpty("ORCHESTRA_AGENT_COMMAND_CODEX")
	agentCommandClaude := getenvOrEmpty("ORCHESTRA_AGENT_COMMAND_CLAUDE")
	agentCommandOpenCode := getenvOrEmpty("ORCHESTRA_AGENT_COMMAND_OPENCODE")
	trackerEndpoint := getenvOrEmpty("ORCHESTRA_TRACKER_ENDPOINT")
	trackerToken := getenvOrEmpty("ORCHESTRA_TRACKER_TOKEN")
	trackerProject := getenvOrEmpty("ORCHESTRA_TRACKER_PROJECT")
	trackerWorkerAssigneeIDsRaw := getenvOrEmpty("ORCHESTRA_TRACKER_WORKER_ASSIGNEE_IDS")
	activeStatesRaw := getenvOrEmpty("ORCHESTRA_ACTIVE_STATES")
	terminalStatesRaw := getenvOrEmpty("ORCHESTRA_TERMINAL_STATES")
	maxConcurrentRaw := getenvOrEmpty("ORCHESTRA_MAX_CONCURRENT")
	maxConcurrentByStateRaw := getenvOrEmpty("ORCHESTRA_MAX_CONCURRENT_BY_STATE")
	workspaceAfterCreate := getenvOrEmpty("ORCHESTRA_WORKSPACE_AFTER_CREATE")
	workspaceBeforeRemove := getenvOrEmpty("ORCHESTRA_WORKSPACE_BEFORE_REMOVE")
	workspaceBeforeRun := getenvOrEmpty("ORCHESTRA_WORKSPACE_BEFORE_RUN")
	workspaceAfterRun := getenvOrEmpty("ORCHESTRA_WORKSPACE_AFTER_RUN")

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
	if strings.TrimSpace(trackerEndpoint) == "" {
		trackerEndpoint = workflowOverrides.TrackerEndpoint
	}
	if strings.TrimSpace(trackerToken) == "" {
		trackerToken = workflowOverrides.TrackerToken
	}
	if strings.TrimSpace(trackerProject) == "" {
		trackerProject = workflowOverrides.TrackerProject
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

	if strings.TrimSpace(host) == "" {
		host = "127.0.0.1"
	}
	if strings.TrimSpace(portRaw) == "" {
		portRaw = "4000"
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
		agentCommands["codex"] = value
	}
	if value := strings.TrimSpace(workflowOverrides.AgentCommandClaude); value != "" {
		agentCommands["claude"] = value
	}
	if value := strings.TrimSpace(workflowOverrides.AgentCommandOpenCode); value != "" {
		agentCommands["opencode"] = value
	}

	if value := strings.TrimSpace(agentCommandCodex); value != "" {
		agentCommands["codex"] = value
	}
	if value := strings.TrimSpace(agentCommandClaude); value != "" {
		agentCommands["claude"] = value
	}
	if value := strings.TrimSpace(agentCommandOpenCode); value != "" {
		agentCommands["opencode"] = value
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
		maxConcurrent = 10
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

	return Config{
		Host:                     strings.TrimSpace(host),
		Port:                     port,
		WorkspaceRoot:            strings.TrimSpace(workspaceRoot),
		APIToken:                 strings.TrimSpace(apiToken),
		WorkflowFile:             strings.TrimSpace(workflowPath),
		AgentProvider:            strings.TrimSpace(strings.ToLower(agentProvider)),
		AgentCommands:            agentCommands,
		AgentMaxTurns:            agentMaxTurns,
		TrackerEndpoint:          strings.TrimSpace(trackerEndpoint),
		TrackerToken:             strings.TrimSpace(trackerToken),
		TrackerProject:           strings.TrimSpace(trackerProject),
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
	}, nil
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
	AgentMaxTurns            string
	TrackerEndpoint          string
	TrackerToken             string
	TrackerProject           string
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
		AgentMaxTurns: firstStringValue(
			lookupNested(doc.Config, []string{"agent", "max_turns"}),
		),
		TrackerEndpoint: firstStringValue(
			lookupNested(doc.Config, []string{"tracker", "endpoint"}),
		),
		TrackerToken: firstStringValue(
			lookupNested(doc.Config, []string{"tracker", "token"}),
		),
		TrackerProject: firstStringValue(
			lookupNested(doc.Config, []string{"tracker", "project"}),
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
	}
}

func resolveWorkflowPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	if trimmed == "WORKFLOW.md" && !fileExists(trimmed) && fileExists("ORCHESTRA.md") {
		return "ORCHESTRA.md"
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

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
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
