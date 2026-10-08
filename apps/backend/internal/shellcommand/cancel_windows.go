package shellcommand

import (
	"context"
	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
	"golang.org/x/sys/windows"
	"os/exec"
	"strconv"
	"syscall"
)

func configureCancellation(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_NO_WINDOW, HideWindow: true}
	cmd.Cancel = func() error {
		kill := backgroundcommand.CommandContext(context.Background(), "taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
		if err := kill.Run(); err != nil {
			return cmd.Process.Kill()
		}
		return nil
	}
}
