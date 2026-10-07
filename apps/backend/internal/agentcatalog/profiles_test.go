package agentcatalog

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func profileService(t *testing.T) (*Service, string) {
	t.Helper()
	service, _, home := testService(t)
	service.commands = map[string]string{"CLAUDE": "claude", "CODEX": "codex", "OPENCODE": "opencode", "ANTIGRAVITY": "agy"}
	service.SetHome(home)
	return service, home
}

func TestDiscoveryIsPerHarnessWithTomlAndClaudeSubagents(t *testing.T) {
	service, home := profileService(t)
	writeFile(t, filepath.Join(home, ".codex", "agents", "reviewer.toml"), "name = \"reviewer\"\ndescription = \"Codex reviewer\"\ndeveloper_instructions = \"Review diffs.\"\nmodel = \"gpt-6\"\nmodel_reasoning_effort = \"high\"\n")
	writeFile(t, filepath.Join(home, ".claude", "agents", "helper.md"), "---\nname: helper\ndescription: Claude helper\n---\nHelp.\n")
	writeFile(t, filepath.Join(home, ".claude", "agents", "lead.md"), "---\nname: lead-agent\ndescription: Lead\nmode: primary\n---\nLead.\n")
	writeFile(t, filepath.Join(home, ".claude", "agents", "worker.md"), "---\nname: worker\ndescription: Delegate only\nmode: subagent\n---\nWork.\n")
	ctx := context.Background()
	list, err := service.Agents(ctx, "", "", "codex")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != "harness:global:codex:reviewer" || list[0].Description != "Codex reviewer" || list[0].Prompt != "Review diffs." || list[0].Model != "gpt-6" || list[0].Effort != "high" || !list[0].Selectable {
		t.Fatalf("codex TOML agents: %+v", list)
	}
	claude, err := service.Agents(ctx, "", "", "claude")
	if err != nil {
		t.Fatal(err)
	}
	modes := map[string]string{}
	for _, a := range claude {
		modes[a.Name] = a.Mode
		if a.Harness != "CLAUDE" {
			t.Fatalf("another harness leaked into Claude: %+v", a)
		}
	}
	// No mode means both: claude --agent runs it as the main session too.
	if modes["helper"] != "all" || modes["lead-agent"] != "primary" || modes["worker"] != "subagent" || len(claude) != 3 {
		t.Fatalf("claude modes: %v", modes)
	}
	resolved, err := service.ResolveAgent(ctx, ResolveRequest{Harness: "CLAUDE", AgentID: "harness:global:claude:lead"})
	if err != nil || resolved.Name != "lead-agent" || resolved.Harness != "CLAUDE" {
		t.Fatalf("claude selects by frontmatter name: %+v %v", resolved, err)
	}
	if helper, err := service.ResolveAgent(ctx, ResolveRequest{Harness: "CLAUDE", AgentID: "harness:global:claude:helper"}); err != nil || helper.Name != "helper" {
		t.Fatalf("claude agent without a mode must be selectable: %+v %v", helper, err)
	}
	if _, err = service.ResolveAgent(ctx, ResolveRequest{Harness: "CLAUDE", AgentID: "harness:global:claude:worker"}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("explicit subagent must not be selectable: %v", err)
	}
	if _, err = service.ResolveAgent(ctx, ResolveRequest{Harness: "CLAUDE", AgentID: "harness:global:codex:reviewer"}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("codex agent on claude must be rejected: %v", err)
	}
	// Legacy bare id + scope + hash still resolves for the session harness.
	if _, err = service.ResolveAgent(ctx, ResolveRequest{Harness: "CODEX", AgentID: "reviewer", Scope: "global", Hash: list[0].ContentHash}); err != nil {
		t.Fatalf("legacy id: %v", err)
	}
	if _, err = service.ResolveAgent(ctx, ResolveRequest{Harness: "CODEX", AgentID: "reviewer", Scope: "global", Hash: "sha256:stale"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale hash: %v", err)
	}
}

func TestResolveOrchestraAgentSkillsAndCompatibility(t *testing.T) {
	service, home := profileService(t)
	writeFile(t, filepath.Join(home, ".claude", "skills", "lint", "SKILL.md"), "---\nname: lint\ndescription: Lint\n---\nx\n")
	writeFile(t, filepath.Join(home, ".orchestra", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Deploy\n---\nx\n")
	ctx := context.Background()
	name, prompt := "rev", "Review."
	skills := []string{"lint", "deploy"}
	created, err := service.CreateOrchestraAgent(ctx, AgentInput{Scope: ScopeGlobal, Name: &name, Prompt: &prompt, Skills: &skills})
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := service.ResolveAgent(ctx, ResolveRequest{Harness: "CLAUDE", AgentID: created.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(resolved.Skills) != 2 || !resolved.Skills[0].Native || resolved.Skills[1].Native || filepath.Base(resolved.Skills[1].Path) != "deploy" {
		t.Fatalf("skills: %+v", resolved.Skills)
	}
	codex, err := service.ResolveAgent(ctx, ResolveRequest{Harness: "CODEX", AgentID: created.ID})
	if err != nil || codex.Skills[0].Native {
		t.Fatalf("a claude skill is not native to codex: %+v %v", codex, err)
	}
	if _, err = service.ResolveAgent(ctx, ResolveRequest{Harness: "8GENT", AgentID: created.ID}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("8gent is deferred: %v", err)
	}
	missing := []string{"nope"}
	if _, err = service.UpdateOrchestraAgent(ctx, created.ID, AgentInput{Skills: &missing}); err != nil {
		t.Fatal(err)
	}
	if _, err = service.ResolveAgent(ctx, ResolveRequest{Harness: "CLAUDE", AgentID: created.ID}); !errors.Is(err, ErrConflict) {
		t.Fatalf("missing skill must fail resolution: %v", err)
	}
	bad := "Bad Mode"
	if _, err = service.UpdateOrchestraAgent(ctx, created.ID, AgentInput{Mode: &bad}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("mode validation: %v", err)
	}
}
