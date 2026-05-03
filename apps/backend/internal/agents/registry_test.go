package agents

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestNewRegistryNormalizesProviderKeys(t *testing.T) {
	registry := NewRegistry(map[string]string{
		"  OPENCODE  ": "opencode run {{prompt}}",
		"  ":           "ignored",
		"claude":       "",
	})

	if !registry.HasProvider(ProviderOpenCode) {
		t.Fatalf("expected normalized opencode provider to be configured")
	}
	if registry.HasProvider(ProviderClaude) {
		t.Fatalf("expected empty command provider to be skipped")
	}
}

func TestNewRegistryUsesCodexAppServerRunnerWhenCommandIncludesAppServer(t *testing.T) {
	registry := NewRegistry(map[string]string{
		"codex": "codex app-server --stdio",
	})

	runner, ok := registry.runners[ProviderCodex]
	if !ok {
		t.Fatalf("expected codex provider runner configured")
	}
	if _, ok := runner.(*CodexAppServerRunner); !ok {
		t.Fatalf("expected codex app-server runner, got %T", runner)
	}
}

func TestRegistryRunTurnReturnsProviderNotConfiguredError(t *testing.T) {
	registry := NewRegistry(map[string]string{})
	_, err := registry.RunTurn(context.Background(), ProviderOpenCode, TurnRequest{}, nil)
	if err == nil {
		t.Fatalf("expected provider not configured error")
	}
	if !strings.Contains(err.Error(), "provider not configured") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// TestRegistrySelectsCorrectRunnerPerProvider guards against a refactor
// silently routing a #147-matrix provider through CommandRunner. Each of
// Claude/Codex/OpenCode/Gemini must resolve to its dedicated runner type
// so the per-provider lifecycle (Plan/Diff parsing, model env vars,
// streaming protocol) keeps working.
func TestRegistrySelectsCorrectRunnerPerProvider(t *testing.T) {
	cases := []struct {
		name     string
		provider Provider
		command  string
		want     any
	}{
		{"claude", ProviderClaude, "claude --print", (*ClaudeRunner)(nil)},
		{"codex_app_server", ProviderCodex, "codex app-server --stdio", (*CodexAppServerRunner)(nil)},
		{"opencode", ProviderOpenCode, "opencode run", (*OpenCodeRunner)(nil)},
		{"gemini", ProviderGemini, "gemini --prompt", (*GeminiRunner)(nil)},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := NewRegistry(map[string]string{string(tc.provider): tc.command})
			runner, ok := r.runners[tc.provider]
			if !ok {
				t.Fatalf("provider %s not registered", tc.provider)
			}
			gotType := reflect.TypeOf(runner)
			wantType := reflect.TypeOf(tc.want)
			if gotType != wantType {
				t.Fatalf("provider %s: got %s, want %s", tc.provider, gotType, wantType)
			}
		})
	}
}
