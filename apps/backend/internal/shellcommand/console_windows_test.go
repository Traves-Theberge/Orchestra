package shellcommand

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestBackgroundShellHasNoConsole(t *testing.T) {
	if os.Getenv("ORCHESTRA_SHELL_CONSOLE_PROBE") == "child" {
		window, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow").Call()
		if window != 0 {
			os.Exit(41)
		}
		_, _ = os.Stdout.WriteString("console-free shell output")
		os.Exit(0)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if os.Getenv("ORCHESTRA_SHELL_CONSOLE_PROBE") == "parent" {
		executable := strings.ReplaceAll(filepath.ToSlash(os.Args[0]), "'", "'\"'\"'")
		command, err := CommandContext(ctx, "'"+executable+"' -test.run=^TestBackgroundShellHasNoConsole$")
		if err != nil {
			t.Fatal(err)
		}
		command.Env = append(os.Environ(), "ORCHESTRA_SHELL_CONSOLE_PROBE=child")
		output, err := command.CombinedOutput()
		if err != nil || !strings.Contains(string(output), "console-free shell output") {
			t.Fatalf("background shell: %q, %v", output, err)
		}
		return
	}
	parent := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestBackgroundShellHasNoConsole$")
	parent.Env = append(os.Environ(), "ORCHESTRA_SHELL_CONSOLE_PROBE=parent")
	parent.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000, HideWindow: true}
	if output, err := parent.CombinedOutput(); err != nil {
		t.Fatalf("shell must not inherit a console: %s, %v", output, err)
	}
}
