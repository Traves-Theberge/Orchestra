package backgroundcommand

import (
	"os/exec"
	"syscall"
)

func configure(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000, HideWindow: true} // CREATE_NO_WINDOW
}
