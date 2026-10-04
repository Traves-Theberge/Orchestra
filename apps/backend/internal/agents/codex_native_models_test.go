package agents

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNativeModelsCatalogOnlyAndPagination(t *testing.T) {
	root := t.TempDir()
	registry := NewRegistry(map[string]string{"CODEX": "codex exec --dangerously-bypass-approvals-and-sandbox {{prompt}}"})
	registry.SetNativeCommand(ProviderCodex, nativeFixtureCommand(t, "catalog-paged"))
	models, err := registry.NativeModels(context.Background(), ProviderCodex, TurnRequest{Workspace: root, WorkspaceRoot: root, ProjectRootWorkspace: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0].Model != "fixture-model" || models[1].ID != "fixture-model-next" || models[0].DisplayName != "Fixture model" || !models[0].IsDefault || models[0].DefaultReasoningEffort != "medium" || len(models[0].SupportedReasoningEfforts) != 1 || models[0].SupportedReasoningEfforts[0].ReasoningEffort != "medium" || models[0].InputModalities[0] != "text" {
		t.Fatalf("bad catalog %+v", models)
	}
	methods, err := os.ReadFile(filepath.Join(root, "protocol-methods.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(methods)) != "initialize\ninitialized\nmodel/list\nmodel/list" {
		t.Fatalf("unexpected process methods: %s", methods)
	}
}
func TestNativeModelsCatalogFailuresAndCleanup(t *testing.T) {
	for _, mode := range []string{"catalog-eof", "catalog-malformed", "catalog-loop"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			registry := NewRegistry(map[string]string{"CODEX": "codex exec {{prompt}}"})
			registry.SetNativeCommand(ProviderCodex, nativeFixtureCommand(t, mode))
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			start := time.Now()
			models, err := registry.NativeModels(ctx, ProviderCodex, TurnRequest{Workspace: root, WorkspaceRoot: root, ProjectRootWorkspace: true})
			if err == nil || models != nil {
				t.Fatal("catalog failure accepted")
			}
			if time.Since(start) > 3*time.Second {
				t.Fatal("catalog process cleanup was not bounded")
			}
			methods, _ := os.ReadFile(filepath.Join(root, "protocol-methods.txt"))
			if strings.Contains(string(methods), "thread/") || strings.Contains(string(methods), "turn/") {
				t.Fatal("catalog created provider session")
			}
		})
	}
}
func TestNativeModelsRejectWorkspaceBeforeProcess(t *testing.T) {
	root := t.TempDir()
	registry := NewRegistry(map[string]string{"CODEX": "codex exec {{prompt}}"})
	registry.SetNativeCommand(ProviderCodex, nativeFixtureCommand(t, "catalog"))
	if _, err := registry.NativeModels(context.Background(), ProviderCodex, TurnRequest{Workspace: root, WorkspaceRoot: filepath.Join(root, "other")}); err == nil {
		t.Fatal("outside workspace accepted")
	}
	if _, err := os.Stat(filepath.Join(root, "protocol-methods.txt")); !os.IsNotExist(err) {
		t.Fatal("catalog process started before workspace validation")
	}
}
