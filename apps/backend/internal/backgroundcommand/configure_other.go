//go:build !windows

package backgroundcommand

import "os/exec"

func configure(command *exec.Cmd) {}
