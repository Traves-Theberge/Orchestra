package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// initTestRepo creates a new git repo in a temp dir with one initial commit.
func initTestRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	cmds := [][]string{
		{"git", "init"},
		{"git", "config", "user.email", "test@test.com"},
		{"git", "config", "user.name", "Test"},
	}
	for _, args := range cmds {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v failed: %v\n%s", args, err, out)
		}
	}

	// Create a file and commit it
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# test\n"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"git", "add", "-A"},
		{"git", "commit", "-m", "initial commit"},
	} {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v failed: %v\n%s", args, err, out)
		}
	}

	return dir
}

func TestWorktreeAdd_NewBranch(t *testing.T) {
	repo := initTestRepo(t)
	ctx := context.Background()

	wtDir := filepath.Join(t.TempDir(), "wt-new")
	if err := WorktreeAdd(ctx, repo, wtDir, "feature-1", true); err != nil {
		t.Fatalf("WorktreeAdd (new branch) failed: %v", err)
	}

	// Verify worktree directory exists and has files
	if _, err := os.Stat(filepath.Join(wtDir, "README.md")); err != nil {
		t.Fatalf("expected README.md in worktree: %v", err)
	}
	if _, err := os.Stat(filepath.Join(wtDir, ".git")); err != nil {
		t.Fatalf("expected .git in worktree: %v", err)
	}
}

func TestWorktreeAdd_ExistingBranch(t *testing.T) {
	repo := initTestRepo(t)
	ctx := context.Background()

	// Create a branch in the repo
	cmd := exec.Command("git", "branch", "existing-branch")
	cmd.Dir = repo
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git branch failed: %v\n%s", err, out)
	}

	wtDir := filepath.Join(t.TempDir(), "wt-existing")
	if err := WorktreeAdd(ctx, repo, wtDir, "existing-branch", false); err != nil {
		t.Fatalf("WorktreeAdd (existing branch) failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(wtDir, "README.md")); err != nil {
		t.Fatalf("expected README.md in worktree: %v", err)
	}
}

func TestWorktreeRemove(t *testing.T) {
	repo := initTestRepo(t)
	ctx := context.Background()

	wtDir := filepath.Join(t.TempDir(), "wt-remove")
	if err := WorktreeAdd(ctx, repo, wtDir, "remove-branch", true); err != nil {
		t.Fatal(err)
	}

	if err := WorktreeRemove(ctx, repo, wtDir); err != nil {
		t.Fatalf("WorktreeRemove failed: %v", err)
	}

	if _, err := os.Stat(wtDir); !os.IsNotExist(err) {
		t.Fatalf("expected worktree dir to be gone, got err: %v", err)
	}
}

func TestWorktreeRemove_NonExistent(t *testing.T) {
	repo := initTestRepo(t)
	ctx := context.Background()

	err := WorktreeRemove(ctx, repo, filepath.Join(t.TempDir(), "does-not-exist"))
	if err != nil {
		t.Fatalf("expected nil error for non-existent worktree, got: %v", err)
	}
}

func TestWorktreePrune(t *testing.T) {
	repo := initTestRepo(t)
	ctx := context.Background()

	if err := WorktreePrune(ctx, repo); err != nil {
		t.Fatalf("WorktreePrune failed: %v", err)
	}
}

func TestWorktreeList(t *testing.T) {
	repo := initTestRepo(t)
	ctx := context.Background()

	wt1 := filepath.Join(t.TempDir(), "wt-list-1")
	wt2 := filepath.Join(t.TempDir(), "wt-list-2")

	if err := WorktreeAdd(ctx, repo, wt1, "list-branch-1", true); err != nil {
		t.Fatal(err)
	}
	if err := WorktreeAdd(ctx, repo, wt2, "list-branch-2", true); err != nil {
		t.Fatal(err)
	}

	paths, err := WorktreeList(ctx, repo)
	if err != nil {
		t.Fatalf("WorktreeList failed: %v", err)
	}

	// Should contain at least the main repo + 2 worktrees
	if len(paths) < 3 {
		t.Fatalf("expected at least 3 worktree paths, got %d: %v", len(paths), paths)
	}

	found1, found2 := false, false
	wt1, err = filepath.EvalSymlinks(wt1)
	if err != nil {
		t.Fatal(err)
	}
	wt2, err = filepath.EvalSymlinks(wt2)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range paths {
		if p == wt1 {
			found1 = true
		}
		if p == wt2 {
			found2 = true
		}
	}
	if !found1 || !found2 {
		t.Fatalf("expected both worktree paths in list; got %v", paths)
	}
}

func TestHeadSHA(t *testing.T) {
	repo := initTestRepo(t)
	ctx := context.Background()

	sha, err := HeadSHA(ctx, repo)
	if err != nil {
		t.Fatalf("HeadSHA failed: %v", err)
	}

	matched, _ := regexp.MatchString(`^[0-9a-f]{40}$`, sha)
	if !matched {
		t.Fatalf("expected 40-char hex SHA, got: %q", sha)
	}
}

func TestBranchDiff_OnlyShowsBranchChanges(t *testing.T) {
	repo := initTestRepo(t)
	ctx := context.Background()

	// Record the base SHA
	baseSHA, err := HeadSHA(ctx, repo)
	if err != nil {
		t.Fatal(err)
	}

	// Create a worktree with a new branch
	wtDir := filepath.Join(t.TempDir(), "wt-diff")
	if err := WorktreeAdd(ctx, repo, wtDir, "diff-branch", true); err != nil {
		t.Fatal(err)
	}

	// Commit a change on the branch (in worktree)
	if err := os.WriteFile(filepath.Join(wtDir, "branch-file.txt"), []byte("branch change\n"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"git", "add", "-A"},
		{"git", "commit", "-m", "branch commit"},
	} {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = wtDir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@test.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@test.com")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v failed: %v\n%s", args, err, out)
		}
	}

	// Commit a DIFFERENT change on main
	if err := os.WriteFile(filepath.Join(repo, "main-file.txt"), []byte("main change\n"), 0644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"git", "add", "-A"},
		{"git", "commit", "-m", "main commit"},
	} {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v failed: %v\n%s", args, err, out)
		}
	}

	diff, err := BranchDiff(ctx, repo, baseSHA, "diff-branch")
	if err != nil {
		t.Fatalf("BranchDiff failed: %v", err)
	}

	if !strings.Contains(diff, "branch-file.txt") {
		t.Fatalf("expected diff to contain branch-file.txt, got:\n%s", diff)
	}
	if strings.Contains(diff, "main-file.txt") {
		t.Fatalf("expected diff NOT to contain main-file.txt, got:\n%s", diff)
	}
}

func TestWorktreeDiff_UncommittedChanges(t *testing.T) {
	repo := initTestRepo(t)
	ctx := context.Background()

	wtDir := filepath.Join(t.TempDir(), "wt-uncommitted")
	if err := WorktreeAdd(ctx, repo, wtDir, "uncommitted-branch", true); err != nil {
		t.Fatal(err)
	}

	// Add an uncommitted tracked file (must be staged for diff HEAD to see it)
	if err := os.WriteFile(filepath.Join(wtDir, "new-file.txt"), []byte("uncommitted\n"), 0644); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("git", "add", "new-file.txt")
	cmd.Dir = wtDir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git add failed: %v\n%s", err, out)
	}

	diff, err := WorktreeDiff(ctx, wtDir)
	if err != nil {
		t.Fatalf("WorktreeDiff failed: %v", err)
	}

	if !strings.Contains(diff, "new-file.txt") {
		t.Fatalf("expected diff to contain new-file.txt, got:\n%s", diff)
	}
}

func TestIsGitRepo(t *testing.T) {
	repo := initTestRepo(t)

	if !IsGitRepo(repo) {
		t.Fatal("expected IsGitRepo to return true for a git repo")
	}

	tmpDir := t.TempDir()
	if IsGitRepo(tmpDir) {
		t.Fatal("expected IsGitRepo to return false for a non-repo dir")
	}
}
