package agents

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/orchestra/orchestra/apps/backend/internal/terminal"
	"github.com/orchestra/orchestra/apps/backend/internal/unsandbox"
)

// Registry maps provider names to Runner implementations and dispatches
// turn execution to the appropriate backend. It is the central entry point
// for the orchestrator to invoke any configured agent.
type Registry struct {
	mu          sync.Mutex
	runners     map[Provider]Runner
	termManager *terminal.Manager
}

// NewRegistry creates a Registry with the given provider-to-command mapping
// and no terminal manager (PTY support disabled).
func NewRegistry(commandByProvider map[string]string) *Registry {
	return NewRegistryWithTerminal(commandByProvider, nil)
}

// NewRegistryWithTerminal creates a Registry with the given provider-to-command
// mapping and an optional terminal.Manager for PTY-based agent sessions.
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

// RunTurn dispatches a single agent turn to the runner registered for the given
// provider. It returns an error if the provider is not configured.
func (r *Registry) RunTurn(ctx context.Context, provider Provider, request TurnRequest, onEvent EventHandler) (TurnResult, error) {
	runner, ok := r.runners[provider]
	if !ok {
		return TurnResult{}, fmt.Errorf("provider not configured: %s", provider)
	}
	return runner.RunTurn(ctx, request, onEvent)
}

// HasProvider reports whether a runner is registered for the given provider.
func (r *Registry) HasProvider(provider Provider) bool {
	_, ok := r.runners[provider]
	return ok
}

// Providers returns a slice of all currently registered provider identifiers.
func (r *Registry) Providers() []Provider {
	providers := make([]Provider, 0, len(r.runners))
	for p := range r.runners {
		providers = append(providers, p)
	}
	return providers
}

// SetRunner registers or replaces the runner for the given provider directly,
// bypassing the command-based lookup. This is used by callers that construct
// their own Runner implementations (e.g. TailscaleRunner, KubernetesRunner).
func (r *Registry) SetRunner(p Provider, runner Runner) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runners[p] = runner
}

// SetCommand registers or replaces the runner for the given provider by
// normalizing the provider name and selecting the appropriate Runner
// implementation (ClaudeRunner, GeminiRunner, CodexAppServerRunner, etc.)
// based on the provider and command string. Empty commands are ignored.
func (r *Registry) SetCommand(provider Provider, command string) {
	if strings.TrimSpace(command) == "" {
		return
	}
	p := NormalizeProvider(string(provider))
	if p == ProviderCodex && strings.Contains(strings.ToLower(command), "app-server") {
		r.runners[p] = NewCodexAppServerRunner(command)
		return
	}
	switch p {
	case ProviderClaude:
		r.runners[p] = NewClaudeRunner(command)
	case Provider8gent:
		r.runners[p] = NewEightgentRunner(command)
	case ProviderOpenCode:
		r.runners[p] = NewOpenCodeRunner(command)
	case ProviderGemini:
		r.runners[p] = NewGeminiRunner(command)
	case ProviderUnsandbox:
		client, err := unsandbox.NewClientFromEnv()
		if err == nil {
			r.runners[p] = NewUnsandboxRunner(client, command)
		}
		return
	default:
		runner := NewCommandRunner(p, command)
		if r.termManager != nil {
			runner.WithTerminalManager(r.termManager)
		}
		r.runners[p] = runner
	}
}
