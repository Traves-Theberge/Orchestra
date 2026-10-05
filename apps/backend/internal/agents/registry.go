package agents

import (
	"context"
	"fmt"
	"runtime"
	"strings"
	"sync"

	"github.com/orchestra/orchestra/apps/backend/internal/harnessaccounts"
	"github.com/orchestra/orchestra/apps/backend/internal/terminal"
	"github.com/orchestra/orchestra/apps/backend/internal/unsandbox"
)

// Registry maps provider names to Runner implementations and dispatches
// turn execution to the appropriate backend. It is the central entry point
// for the orchestrator to invoke any configured agent.
type Registry struct {
	accounts       *harnessaccounts.Store
	mu             sync.Mutex
	runners        map[Provider]Runner
	disabled       map[Provider]bool
	commands       map[Provider]string
	readOnlyStages map[string]readOnlyStageCapability
	nativeCommands map[Provider]string
	transports     map[RuntimeTarget]RuntimeTransport
	termManager    *terminal.Manager
}

func (r *Registry) SetAccountStore(store *harnessaccounts.Store) {
	r.mu.Lock()
	r.accounts = store
	r.mu.Unlock()
}
func (r *Registry) ActiveAccount(provider Provider) string {
	r.mu.Lock()
	store := r.accounts
	r.mu.Unlock()
	if store == nil {
		return ""
	}
	return store.Active(string(provider)).AccountID
}

// ValidateAccount checks a persisted conversation binding before accepting a
// new message. An account removed since the previous turn cannot be replaced
// silently by the current active selection.
func (r *Registry) ValidateAccount(provider Provider, accountID string) error {
	if accountID == "" || accountID == "system_default" {
		return nil
	}
	r.mu.Lock()
	store := r.accounts
	r.mu.Unlock()
	if store == nil {
		return harnessaccounts.ErrUnavailable
	}
	_, err := store.Home(string(provider), accountID)
	return err
}
func (r *Registry) bindAccount(provider Provider, request TurnRequest) (TurnRequest, error) {
	if request.AccountID == "system_default" {
		request.AccountID = ""
		return request, nil
	}
	r.mu.Lock()
	store := r.accounts
	r.mu.Unlock()
	if store == nil {
		if request.AccountID != "" {
			return request, harnessaccounts.ErrNotFound
		}
		return request, nil
	}
	if request.AccountID == "" {
		request.AccountID = store.Active(string(provider)).AccountID
	}
	if request.AccountID == "" {
		return request, nil
	}
	if NormalizeRuntimeTarget(string(request.RuntimeTarget)) != RuntimeLocal {
		return request, fmt.Errorf("managed account remote execution is unsupported")
	}
	home, err := store.Home(string(provider), request.AccountID)
	if err != nil {
		return request, err
	}
	request.CredentialHome = home
	return request, nil
}

type readOnlyStageCapability struct {
	provider     Provider
	executionCmd string
	refCount     int
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
		disabled:       map[Provider]bool{},
		commands:       map[Provider]string{},
		readOnlyStages: map[string]readOnlyStageCapability{},
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
	var accountErr error
	request, accountErr = r.bindAccount(provider, request)
	if accountErr != nil {
		return TurnResult{}, accountErr
	}
	r.mu.Lock()
	accountStore := r.accounts
	r.mu.Unlock()
	if accountStore != nil && request.AccountID != "" {
		release, err := accountStore.Acquire(request.AccountID)
		if err != nil {
			return TurnResult{}, err
		}
		defer release()
	}
	if request.PlanOnly {
		if !r.isPreparedReadOnlyStage(provider, request.CommandOverride) || NormalizeRuntimeTarget(string(request.RuntimeTarget)) != RuntimeLocal {
			return TurnResult{}, fmt.Errorf("read-only stage is not supported for provider %s and runtime %s", provider, NormalizeRuntimeTarget(string(request.RuntimeTarget)))
		}
		request.ToolExecutor = nil
		request.ToolSpecs = nil
		request.ResourceSpecs = nil
	}
	r.mu.Lock()
	runner, ok := r.runners[provider]
	ok = ok && !r.disabled[provider]
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
	if request.PlanOnly {
		if !r.isPreparedReadOnlyStage(provider, request.CommandOverride) || NormalizeRuntimeTarget(string(request.RuntimeTarget)) != RuntimeLocal {
			return fmt.Errorf("read-only stage is not supported for provider %s and runtime %s", provider, NormalizeRuntimeTarget(string(request.RuntimeTarget)))
		}
	}
	r.mu.Lock()
	runner, ok := r.runners[provider]
	ok = ok && !r.disabled[provider]
	transport := r.transports[request.RuntimeTarget]
	r.mu.Unlock()
	if !ok {
		return fmt.Errorf("provider not configured: %s", provider)
	}
	return validateTurnOptions(context.Background(), provider, runner, transport, request)
}

func (r *Registry) isPreparedReadOnlyStage(provider Provider, command string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	capability, ok := r.readOnlyStages[command]
	return ok && capability.provider == provider && r.commands[provider] == capability.executionCmd
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
	return ok && !r.disabled[provider]
}

// SetRegistered changes availability for future turns without discarding the
// configured command or interrupting a runner already executing a turn.
func (r *Registry) SetRegistered(provider Provider, registered bool) {
	provider = NormalizeProvider(string(provider))
	r.mu.Lock()
	r.disabled[provider] = !registered
	r.mu.Unlock()
}

// Providers returns a slice of all currently registered provider identifiers.
func (r *Registry) Providers() []Provider {
	r.mu.Lock()
	defer r.mu.Unlock()
	providers := make([]Provider, 0, len(r.runners))
	for p := range r.runners {
		if !r.disabled[p] {
			providers = append(providers, p)
		}
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

// ReadOnlyPlanCommandFor returns only explicitly reviewed per-provider command
// variants, and only when the execution command is Orchestra's exact default.
// A planning prompt or arbitrary custom command never grants read-only safety.
func (r *Registry) ReadOnlyPlanCommandFor(provider Provider) (string, bool) {
	provider = NormalizeProvider(string(provider))
	r.mu.Lock()
	command := strings.TrimSpace(r.commands[provider])
	r.mu.Unlock()
	return safeStageCommand(provider, command)
}

// ReadOnlyStageCommandFor is the shared capability boundary for read-only
// planning and review turns. The returned command is a fresh stage-specific
// invocation; callers must still supply no tool executor/specs and use LOCAL.
func (r *Registry) ReadOnlyStageCommandFor(provider Provider) (string, bool) {
	return r.ReadOnlyPlanCommandFor(provider)
}

// CanReadOnlyStage reports whether the currently configured exact provider
// command has a reviewed read-only stage adapter. It performs no preparation
// and writes no policy files; callers must still prepare the command before
// dispatch with PrepareReadOnlyStageCommandFor.
func (r *Registry) CanReadOnlyStage(provider Provider) bool {
	_, ok := r.ReadOnlyPlanCommandFor(provider)
	return ok
}

// PrepareReadOnlyStageCommandFor creates any per-turn policy artifact required
// by a reviewed provider adapter and registers the exact command as a capability.
// cleanup must be called when the turn completes or is rejected.
func (r *Registry) PrepareReadOnlyStageCommandFor(provider Provider) (command string, cleanup func(), ok bool) {
	provider = NormalizeProvider(string(provider))
	raw, exists := r.CommandFor(provider)
	if !exists {
		return "", func() {}, false
	}
	if command, supported := safeStageCommand(provider, raw); supported {
		r.mu.Lock()
		capability := r.readOnlyStages[command]
		if capability.provider != provider || capability.executionCmd != raw {
			capability = readOnlyStageCapability{provider: provider, executionCmd: raw}
		}
		capability.refCount++
		r.readOnlyStages[command] = capability
		r.mu.Unlock()
		var once sync.Once
		return command, func() { once.Do(func() { r.releaseReadOnlyStage(command) }) }, true
	}
	return "", func() {}, false
}

func (r *Registry) releaseReadOnlyStage(command string) {
	r.mu.Lock()
	if capability, ok := r.readOnlyStages[command]; ok {
		capability.refCount--
		if capability.refCount <= 0 {
			delete(r.readOnlyStages, command)
		} else {
			r.readOnlyStages[command] = capability
		}
	}
	r.mu.Unlock()
}

func safeStageCommand(provider Provider, raw string) (string, bool) {
	switch provider {
	case ProviderCodex:
		if raw == "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {{prompt}}" {
			command := "codex exec --skip-git-repo-check --ignore-user-config --sandbox read-only --json {{prompt}}"
			if runtime.GOOS == "windows" {
				// ignore-user-config also omits CODEX_HOME's Windows sandbox mode.
				// Pin the supported fallback explicitly while retaining the read-only
				// execution policy for this unattended planning stage.
				command = "codex exec --skip-git-repo-check --ignore-user-config -c windows.sandbox='\"unelevated\"' -c approval_policy='\"never\"' --sandbox read-only --json {{prompt}}"
			}
			return command, true
		}
	case ProviderClaude:
		if raw == "claude -p {{prompt}} --output-format stream-json --verbose --dangerously-skip-permissions" {
			return "claude -p {{prompt}} --output-format stream-json --verbose --permission-mode plan --tools Read,Grep,Glob --disallowedTools mcp__*", true
		}
	}
	return "", false
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
	p := NormalizeProvider(string(provider))
	if p == ProviderGemini {
		// Gemini remains only as an archived provider identity. New execution
		// configuration is Antigravity-only. Clear an older active registration.
		r.mu.Lock()
		delete(r.commands, p)
		delete(r.runners, p)
		for capabilityCommand, capability := range r.readOnlyStages {
			if capability.provider == p {
				delete(r.readOnlyStages, capabilityCommand)
			}
		}
		r.mu.Unlock()
		return
	}
	if strings.TrimSpace(command) == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
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
