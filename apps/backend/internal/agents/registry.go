package agents

import (
	"context"
	"fmt"
	"strings"
)

type Registry struct {
	runners map[Provider]Runner
}

func NewRegistry(commandByProvider map[string]string) *Registry {
	runners := map[Provider]Runner{}
	for provider, command := range commandByProvider {
		p := Provider(strings.ToLower(strings.TrimSpace(provider)))
		if p == "" || strings.TrimSpace(command) == "" {
			continue
		}
		if p == ProviderCodex && strings.Contains(strings.ToLower(command), "app-server") {
			runners[p] = NewCodexAppServerRunner(command)
			continue
		}
		switch p {
		case ProviderClaude:
			runners[p] = NewClaudeRunner(command)
		case ProviderOpenCode:
			runners[p] = NewOpenCodeRunner(command)
		default:
			runners[p] = NewCommandRunner(p, command)
		}
	}
	return &Registry{runners: runners}
}

func (r *Registry) RunTurn(ctx context.Context, provider Provider, request TurnRequest, onEvent EventHandler) (TurnResult, error) {
	runner, ok := r.runners[provider]
	if !ok {
		return TurnResult{}, fmt.Errorf("provider not configured: %s", provider)
	}
	return runner.RunTurn(ctx, request, onEvent)
}

func (r *Registry) HasProvider(provider Provider) bool {
	_, ok := r.runners[provider]
	return ok
}
