// Package backgroundcommand runs native helpers without desktop console windows.
package backgroundcommand

import (
	"context"
	"os/exec"
)

// Command preserves exec's pipes while preventing background executables from
// opening or inheriting a Windows console.
func Command(executable string, args ...string) *exec.Cmd {
	command := exec.Command(executable, args...)
	configure(command)
	return command
}

// CommandContext preserves exec's pipes and cancellation behavior while preventing
// background executables from opening or inheriting a Windows console.
func CommandContext(ctx context.Context, executable string, args ...string) *exec.Cmd {
	command := exec.CommandContext(ctx, executable, args...)
	configure(command)
	return command
}
