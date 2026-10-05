package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

// Prepare only a newly owned destination. Existing checkouts are never overwritten
// or removed, including after a failed clone/initialization.
func prepareProjectSource(ctx context.Context, source, parent, name, remote string, roots []string) (string, error) {
	if source == "" || source == "local" {
		return parent, nil
	}
	if source != "new" && source != "clone" {
		return "", fmt.Errorf("unsupported project source")
	}
	if !filepath.IsAbs(parent) || strings.TrimSpace(name) != name || name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\<>:"|?*`) || strings.HasSuffix(name, ".") {
		return "", fmt.Errorf("choose an absolute parent folder and a valid single folder name")
	}
	if err := workspace.ValidateProjectPath(parent, roots); err != nil {
		return "", err
	}
	if info, err := os.Stat(parent); err != nil || !info.IsDir() {
		return "", fmt.Errorf("parent folder must already exist")
	}
	destination := filepath.Join(parent, name)
	if err := workspace.ValidateWorkspacePath(parent, destination); err != nil {
		return "", err
	}
	if source == "clone" {
		if filepath.IsAbs(remote) {
			if err := workspace.ValidateProjectPath(remote, roots); err != nil {
				return "", fmt.Errorf("local clone source is outside project access")
			}
		} else {
			parsed, err := url.Parse(remote)
			credentials := false
			if err == nil && parsed.User != nil {
				_, password := parsed.User.Password()
				credentials = password || parsed.Scheme != "ssh"
			}
			if err != nil || parsed.Host == "" || credentials || (parsed.Scheme != "https" && parsed.Scheme != "ssh") {
				return "", fmt.Errorf("use an HTTPS or SSH Git URL without embedded credentials, or an authorized absolute local repository path")
			}
		}
	}
	if _, err := exec.LookPath("git"); err != nil {
		return "", fmt.Errorf("Git is unavailable on the backend host")
	}
	if err := os.Mkdir(destination, 0o700); err != nil {
		return "", fmt.Errorf("destination already exists or cannot be created; choose another name or add that folder as a local project")
	}
	commandCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	run := func(args ...string) error {
		command := exec.CommandContext(commandCtx, "git", args...)
		command.Dir = destination
		command.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		if _, err := command.CombinedOutput(); err != nil {
			return fmt.Errorf("Git setup failed; destination retained at %s. Inspect it before retrying: %w", destination, err)
		}
		return nil
	}
	if source == "clone" {
		if err := run("-c", "protocol.ext.allow=never", "clone", "--", remote, "."); err != nil {
			return "", err
		}
	} else {
		if err := run("init", "--initial-branch=main"); err != nil {
			return "", err
		}
		// A first commit allows task worktrees immediately. Identity is invocation-
		// scoped automation identity; never write the user's Git configuration.
		if err := run("-c", "user.name=Orchestra", "-c", "user.email=orchestra@localhost", "commit", "--allow-empty", "-m", "Initialize project"); err != nil {
			return "", err
		}
	}
	return destination, nil
}
