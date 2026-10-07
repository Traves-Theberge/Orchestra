package agents

import (
	"context"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// A replayed transcript can be far longer than the ~8K command line the
// Windows shell receives intact; it must reach the agent unchanged.
func TestLongPromptReachesCommandIntact(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("prompt file substitution is Windows-only")
	}
	prompt := strings.Repeat("it's \"quoted\" `tick` $HOME 🎻\n", 700)
	r := NewCommandRunner(ProviderClaude, `printf '%s' {{prompt}} | wc -c`)
	root := t.TempDir()
	result, err := r.RunTurn(context.Background(), TurnRequest{Workspace: root, WorkspaceRoot: root, Prompt: prompt}, nil)
	if err != nil || result.ExitCode != 0 {
		t.Fatal(err, result.ExitCode, result.Output)
	}
	want := strconv.Itoa(len(strings.TrimSpace(prompt)))
	if strings.TrimSpace(result.Output) != want {
		t.Fatalf("prompt bytes %s, command saw %q", want, result.Output)
	}
}
