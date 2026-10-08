package git

import (
	"bytes"
	"context"
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
	"os"
	"path/filepath"
	"strings"
)

// WorktreeAdd creates a git worktree at wtDir for the given branch.
// If newBranch is true, creates a new branch (-b flag).
func WorktreeAdd(ctx context.Context, repoDir, wtDir, branch string, newBranch bool) error {
	args := []string{"worktree", "add"}
	if newBranch {
		args = append(args, "-b", branch, wtDir)
	} else {
		args = append(args, wtDir, branch)
	}

	cmd := backgroundcommand.CommandContext(ctx, "git", args...)
	cmd.Dir = repoDir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git worktree add failed: %v - %s", err, stderr.String())
	}
	return nil
}

// WorktreeRemove removes a git worktree. Uses --force for locked worktrees.
// Returns nil if the worktree doesn't exist.
func WorktreeRemove(ctx context.Context, repoDir, wtDir string) error {
	// If the directory doesn't exist, nothing to do.
	if _, err := os.Stat(wtDir); os.IsNotExist(err) {
		return nil
	}

	cmd := backgroundcommand.CommandContext(ctx, "git", "worktree", "remove", "--force", wtDir)
	cmd.Dir = repoDir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git worktree remove failed: %v - %s", err, stderr.String())
	}
	return nil
}

// WorktreePrune removes stale worktree references.
func WorktreePrune(ctx context.Context, repoDir string) error {
	cmd := backgroundcommand.CommandContext(ctx, "git", "worktree", "prune")
	cmd.Dir = repoDir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git worktree prune failed: %v - %s", err, stderr.String())
	}
	return nil
}

// WorktreeList returns paths of all worktrees for the given repo.
func WorktreeList(ctx context.Context, repoDir string) ([]string, error) {
	cmd := backgroundcommand.CommandContext(ctx, "git", "worktree", "list", "--porcelain")
	cmd.Dir = repoDir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("git worktree list failed: %v - %s", err, stderr.String())
	}

	var paths []string
	for _, line := range strings.Split(stdout.String(), "\n") {
		if strings.HasPrefix(line, "worktree ") {
			paths = append(paths, filepath.Clean(filepath.FromSlash(strings.TrimPrefix(line, "worktree "))))
		}
	}
	return paths, nil
}

// HeadSHA returns the HEAD commit SHA for the given directory.
func HeadSHA(ctx context.Context, dir string) (string, error) {
	cmd := backgroundcommand.CommandContext(ctx, "git", "rev-parse", "HEAD")
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git rev-parse HEAD failed: %v - %s", err, stderr.String())
	}
	return strings.TrimSpace(stdout.String()), nil
}

// BranchDiff returns the three-dot diff between baseSHA and branch.
func BranchDiff(ctx context.Context, repoDir, baseSHA, branch string) (string, error) {
	cmd := backgroundcommand.CommandContext(ctx, "git", "diff", baseSHA+"..."+branch)
	cmd.Dir = repoDir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git diff failed: %v - %s", err, stderr.String())
	}
	return stdout.String(), nil
}

// WorktreeDiff returns all uncommitted changes (staged + unstaged) via "git diff HEAD".
func WorktreeDiff(ctx context.Context, wtDir string) (string, error) {
	cmd := backgroundcommand.CommandContext(ctx, "git", "diff", "HEAD")
	cmd.Dir = wtDir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git diff HEAD failed: %v - %s", err, stderr.String())
	}
	return stdout.String(), nil
}

// MergeBase returns the merge-base (common ancestor) of two refs.
func MergeBase(ctx context.Context, dir, ref1, ref2 string) (string, error) {
	cmd := backgroundcommand.CommandContext(ctx, "git", "merge-base", ref1, ref2)
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git merge-base failed: %v - %s", err, stderr.String())
	}
	return strings.TrimSpace(stdout.String()), nil
}

// IsGitRepo checks whether dir contains a .git directory or file (worktree).
func IsGitRepo(dir string) bool {
	_, err := os.Stat(dir + "/.git")
	return err == nil
}
