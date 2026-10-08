package backgroundcommand

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
)

func TestCommandHasNoConsoleAndCapturesOutput(t *testing.T) {
	if os.Getenv("ORCHESTRA_CONSOLE_PROBE") == "1" {
		window, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow").Call()
		if window != 0 {
			os.Exit(3)
		}
		_, _ = os.Stdout.WriteString("probe completed")
		os.Exit(0)
	}
	if os.Getenv("ORCHESTRA_CONSOLE_PROBE") == "parent" {
		command := CommandContext(context.Background(), os.Args[0], "-test.run=^TestCommandHasNoConsoleAndCapturesOutput$")
		if os.Getenv("ORCHESTRA_CONSOLE_PLAIN") == "1" {
			command = Command(os.Args[0], "-test.run=^TestCommandHasNoConsoleAndCapturesOutput$")
		}
		command.Env = append(os.Environ(), "ORCHESTRA_CONSOLE_PROBE=1")
		output, err := command.Output()
		if err != nil {
			os.Exit(4)
		}
		_, _ = os.Stdout.Write(output)
		os.Exit(0)
	}
	// Keep the test parent console-free too: Windows Terminal can display a
	// CREATE_NEW_CONSOLE parent even with HideWindow set.
	for _, plain := range []string{"0", "1"} {
		command := exec.CommandContext(context.Background(), os.Args[0], "-test.run=^TestCommandHasNoConsoleAndCapturesOutput$")
		command.Env = append(os.Environ(), "ORCHESTRA_CONSOLE_PROBE=parent", "ORCHESTRA_CONSOLE_PLAIN="+plain)
		command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000, HideWindow: true}
		output, err := command.Output()
		if err != nil || strings.TrimSpace(string(output)) != "probe completed" {
			t.Fatalf("background child must run without a console and preserve output (plain=%s): %q, %v", plain, output, err)
		}
	}
}
