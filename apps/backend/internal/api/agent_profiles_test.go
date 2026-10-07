package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

// TestFakeMCPServerProcess is a stdio MCP server used by the status probe test.
func TestFakeMCPServerProcess(t *testing.T) {
	if os.Getenv("ORCHESTRA_FAKE_MCP") != "1" {
		return
	}
	scan := bufio.NewScanner(os.Stdin)
	for scan.Scan() {
		var msg struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		_ = json.Unmarshal(scan.Bytes(), &msg)
		if msg.Method == "initialize" {
			fmt.Printf(`{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"fake","version":"1"}}}`+"\n", msg.ID)
		}
	}
	os.Exit(0)
}

func profileTestServer(t *testing.T) (func(method, route string, body any) (int, []byte), string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	workspaceRoot := filepath.Join(home, "workspace")
	_ = os.MkdirAll(workspaceRoot, 0o755)
	cfg := &config.Config{WorkspaceRoot: workspaceRoot, APIToken: "tok", ProjectRoots: []string{home}, AgentCommands: map[string]string{"CLAUDE": "claude -p {{prompt}}", "OPENCODE": "opencode run {{prompt}}"}}
	service := orchestrator.NewService()
	service.SetDB(database)
	server := httptest.NewServer(NewRouterWithPubSub(zerolog.Nop(), service, cfg, nil, database, nil, nil, nil, nil, nil))
	t.Cleanup(server.Close)
	return func(method, route string, body any) (int, []byte) {
		t.Helper()
		var raw []byte
		if body != nil {
			raw, _ = json.Marshal(body)
		}
		req, _ := http.NewRequest(method, server.URL+route, bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer tok")
		req.Header.Set("Content-Type", "application/json")
		resp, e := server.Client().Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer resp.Body.Close()
		var out bytes.Buffer
		_, _ = out.ReadFrom(resp.Body)
		return resp.StatusCode, out.Bytes()
	}, home
}

func TestHarnessCapabilitiesRetireGemini(t *testing.T) {
	call, _ := profileTestServer(t)
	status, body := call("GET", "/api/v1/harnesses/capabilities", nil)
	var out struct {
		Harnesses []struct {
			Harness     string
			AgentInline struct {
				Supported bool
				Note      string
			} `json:"agent_inline"`
		}
	}
	if status != 200 || json.Unmarshal(body, &out) != nil || len(out.Harnesses) != 5 {
		t.Fatalf("%d %s", status, body)
	}
	for _, h := range out.Harnesses {
		if h.Harness == "GEMINI" {
			t.Fatal("Gemini is retired")
		}
		if h.Harness == "8GENT" && (h.AgentInline.Supported || h.AgentInline.Note != "deferred: see follow-up issue") {
			t.Fatalf("8gent must be deferred: %+v", h)
		}
	}
}

func TestOrchestraAgentCRUDIsImmediatelyListed(t *testing.T) {
	call, home := profileTestServer(t)
	status, _ := call("GET", "/api/v1/agents", nil)
	if status != 200 {
		t.Fatal("legacy provider list broke")
	}
	status, body := call("POST", "/api/v1/agents", map[string]any{"scope": "global", "name": "rev", "description": "Reviewer", "prompt": "Review.", "model": "sonnet", "color": "#123456", "skills": []string{"lint"}, "mcp_servers": []string{"fs"}, "permissions": map[string]string{"bash": "deny"}})
	if status != http.StatusCreated {
		t.Fatalf("create: %d %s", status, body)
	}
	var created struct {
		ID          string `json:"id"`
		ContentHash string `json:"content_hash"`
	}
	_ = json.Unmarshal(body, &created)
	if created.ID != "orchestra:global:orchestra:rev" {
		t.Fatalf("id %s", body)
	}
	raw, err := os.ReadFile(filepath.Join(home, ".orchestra", "agents", "rev.md"))
	if err != nil || !strings.Contains(string(raw), "model: sonnet") || !strings.HasSuffix(string(raw), "Review.\n") {
		t.Fatalf("file: %s %v", raw, err)
	}
	list := func(query string) []map[string]any {
		status, body := call("GET", "/api/v1/agents?"+query, nil)
		var out struct{ Agents []map[string]any }
		if status != 200 || json.Unmarshal(body, &out) != nil {
			t.Fatalf("list %d %s", status, body)
		}
		return out.Agents
	}
	agentsFor := list("harness=claude")
	if len(agentsFor) != 1 || agentsFor[0]["selectable"] != true || agentsFor[0]["prompt"] != "Review." {
		t.Fatalf("claude list: %v", agentsFor)
	}
	if a := list("harness=codex"); len(a) != 1 || a[0]["selectable"] != false || !strings.Contains(a[0]["unavailable_reason"].(string), "No CODEX command") {
		t.Fatalf("codex list: %v", a)
	}
	escaped := url.PathEscape(created.ID)
	status, body = call("PATCH", "/api/v1/agents/"+escaped, map[string]any{"prompt": "Review harder.", "content_hash": created.ContentHash})
	if status != 200 || !strings.Contains(string(body), "Review harder.") {
		t.Fatalf("patch: %d %s", status, body)
	}
	if status, _ = call("PATCH", "/api/v1/agents/"+escaped, map[string]any{"prompt": "x", "content_hash": created.ContentHash}); status != http.StatusConflict {
		t.Fatalf("stale hash must conflict: %d", status)
	}
	if a := list("view=profiles"); a[0]["prompt"] != "Review harder." {
		t.Fatalf("edit not reflected: %v", a)
	}
	if status, _ = call("DELETE", "/api/v1/agents/"+escaped, nil); status != http.StatusNoContent {
		t.Fatalf("delete %d", status)
	}
	if a := list("harness=claude"); len(a) != 0 {
		t.Fatalf("delete not reflected: %v", a)
	}
	if status, _ = call("PATCH", "/api/v1/agents/"+url.PathEscape("harness:global:claude:x"), map[string]any{"prompt": "x"}); status != http.StatusUnprocessableEntity {
		t.Fatalf("harness agents are not managed here: %d", status)
	}
	if status, _ = call("POST", "/api/v1/agent-profiles", map[string]any{"scope": "global", "name": "../x"}); status != http.StatusBadRequest {
		t.Fatalf("bad name: %d", status)
	}
}

func TestSkillsListPerHarnessAndShared(t *testing.T) {
	call, home := profileTestServer(t)
	for _, dir := range []string{filepath.Join(home, ".claude", "skills", "lint"), filepath.Join(home, ".orchestra", "skills", "shared-one"), filepath.Join(home, ".config", "opencode", "skills", "oc")} {
		_ = os.MkdirAll(dir, 0o755)
		_ = os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: x\ndescription: d\n---\nbody\n"), 0o644)
	}
	status, body := call("GET", "/api/v1/skills?harness=claude", nil)
	var out struct {
		Skills []struct{ Name, Harness string }
	}
	if status != 200 || json.Unmarshal(body, &out) != nil {
		t.Fatalf("%d %s", status, body)
	}
	got := []string{}
	for _, s := range out.Skills {
		got = append(got, s.Harness+":"+s.Name)
	}
	if strings.Join(got, ",") != "CLAUDE:lint,shared:shared-one" {
		t.Fatalf("per-harness discovery must not mix harnesses: %v", got)
	}
}

func TestMCPServerStatusAndProbe(t *testing.T) {
	call, _ := profileTestServer(t)
	exe, _ := os.Executable()
	status, body := call("POST", "/api/v1/mcp/servers", map[string]any{"name": "fake", "command": exe, "args": []string{"-test.run=^TestFakeMCPServerProcess$"}, "env": map[string]string{"ORCHESTRA_FAKE_MCP": "1"}})
	if status != http.StatusCreated {
		t.Fatalf("%d %s", status, body)
	}
	status, body = call("POST", "/api/v1/mcp/servers", map[string]any{"name": "off", "command": "nope", "enabled": false})
	if status != http.StatusCreated {
		t.Fatalf("%d %s", status, body)
	}
	status, body = call("POST", "/api/v1/mcp/servers", map[string]any{"name": "broken", "command": filepath.Join(t.TempDir(), "missing-binary")})
	if status != http.StatusCreated {
		t.Fatalf("%d %s", status, body)
	}
	status, body = call("GET", "/api/v1/mcp/servers/status", nil)
	var out struct {
		Servers []struct {
			Name, Status, Source string
			Env                  map[string]string
		}
	}
	if status != 200 || json.Unmarshal(body, &out) != nil {
		t.Fatalf("%d %s", status, body)
	}
	got := map[string]string{}
	for _, s := range out.Servers {
		if s.Source == "orchestra" {
			got[s.Name] = s.Status
			if s.Name == "fake" && s.Env["ORCHESTRA_FAKE_MCP"] != "***" {
				t.Fatalf("env values must be redacted: %v", s.Env)
			}
		}
	}
	if got["fake"] != "connected" || got["off"] != "disabled" || got["broken"] != "failed" {
		t.Fatalf("statuses: %v (%s)", got, body)
	}
	status, body = call("POST", "/api/v1/mcp/servers/fake/probe", nil)
	if status != 200 || !strings.Contains(string(body), `"status":"connected"`) {
		t.Fatalf("probe: %d %s", status, body)
	}
	if status, _ = call("POST", "/api/v1/mcp/servers/absent/probe", nil); status != http.StatusNotFound {
		t.Fatalf("absent probe %d", status)
	}
}
