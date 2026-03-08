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

func (r *Registry) Providers() []Provider {
	providers := make([]Provider, 0, len(r.runners))
	for p := range r.runners {
		providers = append(providers, p)
	}
	return providers
}

func (r *Registry) SetCommand(provider Provider, command string) {
	if strings.TrimSpace(command) == "" {
		return
	}
	p := Provider(strings.ToLower(strings.TrimSpace(string(provider))))
	if p == ProviderCodex && strings.Contains(strings.ToLower(command), "app-server") {
		r.runners[p] = NewCodexAppServerRunner(command)
		return
	}
	switch p {
	case ProviderClaude:
		r.runners[p] = NewClaudeRunner(command)
	case ProviderOpenCode:
		r.runners[p] = NewOpenCodeRunner(command)
	default:
		r.runners[p] = NewCommandRunner(p, command)
	}
}
