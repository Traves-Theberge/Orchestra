package agents

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeReasoningEffortWirePayloadAndDefaultOmission(t *testing.T) {
	root := t.TempDir()
	session, err := NewCodexNativeSession(context.Background(), nativeFixtureCommand(t, "effort"), TurnRequest{Workspace: root, WorkspaceRoot: root, ProjectRootWorkspace: true}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	if session.ModelInfo().ReasoningEffort != "medium" {
		t.Fatal("thread response effort not observed")
	}
	optionsSession := session.(NativeTurnOptionsSession)
	for _, effort := range []string{"High", "high\n", "-high", strings.Repeat("x", 33)} {
		if _, err := optionsSession.SendTurnWithOptions(context.Background(), "hello", NativeTurnOptions{ReasoningEffort: effort}); err == nil {
			t.Fatalf("invalid effort %q accepted", effort)
		}
	}
	paramsFile := filepath.Join(root, "turn-params.jsonl")
	if _, err := os.Stat(paramsFile); !os.IsNotExist(err) {
		t.Fatal("invalid effort wrote a turn RPC")
	}
	defaultResult, err := session.SendTurn(context.Background(), "default", "")
	if err != nil {
		t.Fatal(err)
	}
	if defaultResult.ReasoningEffort != "medium" {
		t.Fatal("observed thread default lost")
	}
	overrideResult, err := optionsSession.SendTurnWithOptions(context.Background(), "specific", NativeTurnOptions{ReasoningEffort: "high"})
	if err != nil {
		t.Fatal(err)
	}
	if overrideResult.ReasoningEffort != "" || session.ModelInfo().ReasoningEffort != "" {
		t.Fatal("requested override mislabeled observed")
	}
	if _, err = optionsSession.SendTurnWithOptions(context.Background(), "inherit", NativeTurnOptions{}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(paramsFile)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) != 3 {
		t.Fatalf("wrong payload count %s", raw)
	}
	for i, line := range lines {
		var params map[string]any
		if err = json.Unmarshal([]byte(line), &params); err != nil {
			t.Fatal(err)
		}
		if params["summary"] != "detailed" {
			t.Fatalf("reasoning summary not requested: %v", params)
		}
		effort, present := params["effort"]
		if i == 1 {
			if effort != "high" {
				t.Fatalf("override not applied %v", params)
			}
		} else if present {
			t.Fatalf("default must omit effort: %v", params)
		}
	}
}
