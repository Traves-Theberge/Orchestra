package studio

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// ScratchWorktree is an ephemeral, read-only git worktree used to host a
// studio session. The agent can read repo contents but cannot modify them.
type ScratchWorktree struct {
	RepoPath string
	Path     string
}

// CreateReadOnlyWorktree adds a detached worktree of the given repo into a
// fresh temp directory and sets all tracked files to read-only.
func CreateReadOnlyWorktree(repoPath string) (*ScratchWorktree, error) {
	tmp, err := os.MkdirTemp("", "orchestra-studio-*")
	if err != nil {
		return nil, fmt.Errorf("mkdir tmp: %w", err)
	}
	wtPath := filepath.Join(tmp, "wt")
	cmd := exec.Command("git", "worktree", "add", "--detach", wtPath)
	cmd.Dir = repoPath
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = os.RemoveAll(tmp)
		return nil, fmt.Errorf("git worktree add: %w: %s", err, string(out))
	}
	if err := setReadOnly(wtPath); err != nil {
		_ = exec.Command("git", "-C", repoPath, "worktree", "remove", "--force", wtPath).Run()
		_ = os.RemoveAll(tmp)
		return nil, err
	}
	return &ScratchWorktree{RepoPath: repoPath, Path: wtPath}, nil
}

// Cleanup restores write permissions, removes the worktree from git's registry,
// and deletes the temp directory.
func (w *ScratchWorktree) Cleanup() error {
	_ = filepath.Walk(w.Path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			_ = os.Chmod(path, 0755)
		} else {
			_ = os.Chmod(path, 0644)
		}
		return nil
	})
	out, err := exec.Command("git", "-C", w.RepoPath, "worktree", "remove", "--force", w.Path).CombinedOutput()
	if err != nil {
		return fmt.Errorf("worktree remove: %w: %s", err, string(out))
	}
	return os.RemoveAll(filepath.Dir(w.Path))
}

// setReadOnly walks the worktree and applies 0444 to files / 0555 to dirs,
// skipping any .git directory so git operations on the worktree still function.
func setReadOnly(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Skip broken symlinks and other inaccessible paths.
			return nil
		}
		if info.IsDir() && filepath.Base(path) == ".git" {
			return filepath.SkipDir
		}
		// Symlink permissions cannot be changed on Linux; os.Chmod follows the
		// link and returns ENOENT for broken symlinks. Skip them entirely.
		if info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		if info.IsDir() {
			return os.Chmod(path, 0555)
		}
		return os.Chmod(path, 0444)
	})
}
