package agents

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"testing"
	"time"
)

func verifyNativeFixtureConsole() {
	if os.Getenv("ORCHESTRA_NATIVE_REQUIRE_NO_CONSOLE") != "1" {
		return
	}
	window, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow").Call()
	if window != 0 {
		fmt.Fprintln(os.Stderr, "background native session has a console")
		os.Exit(41)
	}
}

func TestNativeChatProcessesHaveNoConsole(t *testing.T) {
	if provider := os.Getenv("ORCHESTRA_NATIVE_CONSOLE_PARENT"); provider != "" {
		if provider == "omp" {
			session := startOMPFixture(t, "", &ompEventLog{}, "ORCHESTRA_NATIVE_REQUIRE_NO_CONSOLE=1")
			result, err := session.SendTurn(context.Background(), "console probe", "")
			if err != nil || result.Status != "completed" {
				t.Fatalf("OMP turn: %#v, %v", result, err)
			}
		} else {
			command, args := antigravityFixtureCommand(t)
			workspace := t.TempDir()
			session, err := newAntigravityNativeSessionWithArgs(context.Background(), command, args,
				TurnRequest{Workspace: workspace, WorkspaceRoot: workspace, ProjectRootWorkspace: true, RequestedAgentID: "reviewer"},
				"", nil, []string{"ORCHESTRA_AGY_FIXTURE=1", "ORCHESTRA_NATIVE_REQUIRE_NO_CONSOLE=1"})
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			result, err := session.SendTurn(context.Background(), "console probe", "")
			if err != nil || result.Status != "completed" {
				t.Fatalf("Antigravity turn: %#v, %v", result, err)
			}
		}
		return
	}
	for _, provider := range []string{"omp", "antigravity"} {
		t.Run(provider, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			parent := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestNativeChatProcessesHaveNoConsole$")
			parent.Env = append(os.Environ(), "ORCHESTRA_NATIVE_CONSOLE_PARENT="+provider)
			// The test launcher must also stay out of Windows Terminal.
			parent.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000, HideWindow: true}
			if output, err := parent.CombinedOutput(); err != nil {
				t.Fatalf("%s chat must stream without a console: %s, %v", provider, output, err)
			}
		})
	}
}
