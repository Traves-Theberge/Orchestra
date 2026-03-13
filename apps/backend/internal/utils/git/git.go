package git

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// ProjectInfo extracts the top-level repository path and the remote origin URL
func ProjectInfo(ctx context.Context, dir string) (rootPath string, remoteURL string, err error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	// 1. Get Top Level Path
	cmdRoot := exec.CommandContext(ctx, "git", "rev-parse", "--show-toplevel")
	cmdRoot.Dir = dir
	var outRoot, errRoot bytes.Buffer
	cmdRoot.Stdout = &outRoot
	cmdRoot.Stderr = &errRoot

	if err := cmdRoot.Run(); err != nil {
		return "", "", fmt.Errorf("git rev-parse failed (not a git repo?): %v - %s", err, errRoot.String())
	}
	rootPath = strings.TrimSpace(outRoot.String())

	// 2. Get Remote Origin URL
	cmdRemote := exec.CommandContext(ctx, "git", "remote", "get-url", "origin")
	cmdRemote.Dir = rootPath
	var outRemote, errRemote bytes.Buffer
	cmdRemote.Stdout = &outRemote
	cmdRemote.Stderr = &errRemote

	if err := cmdRemote.Run(); err != nil {
		// If origin doesn't exist, we just leave remote_url empty instead of failing
		remoteURL = ""
	} else {
		remoteURL = strings.TrimSpace(outRemote.String())
	}

	return rootPath, remoteURL, nil
}

// CurrentBranch returns the current active branch name
func CurrentBranch(ctx context.Context, dir string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "branch", "--show-current")
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git branch --show-current failed: %v - %s", err, stderr.String())
	}
	return strings.TrimSpace(stdout.String()), nil
}

// Commit creates a new commit with the given message
func Commit(ctx context.Context, dir, message string) error {
	cmd := exec.CommandContext(ctx, "git", "commit", "-am", message)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git commit failed: %v - %s", err, stderr.String())
	}
	return nil
}

// Push pushes the current branch to the given remote
func Push(ctx context.Context, dir, remote, branch string) error {
	cmd := exec.CommandContext(ctx, "git", "push", remote, branch)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git push failed: %v - %s", err, stderr.String())
	}
	return nil
}

// Pull pulls the given branch from the given remote
func Pull(ctx context.Context, dir, remote, branch string) error {
	cmd := exec.CommandContext(ctx, "git", "pull", remote, branch)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git pull failed: %v - %s", err, stderr.String())
	}
	return nil
}

// CreateBranch creates a new branch
func CreateBranch(ctx context.Context, dir, name string) error {
	cmd := exec.CommandContext(ctx, "git", "checkout", "-b", name)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git checkout -b failed: %v - %s", err, stderr.String())
	}
	return nil
}

// ParseGitHubRemote extracts owner and repo from a GitHub URL
func ParseGitHubRemote(remoteURL string) (owner string, repo string, ok bool) {
	if remoteURL == "" {
		return "", "", false
	}

	// Remove .git suffix
	remoteURL = strings.TrimSuffix(remoteURL, ".git")

	// Handing SSH: git@github.com:owner/repo
	if strings.HasPrefix(remoteURL, "git@") {
		parts := strings.Split(remoteURL, ":")
		if len(parts) < 2 {
			return "", "", false
		}
		path := parts[len(parts)-1]
		pathParts := strings.Split(path, "/")
		if len(pathParts) < 2 {
			return "", "", false
		}
		return pathParts[0], pathParts[1], true
	}

	// Handling HTTPS: https://github.com/owner/repo
	if strings.Contains(remoteURL, "github.com/") {
		parts := strings.Split(remoteURL, "github.com/")
		if len(parts) < 2 {
			return "", "", false
		}
		path := parts[1]
		pathParts := strings.Split(path, "/")
		if len(pathParts) < 2 {
			return "", "", false
		}
		return pathParts[0], pathParts[1], true
	}

	return "", "", false
}
