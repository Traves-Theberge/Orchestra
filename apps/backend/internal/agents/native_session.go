package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type NativeModelInfo struct {
	Model           string `json:"model,omitempty"`
	ApprovalPolicy  string `json:"approval_policy,omitempty"`
	SandboxMode     string `json:"sandbox_mode,omitempty"`
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
}

type NativeEvent struct {
	Type      string          `json:"type"`
	ThreadID  string          `json:"thread_id,omitempty"`
	TurnID    string          `json:"turn_id,omitempty"`
	ItemID    string          `json:"item_id,omitempty"`
	RequestID string          `json:"request_id,omitempty"`
	Delta     string          `json:"delta,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
	Usage     *NativeUsage    `json:"usage,omitempty"`
}
type NativeUsage struct {
	Last               TokenUsage `json:"last"`
	Total              TokenUsage `json:"total"`
	ModelContextWindow *int64     `json:"model_context_window,omitempty"`
}

// Catalog observation does not establish model access or entitlement.
type NativeModelCatalogProvider interface {
	ListModels(context.Context) (json.RawMessage, error)
}
type NativeEventHandler func(NativeEvent)
type NativeTurnResult struct {
	TurnID          string `json:"turn_id"`
	Status          string `json:"status"`
	Text            string `json:"text"`
	Model           string `json:"model,omitempty"`
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
}
type NativeTurnOptions struct {
	Model           string `json:"model,omitempty"`
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
}

// Optional extension preserves compatibility with native fixtures/providers
// that only implement the original model-only turn contract.
type NativeTurnOptionsSession interface {
	SendTurnWithOptions(context.Context, string, NativeTurnOptions) (NativeTurnResult, error)
}
type NativeSession interface {
	ThreadID() string
	ModelInfo() NativeModelInfo
	SendTurn(context.Context, string, string) (NativeTurnResult, error)
	RespondRequest(context.Context, string, json.RawMessage) error
	Interrupt(context.Context) error
	Close() error
}

// Native capability is separate from the batch runner's capabilities.
func (r *Registry) SupportsNativeSession(provider Provider) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	p := NormalizeProvider(string(provider))
	return p == ProviderCodex && strings.TrimSpace(r.nativeCommands[p]) != ""
}

// SetNativeCommand configures the independent interactive provider command.
// Empty explicitly disables native chat; batch commands and dangerous flags are never reused.
func (r *Registry) SetNativeCommand(provider Provider, command string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.nativeCommands == nil {
		r.nativeCommands = map[Provider]string{}
	}
	r.nativeCommands[NormalizeProvider(string(provider))] = strings.TrimSpace(command)
}
func (r *Registry) NativeCommandFor(provider Provider) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	command, ok := r.nativeCommands[NormalizeProvider(string(provider))]
	return command, ok
}
func (r *Registry) StartNativeSession(ctx context.Context, provider Provider, request TurnRequest, threadID string, onEvent NativeEventHandler) (NativeSession, error) {
	if !r.SupportsNativeSession(provider) {
		return nil, fmt.Errorf("native sessions are not supported by provider %s", provider)
	}
	if request.RuntimeTarget != "" && request.RuntimeTarget != RuntimeLocal {
		return nil, fmt.Errorf("native remote sessions are not supported")
	}
	if request.RequestedMaxTurns != nil {
		return nil, fmt.Errorf("native turn budgets are not supported")
	}
	command, _ := r.NativeCommandFor(provider)
	return NewCodexNativeSession(ctx, command, request, threadID, onEvent)
}
