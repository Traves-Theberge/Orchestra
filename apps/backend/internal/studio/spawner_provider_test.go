package studio

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

func TestSpawnRejectsUnknownRunnerBeforeWorkspace(t *testing.T) {
	for _, runner := range []string{"antigravity", "typo", ""} {
		t.Run(runner, func(t *testing.T) {
			reg := &fakeRegistryForSpawn{}
			// An invalid repository would fail differently if provisioning ran.
			sp := NewStudioSpawner(reg, filepath.Join(t.TempDir(), "absent"), "", "")
			err := sp.Spawn(context.Background(), Session{ID: "invalid", Runner: runner}, func(Event) {})
			if err == nil || !strings.Contains(err.Error(), "unsupported runner") {
				t.Fatalf("expected runner validation before provisioning, got %v", err)
			}
			if len(sp.sessions) != 0 || len(reg.turns) != 0 {
				t.Fatal("invalid runner acquired session or dispatched a turn")
			}
		})
	}
}

func TestStudioProviderAliases(t *testing.T) {
	for runner, want := range map[string]agents.Provider{
		"claude-code": agents.ProviderClaude, " CLAUDE ": agents.ProviderClaude,
		"CoDeX": agents.ProviderCodex, "OPENCODE": agents.ProviderOpenCode,
		"gemini": agents.ProviderGemini,
	} {
		got, err := agentsProviderFor(runner)
		if err != nil || got != want {
			t.Fatalf("runner %q: got %q, %v; want %q", runner, got, err, want)
		}
	}
}
