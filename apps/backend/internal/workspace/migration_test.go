package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPlanWorkspaceMigrationRenameRoot(t *testing.T) {
	temp := t.TempDir()
	oldRoot := filepath.Join(temp, "orchestra_workspaces_prev")
	newRoot := filepath.Join(temp, "orchestra_workspaces")

	if err := os.MkdirAll(filepath.Join(oldRoot, "MT-1"), 0o755); err != nil {
		t.Fatalf("mkdir old root: %v", err)
	}

	plan, err := PlanWorkspaceMigration(oldRoot, newRoot)
	if err != nil {
		t.Fatalf("plan migration: %v", err)
	}

	if len(plan.Actions) != 1 || plan.Actions[0].Type != "rename_root" {
		t.Fatalf("expected one rename_root action, got=%+v", plan.Actions)
	}
}

func TestExecuteWorkspaceMigrationDryRunNoMutation(t *testing.T) {
	temp := t.TempDir()
	oldRoot := filepath.Join(temp, "orchestra_workspaces_prev")
	newRoot := filepath.Join(temp, "orchestra_workspaces")

	if err := os.MkdirAll(filepath.Join(oldRoot, "MT-2"), 0o755); err != nil {
		t.Fatalf("mkdir old root: %v", err)
	}

	result, err := ExecuteWorkspaceMigration(oldRoot, newRoot, true)
	if err != nil {
		t.Fatalf("execute migration dry-run: %v", err)
	}
	if result.Applied {
		t.Fatalf("expected dry-run not applied")
	}
	if !exists(oldRoot) {
		t.Fatalf("expected old root unchanged in dry-run")
	}
	if exists(newRoot) {
		t.Fatalf("expected new root not created in dry-run")
	}
}

func TestExecuteWorkspaceMigrationMovesEntriesOnConflictAwarePlan(t *testing.T) {
	temp := t.TempDir()
	oldRoot := filepath.Join(temp, "orchestra_workspaces_prev")
	newRoot := filepath.Join(temp, "orchestra_workspaces")

	if err := os.MkdirAll(oldRoot, 0o755); err != nil {
		t.Fatalf("mkdir old root: %v", err)
	}
	if err := os.MkdirAll(newRoot, 0o755); err != nil {
		t.Fatalf("mkdir new root: %v", err)
	}

	if err := os.MkdirAll(filepath.Join(oldRoot, "MT-3"), 0o755); err != nil {
		t.Fatalf("mkdir old MT-3: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(oldRoot, "MT-4"), 0o755); err != nil {
		t.Fatalf("mkdir old MT-4: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(newRoot, "MT-4"), 0o755); err != nil {
		t.Fatalf("mkdir conflicting new MT-4: %v", err)
	}

	result, err := ExecuteWorkspaceMigration(oldRoot, newRoot, false)
	if err != nil {
		t.Fatalf("execute migration: %v", err)
	}
	if !result.Applied {
		t.Fatalf("expected migration applied")
	}

	if !exists(filepath.Join(newRoot, "MT-3")) {
		t.Fatalf("expected MT-3 moved to new root")
	}
	if !exists(filepath.Join(oldRoot, "MT-4")) {
		t.Fatalf("expected conflicting MT-4 to remain in old root")
	}
}
