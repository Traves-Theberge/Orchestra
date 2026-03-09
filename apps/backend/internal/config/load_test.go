package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad_UsesOrchestraEnv(t *testing.T) {
	t.Setenv("ORCHESTRA_SERVER_HOST", "0.0.0.0")
	t.Setenv("ORCHESTRA_SERVER_PORT", "4111")
	t.Setenv("ORCHESTRA_WORKSPACE_ROOT", "/tmp/orchestra-test")
	t.Setenv("ORCHESTRA_API_TOKEN", "token-1")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected config load success, got err=%v", err)
	}

	if cfg.Host != "0.0.0.0" {
		t.Fatalf("expected ORCHESTRA host, got=%q", cfg.Host)
	}
	if cfg.Port != 4111 {
		t.Fatalf("expected ORCHESTRA port, got=%d", cfg.Port)
	}
	if cfg.WorkspaceRoot != "/tmp/orchestra-test" {
		t.Fatalf("expected ORCHESTRA workspace root, got=%q", cfg.WorkspaceRoot)
	}
	if cfg.APIToken != "token-1" {
		t.Fatalf("expected ORCHESTRA api token, got=%q", cfg.APIToken)
	}
	if cfg.AgentProvider != "codex" {
		t.Fatalf("expected default agent provider codex, got=%q", cfg.AgentProvider)
	}
	if cfg.WorkflowFile != "WORKFLOW.md" {
		t.Fatalf("expected default workflow file WORKFLOW.md, got=%q", cfg.WorkflowFile)
	}
	if cfg.AgentMaxTurns != 3 {
		t.Fatalf("expected default agent max turns 3, got=%d", cfg.AgentMaxTurns)
	}
}

func TestLoad_AgentProviderAndCommandsFromEnv(t *testing.T) {
	t.Setenv("ORCHESTRA_AGENT_PROVIDER", "claude")
	t.Setenv("ORCHESTRA_AGENT_COMMAND_CLAUDE", "claude -p {{prompt}} --output-format json")
	t.Setenv("ORCHESTRA_AGENT_MAX_TURNS", "7")
	t.Setenv("ORCHESTRA_TRACKER_ENDPOINT", "http://127.0.0.1:5010/api/v1")
	t.Setenv("ORCHESTRA_TRACKER_TOKEN", "tracker-token")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected config load success, got err=%v", err)
	}

	if cfg.AgentProvider != "claude" {
		t.Fatalf("expected agent provider claude, got=%q", cfg.AgentProvider)
	}
	if cfg.AgentCommands["claude"] != "claude -p {{prompt}} --output-format json" {
		t.Fatalf("unexpected claude command: %q", cfg.AgentCommands["claude"])
	}
	if cfg.AgentMaxTurns != 7 {
		t.Fatalf("expected env max turns 7, got=%d", cfg.AgentMaxTurns)
	}
	if cfg.TrackerEndpoint != "http://127.0.0.1:5010/api/v1" {
		t.Fatalf("unexpected tracker endpoint: %q", cfg.TrackerEndpoint)
	}
	if cfg.TrackerToken != "tracker-token" {
		t.Fatalf("unexpected tracker token: %q", cfg.TrackerToken)
	}
}

func TestLoad_ParsesTrackerAndConcurrencyOverridesFromEnv(t *testing.T) {
	t.Setenv("ORCHESTRA_TRACKER_PROJECT", "orch")
	t.Setenv("ORCHESTRA_TRACKER_WORKER_ASSIGNEE_IDS", "user-1,user-2")
	t.Setenv("ORCHESTRA_ACTIVE_STATES", "Todo, In Progress")
	t.Setenv("ORCHESTRA_TERMINAL_STATES", "Done, Cancelled")
	t.Setenv("ORCHESTRA_MAX_CONCURRENT", "12")
	t.Setenv("ORCHESTRA_MAX_CONCURRENT_BY_STATE", "Todo:1,In Progress:2")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected config load success, got err=%v", err)
	}

	if cfg.TrackerProject != "orch" {
		t.Fatalf("expected tracker project override, got=%q", cfg.TrackerProject)
	}
	if len(cfg.TrackerWorkerAssigneeIDs) != 2 || cfg.TrackerWorkerAssigneeIDs[0] != "user-1" || cfg.TrackerWorkerAssigneeIDs[1] != "user-2" {
		t.Fatalf("unexpected tracker worker assignee IDs: %+v", cfg.TrackerWorkerAssigneeIDs)
	}
	if len(cfg.ActiveStates) != 2 || cfg.ActiveStates[0] != "Todo" || cfg.ActiveStates[1] != "In Progress" {
		t.Fatalf("unexpected active states: %+v", cfg.ActiveStates)
	}
	if len(cfg.TerminalStates) != 2 || cfg.TerminalStates[0] != "Done" || cfg.TerminalStates[1] != "Cancelled" {
		t.Fatalf("unexpected terminal states: %+v", cfg.TerminalStates)
	}
	if cfg.MaxConcurrent != 12 {
		t.Fatalf("expected max concurrent 12, got=%d", cfg.MaxConcurrent)
	}
	if cfg.MaxConcurrentByState["Todo"] != 1 || cfg.MaxConcurrentByState["In Progress"] != 2 {
		t.Fatalf("unexpected per-state limits: %+v", cfg.MaxConcurrentByState)
	}
}

func TestLoad_UsesWorkflowOverridesWhenEnvUnset(t *testing.T) {
	tempDir := t.TempDir()
	workflowPath := filepath.Join(tempDir, "WORKFLOW.md")
	content := "---\nserver:\n  host: 0.0.0.0\n  port: 4333\n  api_token: workflow-token\nworkspace:\n  root: /tmp/orchestra-from-workflow\nagent:\n  provider: opencode\n  max_turns: 4\n  max_concurrent: 8\n  max_concurrent_by_state:\n    Todo: 1\n    In Progress: 2\n  commands:\n    opencode: opencode run {{prompt}} --json\ntracker:\n  endpoint: http://tracker.local/api/v1\n  token: workflow-tracker-token\n  project: orch-workflow\n  worker_assignee_ids: user-1,user-2\n  active_states: Todo,In Progress\n  terminal_states: Done,Cancelled\n---\nPrompt"
	if err := os.WriteFile(workflowPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write workflow: %v", err)
	}

	t.Setenv("ORCHESTRA_WORKFLOW_FILE", workflowPath)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected config load success, got err=%v", err)
	}

	if cfg.Host != "0.0.0.0" || cfg.Port != 4333 || cfg.WorkspaceRoot != "/tmp/orchestra-from-workflow" {
		t.Fatalf("expected workflow overrides, got=%+v", cfg)
	}
	if cfg.APIToken != "workflow-token" {
		t.Fatalf("expected workflow API token override, got=%q", cfg.APIToken)
	}
	if cfg.AgentProvider != "opencode" {
		t.Fatalf("expected workflow agent provider override, got=%q", cfg.AgentProvider)
	}
	if cfg.AgentCommands["opencode"] != "opencode run {{prompt}} --json" {
		t.Fatalf("unexpected workflow opencode command override: %q", cfg.AgentCommands["opencode"])
	}
	if cfg.AgentMaxTurns != 4 {
		t.Fatalf("expected workflow max turns 4, got=%d", cfg.AgentMaxTurns)
	}
	if cfg.TrackerEndpoint != "http://tracker.local/api/v1" {
		t.Fatalf("unexpected workflow tracker endpoint: %q", cfg.TrackerEndpoint)
	}
	if cfg.TrackerToken != "workflow-tracker-token" {
		t.Fatalf("unexpected workflow tracker token: %q", cfg.TrackerToken)
	}
	if cfg.TrackerProject != "orch-workflow" {
		t.Fatalf("unexpected workflow tracker project: %q", cfg.TrackerProject)
	}
	if len(cfg.TrackerWorkerAssigneeIDs) != 2 || cfg.TrackerWorkerAssigneeIDs[0] != "user-1" || cfg.TrackerWorkerAssigneeIDs[1] != "user-2" {
		t.Fatalf("unexpected workflow tracker worker assignee IDs: %+v", cfg.TrackerWorkerAssigneeIDs)
	}
	if cfg.MaxConcurrent != 8 {
		t.Fatalf("unexpected workflow max concurrent: %d", cfg.MaxConcurrent)
	}
	if cfg.MaxConcurrentByState["Todo"] != 1 || cfg.MaxConcurrentByState["In Progress"] != 2 {
		t.Fatalf("unexpected workflow per-state limits: %+v", cfg.MaxConcurrentByState)
	}
}

func TestLoad_FallsBackToOrchestraMDWhenWorkflowMissing(t *testing.T) {
	t.Setenv("ORCHESTRA_SERVER_HOST", "")
	t.Setenv("ORCHESTRA_SERVER_PORT", "")
	t.Setenv("ORCHESTRA_WORKSPACE_ROOT", "")
	t.Setenv("ORCHESTRA_WORKFLOW_FILE", "")

	tempDir := t.TempDir()
	originalCwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	defer func() {
		_ = os.Chdir(originalCwd)
	}()

	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("chdir temp: %v", err)
	}

	content := "---\nserver:\n  host: 0.0.0.0\n  port: 4777\n---\nPrompt"
	if err := os.WriteFile(filepath.Join(tempDir, "ORCHESTRA.md"), []byte(content), 0o644); err != nil {
		t.Fatalf("write ORCHESTRA.md: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected load success, got err=%v", err)
	}

	if cfg.Host != "0.0.0.0" || cfg.Port != 4777 {
		t.Fatalf("expected ORCHESTRA.md overrides, got=%+v", cfg)
	}
	if cfg.WorkflowFile != "ORCHESTRA.md" {
		t.Fatalf("expected workflow fallback to ORCHESTRA.md, got=%q", cfg.WorkflowFile)
	}
}

func TestLoad_ParsesWorkflowListValuesForTrackerFields(t *testing.T) {
	tempDir := t.TempDir()
	workflowPath := filepath.Join(tempDir, "WORKFLOW.md")
	content := "---\ntracker:\n  worker_assignee_ids:\n    - user-1\n    - user-2\n  active_states:\n    - Todo\n    - In Progress\n  terminal_states:\n    - Done\n    - Cancelled\n---\nPrompt"
	if err := os.WriteFile(workflowPath, []byte(content), 0o644); err != nil {
		t.Fatalf("write workflow: %v", err)
	}

	t.Setenv("ORCHESTRA_WORKFLOW_FILE", workflowPath)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected load success, got err=%v", err)
	}

	if len(cfg.TrackerWorkerAssigneeIDs) != 2 || cfg.TrackerWorkerAssigneeIDs[0] != "user-1" || cfg.TrackerWorkerAssigneeIDs[1] != "user-2" {
		t.Fatalf("unexpected workflow list worker assignee IDs: %+v", cfg.TrackerWorkerAssigneeIDs)
	}
	if len(cfg.ActiveStates) != 2 || cfg.ActiveStates[0] != "Todo" || cfg.ActiveStates[1] != "In Progress" {
		t.Fatalf("unexpected workflow list active states: %+v", cfg.ActiveStates)
	}
	if len(cfg.TerminalStates) != 2 || cfg.TerminalStates[0] != "Done" || cfg.TerminalStates[1] != "Cancelled" {
		t.Fatalf("unexpected workflow list terminal states: %+v", cfg.TerminalStates)
	}
}

func TestLoad_InvalidPortReturnsError(t *testing.T) {
	t.Setenv("ORCHESTRA_SERVER_PORT", "99999")

	_, err := Load()
	if err == nil {
		t.Fatalf("expected invalid port error")
	}
}

func TestLoad_InvalidAgentMaxTurnsFallsBackToDefault(t *testing.T) {
	t.Setenv("ORCHESTRA_AGENT_MAX_TURNS", "-4")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected config load success, got err=%v", err)
	}
	if cfg.AgentMaxTurns != 3 {
		t.Fatalf("expected default agent max turns 3, got=%d", cfg.AgentMaxTurns)
	}
}

func TestLoad_InvalidMaxConcurrentFallsBackToDefault(t *testing.T) {
	t.Setenv("ORCHESTRA_MAX_CONCURRENT", "0")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected config load success, got err=%v", err)
	}
	if cfg.MaxConcurrent != 10 {
		t.Fatalf("expected fallback max concurrent 10, got=%d", cfg.MaxConcurrent)
	}
}
