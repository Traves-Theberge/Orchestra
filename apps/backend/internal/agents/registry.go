package agents

import (
	"context"
	"fmt"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/terminal"
)

type Registry struct {
	runners     map[Provider]Runner
	termManager *terminal.Manager
}

func NewRegistry(commandByProvider map[string]string) *Registry {
	return NewRegistryWithTerminal(commandByProvider, nil)
}

func NewRegistryWithTerminal(commandByProvider map[string]string, tm *terminal.Manager) *Registry {
	r := &Registry{
		runners:     map[Provider]Runner{},
		termManager: tm,
	}
	for provider, command := range commandByProvider {
		r.SetCommand(Provider(provider), command)
	}
	return r
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
	case ProviderGemini:
		r.runners[p] = NewGeminiRunner(command)
	default:
		runner := NewCommandRunner(p, command)
		if r.termManager != nil {
			runner.WithTerminalManager(r.termManager)
		}
		r.runners[p] = runner
	}
}
