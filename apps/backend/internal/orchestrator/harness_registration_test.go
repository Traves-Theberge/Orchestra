package orchestrator

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

func TestHarnessRegistrationPersistsAndGuardsDefault(t *testing.T) {
	ctx := context.Background()
	warehouse, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer warehouse.Close()
	commands := map[string]string{"CODEX": "codex exec {{prompt}}", "CLAUDE": "claude -p {{prompt}}"}
	newService := func() (*Service, *agents.Registry) {
		s := NewService()
		s.SetDB(warehouse)
		r := agents.NewRegistry(commands)
		s.SetAgentRegistry(r, commands, "CODEX")
		return s, r
	}
	s, registry := newService()
	if _, err := s.SetHarnessRegistration(ctx, "CODEX", false, 0); !errors.Is(err, ErrDefaultHarness) {
		t.Fatalf("default unregister: %v", err)
	}
	version, err := s.SetHarnessRegistration(ctx, "CLAUDE", false, 0)
	if err != nil || version != 1 || registry.HasProvider(agents.ProviderClaude) {
		t.Fatalf("unregister: version %d, err %v", version, err)
	}
	if _, err := s.SetHarnessRegistration(ctx, "CLAUDE", true, 0); !errors.Is(err, ErrHarnessRegistrationConflict) {
		t.Fatalf("stale update: %v", err)
	}
	restored, restoredRegistry := newService()
	if err := restored.RestoreHarnessRegistration(ctx); err != nil {
		t.Fatal(err)
	}
	if restoredRegistry.HasProvider(agents.ProviderClaude) {
		t.Fatal("unregistered provider restored as available")
	}
	if _, err := restored.SetHarnessRegistration(ctx, "CLAUDE", true, 1); err != nil {
		t.Fatal(err)
	}
	if !restoredRegistry.HasProvider(agents.ProviderClaude) {
		t.Fatal("registered provider unavailable")
	}
}

func TestCommandConfigurationDoesNotRegisterHarness(t *testing.T) {
	ctx := context.Background()
	warehouse, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer warehouse.Close()
	s := NewService()
	s.SetDB(warehouse)
	registry := agents.NewRegistry(map[string]string{"CODEX": "codex exec {{prompt}}"})
	s.SetAgentRegistry(registry, map[string]string{"CODEX": "codex exec {{prompt}}"}, "CODEX")
	if err := s.UpdateAgentConfig(map[string]string{"CLAUDE": "claude -p {{prompt}}"}, ""); err != nil {
		t.Fatal(err)
	}
	if registry.HasProvider(agents.ProviderClaude) {
		t.Fatal("saving command registered harness")
	}
	restored := NewService()
	restored.SetDB(warehouse)
	restoredRegistry := agents.NewRegistry(map[string]string{"CODEX": "codex exec {{prompt}}"})
	restored.SetAgentRegistry(restoredRegistry, map[string]string{"CODEX": "codex exec {{prompt}}"}, "CODEX")
	if err := restored.RestoreHarnessRegistration(ctx); err != nil {
		t.Fatal(err)
	}
	if restoredRegistry.HasProvider(agents.ProviderClaude) {
		t.Fatal("command override registered harness after restart")
	}
	if version, err := restored.HarnessRegistrationVersion(ctx, "CLAUDE"); err != nil || version != 1 {
		t.Fatalf("version %d: %v", version, err)
	}
	if _, err := restored.SetHarnessRegistration(ctx, "CLAUDE", true, 1); err != nil {
		t.Fatal(err)
	}
	if !restoredRegistry.HasProvider(agents.ProviderClaude) {
		t.Fatal("register failed")
	}
}

func TestDefaultChangeSurvivesUnregisterAndRestart(t *testing.T) {
	ctx := context.Background()
	warehouse, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer warehouse.Close()
	commands := map[string]string{"CODEX": "codex exec {{prompt}}", "CLAUDE": "claude -p {{prompt}}"}
	s := NewService()
	s.SetDB(warehouse)
	s.SetAgentRegistry(agents.NewRegistry(commands), commands, "CODEX")
	if err := s.UpdateAgentConfig(nil, "CLAUDE"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetHarnessRegistration(ctx, "CODEX", false, 0); err != nil {
		t.Fatal(err)
	}
	restored := NewService()
	restored.SetDB(warehouse)
	registry := agents.NewRegistry(commands)
	restored.SetAgentRegistry(registry, commands, "CODEX")
	if err := restored.RestoreHarnessRegistration(ctx); err != nil {
		t.Fatal(err)
	}
	_, selected := restored.GetAgentConfig()
	if selected != "CLAUDE" {
		t.Fatalf("restored default = %q", selected)
	}
	if registry.HasProvider(agents.ProviderCodex) || !registry.HasProvider(agents.ProviderClaude) {
		t.Fatal("restored availability differs from selected default")
	}
}
