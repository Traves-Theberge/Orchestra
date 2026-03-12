package workspace

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestEnsureIssueWorkspaceCreatesAndRunsAfterCreateOnce(t *testing.T) {
	root := t.TempDir()
	service := Service{Root: root, HookTimeout: 2 * time.Second}

	workspacePath, created, err := service.EnsureIssueWorkspace("MT-101", "codex", Hooks{AfterCreate: "echo hello > created.txt"})
	if err != nil {
		t.Fatalf("expected workspace creation success, got err=%v", err)
	}
	if !created {
		t.Fatalf("expected first ensure to create workspace")
	}

	content, err := os.ReadFile(filepath.Join(workspacePath, "created.txt"))
	if err != nil {
		t.Fatalf("expected hook output file: %v", err)
	}
	if string(content) != "hello\n" {
		t.Fatalf("unexpected hook output: %q", string(content))
	}

	if _, secondCreated, err := service.EnsureIssueWorkspace("MT-101", "codex", Hooks{AfterCreate: "echo nope > created.txt"}); err != nil {
		t.Fatalf("expected second ensure success, got err=%v", err)
	} else if secondCreated {
		t.Fatalf("expected second ensure not to recreate workspace")
	}

	content, err = os.ReadFile(filepath.Join(workspacePath, "created.txt"))
	if err != nil {
		t.Fatalf("expected hook output file on second check: %v", err)
	}
	if string(content) != "hello\n" {
		t.Fatalf("expected original hook output to remain, got=%q", string(content))
	}
}

func TestEnsureIssueWorkspaceReplacesStaleFilePath(t *testing.T) {
	root := t.TempDir()
	service := Service{Root: root}

	stalePath, err := WorkspacePath(root, "MT-201", "codex")
	if err != nil {
		t.Fatalf("expected workspace path, got err=%v", err)
	}

	if err := os.WriteFile(stalePath, []byte("stale"), 0o644); err != nil {
		t.Fatalf("write stale file: %v", err)
	}

	workspacePath, created, err := service.EnsureIssueWorkspace("MT-201", "codex", Hooks{})
	if err != nil {
		t.Fatalf("ensure workspace: %v", err)
	}
	if !created {
		t.Fatalf("expected stale file replacement to count as created")
	}
	if workspacePath != stalePath {
		t.Fatalf("expected same path reused, got=%s want=%s", workspacePath, stalePath)
	}

	info, err := os.Stat(workspacePath)
	if err != nil {
		t.Fatalf("stat workspace: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("expected workspace to be directory")
	}
}

func TestRemoveIssueWorkspacesContinuesWhenBeforeRemoveFails(t *testing.T) {
	root := t.TempDir()
	service := Service{Root: root, HookTimeout: 2 * time.Second}

	workspacePath, _, err := service.EnsureIssueWorkspace("MT-301", "codex", Hooks{})
	if err != nil {
		t.Fatalf("ensure workspace: %v", err)
	}

	err = service.RemoveIssueWorkspaces("MT-301", "codex", Hooks{BeforeRemove: "echo fail && exit 17"})
	if err != nil {
		t.Fatalf("expected remove workspace success despite hook failure, got err=%v", err)
	}

	if _, statErr := os.Stat(workspacePath); !os.IsNotExist(statErr) {
		t.Fatalf("expected workspace removed, statErr=%v", statErr)
	}
}

func TestRemoveIssueWorkspacesRunsBeforeRemoveHook(t *testing.T) {
	root := t.TempDir()
	service := Service{Root: root, HookTimeout: 2 * time.Second}

	workspacePath, _, err := service.EnsureIssueWorkspace("MT-401", "codex", Hooks{})
	if err != nil {
		t.Fatalf("ensure workspace: %v", err)
	}

	marker := filepath.Join(root, "before-remove.txt")
	script := "echo ran > \"" + marker + "\""
	err = service.RemoveIssueWorkspaces("MT-401", "codex", Hooks{BeforeRemove: script})
	if err != nil {
		t.Fatalf("expected remove workspace success, got err=%v", err)
	}

	if _, statErr := os.Stat(workspacePath); !os.IsNotExist(statErr) {
		t.Fatalf("expected workspace removed, statErr=%v", statErr)
	}

	content, readErr := os.ReadFile(marker)
	if readErr != nil {
		t.Fatalf("expected marker file from before_remove hook: %v", readErr)
	}
	if string(content) != "ran\n" {
		t.Fatalf("unexpected marker content: %q", string(content))
	}
}

func TestRunBeforeRunHookReturnsErrorOnFailure(t *testing.T) {
	root := t.TempDir()
	service := Service{Root: root, HookTimeout: 2 * time.Second}

	workspacePath, _, err := service.EnsureIssueWorkspace("MT-501", "codex", Hooks{})
	if err != nil {
		t.Fatalf("ensure workspace: %v", err)
	}

	err = service.RunBeforeRunHook(workspacePath, Hooks{BeforeRun: "exit 23"})
	if err == nil {
		t.Fatalf("expected before_run hook error")
	}
}

func TestRunAfterRunHookIgnoresFailureButRunsHook(t *testing.T) {
	root := t.TempDir()
	service := Service{Root: root, HookTimeout: 2 * time.Second}

	workspacePath, _, err := service.EnsureIssueWorkspace("MT-601", "codex", Hooks{})
	if err != nil {
		t.Fatalf("ensure workspace: %v", err)
	}

	marker := filepath.Join(root, "after-run.txt")
	err = service.RunAfterRunHook(workspacePath, Hooks{AfterRun: "echo ran > \"" + marker + "\"; exit 17"})
	if err != nil {
		t.Fatalf("expected after_run hook failure to be ignored, got err=%v", err)
	}

	content, readErr := os.ReadFile(marker)
	if readErr != nil {
		t.Fatalf("expected marker file from after_run hook: %v", readErr)
	}
	if string(content) != "ran\n" {
		t.Fatalf("unexpected marker content: %q", string(content))
	}
}

func TestRemoveIssueWorkspacesNoopForEmptyIdentifier(t *testing.T) {
	service := Service{Root: t.TempDir(), HookTimeout: 2 * time.Second}
	if err := service.RemoveIssueWorkspaces("", "codex", Hooks{BeforeRemove: "exit 1"}); err != nil {
		t.Fatalf("expected empty identifier remove to be no-op, got err=%v", err)
	}
}

func TestRemoveIssueWorkspacesNoopWhenWorkspaceMissing(t *testing.T) {
	root := t.TempDir()
	service := Service{Root: root, HookTimeout: 2 * time.Second}

	marker := filepath.Join(root, "before-remove-should-not-run.txt")
	err := service.RemoveIssueWorkspaces("MT-999", "codex", Hooks{BeforeRemove: "echo ran > \"" + marker + "\""})
	if err != nil {
		t.Fatalf("expected missing workspace remove to be no-op, got err=%v", err)
	}
	if _, statErr := os.Stat(marker); !os.IsNotExist(statErr) {
		t.Fatalf("expected before_remove hook not to run for missing workspace, statErr=%v", statErr)
	}
}
