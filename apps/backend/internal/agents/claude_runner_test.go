package agents

import (
	"context"
	"testing"
)

func TestClaudeRequestedModelValidation(t *testing.T) {
	r := NewClaudeRunner("claude -p {{prompt}} --output-format stream-json --verbose")
	for _, ok := range []string{"sonnet", "claude-sonnet-5-5", "claude-opus-5-5[1m]", "claude-haiku-4-5-20251001"} {
		if err := validateTurnOptions(context.Background(), ProviderClaude, r, nil, TurnRequest{RuntimeTarget: RuntimeLocal, RequestedModel: ok}); err != nil {
			t.Fatalf("%s rejected: %v", ok, err)
		}
	}
	for _, bad := range []string{"-sonnet", "sonnet; rm -rf /", "a b", "x'y"} {
		if err := r.ValidateRequestedModel(bad); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
}

func TestOpenCodeRequestedModelValidation(t *testing.T) {
	r := NewOpenCodeRunner("opencode run {{prompt}} --format json")
	for _, ok := range []string{"opencode/ling-3.1-flash-free", "anthropic/claude-sonnet-5-5", "openrouter/meta-llama/llama-4"} {
		if err := validateTurnOptions(context.Background(), ProviderOpenCode, r, nil, TurnRequest{RuntimeTarget: RuntimeLocal, RequestedModel: ok}); err != nil {
			t.Fatalf("%s rejected: %v", ok, err)
		}
	}
	for _, bad := range []string{"sonnet", "/x", "a/b; rm -rf /", "a b/c"} {
		if err := r.ValidateRequestedModel(bad); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
}
