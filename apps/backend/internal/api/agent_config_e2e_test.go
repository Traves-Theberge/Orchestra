package api_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/api"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

// testServer creates a test router with the full API surface.
func testServer(t *testing.T) (http.Handler, func()) {
	t.Helper()
	logger := zerolog.New(os.Stderr).Level(zerolog.Disabled)
	cfg := &config.Config{WorkspaceRoot: t.TempDir()}
	svc := orchestrator.NewService()
	handler := api.NewRouter(logger, svc, cfg)
	return handler, func() {}
}

// request is a helper to make HTTP requests to the test router.
func request(t *testing.T, handler http.Handler, method, path string, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var result map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&result)
	return rec.Code, result
}

// requestArray is like request but decodes a JSON array.
func requestArray(t *testing.T, handler http.Handler, method, path string, body string) (int, []map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var result []map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&result)
	return rec.Code, result
}

// TestAgentConfigSettingsMerge verifies that POST settings merges rather than replaces.
func TestAgentConfigSettingsMerge(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	// Create initial settings with multiple fields
	settingsDir := filepath.Join(home, ".claude")
	os.MkdirAll(settingsDir, 0755)
	initial := map[string]any{
		"model":        "claude-opus-4-6",
		"voiceEnabled": true,
		"enabledPlugins": map[string]any{
			"gmail@claude-ai":      true,
			"superpowers@official": true,
		},
	}
	data, _ := json.MarshalIndent(initial, "", "  ")
	os.WriteFile(filepath.Join(settingsDir, "settings.json"), data, 0644)

	ts, cleanup := testServer(t)
	defer cleanup()

	// Change only the model
	code, resp := request(t, ts, "POST", "/api/v1/agents/claude/settings?scope=global",
		`{"settings":{"model":"claude-sonnet-4"}}`)
	if code != 200 {
		t.Fatalf("POST settings: expected 200, got %d: %v", code, resp)
	}

	// Read back and verify OTHER fields survived
	code, resp = request(t, ts, "GET", "/api/v1/agents/claude/settings?scope=global", "")
	if code != 200 {
		t.Fatalf("GET settings: expected 200, got %d", code)
	}
	settings := resp["settings"].(map[string]any)

	if settings["model"] != "claude-sonnet-4" {
		t.Errorf("model: expected claude-sonnet-4, got %v", settings["model"])
	}
	if settings["voiceEnabled"] != true {
		t.Errorf("voiceEnabled: expected true, got %v (was wiped!)", settings["voiceEnabled"])
	}
	plugins, ok := settings["enabledPlugins"].(map[string]any)
	if !ok || len(plugins) != 2 {
		t.Errorf("enabledPlugins: expected 2 plugins preserved, got %v (was wiped!)", settings["enabledPlugins"])
	}

	// Verify on disk too
	raw, _ := os.ReadFile(filepath.Join(settingsDir, "settings.json"))
	var disk map[string]any
	json.Unmarshal(raw, &disk)
	if disk["model"] != "claude-sonnet-4" {
		t.Errorf("disk model: expected claude-sonnet-4, got %v", disk["model"])
	}
	if disk["voiceEnabled"] != true {
		t.Errorf("disk voiceEnabled: expected true, got %v", disk["voiceEnabled"])
	}
}

// TestAgentConfigInstructionsCRUD verifies CLAUDE.md read/write/delete cycle.
func TestAgentConfigInstructionsCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	os.MkdirAll(filepath.Join(home, ".claude"), 0755)

	ts, cleanup := testServer(t)
	defer cleanup()

	// Initially empty/missing
	code, resp := request(t, ts, "GET", "/api/v1/agents/claude/instructions?scope=global", "")
	if code != 200 {
		t.Fatalf("GET instructions: expected 200, got %d", code)
	}

	// Write instructions
	code, _ = request(t, ts, "POST", "/api/v1/agents/claude/instructions?scope=global",
		`{"content":"# Test\nAlways be concise."}`)
	if code != 200 {
		t.Fatalf("POST instructions: expected 200, got %d", code)
	}

	// Read back via API
	code, resp = request(t, ts, "GET", "/api/v1/agents/claude/instructions?scope=global", "")
	if code != 200 {
		t.Fatalf("GET instructions after write: expected 200, got %d", code)
	}
	content := resp["content"].(string)
	if !strings.Contains(content, "Always be concise") {
		t.Errorf("instructions content: expected 'Always be concise', got %q", content)
	}

	// Verify on disk
	diskContent, err := os.ReadFile(filepath.Join(home, ".claude", "CLAUDE.md"))
	if err != nil {
		t.Fatalf("read disk CLAUDE.md: %v", err)
	}
	if !strings.Contains(string(diskContent), "Always be concise") {
		t.Errorf("disk content mismatch: %q", string(diskContent))
	}

	// Delete
	code, _ = request(t, ts, "DELETE", "/api/v1/agents/claude/instructions?scope=global", "")
	if code != 200 && code != 204 {
		t.Fatalf("DELETE instructions: expected 200/204, got %d", code)
	}
}

// TestAgentConfigRulesCRUD verifies rules create/list/delete.
func TestAgentConfigRulesCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	os.MkdirAll(filepath.Join(home, ".claude", "rules"), 0755)

	ts, cleanup := testServer(t)
	defer cleanup()

	// Create a rule
	code, resp := request(t, ts, "POST", "/api/v1/agents/claude/rules?scope=global",
		`{"name":"no-console-log","content":"Never use console.log in production code."}`)
	if code != 200 && code != 201 {
		t.Fatalf("POST rule: expected 200/201, got %d: %v", code, resp)
	}

	// List rules
	code, resp = request(t, ts, "GET", "/api/v1/agents/claude/rules?scope=global", "")
	if code != 200 {
		t.Fatalf("GET rules: expected 200, got %d", code)
	}
	items := resp["items"].([]any)
	if len(items) != 1 {
		t.Errorf("expected 1 rule, got %d", len(items))
	}

	// Verify on disk
	ruleFile := filepath.Join(home, ".claude", "rules", "no-console-log.md")
	if _, err := os.Stat(ruleFile); os.IsNotExist(err) {
		t.Errorf("rule file not found on disk: %s", ruleFile)
	}

	// Delete
	code, _ = request(t, ts, "DELETE", "/api/v1/agents/claude/rules/no-console-log?scope=global", "")
	if code != 200 && code != 204 {
		t.Fatalf("DELETE rule: expected 200/204, got %d", code)
	}

	// Verify deleted from disk
	if _, err := os.Stat(ruleFile); !os.IsNotExist(err) {
		t.Errorf("rule file still exists on disk after delete: %s", ruleFile)
	}
}

// TestAgentConfigSkillsCRUD verifies skills create/list/delete.
func TestAgentConfigSkillsCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	os.MkdirAll(filepath.Join(home, ".claude", "skills"), 0755)

	ts, cleanup := testServer(t)
	defer cleanup()

	skillContent := "---\nname: test-ping\ndescription: A test skill\n---\n# Ping\nRespond with pong."

	// Create
	code, _ := request(t, ts, "POST", "/api/v1/agents/claude/skills?scope=global",
		fmt.Sprintf(`{"name":"test-ping","content":%q}`, skillContent))
	if code != 200 && code != 201 {
		t.Fatalf("POST skill: expected 200/201, got %d", code)
	}

	// List
	code, resp := request(t, ts, "GET", "/api/v1/agents/claude/skills?scope=global", "")
	if code != 200 {
		t.Fatalf("GET skills: expected 200, got %d", code)
	}
	items := resp["items"].([]any)
	found := false
	for _, item := range items {
		if m, ok := item.(map[string]any); ok && m["name"] == "test-ping" {
			found = true
		}
	}
	if !found {
		t.Error("test-ping skill not found in list")
	}

	// Verify on disk
	skillFile := filepath.Join(home, ".claude", "skills", "test-ping.md")
	if _, err := os.Stat(skillFile); os.IsNotExist(err) {
		t.Errorf("skill file not found on disk: %s", skillFile)
	}

	// Delete
	code, _ = request(t, ts, "DELETE", "/api/v1/agents/claude/skills/test-ping?scope=global", "")
	if code != 200 && code != 204 {
		t.Fatalf("DELETE skill: expected 200/204, got %d", code)
	}

	if _, err := os.Stat(skillFile); !os.IsNotExist(err) {
		t.Errorf("skill file still exists after delete")
	}
}

// TestAgentConfigSubAgentsCRUD verifies sub-agent create/list/delete.
func TestAgentConfigSubAgentsCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	os.MkdirAll(filepath.Join(home, ".claude", "agents"), 0755)

	ts, cleanup := testServer(t)
	defer cleanup()

	agentContent := "---\nname: reviewer\ndescription: Code review agent\nmodel: sonnet\n---\nYou review code for quality."

	// Create
	code, _ := request(t, ts, "POST", "/api/v1/agents/claude/subagents?scope=global",
		fmt.Sprintf(`{"name":"reviewer","content":%q}`, agentContent))
	if code != 200 && code != 201 {
		t.Fatalf("POST subagent: expected 200/201, got %d", code)
	}

	// List
	code, resp := request(t, ts, "GET", "/api/v1/agents/claude/subagents?scope=global", "")
	if code != 200 {
		t.Fatalf("GET subagents: expected 200, got %d", code)
	}
	items := resp["items"].([]any)
	if len(items) != 1 {
		t.Errorf("expected 1 subagent, got %d", len(items))
	}

	// Verify on disk (directory + AGENT.md)
	agentFile := filepath.Join(home, ".claude", "agents", "reviewer", "AGENT.md")
	if _, err := os.Stat(agentFile); os.IsNotExist(err) {
		t.Errorf("AGENT.md not found on disk: %s", agentFile)
	}

	// Delete
	code, _ = request(t, ts, "DELETE", "/api/v1/agents/claude/subagents/reviewer?scope=global", "")
	if code != 200 && code != 204 {
		t.Fatalf("DELETE subagent: expected 200/204, got %d", code)
	}

	agentDir := filepath.Join(home, ".claude", "agents", "reviewer")
	if _, err := os.Stat(agentDir); !os.IsNotExist(err) {
		t.Errorf("agent directory still exists after delete")
	}
}

// TestAgentConfigMCPPluginDetection verifies plugin-based MCPs from settings.json are included.
func TestAgentConfigMCPPluginDetection(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	// Set up settings.json with enabledPlugins
	settingsDir := filepath.Join(home, ".claude")
	os.MkdirAll(settingsDir, 0755)
	settings := map[string]any{
		"enabledPlugins": map[string]any{
			"gmail@claude-ai":                             true,
			"superpowers@claude-plugins-official":         true,
			"chrome-devtools-mcp@claude-plugins-official": false,
		},
	}
	data, _ := json.MarshalIndent(settings, "", "  ")
	os.WriteFile(filepath.Join(settingsDir, "settings.json"), data, 0644)

	// Set up .claude.json with one configured MCP
	claudeJSON := map[string]any{
		"mcpServers": map[string]any{
			"gmail": map[string]any{
				"command": "npx -y @claude-ai/mcp-server-gmail@latest",
				"type":    "stdio",
			},
		},
	}
	cdata, _ := json.MarshalIndent(claudeJSON, "", "  ")
	os.WriteFile(filepath.Join(home, ".claude.json"), cdata, 0644)

	ts, cleanup := testServer(t)
	defer cleanup()

	code, servers := requestArray(t, ts, "GET", "/api/v1/agents/claude/mcp", "")
	if code != 200 {
		t.Fatalf("GET MCP: expected 200, got %d", code)
	}

	// Should have 3 servers: gmail (from .claude.json) + superpowers + chrome-devtools-mcp (from plugins)
	if len(servers) < 3 {
		t.Errorf("expected at least 3 MCP servers, got %d: %v", len(servers), servers)
	}

	// Verify gmail is enabled (from .claude.json + enabledPlugins)
	foundGmail := false
	foundSuperpowers := false
	foundDevtools := false
	for _, s := range servers {
		name, _ := s["name"].(string)
		enabled, _ := s["enabled"].(bool)
		switch name {
		case "gmail":
			foundGmail = true
			if !enabled {
				t.Error("gmail should be enabled")
			}
		case "superpowers":
			foundSuperpowers = true
			if !enabled {
				t.Error("superpowers should be enabled")
			}
		case "chrome-devtools-mcp":
			foundDevtools = true
			if enabled {
				t.Error("chrome-devtools-mcp should be disabled")
			}
		}
	}
	if !foundGmail {
		t.Error("gmail not found in MCP list")
	}
	if !foundSuperpowers {
		t.Error("superpowers not found in MCP list (plugin-based, not in .claude.json)")
	}
	if !foundDevtools {
		t.Error("chrome-devtools-mcp not found in MCP list (plugin-based, not in .claude.json)")
	}
}

// TestAgentConfigMCPTogglePersistence verifies toggling MCP servers persists to settings.json.
func TestAgentConfigMCPTogglePersistence(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	settingsDir := filepath.Join(home, ".claude")
	os.MkdirAll(settingsDir, 0755)
	settings := map[string]any{
		"model": "claude-opus-4-6",
		"enabledPlugins": map[string]any{
			"superpowers@claude-plugins-official": true,
		},
	}
	data, _ := json.MarshalIndent(settings, "", "  ")
	settingsPath := filepath.Join(settingsDir, "settings.json")
	os.WriteFile(settingsPath, data, 0644)

	// Need .claude.json for the MCP endpoint to work
	os.WriteFile(filepath.Join(home, ".claude.json"), []byte(`{"mcpServers":{}}`), 0644)

	ts, cleanup := testServer(t)
	defer cleanup()

	// Toggle superpowers off
	code, resp := request(t, ts, "PATCH", "/api/v1/agents/claude/mcp/superpowers",
		`{"enabled":false}`)
	if code != 200 {
		t.Fatalf("PATCH MCP toggle off: expected 200, got %d: %v", code, resp)
	}

	// Verify on disk
	raw, _ := os.ReadFile(settingsPath)
	var disk map[string]any
	json.Unmarshal(raw, &disk)
	plugins := disk["enabledPlugins"].(map[string]any)
	if plugins["superpowers@claude-plugins-official"] != false {
		t.Errorf("disk: superpowers should be false, got %v", plugins["superpowers@claude-plugins-official"])
	}
	// Model should still be there (merge, not replace)
	if disk["model"] != "claude-opus-4-6" {
		t.Errorf("disk: model was wiped, got %v", disk["model"])
	}

	// Toggle back on
	code, _ = request(t, ts, "PATCH", "/api/v1/agents/claude/mcp/superpowers",
		`{"enabled":true}`)
	if code != 200 {
		t.Fatalf("PATCH MCP toggle on: expected 200, got %d", code)
	}

	raw, _ = os.ReadFile(settingsPath)
	json.Unmarshal(raw, &disk)
	plugins = disk["enabledPlugins"].(map[string]any)
	if plugins["superpowers@claude-plugins-official"] != true {
		t.Errorf("disk: superpowers should be true after re-enable, got %v", plugins["superpowers@claude-plugins-official"])
	}
}

// TestAgentConfigHooksCRUD verifies hooks read/write.
func TestAgentConfigHooksCRUD(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	settingsDir := filepath.Join(home, ".claude")
	os.MkdirAll(settingsDir, 0755)
	settings := map[string]any{
		"model": "claude-opus-4-6",
		"hooks": map[string]any{},
	}
	data, _ := json.MarshalIndent(settings, "", "  ")
	os.WriteFile(filepath.Join(settingsDir, "settings.json"), data, 0644)

	ts, cleanup := testServer(t)
	defer cleanup()

	// Read empty hooks
	code, _ := requestArray(t, ts, "GET", "/api/v1/agents/claude/hooks", "")
	if code != 200 {
		t.Fatalf("GET hooks: expected 200, got %d", code)
	}

	// Write a hook
	code, resp := request(t, ts, "POST", "/api/v1/agents/claude/hooks",
		`[{"event":"notification","type":"command","command":"echo hello"}]`)
	if code != 200 {
		t.Fatalf("POST hooks: expected 200, got %d: %v", code, resp)
	}

	// Read back
	code, hooks := requestArray(t, ts, "GET", "/api/v1/agents/claude/hooks", "")
	if code != 200 {
		t.Fatalf("GET hooks after write: expected 200, got %d", code)
	}
	if len(hooks) == 0 {
		t.Error("expected at least 1 hook after write")
	}

	// Verify on disk
	raw, _ := os.ReadFile(filepath.Join(settingsDir, "settings.json"))
	var disk map[string]any
	json.Unmarshal(raw, &disk)
	hooksMap, ok := disk["hooks"].(map[string]any)
	if !ok || len(hooksMap) == 0 {
		t.Errorf("hooks not persisted to disk: %v", disk["hooks"])
	}

	// Model should still be there
	if disk["model"] != "claude-opus-4-6" {
		t.Errorf("model was wiped by hooks write: %v", disk["model"])
	}

	// Clear hooks
	code, _ = request(t, ts, "POST", "/api/v1/agents/claude/hooks", `[]`)
	if code != 200 {
		t.Fatalf("POST empty hooks: expected 200, got %d", code)
	}
}
