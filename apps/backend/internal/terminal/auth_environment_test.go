package terminal

import (
	"runtime"
	"strings"
	"testing"
)

func TestTerminalEnvironmentSignatureKeepsAccountBoundary(t *testing.T) {
	first := terminalEnvSignature([]string{"PATH=/bin", "CODEX_HOME=/accounts/a", "ORCHESTRA_SESSION_ID=first"})
	resumed := terminalEnvSignature([]string{"PATH=/bin", "CODEX_HOME=/accounts/a", "ORCHESTRA_SESSION_ID=second"})
	other := terminalEnvSignature([]string{"PATH=/bin", "CODEX_HOME=/accounts/b", "ORCHESTRA_SESSION_ID=second"})
	if first != resumed || first == other {
		t.Fatal("turn identity must not change the terminal context, but account home must")
	}
}

func TestScopedTerminalRejectsAccountChange(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows PTY support requires ConPTY")
	}
	manager := NewManager()
	first, err := manager.GetOrCreateSessionWithEnv("issue-1", t.TempDir(), []string{"PATH=/bin:/usr/bin", "CODEX_HOME=/accounts/a"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(first.Close)
	if _, err := manager.GetOrCreateSessionWithEnv("issue-1", first.Cmd.Dir, []string{"PATH=/bin:/usr/bin", "CODEX_HOME=/accounts/b"}); err == nil || !strings.Contains(err.Error(), "environment changed") {
		t.Fatalf("account switch reused a live terminal: %v", err)
	}
}
