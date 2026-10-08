// Package workspace provides workspace lifecycle management including creation,
// removal, hook execution, artifact listing, and git diff retrieval for issue workspaces.
package workspace

import (
	"context"
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/utils/git"
)

// Service manages issue workspaces under a configurable root directory.
type Service struct {
	Root        string
	HookTimeout time.Duration
}

// Hooks defines shell scripts to run at various points in the workspace lifecycle.
type Hooks struct {
	AfterCreate  string
	BeforeRemove string
	BeforeRun    string
	AfterRun     string
}

// RunBeforeRunHook executes the before_run hook script in the given workspace directory.
func (s *Service) RunBeforeRunHook(workspacePath string, hooks Hooks) (HookResult, error) {
	if hooks.BeforeRun == "" {
		return HookResult{}, nil
	}
	return RunHook("before_run", hooks.BeforeRun, workspacePath, s.timeoutOrDefault())
}

// RunAfterRunHook executes the after_run hook script in the given workspace directory.
// Failures are intentionally swallowed so that after-run hooks never block the pipeline.
func (s *Service) RunAfterRunHook(workspacePath string, hooks Hooks) (HookResult, error) {
	if hooks.AfterRun == "" {
		return HookResult{}, nil
	}
	result, _ := RunHook("after_run", hooks.AfterRun, workspacePath, s.timeoutOrDefault())
	return result, nil
}

// ListArtifacts returns relative paths of all files in the workspace for the given issue,
// excluding .git directories and the .orchestra marker file.
func (s *Service) ListArtifacts(issueIdentifier string, provider string) ([]string, error) {
	path, err := WorkspacePath(s.Root, issueIdentifier, provider)
	if err != nil {
		return nil, err
	}

	if !exists(path) {
		return []string{}, nil
	}

	var artifacts []string
	err = filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}

		rel, err := filepath.Rel(path, p)
		if err != nil {
			return err
		}

		if rel == ".orchestra" {
			return nil
		}

		artifacts = append(artifacts, rel)
		return nil
	})

	return artifacts, err
}

// GetArtifactContent reads and returns the content of a file at the given relative path
// within the issue workspace, validating that the path does not escape the workspace root.
func (s *Service) GetArtifactContent(issueIdentifier string, provider string, relPath string) ([]byte, error) {
	root, err := WorkspacePath(s.Root, issueIdentifier, provider)
	if err != nil {
		return nil, err
	}

	fullPath := filepath.Join(root, relPath)
	if err := ValidateWorkspacePath(s.Root, fullPath); err != nil {
		return nil, err
	}

	return os.ReadFile(fullPath)
}

// GetDiff returns the git diff of changes in the workspace for the given issue.
// Returns an empty string if the workspace is not a git repository.
func (s *Service) GetDiff(issueIdentifier string, provider string) (string, error) {
	path, err := WorkspacePath(s.Root, issueIdentifier, provider)
	if err != nil {
		return "", err
	}

	if !exists(path) {
		return "", nil
	}

	// Use git to get the diff of changes (including untracked files)
	// We check if it's a git repo first
	if !exists(filepath.Join(path, ".git")) {
		return "", nil
	}

	cmd := backgroundcommand.Command("git", "diff", "HEAD")
	cmd.Dir = path
	out, err := cmd.CombinedOutput()
	if err != nil {
		// If HEAD doesn't exist yet (new repo), try just git diff
		cmd = backgroundcommand.Command("git", "diff")
		cmd.Dir = path
		out, err = cmd.CombinedOutput()
		if err != nil {
			return "", fmt.Errorf("git diff failed: %w (output: %s)", err, string(out))
		}
	}

	return string(out), nil
}

// WorktreePath returns the deterministic worktree path for a project and branch.
func (s *Service) WorktreePath(projectID, branchName string) string {
	return filepath.Join(s.Root, projectID, branchName)
}

// EnsureWorktree creates or reuses a git worktree for the given project and branch.
// Returns (worktreePath, baseSHA, created, error).
// If the worktree already exists, returns (path, "", false, nil).
// If new, captures base SHA from project repo HEAD before creating.
func (s *Service) EnsureWorktree(projectRoot, projectID, branchName string, hooks Hooks) (string, string, bool, error) {
	wtPath := s.WorktreePath(projectID, branchName)

	// If directory already exists, reuse it but still return the merge-base SHA.
	if info, err := os.Stat(wtPath); err == nil && info.IsDir() {
		baseSHA, _ := git.MergeBase(context.Background(), projectRoot, "HEAD", branchName)
		return wtPath, baseSHA, false, nil
	}

	ctx := context.Background()

	// Capture base SHA before creating the worktree.
	baseSHA, err := git.HeadSHA(ctx, projectRoot)
	if err != nil {
		return "", "", false, fmt.Errorf("capture base SHA: %w", err)
	}

	// Try creating with a new branch first.
	if err := git.WorktreeAdd(ctx, projectRoot, wtPath, branchName, true); err != nil {
		// Branch may already exist — try without -b.
		if err2 := git.WorktreeAdd(ctx, projectRoot, wtPath, branchName, false); err2 != nil {
			return "", "", false, fmt.Errorf("worktree add failed: new-branch: %v; existing-branch: %v", err, err2)
		}
	}

	// Run after_create hook if set (log warning on failure, don't block).
	if hooks.AfterCreate != "" {
		if _, hookErr := RunHook("after_create", hooks.AfterCreate, wtPath, s.timeoutOrDefault()); hookErr != nil {
			fmt.Fprintf(os.Stderr, "WARN: after_create hook failed for %s: %v\n", wtPath, hookErr)
		}
	}

	return wtPath, baseSHA, true, nil
}

// RemoveWorktree removes a git worktree, running the before_remove hook first.
func (s *Service) RemoveWorktree(projectRoot, wtPath string, hooks Hooks) error {
	if !exists(wtPath) {
		return nil
	}

	// Run before_remove hook if set (log warning on failure, don't block).
	if hooks.BeforeRemove != "" {
		if _, hookErr := RunHook("before_remove", hooks.BeforeRemove, wtPath, s.timeoutOrDefault()); hookErr != nil {
			fmt.Fprintf(os.Stderr, "WARN: before_remove hook failed for %s: %v\n", wtPath, hookErr)
		}
	}

	ctx := context.Background()
	return git.WorktreeRemove(ctx, projectRoot, wtPath)
}

// CleanupWorktree removes a worktree directory, prunes stale references, and
// deletes the associated branch (best-effort). Use this when an issue moves to Done.
func (s *Service) CleanupWorktree(projectRoot, projectID, branchName string) error {
	wtPath := s.WorktreePath(projectID, branchName)
	ctx := context.Background()

	// Remove the worktree via git (handles lock files, etc.)
	if err := git.WorktreeRemove(ctx, projectRoot, wtPath); err != nil {
		return fmt.Errorf("remove worktree: %w", err)
	}

	// Prune stale worktree references (best-effort)
	_ = git.WorktreePrune(ctx, projectRoot)

	// Delete the branch (best-effort, may fail if not merged)
	_ = git.DeleteBranch(ctx, projectRoot, branchName)

	return nil
}

// PruneWorktrees cleans up stale worktree references for the given project repo.
func (s *Service) PruneWorktrees(projectRoot string) error {
	ctx := context.Background()
	return git.WorktreePrune(ctx, projectRoot)
}

func (s *Service) timeoutOrDefault() time.Duration {
	if s.HookTimeout <= 0 {
		return 60 * time.Second
	}
	return s.HookTimeout
}
