// Package shellcommand resolves the POSIX shell used by configured agent commands and hooks.
package shellcommand

import (
	"context"
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Resolve uses PATH on Unix and also checks Git for Windows' installation on Windows.
// It deliberately avoids the Windows bash alias, which may launch a different WSL environment.
func Resolve() (string, error) {
	if path, err := exec.LookPath("sh"); err == nil {
		return path, nil
	}
	if runtime.GOOS == "windows" {
		if git, err := exec.LookPath("git"); err == nil {
			root := filepath.Dir(filepath.Dir(git))
			for _, path := range []string{filepath.Join(root, "bin", "sh.exe"), filepath.Join(root, "usr", "bin", "sh.exe")} {
				if info, err := os.Stat(path); err == nil && !info.IsDir() {
					return path, nil
				}
			}
		}
	}
	return "", fmt.Errorf("POSIX shell unavailable: install sh or Git for Windows for agent commands and workspace hooks")
}

func CommandContext(ctx context.Context, script string) (*exec.Cmd, error) {
	path, err := Resolve()
	if err != nil {
		return nil, err
	}
	// Accept a bare executable path as well as a shell command. Native Windows paths
	// must be quoted and normalized before being interpreted by a POSIX shell.
	if info, err := os.Stat(script); err == nil && !info.IsDir() && filepath.IsAbs(script) {
		script = "'" + strings.ReplaceAll(filepath.ToSlash(script), "'", "'\"'\"'") + "'"
	}
	cmd := backgroundcommand.CommandContext(ctx, path, "-lc", script)
	cmd.WaitDelay = 2 * time.Second
	configureCancellation(cmd)
	return cmd, nil
}
