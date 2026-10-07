package agents

import (
	"strings"
	"testing"
)

func orchestraAgent(name string) *ResolvedAgent {
	return &ResolvedAgent{ID: "orchestra:global:orchestra:" + name, Name: name, Source: AgentSourceOrchestra, Scope: "global", Prompt: "You review code."}
}

func TestAgentSelectionRequiresResolvedProfile(t *testing.T) {
	registry := NewRegistry(map[string]string{"OPENCODE": "opencode run {{prompt}}"})
	err := registry.ValidateTurnOptions(ProviderOpenCode, TurnRequest{RuntimeTarget: RuntimeLocal, RequestedAgentID: "team/reviewer", RequestedAgentScope: "project"})
	if err == nil || !strings.Contains(err.Error(), "not resolved") {
		t.Fatalf("unresolved agent must be rejected, got %v", err)
	}
}

func TestAgentSelectionAcceptsApplicableProfiles(t *testing.T) {
	registry := NewRegistry(map[string]string{
		"OPENCODE": "opencode run {{prompt}}", "CLAUDE": "claude -p {{prompt}}", "CODEX": "codex exec {{prompt}}",
		"ANTIGRAVITY": "agy -p {{prompt}}", "OMP": "omp -p --mode json {{prompt}}", "8GENT": "8gent run {{prompt}}",
	})
	for _, p := range SelectableHarnesses() {
		req := TurnRequest{RuntimeTarget: RuntimeLocal, RequestedAgentID: "orchestra:global:orchestra:rev", Agent: orchestraAgent("rev")}
		err := registry.ValidateTurnOptions(p, req)
		if p == Provider8gent {
			if err == nil {
				t.Fatal("8gent agent support is deferred and must be rejected")
			}
			continue
		}
		if err != nil {
			t.Fatalf("%s should apply orchestra agents: %v", p, err)
		}
	}
	own := &ResolvedAgent{ID: "harness:project:opencode:rev", Name: "rev", Source: AgentSourceHarness, Harness: "OPENCODE", Scope: "project"}
	if err := registry.ValidateTurnOptions(ProviderOpenCode, TurnRequest{RuntimeTarget: RuntimeLocal, RequestedAgentID: own.ID, Agent: own}); err != nil {
		t.Fatalf("own harness agent should be selectable: %v", err)
	}
	if err := registry.ValidateTurnOptions(ProviderClaude, TurnRequest{RuntimeTarget: RuntimeLocal, RequestedAgentID: own.ID, Agent: own}); err == nil {
		t.Fatal("another harness's agent must be rejected")
	}
	eight := &ResolvedAgent{ID: "harness:project:8gent:x", Name: "x", Source: AgentSourceHarness, Harness: "8GENT"}
	if err := registry.ValidateTurnOptions(Provider8gent, TurnRequest{RuntimeTarget: RuntimeLocal, RequestedAgentID: eight.ID, Agent: eight}); err == nil {
		t.Fatal("8gent has no named agents")
	}
	sub := orchestraAgent("helper")
	sub.Mode = "subagent"
	if err := registry.ValidateTurnOptions(ProviderClaude, TurnRequest{RuntimeTarget: RuntimeLocal, RequestedAgentID: sub.ID, Agent: sub}); err == nil {
		t.Fatal("subagents cannot be primary")
	}
}

func TestProviderDefaultDoesNotRequireAgentCapability(t *testing.T) {
	registry := NewRegistry(map[string]string{"OPENCODE": "opencode -p {{prompt}} -f json"})
	if err := registry.ValidateTurnOptions(ProviderOpenCode, TurnRequest{RuntimeTarget: RuntimeLocal}); err != nil {
		t.Fatalf("provider-default turn should remain compatible: %v", err)
	}
}
