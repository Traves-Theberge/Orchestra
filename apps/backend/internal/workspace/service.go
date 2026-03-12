package workspace

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type Service struct {
	Root        string
	HookTimeout time.Duration
}

type Hooks struct {
	AfterCreate  string
	BeforeRemove string
	BeforeRun    string
	AfterRun     string
}

func (s Service) EnsureIssueWorkspace(issueIdentifier string, provider string, hooks Hooks) (string, bool, HookResult, error) {
	path, err := WorkspacePath(s.Root, issueIdentifier, provider)
	if err != nil {
		return "", false, HookResult{}, err
	}

	if err := os.MkdirAll(s.Root, 0o755); err != nil {
		return "", false, HookResult{}, fmt.Errorf("create workspace root: %w", err)
	}

	created := false
	info, statErr := os.Lstat(path)
	switch {
	case statErr == nil && info.IsDir():
		if err := ValidateWorkspacePath(s.Root, path); err != nil {
			return "", false, HookResult{}, err
		}
	case statErr == nil && !info.IsDir():
		if err := os.Remove(path); err != nil {
			return "", false, HookResult{}, fmt.Errorf("remove stale workspace path: %w", err)
		}
		if err := os.MkdirAll(path, 0o755); err != nil {
			return "", false, HookResult{}, fmt.Errorf("create workspace directory: %w", err)
		}
		created = true
	case statErr != nil:
		if !isNotExist(statErr) {
			return "", false, HookResult{}, fmt.Errorf("inspect workspace path: %w", statErr)
		}
		if err := os.MkdirAll(path, 0o755); err != nil {
			return "", false, HookResult{}, fmt.Errorf("create workspace directory: %w", err)
		}
		created = true
	}

	if created && hooks.AfterCreate != "" {
		res, err := RunHook("after_create", hooks.AfterCreate, path, s.timeoutOrDefault())
		return path, created, res, err
	}

	return path, created, HookResult{}, nil
}

func (s Service) RemoveIssueWorkspaces(issueIdentifier string, provider string, hooks Hooks) error {
	if issueIdentifier == "" {
		return nil
	}

	path, err := WorkspacePath(s.Root, issueIdentifier, provider)
	if err != nil {
		return err
	}

	if !exists(path) {
		return nil
	}

	if hooks.BeforeRemove != "" {
		_, _ = RunHook("before_remove", hooks.BeforeRemove, path, s.timeoutOrDefault())
	}

	if err := ValidateWorkspacePath(s.Root, path); err != nil {
		return err
	}

	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("remove workspace: %w", err)
	}

	return nil
}

func (s Service) RunBeforeRunHook(workspacePath string, hooks Hooks) (HookResult, error) {
	if hooks.BeforeRun == "" {
		return HookResult{}, nil
	}
	return RunHook("before_run", hooks.BeforeRun, workspacePath, s.timeoutOrDefault())
}

func (s Service) RunAfterRunHook(workspacePath string, hooks Hooks) (HookResult, error) {
	if hooks.AfterRun == "" {
		return HookResult{}, nil
	}
	res, _ := RunHook("after_run", hooks.AfterRun, workspacePath, s.timeoutOrDefault())
	return res, nil
}

func (s Service) ListArtifacts(issueIdentifier string, provider string) ([]string, error) {
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

func (s Service) GetArtifactContent(issueIdentifier string, provider string, relPath string) ([]byte, error) {
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

func (s Service) GetDiff(issueIdentifier string, provider string) (string, error) {
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

	cmd := exec.Command("git", "diff", "HEAD")
	cmd.Dir = path
	out, err := cmd.CombinedOutput()
	if err != nil {
		// If HEAD doesn't exist yet (new repo), try just git diff
		cmd = exec.Command("git", "diff")
		cmd.Dir = path
		out, err = cmd.CombinedOutput()
		if err != nil {
			return "", fmt.Errorf("git diff failed: %w (output: %s)", err, string(out))
		}
	}

	return string(out), nil
}

func (s Service) timeoutOrDefault() time.Duration {
	if s.HookTimeout <= 0 {
		return 60 * time.Second
	}
	return s.HookTimeout
}

func isNotExist(err error) bool {
	return err != nil && (os.IsNotExist(err) || isPathErrorNotExist(err))
}

func isPathErrorNotExist(err error) bool {
	var pathErr *fs.PathError
	if errors.As(err, &pathErr) {
		return os.IsNotExist(pathErr.Err)
	}
	return false
}

func MarkerPath(path string) string {
	return filepath.Join(path, ".orchestra")
}
