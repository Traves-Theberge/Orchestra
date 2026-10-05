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
	mu             sync.Mutex
	runners        map[Provider]Runner
	commands       map[Provider]string
	nativeCommands map[Provider]string
	transports     map[RuntimeTarget]RuntimeTransport
	termManager    *terminal.Manager
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
		runners:        map[Provider]Runner{},
		commands:       map[Provider]string{},
		nativeCommands: map[Provider]string{},
		transports:     map[RuntimeTarget]RuntimeTransport{},
		termManager:    tm,
	}
	for provider, command := range commandByProvider {
		r.SetCommand(Provider(provider), command)
	}
	return r
}

// RunTurn dispatches a single agent turn to the runner registered for the given
// provider. If request.RuntimeTarget is set (and not LOCAL), it routes through
// the registered RuntimeTransport instead of the default runner.
func (r *Registry) RunTurn(ctx context.Context, provider Provider, request TurnRequest, onEvent EventHandler) (TurnResult, error) {
	provider = NormalizeProvider(string(provider))
	r.mu.Lock()
	runner, ok := r.runners[provider]
	cmd := r.commands[provider]
	transport := r.transports[request.RuntimeTarget]
	r.mu.Unlock()

	if !ok {
		return TurnResult{}, fmt.Errorf("provider not configured: %s", provider)
	}
	if err := validateTurnOptions(ctx, provider, runner, transport, request); err != nil {
		return TurnResult{}, err
	}
	if request.RuntimeTarget != "" && request.RuntimeTarget != RuntimeLocal {
		if transport == nil {
			return TurnResult{}, fmt.Errorf("runtime target not configured: %s", request.RuntimeTarget)
		}
		runner = transport.WrapCommand(provider, cmd)
	}
	return runner.RunTurn(ctx, request, onEvent)
}

// ValidateTurnOptions checks requested options before workspace effects. RunTurn
// checks again against its selected runner, because registry bindings can change.
// This is a capability boundary, not a frozen or persisted configuration snapshot.
func (r *Registry) ValidateTurnOptions(provider Provider, request TurnRequest) error {
	provider = NormalizeProvider(string(provider))
	r.mu.Lock()
	runner, ok := r.runners[provider]
	transport := r.transports[request.RuntimeTarget]
	r.mu.Unlock()
	if !ok {
		return fmt.Errorf("provider not configured: %s", provider)
	}
	return validateTurnOptions(context.Background(), provider, runner, transport, request)
}

func validateTurnOptions(ctx context.Context, provider Provider, runner Runner, transport RuntimeTransport, request TurnRequest) error {
	if runner == nil {
		return fmt.Errorf("provider runner missing: %s", provider)
	}
	remote := request.RuntimeTarget != "" && request.RuntimeTarget != RuntimeLocal
	if request.RequestedMaxTurns != nil {
		return fmt.Errorf("requested_max_turns is not supported: task turn-budget semantics are not implemented")
	}
	if request.RequestedAgentID == "" {
		if request.RequestedAgentScope != "" || request.RequestedAgentContentHash != "" || request.RequestedAgentFormat != "" {
			return fmt.Errorf("agent selection metadata requires a requested agent id")
		}
	} else {
		if request.RequestedAgentScope != "project" && request.RequestedAgentScope != "global" {
			return fmt.Errorf("requested agent scope must be project or global")
		}
		if remote {
			return fmt.Errorf("requested agent selection is not supported by runtime target %s", request.RuntimeTarget)
		}
		validator, supported := runner.(AgentSelectionValidator)
		if !supported {
			return fmt.Errorf("requested agent selection is not supported by provider %s", provider)
		}
		if err := validator.ValidateAgentSelection(ctx, request); err != nil {
			return fmt.Errorf("requested agent selection rejected by provider %s: %w", provider, err)
		}
	}
	if remote && transport == nil {
		return fmt.Errorf("runtime target not configured: %s", request.RuntimeTarget)
	}
	if request.RequestedModel != "" {
		if remote {
			return fmt.Errorf("requested_model is not supported by runtime target %s", request.RuntimeTarget)
		}
		validator, supported := runner.(RequestedModelValidator)
		if !supported {
			return fmt.Errorf("requested_model is not supported by provider %s", provider)
		}
		if err := validator.ValidateRequestedModel(request.RequestedModel); err != nil {
			return fmt.Errorf("requested_model rejected by provider %s: %w", provider, err)
		}
	}
	return nil
}

// HasProvider reports whether a runner is registered for the given provider.
func (r *Registry) HasProvider(provider Provider) bool {
	provider = NormalizeProvider(string(provider))
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.runners[provider]
	return ok
}

// Providers returns a slice of all currently registered provider identifiers.
func (r *Registry) Providers() []Provider {
	r.mu.Lock()
	defer r.mu.Unlock()
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
	p = NormalizeProvider(string(p))
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runners[p] = runner
}

// CommandFor returns the raw command string registered for the given provider,
// along with a boolean indicating whether one was found.
func (r *Registry) CommandFor(provider Provider) (string, bool) {
	provider = NormalizeProvider(string(provider))
	r.mu.Lock()
	defer r.mu.Unlock()
	cmd, ok := r.commands[provider]
	return cmd, ok
}

// SetTransport registers or replaces the RuntimeTransport for the given target.
func (r *Registry) SetTransport(target RuntimeTarget, transport RuntimeTransport) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.transports[target] = transport
}

// SetCommand registers or replaces the runner for the given provider by
// normalizing the provider name and selecting the appropriate Runner
// implementation (ClaudeRunner, GeminiRunner, CodexAppServerRunner, etc.)
// based on the provider and command string. Empty commands are ignored.
func (r *Registry) SetCommand(provider Provider, command string) {
	if strings.TrimSpace(command) == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	p := NormalizeProvider(string(provider))
	r.commands[p] = command
	if p == ProviderCodex {
		if _, configured := r.nativeCommands[p]; !configured {
			r.nativeCommands[p] = "codex app-server"
		}
	}
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
	case ProviderAntigravity:
		r.runners[p] = NewCommandRunner(p, command)
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
