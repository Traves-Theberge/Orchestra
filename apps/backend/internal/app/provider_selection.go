package app

import (
	"fmt"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
)

// canonicalDispatchProvider accepts the Studio/template alias for Claude Code.
// Other names retain registry-defined meaning, including configured custom runners.
func canonicalDispatchProvider(name string) agents.Provider {
	p := agents.NormalizeProvider(name)
	if p == "CLAUDE-CODE" {
		return agents.ProviderClaude
	}
	return p
}

func resolveDispatchProvider(registry *agents.Registry, fallback agents.Provider, entry orchestrator.RunningEntry) (agents.Provider, error) {
	selected := canonicalDispatchProvider(string(fallback))
	if entry.Provider != "" {
		selected = canonicalDispatchProvider(entry.Provider)
	} else if assignee := strings.TrimSpace(entry.AssigneeID); strings.HasPrefix(strings.ToLower(assignee), "agent-") {
		selected = canonicalDispatchProvider(assignee[len("agent-"):])
	}
	if registry == nil || selected == "" || !registry.HasProvider(selected) {
		return selected, fmt.Errorf("selected agent provider %q is not configured", selected)
	}
	return selected, nil
}

func dispatchRequestedOptions(entry orchestrator.RunningEntry) agents.TurnRequest {
	request := agents.TurnRequest{
		RequestedModel: entry.RequestedModel,
		RuntimeTarget:  agents.NormalizeRuntimeTarget(entry.RuntimeTarget),
	}
	if entry.RequestedMaxTurns != nil {
		turns := *entry.RequestedMaxTurns
		request.RequestedMaxTurns = &turns
	}
	return request
}
