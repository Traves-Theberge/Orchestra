package workspace

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// initTestRepo creates a temp dir with a git repo containing one commit.
func initTestRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, args := range [][]string{
		{"git", "init"},
		{"git", "config", "user.email", "test@test.com"},
		{"git", "config", "user.name", "Test"},
	} {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v failed: %v\n%s", args, err, out)
		}
	}
	// Create a file and commit it
	if err := os.WriteFile(filepath.Join(dir, "README"), []byte("init"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"git", "add", "."},
		{"git", "commit", "-m", "initial"},
	} {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v failed: %v\n%s", args, err, out)
		}
	}
	return dir
}

func TestEnsureWorktree_CreatesNewWorktree(t *testing.T) {
	repo := initTestRepo(t)
	root := t.TempDir()
	svc := Service{Root: root}

	wtPath, baseSHA, created, err := svc.EnsureWorktree(repo, "proj1", "feature-a", Hooks{})
	if err != nil {
		t.Fatalf("EnsureWorktree: %v", err)
	}
	if !created {
		t.Fatal("expected created=true for new worktree")
	}
	if baseSHA == "" {
		t.Fatal("expected non-empty baseSHA")
	}
	if _, err := os.Stat(wtPath); err != nil {
		t.Fatalf("worktree path should exist: %v", err)
	}
	expected := filepath.Join(root, "proj1", "feature-a")
	if wtPath != expected {
		t.Fatalf("expected path %s, got %s", expected, wtPath)
	}
}

func TestEnsureWorktree_ReusesExisting(t *testing.T) {
	repo := initTestRepo(t)
	root := t.TempDir()
	svc := Service{Root: root}

	_, _, created1, err := svc.EnsureWorktree(repo, "proj1", "feature-b", Hooks{})
	if err != nil {
		t.Fatalf("first EnsureWorktree: %v", err)
	}
	if !created1 {
		t.Fatal("expected first call to create")
	}

	wtPath2, baseSHA2, created2, err := svc.EnsureWorktree(repo, "proj1", "feature-b", Hooks{})
	if err != nil {
		t.Fatalf("second EnsureWorktree: %v", err)
	}
	if created2 {
		t.Fatal("expected second call to reuse, got created=true")
	}
	if baseSHA2 == "" {
		t.Fatal("expected merge-base SHA on reuse")
	}
	expected := filepath.Join(root, "proj1", "feature-b")
	if wtPath2 != expected {
		t.Fatalf("expected path %s, got %s", expected, wtPath2)
	}
}

func TestRemoveWorktree(t *testing.T) {
	repo := initTestRepo(t)
	root := t.TempDir()
	svc := Service{Root: root}

	wtPath, _, _, err := svc.EnsureWorktree(repo, "proj1", "feature-rm", Hooks{})
	if err != nil {
		t.Fatalf("EnsureWorktree: %v", err)
	}

	if err := svc.RemoveWorktree(repo, wtPath, Hooks{}); err != nil {
		t.Fatalf("RemoveWorktree: %v", err)
	}

	if _, err := os.Stat(wtPath); !os.IsNotExist(err) {
		t.Fatalf("expected worktree removed, stat err=%v", err)
	}
}

func TestWorktreePath(t *testing.T) {
	svc := Service{Root: "/tmp/worktrees"}
	got := svc.WorktreePath("myproject", "fix-123")
	want := filepath.Join("/tmp/worktrees", "myproject", "fix-123")
	if got != want {
		t.Fatalf("WorktreePath = %q, want %q", got, want)
	}
}

func TestRunBeforeRunHookReturnsErrorOnFailure(t *testing.T) {
	root := t.TempDir()
	service := Service{Root: root, HookTimeout: 2 * time.Second}

	workspacePath := filepath.Join(root, "ws-501")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("create workspace dir: %v", err)
	}

	_, err := service.RunBeforeRunHook(workspacePath, Hooks{BeforeRun: "exit 23"})
	if err == nil {
		t.Fatalf("expected before_run hook error")
	}
}

func TestRunAfterRunHookIgnoresFailureButRunsHook(t *testing.T) {
	root := t.TempDir()
	service := Service{Root: root, HookTimeout: 2 * time.Second}

	workspacePath := filepath.Join(root, "ws-601")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("create workspace dir: %v", err)
	}

	marker := filepath.Join(root, "after-run.txt")
	_, err := service.RunAfterRunHook(workspacePath, Hooks{AfterRun: "echo ran > \"" + marker + "\"; exit 17"})
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
