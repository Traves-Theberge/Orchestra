package workspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestListGitWorktreesKeepsRegisteredLinkedCheckoutPrimaryAndFiltersRoots(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_TERMINAL_PROMPT", "0")
	root := t.TempDir()
	repository := filepath.Join(root, "repo")
	linked := filepath.Join(root, "linked checkout")
	run := func(args ...string) {
		t.Helper()
		if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s %v", args, out, err)
		}
	}
	run("-c", "init.defaultBranch=main", "init", repository)
	run("-C", repository, "config", "user.name", "Worktree Fixture")
	run("-C", repository, "config", "user.email", "fixture@example.invalid")
	if err := os.WriteFile(filepath.Join(repository, "tracked.txt"), []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	run("-C", repository, "add", "tracked.txt")
	run("-C", repository, "commit", "-m", "fixture")
	run("-C", repository, "worktree", "add", "-b", "linked-task", linked)
	rows, err := ListGitWorktrees(context.Background(), linked, []string{root})
	if err != nil || len(rows) != 2 {
		t.Fatalf("registry %+v %v", rows, err)
	}
	for _, row := range rows {
		if row.IsMainWorktree != (filepath.Clean(row.Path) == filepath.Clean(repository)) {
			t.Fatalf("wrong Git main badge %+v", row)
		}
		if row.Primary != (filepath.Clean(row.Path) == filepath.Clean(linked)) {
			t.Fatalf("wrong registered primary %+v", row)
		}
		if row.Head == "" {
			t.Fatalf("missing observed HEAD %+v", row)
		}
	}
	observed, err := ListProjectGitWorktrees(context.Background(), "owner", linked, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range observed {
		resolved, err := ResolveGitWorktree(context.Background(), "owner", linked, row.ID, []string{root})
		if err != nil || resolved.Path != row.Path || resolved.ID == "" {
			t.Fatalf("exact scope %+v %v", resolved, err)
		}
		if _, err := ResolveGitWorktree(context.Background(), "other", linked, row.ID, []string{root}); err == nil {
			t.Fatal("cross-project identity accepted")
		}
	}
	defaultRow, err := ResolveGitWorktree(context.Background(), "owner", linked, "", []string{root})
	if err != nil || !defaultRow.Primary || defaultRow.IsMainWorktree {
		t.Fatalf("default should remain registered linked checkout %+v %v", defaultRow, err)
	}
	if _, err := ResolveGitWorktree(context.Background(), "owner", repository, IDForGitWorktree("owner", linked), []string{repository}); err == nil {
		t.Fatal("unauthorized selected worktree accepted")
	}
	filtered, err := ListGitWorktrees(context.Background(), repository, []string{repository})
	if err != nil || len(filtered) != 1 || !filtered[0].Primary {
		t.Fatalf("allowed registry %+v %v", filtered, err)
	}
	if _, err := ListGitWorktrees(context.Background(), linked, []string{repository}); err == nil {
		t.Fatal("unauthorized registered root accepted")
	}
}
