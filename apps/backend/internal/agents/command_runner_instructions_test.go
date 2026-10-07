package agents

import (
	"context"
	"strings"
	"testing"
)

func TestClaudeDeveloperInstructionsArriveViaFile(t *testing.T) {
	// The appended flag lands as arguments to f, which prints the file it names.
	r := NewCommandRunner(ProviderClaude, `f() { cat "$2"; }; f`)
	root := t.TempDir()
	instructions := strings.Repeat("Render visuals in orchestra-html fences. ", 400)
	result, err := r.RunTurn(context.Background(), TurnRequest{Workspace: root, WorkspaceRoot: root, Prompt: "hi", DeveloperInstructions: instructions}, nil)
	if err != nil || result.ExitCode != 0 {
		t.Fatal(err, result.ExitCode, result.Output)
	}
	if strings.TrimSpace(result.Output) != strings.TrimSpace(instructions) {
		t.Fatalf("instructions not delivered: %.120q", result.Output)
	}
}
