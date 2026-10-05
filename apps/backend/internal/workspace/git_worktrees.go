package workspace

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type GitWorktree struct {
	Path     string `json:"path"`
	Head     string `json:"head"`
	Branch   string `json:"branch"`
	Detached bool   `json:"detached"`
	Locked   bool   `json:"locked"`
	Prunable bool   `json:"prunable"`
	Primary  bool   `json:"primary"`
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
	result := []GitWorktree{}
	for _, row := range ParseGitWorktrees(string(output)) {
		if ValidateProjectPath(row.Path, allowedRoots) != nil {
			continue
		}
		row.Primary = filepath.Clean(row.Path) == filepath.Clean(projectRoot)
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
			case field == "prunable" || strings.HasPrefix(field, "prunable "):
				current.Prunable = true
			}
		}
	}
	return result
}
