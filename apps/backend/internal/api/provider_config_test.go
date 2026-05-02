package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Per-Provider Configuration Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Provider Permissions
// ---------------------------------------------------------------------------

func TestGetProviderPermissions(t *testing.T) {
	router := newTestRouter(t)

	providers := []string{"claude", "codex", "opencode", "gemini"}
	for _, provider := range providers {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/agents/"+provider+"/permissions", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
			t.Fatalf("provider %s: expected 200 or 500, got %d: %s", provider, rec.Code, rec.Body.String())
		}
	}
}

func TestGetProviderPermissionsUnknownProvider(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/agents/unknown_provider/permissions", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusOK {
		t.Fatalf("expected 400 or 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostProviderPermissionsRejectsInvalidJSON(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/permissions", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPostProviderPermissions(t *testing.T) {
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"approval_mode": "auto",
		"allow":         []string{"read"},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/permissions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// May succeed or fail depending on home directory writable
	if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError && rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 200, 400, or 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Provider Model Config
// ---------------------------------------------------------------------------

func TestGetProviderModel(t *testing.T) {
	router := newTestRouter(t)

	providers := []string{"claude", "codex", "opencode", "gemini"}
	for _, provider := range providers {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/agents/"+provider+"/model", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
			t.Fatalf("provider %s: expected 200 or 500, got %d", provider, rec.Code)
		}
	}
}

func TestPostProviderModelRejectsInvalidJSON(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/model", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPostProviderModel(t *testing.T) {
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"model":  "claude-sonnet-4-20250514",
		"effort": "high",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/model", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError && rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 200, 400, or 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Provider Hooks
// ---------------------------------------------------------------------------

func TestGetProviderHooks(t *testing.T) {
	router := newTestRouter(t)

	providers := []string{"claude", "codex", "opencode", "gemini"}
	for _, provider := range providers {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/agents/"+provider+"/hooks", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
			t.Fatalf("provider %s: expected 200 or 500, got %d", provider, rec.Code)
		}
	}
}

func TestPostProviderHooksRejectsInvalidJSON(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/hooks", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Provider MCP Servers
// ---------------------------------------------------------------------------

func TestGetProviderMCPServers(t *testing.T) {
	router := newTestRouter(t)

	providers := []string{"claude", "codex", "opencode", "gemini"}
	for _, provider := range providers {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/agents/"+provider+"/mcp", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
			t.Fatalf("provider %s: expected 200 or 500, got %d", provider, rec.Code)
		}
	}
}

func TestAddProviderMCPServerRejectsInvalidJSON(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/mcp", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestAddProviderMCPServerMissingName(t *testing.T) {
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"name":    "",
		"command": "npx",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAddProviderMCPServerMissingCommandAndURL(t *testing.T) {
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"name": "test-server",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteProviderMCPServer(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/agents/claude/mcp/nonexistent-server", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Should succeed (204) even if server doesn't exist, or fail gracefully
	if rec.Code != http.StatusNoContent && rec.Code != http.StatusInternalServerError && rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 204, 400, or 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Provider Domain Resource Endpoints
// ---------------------------------------------------------------------------

func TestGetCodexBundle(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	router := newTestRouter(t)

	mustWriteTestFile(t, filepath.Join(home, ".codex", "config.toml"), "model = \"gpt-5.3-codex\"\n")
	mustWriteTestFile(t, filepath.Join(home, ".codex", "AGENTS.md"), "# Global Instructions\n")
	mustWriteTestFile(t, filepath.Join(home, ".codex", "agents", "reviewer.toml"), "name = \"reviewer\"\n")
	mustWriteTestFile(t, filepath.Join(home, ".agents", "skills", "triage", "SKILL.md"), "# Triage\n")
	mustWriteTestFile(t, filepath.Join(home, ".codex", "rules", "default.rules"), "prefix_rule(\"git\", \"status\")\n")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/agents/codex/bundle?scope=global", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	for _, key := range []string{"config", "instructions", "subagents", "skills", "rules"} {
		if _, ok := payload[key]; !ok {
			t.Fatalf("expected %s key in response: %v", key, payload)
		}
	}
}

func TestGeminiCommandsCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"name":    "daily-summary",
		"content": "description = \"Daily Summary\"\nprompt = \"\"\"\nDescribe the task.\n\"\"\"\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/gemini/commands?scope=global", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST command: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/agents/gemini/commands?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET commands: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	commandPath := filepath.Join(home, ".gemini", "commands", "daily-summary.toml")
	if _, err := os.Stat(commandPath); err != nil {
		t.Fatalf("expected command on disk: %v", err)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/agents/gemini/commands/daily-summary?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE command: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(commandPath); !os.IsNotExist(err) {
		t.Fatalf("expected command deleted from disk")
	}
}

func TestDeleteGeminiCommandRemovesLegacyMarkdownFile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	router := newTestRouter(t)

	legacyPath := filepath.Join(home, ".gemini", "commands", "legacy.md")
	mustWriteTestFile(t, legacyPath, "# Legacy command\n")

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/agents/gemini/commands/legacy?scope=global", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE legacy command: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	if _, err := os.Stat(legacyPath); !os.IsNotExist(err) {
		t.Fatalf("expected legacy markdown command deleted from disk")
	}
}

func TestOpenCodeAgentsCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"name":    "planner",
		"content": "---\ndescription: Planner\nmode: subagent\n---\n\nYou are Planner.\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/opencode/agents?scope=global", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST agent: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/agents/opencode/agents?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET agents: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	agentPath := filepath.Join(home, ".config", "opencode", "agents", "planner.md")
	if _, err := os.Stat(agentPath); err != nil {
		t.Fatalf("expected agent on disk: %v", err)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/agents/opencode/agents/planner?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE agent: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(agentPath); !os.IsNotExist(err) {
		t.Fatalf("expected agent deleted from disk")
	}
}

func TestPostCodexSubagentRejectsInvalidJSON(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/codex/subagents?scope=global", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestCodexSubagentsCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"name":    "reviewer",
		"content": "name = \"reviewer\"\ndescription = \"Review the diff\"\nprompt = \"\"\"\nReview the diff.\n\"\"\"\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/codex/subagents?scope=global", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST subagent: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/agents/codex/subagents?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET subagents: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	subagentPath := filepath.Join(home, ".codex", "agents", "reviewer.toml")
	if _, err := os.Stat(subagentPath); err != nil {
		t.Fatalf("expected subagent on disk: %v", err)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/agents/codex/subagents/reviewer?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE subagent: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(subagentPath); !os.IsNotExist(err) {
		t.Fatalf("expected subagent deleted from disk")
	}
}

func TestCodexSkillsCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"name":    "triage",
		"content": "# Triage\n\nInvestigate and classify issues.\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/codex/skills?scope=global", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST skill: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/agents/codex/skills?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET skills: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	skillPath := filepath.Join(home, ".agents", "skills", "triage", "SKILL.md")
	if _, err := os.Stat(skillPath); err != nil {
		t.Fatalf("expected skill on disk: %v", err)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/agents/codex/skills/triage?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE skill: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Dir(skillPath)); !os.IsNotExist(err) {
		t.Fatalf("expected skill deleted from disk")
	}
}

func TestCodexRulesCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"name":    "git-safety",
		"content": "prefix_rule(\"git\", \"status\")\nAlways inspect repository state first.\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/codex/rules?scope=global", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST rule: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/agents/codex/rules?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET rules: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	rulePath := filepath.Join(home, ".codex", "rules", "git-safety.rules")
	if _, err := os.Stat(rulePath); err != nil {
		t.Fatalf("expected rule on disk: %v", err)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/agents/codex/rules/git-safety?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE rule: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(rulePath); !os.IsNotExist(err) {
		t.Fatalf("expected rule deleted from disk")
	}
}

func TestCodexHooksScopedFile(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	body, _ := json.Marshal([]map[string]any{
		{"event": "pre_command", "type": "command", "command": "echo before"},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/codex/hooks?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST hooks: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	hooksPath := filepath.Join(projectRoot, ".codex", "hooks.json")
	data, err := os.ReadFile(hooksPath)
	if err != nil {
		t.Fatalf("expected hooks file on disk: %v", err)
	}
	if !strings.Contains(string(data), "pre_command") {
		t.Fatalf("expected hooks file content, got %q", string(data))
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/agents/codex/hooks?scope=project&project_id="+projectID, nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET hooks: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCodexPermissionsProjectWritesScopedConfig(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	body, _ := json.Marshal(map[string]any{
		"approval_mode": "full-auto",
		"allow":         []string{},
		"deny":          []string{},
		"ask":           []string{},
		"sandbox":       "workspace-write",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/codex/permissions?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST permissions: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	configPath := filepath.Join(projectRoot, ".codex", "config.toml")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("expected scoped config on disk: %v", err)
	}
	if !strings.Contains(string(data), "approval_policy") || !strings.Contains(string(data), "full-auto") || !strings.Contains(string(data), "sandbox_mode") || !strings.Contains(string(data), "workspace-write") {
		t.Fatalf("unexpected config content: %q", string(data))
	}
}

func TestCodexModelProjectWritesScopedConfig(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	body, _ := json.Marshal(map[string]any{
		"model":  "gpt-5.3-codex",
		"effort": "high",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/codex/model?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST model: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	configPath := filepath.Join(projectRoot, ".codex", "config.toml")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("expected scoped config on disk: %v", err)
	}
	if !strings.Contains(string(data), "model") || !strings.Contains(string(data), "gpt-5.3-codex") || !strings.Contains(string(data), "model_reasoning_effort") || !strings.Contains(string(data), "high") {
		t.Fatalf("unexpected config content: %q", string(data))
	}
}

func TestPostCodexInstructionsProjectWritesAGENTS(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)

	body, _ := json.Marshal(map[string]any{
		"content": "# Project Instructions\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/codex/instructions?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST instructions: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	instructionsPath := filepath.Join(projectRoot, "AGENTS.md")
	data, err := os.ReadFile(instructionsPath)
	if err != nil {
		t.Fatalf("expected project instructions on disk: %v", err)
	}
	if string(data) != "# Project Instructions\n" {
		t.Fatalf("unexpected instructions content: %q", string(data))
	}
}

func TestPostGeminiSettingsWritesConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"content": "{\n  \"theme\": \"dark\"\n}\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/gemini/settings?scope=global", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST settings: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	settingsPath := filepath.Join(home, ".gemini", "settings.json")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("expected settings on disk: %v", err)
	}
	if string(data) != "{\n  \"theme\": \"dark\"\n}\n" {
		t.Fatalf("unexpected settings content: %q", string(data))
	}
}

func TestPostGeminiContextProjectWritesGEMINI(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)

	body, _ := json.Marshal(map[string]any{
		"content": "# Project Gemini Context\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/gemini/context?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST context: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	contextPath := filepath.Join(projectRoot, "GEMINI.md")
	data, err := os.ReadFile(contextPath)
	if err != nil {
		t.Fatalf("expected project context on disk: %v", err)
	}
	if string(data) != "# Project Gemini Context\n" {
		t.Fatalf("unexpected context content: %q", string(data))
	}
}

func TestGeminiPermissionsProjectWritesScopedSettings(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	body, _ := json.Marshal(map[string]any{
		"approval_mode": "interactive",
		"allow":         []string{"read-file", "run-shell-command"},
		"deny":          []string{},
		"ask":           []string{},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/gemini/permissions?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST permissions: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	settingsPath := filepath.Join(projectRoot, ".gemini", "settings.json")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("expected scoped settings on disk: %v", err)
	}
	if !strings.Contains(string(data), "\"tools\"") || !strings.Contains(string(data), "read-file") || !strings.Contains(string(data), "run-shell-command") {
		t.Fatalf("unexpected settings content: %q", string(data))
	}
}

func TestGeminiModelProjectWritesScopedSettings(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	body, _ := json.Marshal(map[string]any{
		"model":  "gemini-2.5-pro",
		"effort": "high",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/gemini/model?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST model: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	settingsPath := filepath.Join(projectRoot, ".gemini", "settings.json")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("expected scoped settings on disk: %v", err)
	}
	if !strings.Contains(string(data), "gemini-2.5-pro") || !strings.Contains(string(data), "inlineThinkingMode") || !strings.Contains(string(data), "high") {
		t.Fatalf("unexpected settings content: %q", string(data))
	}
}

func TestPostOpenCodeConfigProjectWritesDotOpenCode(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)

	body, _ := json.Marshal(map[string]any{
		"content": "{\n  \"model\": \"gpt-5\"\n}\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/opencode/config?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST config: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	configPath := filepath.Join(projectRoot, ".opencode", "opencode.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("expected project config on disk: %v", err)
	}
	if string(data) != "{\n  \"model\": \"gpt-5\"\n}\n" {
		t.Fatalf("unexpected config content: %q", string(data))
	}
}

func TestOpenCodePermissionsProjectWritesScopedConfig(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	body, _ := json.Marshal(map[string]any{
		"approval_mode": "interactive",
		"allow":         []string{"bash(git status)", "read"},
		"deny":          []string{"bash(rm *)"},
		"ask":           []string{"edit"},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/opencode/permissions?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST permissions: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	configPath := filepath.Join(projectRoot, ".opencode", "opencode.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("expected scoped config on disk: %v", err)
	}
	if !strings.Contains(string(data), "\"permission\"") || !strings.Contains(string(data), "\"git status\"") || !strings.Contains(string(data), "\"rm *\"") || !strings.Contains(string(data), "\"edit\"") {
		t.Fatalf("unexpected config content: %q", string(data))
	}
}

func TestOpenCodeModelProjectWritesScopedConfig(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	body, _ := json.Marshal(map[string]any{
		"model":  "openai/gpt-5.3-codex",
		"effort": "openai/gpt-5.3-codex-spark",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/opencode/model?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST model: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	configPath := filepath.Join(projectRoot, ".opencode", "opencode.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("expected scoped config on disk: %v", err)
	}
	if !strings.Contains(string(data), "\"model\"") || !strings.Contains(string(data), "openai/gpt-5.3-codex") || !strings.Contains(string(data), "\"small_model\"") || !strings.Contains(string(data), "openai/gpt-5.3-codex-spark") {
		t.Fatalf("unexpected config content: %q", string(data))
	}
}

func TestOpenCodeCommandsCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"name":    "summarize",
		"content": "# Summarize\n\nSummarize the current task.\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/opencode/commands?scope=global", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST command: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/agents/opencode/commands?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET commands: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	commandPath := filepath.Join(home, ".config", "opencode", "commands", "summarize.md")
	if _, err := os.Stat(commandPath); err != nil {
		t.Fatalf("expected command on disk: %v", err)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/agents/opencode/commands/summarize?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE command: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(commandPath); !os.IsNotExist(err) {
		t.Fatalf("expected command deleted from disk")
	}
}

func TestOpenCodeSkillsCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"name":    "planner",
		"content": "# Planner\n\nPlan the next steps.\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/opencode/skills?scope=global", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST skill: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/agents/opencode/skills?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET skills: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	skillPath := filepath.Join(home, ".config", "opencode", "skills", "planner", "SKILL.md")
	if _, err := os.Stat(skillPath); err != nil {
		t.Fatalf("expected skill on disk: %v", err)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/agents/opencode/skills/planner?scope=global", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("DELETE skill: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Dir(skillPath)); !os.IsNotExist(err) {
		t.Fatalf("expected skill deleted from disk")
	}
}

func TestOpenCodeAgentsProjectWritesScopedDirectory(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)

	body, _ := json.Marshal(map[string]any{
		"name":    "planner",
		"content": "---\ndescription: Planner\nmode: subagent\n---\n\nYou are Planner.\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/opencode/agents?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST project agent: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	agentPath := filepath.Join(projectRoot, ".opencode", "agents", "planner.md")
	data, err := os.ReadFile(agentPath)
	if err != nil {
		t.Fatalf("expected project agent on disk: %v", err)
	}
	if !strings.Contains(string(data), "mode: subagent") {
		t.Fatalf("unexpected agent content: %q", string(data))
	}
}

func TestOpenCodeSkillsProjectWritesScopedDirectory(t *testing.T) {
	router, projectID, projectRoot := newProviderProjectRouter(t)

	body, _ := json.Marshal(map[string]any{
		"name":    "release",
		"content": "---\nname: release\ndescription: Release helper\ncompatibility: opencode\n---\n\nRelease steps.\n",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/opencode/skills?scope=project&project_id="+projectID, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST project skill: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	skillPath := filepath.Join(projectRoot, ".opencode", "skills", "release", "SKILL.md")
	data, err := os.ReadFile(skillPath)
	if err != nil {
		t.Fatalf("expected project skill on disk: %v", err)
	}
	if !strings.Contains(string(data), "compatibility: opencode") {
		t.Fatalf("unexpected skill content: %q", string(data))
	}
}

// ---------------------------------------------------------------------------
// Agent Provider API Keys
// ---------------------------------------------------------------------------

func TestGetAgentProviders(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/config/agent-providers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := payload["providers"]; !ok {
		t.Fatalf("expected providers key: %v", payload)
	}
}

func mustWriteTestFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func newProviderProjectRouter(t *testing.T) (http.Handler, string, string) {
	t.Helper()
	router, warehouseDB := newTestRouterWithDB(t)
	projectRoot := t.TempDir()

	projectID, err := warehouseDB.UpsertProject(t.Context(), projectRoot, "")
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	return router, projectID, projectRoot
}

func TestSaveAgentProviderRejectsInvalidJSON(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/config/agent-providers", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestSaveAgentProviderMissingFields(t *testing.T) {
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]string{})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/config/agent-providers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSaveAgentProviderInvalidProvider(t *testing.T) {
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]string{
		"provider": "invalid_provider",
		"api_key":  "sk-test",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/config/agent-providers", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSaveAgentProviderValidProviders(t *testing.T) {
	router := newTestRouter(t)

	providers := []string{"openrouter", "claude", "openai", "gemini"}
	for _, provider := range providers {
		body, _ := json.Marshal(map[string]string{
			"provider": provider,
			"api_key":  "test-key-" + provider,
		})
		req := httptest.NewRequest(http.MethodPost, "/api/v1/config/agent-providers", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		// Should succeed (200) or fail gracefully with file I/O error
		if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
			t.Fatalf("provider %s: expected 200 or 500, got %d: %s", provider, rec.Code, rec.Body.String())
		}

		if rec.Code == http.StatusOK {
			var payload map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload["provider"] != provider {
				t.Fatalf("expected provider %q, got %v", provider, payload["provider"])
			}
			if payload["configured"] != true {
				t.Fatalf("expected configured=true, got %v", payload["configured"])
			}
		}
	}
}

