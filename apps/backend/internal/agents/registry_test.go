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

func TestLegacyGeminiCommandDoesNotRegisterAnActiveRunner(t *testing.T) {
	registry := NewRegistry(map[string]string{
		"GEMINI": "gemini -p {{prompt}} --output-format stream-json --approval-mode yolo",
	})
	if registry.HasProvider(ProviderGemini) {
		t.Fatal("legacy Gemini configuration registered an active runner")
	}
	if registry.CanReadOnlyStage(ProviderGemini) || registry.CanReadOnlyStage(ProviderAntigravity) {
		t.Fatal("unexpected read-only capability without a verified adapter")
	}
	if _, _, ok := registry.PrepareReadOnlyStageCommandFor(ProviderAntigravity); ok {
		t.Fatal("Antigravity capability must remain unavailable until scoped permissions are verified")
	}
}

func TestReadOnlyPlanCommandRequiresKnownDefaultAndVerifiedProviderMode(t *testing.T) {
	cases := []struct {
		provider Provider
		command  string
		want     string
	}{
		{ProviderCodex, "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {{prompt}}", "codex exec --skip-git-repo-check --ignore-user-config --sandbox read-only --json {{prompt}}"},
		{ProviderClaude, "claude -p {{prompt}} --output-format stream-json --verbose --dangerously-skip-permissions", "claude -p {{prompt}} --output-format stream-json --verbose --permission-mode plan --tools Read,Grep,Glob --disallowedTools mcp__*"},
		{ProviderAntigravity, "agy -p {{prompt}} --output-format stream-json", ""},
		{ProviderOpenCode, "opencode -p {{prompt}} -f json", ""},
		{Provider8gent, "8gent run --yes --output-format stream-json {{prompt}}", ""},
		{ProviderCodex, "codex exec --dangerously-bypass-approvals-and-sandbox {{prompt}}", ""},
	}
	for _, tc := range cases {
		t.Run(string(tc.provider)+"/"+tc.command, func(t *testing.T) {
			registry := NewRegistry(map[string]string{string(tc.provider): tc.command})
			got, ok := registry.ReadOnlyPlanCommandFor(tc.provider)
			if tc.want == "" {
				if ok || got != "" {
					t.Fatalf("unexpected plan capability %q, %v", got, ok)
				}
				return
			}
			if !ok || got != tc.want {
				t.Fatalf("plan command %q, %v; want %q", got, ok, tc.want)
			}
		})
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
