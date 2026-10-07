package agents

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// argsCommand prints every argument it receives on its own line, so tests
// observe the exact argv a harness would get.
const argsCommand = `f() { for a in "$@"; do printf '%s\n' "$a"; done; }; f`

func testAgent() *ResolvedAgent {
	return &ResolvedAgent{ID: "orchestra:global:orchestra:rev", Name: "rev", Description: "Reviews code", Source: AgentSourceOrchestra, Scope: "global", Prompt: "You are rev. Review carefully.", Model: "sonnet", Effort: "high"}
}

func testSkill(t *testing.T, name string) ResolvedSkill {
	t.Helper()
	dir := filepath.Join(t.TempDir(), name)
	if err := os.MkdirAll(filepath.Join(dir, "refs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: "+name+"\ndescription: d\n---\nbody\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "refs", "x.txt"), []byte("ref"), 0o644); err != nil {
		t.Fatal(err)
	}
	return ResolvedSkill{Name: name, Path: dir}
}

var testMCP = []MCPServerSpec{
	{Name: "fs", Type: "local", Command: "npx", Args: []string{"-y", "server-fs", "/work dir"}, Env: map[string]string{"TOKEN": "t"}},
	{Name: "remote", Type: "remote", URL: "https://mcp.example/mcp", Headers: map[string]string{"Authorization": "Bearer x"}},
}

func argList(output string) []string {
	return strings.Split(strings.ReplaceAll(strings.TrimRight(output, "\n"), "\r", ""), "\n")
}

func argAfter(t *testing.T, args []string, flag string) string {
	t.Helper()
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1]
		}
	}
	t.Fatalf("flag %s missing from argv %q", flag, args)
	return ""
}

func assertGone(t *testing.T, paths ...string) {
	t.Helper()
	for _, p := range paths {
		if _, err := os.Stat(p); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("per-run temp path %s was not removed: %v", p, err)
		}
	}
}

func TestClaudeAdapterArgvAndTempFiles(t *testing.T) {
	agent := testAgent()
	agent.Skills = []ResolvedSkill{testSkill(t, "lint"), {Name: "native", Path: "/x", Native: true}}
	agent.Permissions = AgentPermissions{Bash: "deny"}
	req := TurnRequest{Agent: agent, MCPServers: testMCP}
	plan, err := planCommandAgent(ProviderClaude, "claude -p x", req)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"--agents", "--agent 'rev'", "--model 'sonnet'", "--effort 'high'", "--mcp-config", "--plugin-dir", "--disallowedTools 'Bash'"}
	for _, w := range want {
		if !strings.Contains(plan.commandLine, w) {
			t.Fatalf("missing %q in %s", w, plan.commandLine)
		}
	}
	if len(plan.tempPaths) != 3 {
		t.Fatalf("expected agents, mcp and plugin temp paths, got %v", plan.tempPaths)
	}
	var defs map[string]map[string]string
	raw, _ := os.ReadFile(plan.tempPaths[0])
	if json.Unmarshal(raw, &defs) != nil || defs["rev"]["prompt"] != agent.Prompt || defs["rev"]["description"] != "Reviews code" {
		t.Fatalf("agents file: %s", raw)
	}
	var mcpDoc struct {
		MCPServers map[string]map[string]any `json:"mcpServers"`
	}
	raw, _ = os.ReadFile(plan.tempPaths[1])
	if json.Unmarshal(raw, &mcpDoc) != nil || mcpDoc.MCPServers["fs"]["command"] != "npx" || mcpDoc.MCPServers["remote"]["type"] != "http" || mcpDoc.MCPServers["remote"]["url"] != "https://mcp.example/mcp" {
		t.Fatalf("mcp config: %s", raw)
	}
	pluginDir := plan.tempPaths[2]
	for _, p := range []string{".claude-plugin/plugin.json", "skills/lint/SKILL.md", "skills/lint/refs/x.txt"} {
		if _, err := os.Stat(filepath.Join(pluginDir, p)); err != nil {
			t.Fatalf("plugin file %s: %v", p, err)
		}
	}
	if _, err := os.Stat(filepath.Join(pluginDir, "skills", "native")); err == nil {
		t.Fatal("native skills must not be wrapped")
	}
	plan.cleanup()
	assertGone(t, plan.tempPaths...)
	if plan.receipt.observation() != AgentApplied {
		t.Fatalf("receipt %q", plan.receipt.observation())
	}
}

func TestClaudeHarnessAgentUsesAgentFlagOnly(t *testing.T) {
	agent := &ResolvedAgent{ID: "harness:project:claude:planner", Name: "planner", Source: AgentSourceHarness, Harness: "CLAUDE"}
	plan, err := planCommandAgent(ProviderClaude, "claude -p x", TurnRequest{Agent: agent, RequestedModel: "opus"})
	if err != nil {
		t.Fatal(err)
	}
	defer plan.cleanup()
	if plan.commandLine != "claude -p x --agent 'planner' --model 'opus'" || len(plan.tempPaths) != 0 {
		t.Fatalf("unexpected: %s %v", plan.commandLine, plan.tempPaths)
	}
}

func TestClaudeRunTurnDeliversFilesAndRemovesThem(t *testing.T) {
	root := t.TempDir()
	// Prints the agents file and its path, so the test can check removal.
	r := NewCommandRunner(ProviderClaude, `f() { while [ $# -gt 0 ]; do if [ "$1" = --agents ]; then echo "PATH=$2"; cat "$2"; fi; shift; done; }; f`)
	result, err := r.RunTurn(context.Background(), TurnRequest{Workspace: root, WorkspaceRoot: root, Prompt: "hi", Agent: testAgent()}, nil)
	if err != nil {
		t.Fatal(err, result.Output)
	}
	if !strings.Contains(result.Output, "You are rev. Review carefully.") {
		t.Fatalf("agent prompt not delivered: %s", result.Output)
	}
	path := strings.TrimPrefix(strings.SplitN(result.Output, "\n", 2)[0], "PATH=")
	assertGone(t, filepath.FromSlash(path))
	if result.EffectiveAgentID != "orchestra:global:orchestra:rev" || result.AgentObservation != AgentApplied {
		t.Fatalf("receipt: %q %q", result.EffectiveAgentID, result.AgentObservation)
	}
}

func TestCodexExecAdapterArgvThroughShell(t *testing.T) {
	root := t.TempDir()
	agent := testAgent()
	agent.Model, agent.Effort = "gpt-6", "high"
	agent.Skills = []ResolvedSkill{testSkill(t, "lint")}
	r := NewCommandRunner(ProviderCodex, argsCommand)
	result, err := r.RunTurn(context.Background(), TurnRequest{Workspace: root, WorkspaceRoot: root, Prompt: "hi", Agent: agent, DeveloperInstructions: "Base \"rules\"\nline2", MCPServers: testMCP}, nil)
	if err != nil {
		t.Fatal(err, result.Output)
	}
	args := argList(result.Output)
	wantInstructions := "developer_instructions=" + tomlString("Base \"rules\"\nline2\n\n# Agent: rev\n\nYou are rev. Review carefully.")
	got := map[string]bool{}
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "-c" {
			got[args[i+1]] = true
		}
	}
	for _, want := range []string{
		wantInstructions,
		`model="gpt-6"`,
		`model_reasoning_effort="high"`,
		`mcp_servers.fs.command="npx"`,
		`mcp_servers.fs.args=["-y","server-fs","/work dir"]`,
		`mcp_servers.fs.env={"TOKEN"="t"}`,
		`mcp_servers.remote.url="https://mcp.example/mcp"`,
		`mcp_servers.remote.http_headers={"Authorization"="Bearer x"}`,
	} {
		if !got[want] {
			t.Fatalf("missing -c %s in %q", want, args)
		}
	}
	if result.AgentObservation != "applied_partial:skills" {
		t.Fatalf("codex exec cannot add skills; receipt %q", result.AgentObservation)
	}
	matches, _ := filepath.Glob(filepath.Join(os.TempDir(), "orchestra-codex-instructions-*"))
	for _, m := range matches {
		if data, _ := os.ReadFile(m); strings.Contains(string(data), "You are rev. Review carefully.") {
			t.Fatalf("instructions temp file left behind: %s", m)
		}
	}
}

func TestOpenCodeAdapterConfigFile(t *testing.T) {
	root := t.TempDir()
	agent := testAgent()
	agent.Model = "opencode/ling-3.1-flash-free"
	agent.Permissions = AgentPermissions{Edit: "deny"}
	agent.Skills = []ResolvedSkill{testSkill(t, "lint")}
	r := NewOpenCodeRunner(`f() { echo "CFG=$OPENCODE_CONFIG"; cat "$OPENCODE_CONFIG"; echo; for a in "$@"; do printf 'ARG:%s\n' "$a"; done; }; f`)
	result, err := r.RunTurn(context.Background(), TurnRequest{Workspace: root, WorkspaceRoot: root, Prompt: "hi", Agent: agent, DeveloperInstructions: "Use fences.", MCPServers: testMCP}, nil)
	if err != nil {
		t.Fatal(err, result.Output)
	}
	lines := argList(result.Output)
	cfgPath := strings.TrimPrefix(lines[0], "CFG=")
	jsonText := strings.Join(lines[1:], "\n")
	jsonText = jsonText[:strings.LastIndex(jsonText, "}")+1]
	var cfg struct {
		Agent        map[string]map[string]any `json:"agent"`
		MCP          map[string]map[string]any `json:"mcp"`
		Skills       struct{ Paths []string }  `json:"skills"`
		Instructions []string                  `json:"instructions"`
	}
	if err := json.Unmarshal([]byte(jsonText), &cfg); err != nil {
		t.Fatalf("config: %v %s", err, jsonText)
	}
	rev := cfg.Agent["rev"]
	if rev["prompt"] != agent.Prompt || rev["mode"] != "primary" || rev["permission"].(map[string]any)["edit"] != "deny" {
		t.Fatalf("agent entry: %#v", rev)
	}
	if cfg.MCP["fs"]["type"] != "local" || cfg.MCP["fs"]["command"].([]any)[3] != "/work dir" || cfg.MCP["remote"]["type"] != "remote" {
		t.Fatalf("mcp: %#v", cfg.MCP)
	}
	if len(cfg.Skills.Paths) != 1 || len(cfg.Instructions) != 1 {
		t.Fatalf("skills/instructions: %#v %#v", cfg.Skills, cfg.Instructions)
	}
	for _, want := range []string{"ARG:--agent", "ARG:rev", "ARG:-m", "ARG:opencode/ling-3.1-flash-free", "ARG:--variant", "ARG:high"} {
		if !strings.Contains(strings.ReplaceAll(result.Output, "\r", "")+"\n", want+"\n") {
			t.Fatalf("missing %s in %s", want, result.Output)
		}
	}
	assertGone(t, cfgPath, filepath.FromSlash(cfg.Skills.Paths[0]), filepath.FromSlash(cfg.Instructions[0]))
	if result.AgentObservation != AgentApplied {
		t.Fatalf("receipt %q", result.AgentObservation)
	}
}

func TestOpenCodeBareModelIsPartial(t *testing.T) {
	agent := testAgent()
	plan, err := planCommandAgent(ProviderOpenCode, "opencode run", TurnRequest{Agent: agent})
	if err != nil {
		t.Fatal(err)
	}
	defer plan.cleanup()
	if strings.Contains(plan.commandLine, "-m ") || plan.receipt.observation() != "applied_partial:model" {
		t.Fatalf("%s %q", plan.commandLine, plan.receipt.observation())
	}
}

func TestEightgentPromptPrefix(t *testing.T) {
	root := t.TempDir()
	r := NewEightgentRunner(`printf '%s|' {{prompt}}`)
	result, err := r.RunTurn(context.Background(), TurnRequest{Workspace: root, WorkspaceRoot: root, Prompt: "do it", Agent: testAgent(), MCPServers: testMCP}, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := "<agent_instructions name=\"rev\">\nYou are rev. Review carefully.\n</agent_instructions>\n\ndo it|--model|sonnet|"
	if strings.ReplaceAll(result.Output, "\r", "") != want {
		t.Fatalf("prompt %q", result.Output)
	}
	if result.AgentObservation != "applied_partial:effort,mcp" {
		t.Fatalf("receipt %q", result.AgentObservation)
	}
}

func useTempOverlayManifests(t *testing.T) {
	t.Helper()
	old := overlayManifestDir
	overlayManifestDir = t.TempDir()
	t.Cleanup(func() { overlayManifestDir = old })
}

func TestAntigravityBatchMergesAndRestoresWorkspaceFiles(t *testing.T) {
	useTempOverlayManifests(t)
	root := t.TempDir()
	userMCP := []byte("{\n  \"mcpServers\": {\"fs\": {\"command\": \"mine\"}}\n}\n")
	if err := os.MkdirAll(filepath.Join(root, ".agents", "agents", "rev"), 0o755); err != nil {
		t.Fatal(err)
	}
	userAgent := []byte("---\nname: rev\ndescription: the user's own\n---\nmine\n")
	_ = os.WriteFile(filepath.Join(root, ".agents", "agents", "rev", "agent.md"), userAgent, 0o644)
	_ = os.WriteFile(filepath.Join(root, ".agents", "mcp_config.json"), userMCP, 0o644)
	agent := testAgent()
	agent.Skills = []ResolvedSkill{testSkill(t, "lint")}
	r := NewCommandRunner(ProviderAntigravity, `f() { cat .agents/mcp_config.json; cat .agents/agents/orchestra-rev/agent.md; cat .agents/rules/orchestra.md; cat .agents/skills/lint/SKILL.md; for a in "$@"; do printf 'ARG:%s\n' "$a"; done; }; f`)
	result, err := r.RunTurn(context.Background(), TurnRequest{Workspace: root, WorkspaceRoot: root, Prompt: "hi", Agent: agent, DeveloperInstructions: "Rules here", MCPServers: testMCP}, nil)
	if err != nil {
		t.Fatal(err, result.Output)
	}
	out := result.Output
	for _, want := range []string{`"command": "mine"`, `"serverUrl": "https://mcp.example/mcp"`, "You are rev. Review carefully.", "Rules here", "name: lint", "ARG:--agent\nARG:orchestra-rev", "ARG:--model\nARG:sonnet", "ARG:--effort\nARG:high"} {
		if !strings.Contains(strings.ReplaceAll(out, "\r", ""), want) {
			t.Fatalf("missing %q in run output:\n%s", want, out)
		}
	}
	if strings.Count(out, `"fs"`) != 1 {
		t.Fatalf("user's fs server must not be clobbered:\n%s", out)
	}
	if got, _ := os.ReadFile(filepath.Join(root, ".agents", "mcp_config.json")); string(got) != string(userMCP) {
		t.Fatalf("mcp_config.json not restored byte-for-byte: %s", got)
	}
	if got, _ := os.ReadFile(filepath.Join(root, ".agents", "agents", "rev", "agent.md")); string(got) != string(userAgent) {
		t.Fatal("user agent file changed")
	}
	assertGone(t, filepath.Join(root, ".agents", "agents", "orchestra-rev"), filepath.Join(root, ".agents", "rules"), filepath.Join(root, ".agents", "skills"))
	if result.AgentObservation != "applied_partial:mcp" {
		// fs was already defined by the user, so Orchestra's fs is not applied.
		t.Fatalf("receipt %q", result.AgentObservation)
	}
}

func TestAntigravityOverlayRemovesCreatedDirsAndRecoversAfterCrash(t *testing.T) {
	useTempOverlayManifests(t)
	root := t.TempDir()
	overlay, err := newWorkspaceOverlay(root)
	if err != nil {
		t.Fatal(err)
	}
	if err = overlay.create(".agents/agents/x/agent.md", []byte("a")); err != nil {
		t.Fatal(err)
	}
	if _, err = overlay.mergeJSONObject(".agents/mcp_config.json", "mcpServers", map[string]any{"s": map[string]any{"command": "c"}}); err != nil {
		t.Fatal(err)
	}
	// A second holder shares identical content; release by one keeps files.
	second, _ := newWorkspaceOverlay(root)
	if err = second.create(".agents/agents/x/agent.md", []byte("a")); err != nil {
		t.Fatal(err)
	}
	if err = second.create(".agents/agents/x/agent.md", []byte("different")); !errors.Is(err, errOverlayConflict) {
		t.Fatalf("different content must conflict: %v", err)
	}
	overlay.release()
	if _, err = os.Stat(filepath.Join(root, ".agents", "agents", "x", "agent.md")); err != nil {
		t.Fatal("file removed while still held")
	}
	// Simulate a crash: forget in-memory state, recover from the manifest.
	overlayMu.Lock()
	delete(overlayRoots, overlay.root)
	overlayMu.Unlock()
	if _, err = newWorkspaceOverlay(root); err != nil {
		t.Fatal(err)
	}
	assertGone(t, filepath.Join(root, ".agents"))
}

func TestCodexNativeAppliesAgentConfigSkillsAndInstructions(t *testing.T) {
	root := t.TempDir()
	agent := testAgent()
	agent.Model, agent.Effort = "gpt-6", "high"
	agent.Skills = []ResolvedSkill{testSkill(t, "lint")}
	req := TurnRequest{Workspace: root, WorkspaceRoot: root, ProjectRootWorkspace: true, Agent: agent, DeveloperInstructions: "Base", MCPServers: testMCP}
	session, err := NewCodexNativeSession(context.Background(), nativeFixtureCommand(t, "record"), req, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	info := session.ModelInfo()
	if info.AgentID != agent.ID || info.AgentObservation != AgentApplied {
		t.Fatalf("receipt %#v", info)
	}
	raw, err := os.ReadFile(filepath.Join(root, "rpc-log.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var skillRoot string
	var start map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		var rec struct {
			Method string
			Params map[string]any
		}
		_ = json.Unmarshal([]byte(line), &rec)
		switch rec.Method {
		case "skills/extraRoots/set":
			skillRoot = rec.Params["extraRoots"].([]any)[0].(string)
		case "thread/start":
			start = rec.Params
		}
	}
	if skillRoot == "" {
		t.Fatal("skills/extraRoots/set was not sent")
	}
	if _, err := os.Stat(filepath.Join(skillRoot, "lint", "SKILL.md")); err != nil {
		t.Fatalf("staged skill missing: %v", err)
	}
	if start["developerInstructions"] != "Base\n\n# Agent: rev\n\nYou are rev. Review carefully." || start["model"] != "gpt-6" {
		t.Fatalf("thread/start: %#v", start)
	}
	config := start["config"].(map[string]any)
	servers := config["mcp_servers"].(map[string]any)
	if config["model_reasoning_effort"] != "high" || servers["fs"].(map[string]any)["command"] != "npx" || servers["remote"].(map[string]any)["url"] != "https://mcp.example/mcp" {
		t.Fatalf("config: %#v", config)
	}
	_ = session.Close()
	assertGone(t, skillRoot)
}
