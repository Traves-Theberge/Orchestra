// Package git provides helper functions for common git operations including
// branching, committing, pushing, pulling, and remote URL parsing.
package git

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// ProjectInfo extracts the top-level repository path and the remote origin URL
// for the git repository containing the given directory.
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

// CurrentBranch returns the name of the currently checked-out branch in the given directory.
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

// Commit stages all changes (git add -A) and creates a new commit with the given message.
func Commit(ctx context.Context, dir, message string) error {
	// Stage all changes first
	addCmd := exec.CommandContext(ctx, "git", "add", "-A")
	addCmd.Dir = dir
	if err := addCmd.Run(); err != nil {
		return fmt.Errorf("git add failed: %v", err)
	}
	cmd := exec.CommandContext(ctx, "git", "commit", "-m", message)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git commit failed: %v - %s", err, stderr.String())
	}
	return nil
}

// Push pushes the specified branch to the given remote.
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

// Pull fetches and merges the specified branch from the given remote.
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

// Fetch retrieves objects and refs from all remotes, pruning deleted remote branches.
func Fetch(ctx context.Context, dir string) error {
	cmd := exec.CommandContext(ctx, "git", "fetch", "--all", "--prune")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git fetch: %s: %w", string(out), err)
	}
	return nil
}

// CreateBranch creates and checks out a new branch with the given name.
func CreateBranch(ctx context.Context, dir, name string) error {
	return CreateBranchFrom(ctx, dir, name, "")
}

// CreateBranchFrom creates and checks out a branch in one operation, so a
// rejected start point does not first switch the user's working directory.
func CreateBranchFrom(ctx context.Context, dir, name, startPoint string) error {
	if strings.HasPrefix(name, "-") || strings.HasPrefix(startPoint, "-") {
		return fmt.Errorf("branch name and start point must not start with an option")
	}
	args := []string{"checkout", "-b", name}
	if startPoint != "" {
		args = append(args, startPoint)
	}
	args = append(args, "--")
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git checkout -b failed: %v - %s", err, stderr.String())
	}
	return nil
}

// Checkout switches the working tree to the specified branch.
func Checkout(ctx context.Context, dir, branch string) error {
	cmd := exec.CommandContext(ctx, "git", "checkout", branch)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git checkout failed: %v - %s", err, stderr.String())
	}
	return nil
}

// DeleteBranch deletes the specified local branch. Uses -D (force) to handle
// branches with unmerged changes — the branch manager UI already confirms with the user.
func DeleteBranch(ctx context.Context, dir, name string) error {
	cmd := exec.CommandContext(ctx, "git", "branch", "-D", name)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git branch -D failed: %v - %s", err, stderr.String())
	}
	return nil
}

// Stage adds the specified files to the git index.
func Stage(ctx context.Context, dir string, files []string) error {
	args := append([]string{"add"}, files...)
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git add failed: %v - %s", err, stderr.String())
	}
	return nil
}

// Unstage removes the specified files from the git index without discarding changes.
func Unstage(ctx context.Context, dir string, files []string) error {
	args := append([]string{"reset", "HEAD", "--"}, files...)
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git reset HEAD failed: %v - %s", err, stderr.String())
	}
	return nil
}

// Stash saves uncommitted changes to the stash stack.
func Stash(ctx context.Context, dir string) error {
	cmd := exec.CommandContext(ctx, "git", "stash")
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git stash failed: %v - %s", err, stderr.String())
	}
	return nil
}

// StashPop applies and removes the most recent stash entry.
func StashPop(ctx context.Context, dir string) error {
	cmd := exec.CommandContext(ctx, "git", "stash", "pop")
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git stash pop failed: %v - %s", err, stderr.String())
	}
	return nil
}

// StashList returns a list of stash entries with ref and message fields.
func StashList(ctx context.Context, dir string) ([]map[string]string, error) {
	cmd := exec.CommandContext(ctx, "git", "stash", "list", "--format=%gd|%s")
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("git stash list failed: %v - %s", err, stderr.String())
	}
	var result []map[string]string
	for _, line := range strings.Split(strings.TrimSpace(stdout.String()), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 2)
		entry := map[string]string{"ref": parts[0]}
		if len(parts) > 1 {
			entry["message"] = parts[1]
		} else {
			entry["message"] = ""
		}
		result = append(result, entry)
	}
	return result, nil
}

// StashApply applies the specified stash entry without removing it.
func StashApply(ctx context.Context, dir, ref string) error {
	cmd := exec.CommandContext(ctx, "git", "stash", "apply", ref)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git stash apply failed: %v - %s", err, stderr.String())
	}
	return nil
}

// StashDrop removes the specified stash entry.
func StashDrop(ctx context.Context, dir, ref string) error {
	cmd := exec.CommandContext(ctx, "git", "stash", "drop", ref)
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git stash drop failed: %v - %s", err, stderr.String())
	}
	return nil
}

// DefaultBranch detects the default branch for the remote origin (e.g. "main" or "master").
// Returns "main" if detection fails.
func DefaultBranch(ctx context.Context, dir string) string {
	cmd := exec.CommandContext(ctx, "git", "symbolic-ref", "refs/remotes/origin/HEAD")
	cmd.Dir = dir
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err == nil {
		ref := strings.TrimSpace(stdout.String())
		// ref is like "refs/remotes/origin/main"
		if parts := strings.Split(ref, "/"); len(parts) > 0 {
			return parts[len(parts)-1]
		}
	}
	return "main"
}

// Merge merges the specified branch into the current branch using --no-ff.
func Merge(ctx context.Context, dir, branch string) error {
	cmd := exec.CommandContext(ctx, "git", "merge", branch, "--no-ff", "-m",
		fmt.Sprintf("Merge branch '%s'", branch))
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("git merge failed: %v - %s", err, stderr.String())
	}
	return nil
}

// BranchInfo holds enriched metadata for a single git branch.
type BranchInfo struct {
	Name              string `json:"name"`
	IsRemote          bool   `json:"is_remote"`
	LastCommitSHA     string `json:"last_commit_sha"`
	LastCommitMessage string `json:"last_commit_message"`
	LastCommitDate    string `json:"last_commit_date"`
	LastCommitAuthor  string `json:"last_commit_author"`
	Ahead             int    `json:"ahead"`
	Behind            int    `json:"behind"`
	IsDefault         bool   `json:"is_default"`
	IsCurrent         bool   `json:"is_current"`
}

// BranchesDetail returns the default branch name and detailed metadata for every
// local and remote branch in the repository at dir.
func BranchesDetail(ctx context.Context, dir string) (string, []BranchInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	// 1. Current branch
	currentBranch, err := CurrentBranch(ctx, dir)
	if err != nil {
		return "", nil, fmt.Errorf("get current branch: %w", err)
	}

	// 2. Default branch
	defaultBranch := DefaultBranch(ctx, dir)

	// 3. Local branches
	localCmd := exec.CommandContext(ctx, "git", "branch", "--format=%(refname:short)")
	localCmd.Dir = dir
	var localOut, localErr bytes.Buffer
	localCmd.Stdout = &localOut
	localCmd.Stderr = &localErr
	if err := localCmd.Run(); err != nil {
		return "", nil, fmt.Errorf("git branch failed: %v - %s", err, localErr.String())
	}

	// 4. Remote branches
	remoteCmd := exec.CommandContext(ctx, "git", "branch", "-r", "--format=%(refname:short)")
	remoteCmd.Dir = dir
	var remoteOut, remoteErr bytes.Buffer
	remoteCmd.Stdout = &remoteOut
	remoteCmd.Stderr = &remoteErr
	// Non-fatal if remote listing fails (e.g. no remotes)
	_ = remoteCmd.Run()

	var branches []BranchInfo

	// Process local branches
	for _, name := range splitLines(localOut.String()) {
		if name == "" {
			continue
		}
		info := BranchInfo{
			Name:      name,
			IsRemote:  false,
			IsDefault: name == defaultBranch,
			IsCurrent: name == currentBranch,
		}
		fillCommitInfo(ctx, dir, name, &info)
		fillAheadBehind(ctx, dir, defaultBranch, name, &info)
		branches = append(branches, info)
	}

	// Process remote branches
	for _, raw := range splitLines(remoteOut.String()) {
		if raw == "" || strings.Contains(raw, "HEAD") {
			continue
		}
		// Strip "origin/" prefix for the display name
		name := raw
		if idx := strings.Index(raw, "/"); idx >= 0 {
			name = raw[idx+1:]
		}
		info := BranchInfo{
			Name:      name,
			IsRemote:  true,
			IsDefault: name == defaultBranch,
			IsCurrent: false,
		}
		// Use the full remote ref for git log
		fillCommitInfo(ctx, dir, raw, &info)
		branches = append(branches, info)
	}

	return defaultBranch, branches, nil
}

// fillCommitInfo populates the last commit fields of a BranchInfo.
func fillCommitInfo(ctx context.Context, dir, ref string, info *BranchInfo) {
	cmd := exec.CommandContext(ctx, "git", "log", "-1", "--format=%H|%s|%aI|%an", ref)
	cmd.Dir = dir
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return
	}
	parts := strings.SplitN(strings.TrimSpace(stdout.String()), "|", 4)
	if len(parts) >= 1 {
		info.LastCommitSHA = parts[0]
	}
	if len(parts) >= 2 {
		info.LastCommitMessage = parts[1]
	}
	if len(parts) >= 3 {
		info.LastCommitDate = parts[2]
	}
	if len(parts) >= 4 {
		info.LastCommitAuthor = parts[3]
	}
}

// fillAheadBehind populates the ahead/behind counts relative to the default branch.
func fillAheadBehind(ctx context.Context, dir, defaultBranch, branch string, info *BranchInfo) {
	if branch == defaultBranch {
		return
	}
	cmd := exec.CommandContext(ctx, "git", "rev-list", "--count", "--left-right",
		defaultBranch+"..."+branch)
	cmd.Dir = dir
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return
	}
	parts := strings.Fields(strings.TrimSpace(stdout.String()))
	if len(parts) == 2 {
		info.Behind, _ = strconv.Atoi(parts[0])
		info.Ahead, _ = strconv.Atoi(parts[1])
	}
}

// splitLines splits s on newlines and returns non-empty trimmed lines.
func splitLines(s string) []string {
	var lines []string
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

// ParseGitHubRemote extracts the owner and repository name from a GitHub remote URL,
// supporting both SSH (git@github.com:owner/repo) and HTTPS formats.
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
