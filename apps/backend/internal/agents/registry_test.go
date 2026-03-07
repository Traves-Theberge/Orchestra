package agents

import (
	"context"
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
