package workspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type GitWorktree struct {
	ID             string `json:"id"`
	Path           string `json:"path"`
	Head           string `json:"head"`
	Branch         string `json:"branch"`
	Detached       bool   `json:"detached"`
	Locked         bool   `json:"locked"`
	LockReason     string `json:"lock_reason,omitempty"`
	Prunable       bool   `json:"prunable"`
	Primary        bool   `json:"primary"`
	IsMainWorktree bool   `json:"is_main_worktree"`
}

// IDForGitWorktree scopes a canonical path to its registered project. It does
// not change when the branch or HEAD changes, and survives process updates.
func IDForGitWorktree(projectID, canonicalPath string) string {
	path := filepath.Clean(canonicalPath)
	if runtime.GOOS == "windows" {
		path = strings.ToLower(path)
	}
	digest := sha256.Sum256([]byte(projectID + "\x00" + path))
	return "wt_" + hex.EncodeToString(digest[:16])
}

func ListProjectGitWorktrees(ctx context.Context, projectID, projectRoot string, allowedRoots []string) ([]GitWorktree, error) {
	rows, err := ListGitWorktrees(ctx, projectRoot, allowedRoots)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].ID = IDForGitWorktree(projectID, rows[i].Path)
	}
	return rows, nil
}

// ResolveGitWorktree never guesses a branch directory or falls back to the
// registered checkout when an explicit workspace identity no longer exists.
func ResolveGitWorktree(ctx context.Context, projectID, registeredRoot, workspaceID string, allowedRoots []string) (GitWorktree, error) {
	rows, err := ListProjectGitWorktrees(ctx, projectID, registeredRoot, allowedRoots)
	if err != nil {
		return GitWorktree{}, err
	}
	for _, row := range rows {
		if (workspaceID == "" && row.Primary) || (workspaceID != "" && row.ID == workspaceID) {
			if row.Prunable {
				return GitWorktree{}, fmt.Errorf("selected Git worktree is prunable")
			}
			info, err := os.Stat(row.Path)
			if err != nil || !info.IsDir() {
				return GitWorktree{}, fmt.Errorf("selected Git worktree directory is unavailable")
			}
			return row, nil
		}
	}
	return GitWorktree{}, fmt.Errorf("selected Git worktree is stale, unauthorized, or belongs to another project")
}

// ListGitWorktrees observes actual Git registry rows, never guessed task paths.
// The selected registered checkout is the primary context, even when linked.
func ListGitWorktrees(ctx context.Context, projectRoot string, allowedRoots []string) ([]GitWorktree, error) {
	if err := ValidateProjectPath(projectRoot, allowedRoots); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "git", "worktree", "list", "--porcelain", "-z")
	command.Dir = projectRoot
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("read Git worktree registry: %w", err)
	}
	registered, err := filepath.EvalSymlinks(projectRoot)
	if err != nil {
		return nil, err
	}
	result := []GitWorktree{}
	for index, row := range ParseGitWorktrees(string(output)) {
		if ValidateProjectPath(row.Path, allowedRoots) != nil {
			continue
		}
		canonical, err := filepath.EvalSymlinks(row.Path)
		if err != nil {
			continue
		}
		row.Path = filepath.Clean(canonical)
		row.Primary = IDForGitWorktree("", row.Path) == IDForGitWorktree("", registered)
		row.IsMainWorktree = index == 0
		result = append(result, row)
	}
	return result, nil
}

func ParseGitWorktrees(output string) []GitWorktree {
	result := []GitWorktree{}
	var current *GitWorktree
	for _, field := range strings.Split(output, "\x00") {
		if strings.HasPrefix(field, "worktree ") {
			result = append(result, GitWorktree{Path: strings.TrimPrefix(field, "worktree ")})
			current = &result[len(result)-1]
		} else if current != nil {
			switch {
			case strings.HasPrefix(field, "HEAD "):
				current.Head = strings.TrimPrefix(field, "HEAD ")
			case strings.HasPrefix(field, "branch "):
				current.Branch = strings.TrimPrefix(strings.TrimPrefix(field, "branch "), "refs/heads/")
			case field == "detached":
				current.Detached = true
			case field == "locked" || strings.HasPrefix(field, "locked "):
				current.Locked = true
				current.LockReason = strings.TrimPrefix(field, "locked ")
			case field == "prunable" || strings.HasPrefix(field, "prunable "):
				current.Prunable = true
			}
		}
	}
	return result
}
