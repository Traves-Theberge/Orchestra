package agents

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Live checks against installed CLIs. They spend real (tiny) model turns and
// are skipped unless ORCHESTRA_LIVE_AGENTS names the harnesses to run, e.g.
// ORCHESTRA_LIVE_AGENTS=claude,opencode,codex,agy go test -run TestLive ./internal/agents/

func liveEnabled(t *testing.T, harness string) {
	t.Helper()
	if !strings.Contains(","+os.Getenv("ORCHESTRA_LIVE_AGENTS")+",", ","+harness+",") {
		t.Skip("set ORCHESTRA_LIVE_AGENTS to include " + harness)
	}
}

const liveProbePrompt = "You are the orch-probe agent. Whenever the user asks you to reply with exact text, reply with that text followed by a single space and the word PROBE7."

func liveAgent(model string) *ResolvedAgent {
	return &ResolvedAgent{ID: "orchestra:global:orchestra:orch-probe", Name: "orch-probe", Description: "Orchestra live probe", Source: AgentSourceOrchestra, Scope: "global", Prompt: liveProbePrompt, Model: model}
}

func liveSkill(t *testing.T) ResolvedSkill {
	dir := filepath.Join(t.TempDir(), "orch-probe-skill")
	_ = os.MkdirAll(dir, 0o755)
	_ = os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: orch-probe-skill\ndescription: Orchestra live probe skill\n---\nNothing to do.\n"), 0o644)
	return ResolvedSkill{Name: "orch-probe-skill", Path: dir}
}

var liveMCP = []MCPServerSpec{{Name: "orch_probe", Type: "local", Command: "node", Args: []string{"-e", "setTimeout(()=>{},50)"}}}

func TestLiveClaudeOrchestraAgent(t *testing.T) {
	liveEnabled(t, "claude")
	root := t.TempDir()
	agent := liveAgent("")
	agent.Skills = []ResolvedSkill{liveSkill(t)}
	r := NewClaudeRunner("claude -p {{prompt}} --output-format stream-json --verbose --dangerously-skip-permissions")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	result, err := r.RunTurn(ctx, TurnRequest{Workspace: root, WorkspaceRoot: root, ProjectRootWorkspace: true, Prompt: "Reply with exactly: agent ok", RequestedModel: "sonnet", Agent: agent, MCPServers: liveMCP}, nil)
	t.Logf("receipt=%s output tail=%s", result.AgentObservation, tail(result.Output, 1500))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Output, "agent ok PROBE7") {
		t.Fatal("orchestra agent prompt was not applied")
	}
	if !strings.Contains(result.Output, `"orch_probe"`) {
		t.Fatal("--mcp-config server not reported by the CLI")
	}
}

func TestLiveOpenCodeOrchestraAgent(t *testing.T) {
	liveEnabled(t, "opencode")
	root := t.TempDir()
	agent := liveAgent("opencode/ling-3.1-flash-free")
	agent.Skills = []ResolvedSkill{liveSkill(t)}
	r := NewOpenCodeRunner("opencode run {{prompt}}")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	result, err := r.RunTurn(ctx, TurnRequest{Workspace: root, WorkspaceRoot: root, ProjectRootWorkspace: true, Prompt: "Reply with exactly: opencode ok", Agent: agent, DeveloperInstructions: "Keep replies short.", MCPServers: liveMCP}, nil)
	t.Logf("receipt=%s output=%s", result.AgentObservation, tail(result.Output, 1500))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(result.Output, "opencode ok PROBE7") {
		t.Fatal("orchestra agent prompt was not applied")
	}
}

func TestLiveAntigravityFlagsParse(t *testing.T) {
	liveEnabled(t, "agy")
	root := t.TempDir()
	r := NewCommandRunner(ProviderAntigravity, "agy -p {{prompt}} --output-format stream-json")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	result, err := r.RunTurn(ctx, TurnRequest{Workspace: root, WorkspaceRoot: root, ProjectRootWorkspace: true, Prompt: "Reply with exactly: agy ok", Agent: liveAgent(""), MCPServers: liveMCP}, nil)
	t.Logf("err=%v receipt=%s output=%s", err, result.AgentObservation, tail(result.Output, 2000))
	if _, statErr := os.Stat(filepath.Join(root, ".agents")); statErr == nil {
		t.Fatal("workspace overlay was not cleaned up")
	}
}

func TestLiveCodexNativeAcceptsAgentConfig(t *testing.T) {
	liveEnabled(t, "codex")
	root := t.TempDir()
	agent := liveAgent("")
	agent.Effort = "low"
	agent.Skills = []ResolvedSkill{liveSkill(t)}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	session, err := NewCodexNativeSession(ctx, "codex app-server", TurnRequest{Workspace: root, WorkspaceRoot: root, ProjectRootWorkspace: true, Agent: agent, DeveloperInstructions: "Base.", MCPServers: liveMCP}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	info := session.ModelInfo()
	t.Logf("thread=%s model=%s effort=%s receipt=%s", session.ThreadID(), info.Model, info.ReasoningEffort, info.AgentObservation)
	if info.ReasoningEffort != "low" {
		t.Fatalf("agent effort not applied by app-server: %+v", info)
	}
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}
