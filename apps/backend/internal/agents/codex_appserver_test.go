package agents

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCodexAppServerRunner_RunTurn(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-10")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"result\":{\"ok\":true}}' ;;\n" +
		"    *\"\\\"method\\\":\\\"initialized\\\"\"*) : ;;\n" +
		"    *\"\\\"id\\\":2\"*) printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}' ;;\n" +
		"    *\"\\\"id\\\":3\"*) printf '%s\\n' '{\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-1\"}}}'; printf '%s\\n' '{\"method\":\"item/commandExecution/requestApproval\",\"id\":77}'; printf '%s\\n' '{\"method\":\"item/tool/call\",\"id\":88,\"params\":{\"tool\":\"linear_query\",\"arguments\":{\"query\":\"{}\"}}}'; printf '%s\\n' '{\"method\":\"turn/completed\",\"usage\":{\"input_tokens\":21,\"output_tokens\":9,\"total_tokens\":30}}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	runner := NewCodexAppServerRunner(script)

	events := make([]Event, 0)
	toolInvoked := false
	result, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-10",
		Timeout:         3 * time.Second,
		AutoApprove:     true,
		ToolExecutor: func(tool string, arguments map[string]any) map[string]any {
			toolInvoked = true
			if tool != "linear_query" {
				return map[string]any{"success": false, "error": "unexpected tool"}
			}
			return map[string]any{"success": true, "data": map[string]any{"ok": true}}
		},
	}, func(event Event) {
		events = append(events, event)
	})

	if err != nil {
		t.Fatalf("run turn: %v", err)
	}
	if result.Usage.TotalTokens != 30 {
		t.Fatalf("expected total tokens 30, got %d", result.Usage.TotalTokens)
	}
	if !strings.Contains(result.SessionID, "thread-1-turn-1") {
		t.Fatalf("unexpected session id: %s", result.SessionID)
	}
	if len(events) == 0 {
		t.Fatalf("expected event stream, got none")
	}
	if !toolInvoked {
		t.Fatalf("expected tool executor to be invoked")
	}
}

func TestCodexAppServerRunner_ReturnsApprovalRequiredWhenAutoApproveDisabled(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-11")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server-no-auto.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"result\":{\"ok\":true}}' ;;\n" +
		"    *\"\\\"method\\\":\\\"initialized\\\"\"*) : ;;\n" +
		"    *\"\\\"id\\\":2\"*) printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}' ;;\n" +
		"    *\"\\\"id\\\":3\"*) printf '%s\\n' '{\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-1\"}}}'; printf '%s\\n' '{\"method\":\"execCommandApproval\",\"id\":77}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	runner := NewCodexAppServerRunner(script)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-11",
		Timeout:         3 * time.Second,
		AutoApprove:     false,
	}, nil)

	if err == nil {
		t.Fatalf("expected approval required error")
	}
	if !strings.Contains(err.Error(), "approval required") {
		t.Fatalf("expected approval required error, got %v", err)
	}
}

func TestCodexAppServerRunner_PrefersApprovalOverInputWhenBothPresent(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-11B")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server-approval-precedence.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"result\":{\"ok\":true}}' ;;\n" +
		"    *\"\\\"method\\\":\\\"initialized\\\"\"*) : ;;\n" +
		"    *\"\\\"id\\\":2\"*) printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}' ;;\n" +
		"    *\"\\\"id\\\":3\"*) printf '%s\\n' '{\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-1\"}}}'; printf '%s\\n' '{\"method\":\"execCommandApproval\",\"params\":{\"requiresInput\":true}}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	runner := NewCodexAppServerRunner(script)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-11B",
		Timeout:         3 * time.Second,
		AutoApprove:     false,
	}, nil)

	if err == nil {
		t.Fatalf("expected approval required error")
	}
	if !strings.Contains(err.Error(), "approval required") {
		t.Fatalf("expected approval required precedence, got %v", err)
	}
}

func TestCodexAppServerRunner_TreatsApprovalSubstringMethodAsInputRequired(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-11C")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server-approval-substring.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"result\":{\"ok\":true}}' ;;\n" +
		"    *\"\\\"method\\\":\\\"initialized\\\"\"*) : ;;\n" +
		"    *\"\\\"id\\\":2\"*) printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}' ;;\n" +
		"    *\"\\\"id\\\":3\"*) printf '%s\\n' '{\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-1\"}}}'; printf '%s\\n' '{\"method\":\"provider/approval_status\",\"params\":{\"requiresInput\":true}}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	runner := NewCodexAppServerRunner(script)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-11C",
		Timeout:         3 * time.Second,
		AutoApprove:     false,
	}, nil)

	if err == nil {
		t.Fatalf("expected input required error")
	}
	if !strings.Contains(err.Error(), "input required") {
		t.Fatalf("expected input required outcome, got %v", err)
	}
	if strings.Contains(err.Error(), "approval required") {
		t.Fatalf("did not expect approval required for method substring match, got %v", err)
	}
}

func TestCodexAppServerRunner_ReturnsInputRequiredWhenAutoApproveDisabled(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-12")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server-input-required.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"result\":{\"ok\":true}}' ;;\n" +
		"    *\"\\\"method\\\":\\\"initialized\\\"\"*) : ;;\n" +
		"    *\"\\\"id\\\":2\"*) printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}' ;;\n" +
		"    *\"\\\"id\\\":3\"*) printf '%s\\n' '{\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-1\"}}}'; printf '%s\\n' '{\"method\":\"turn/input_required\",\"params\":{\"requiresInput\":true}}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	runner := NewCodexAppServerRunner(script)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-12",
		Timeout:         3 * time.Second,
		AutoApprove:     false,
	}, nil)

	if err == nil {
		t.Fatalf("expected input required error")
	}
	if !strings.Contains(err.Error(), "input required") {
		t.Fatalf("expected input required error, got %v", err)
	}
}

func TestToolRequestUserInputApprovalAnswersPrefersApproveSession(t *testing.T) {
	answers, ok := toolRequestUserInputApprovalAnswers(map[string]any{
		"questions": []any{
			map[string]any{
				"id": "q1",
				"options": []any{
					map[string]any{"label": "Deny"},
					map[string]any{"label": "Approve this Session"},
				},
			},
		},
	})
	if !ok {
		t.Fatalf("expected approval answers")
	}
	q1, _ := answers["q1"].(map[string]any)
	raw, _ := q1["answers"].([]string)
	if len(raw) != 1 || raw[0] != "Approve this Session" {
		t.Fatalf("unexpected answer labels: %#v", raw)
	}
}

func TestToolRequestUserInputApprovalAnswersAllowsAllowPrefix(t *testing.T) {
	answers, ok := toolRequestUserInputApprovalAnswers(map[string]any{
		"questions": []any{
			map[string]any{
				"id": "q2",
				"options": []any{
					map[string]any{"label": "Allow change"},
				},
			},
		},
	})
	if !ok {
		t.Fatalf("expected approval answers")
	}
	q2, _ := answers["q2"].(map[string]any)
	raw, _ := q2["answers"].([]string)
	if len(raw) != 1 || raw[0] != "Allow change" {
		t.Fatalf("unexpected answer labels: %#v", raw)
	}
}

func TestToolRequestUserInputUnavailableAnswersUsesNonInteractiveText(t *testing.T) {
	answers, ok := toolRequestUserInputUnavailableAnswers(map[string]any{
		"questions": []any{map[string]any{"id": "q3"}},
	})
	if !ok {
		t.Fatalf("expected unavailable answers")
	}
	q3, _ := answers["q3"].(map[string]any)
	raw, _ := q3["answers"].([]string)
	if len(raw) != 1 || raw[0] != nonInteractiveToolInputAnswer {
		t.Fatalf("unexpected non-interactive answers: %#v", raw)
	}
}

func TestNeedsInputMethodDetectsTruthyNestedSignals(t *testing.T) {
	payload := map[string]any{
		"method": "provider/status",
		"meta": map[string]any{
			"details": map[string]any{
				"requires_input": "yes",
			},
		},
	}
	if !needsInputMethod("provider/status", payload) {
		t.Fatalf("expected truthy nested requires_input to trigger needs input")
	}
}

func TestNeedsInputMethodIgnoresFalseySignals(t *testing.T) {
	payload := map[string]any{
		"method": "provider/status",
		"meta": map[string]any{
			"needsInput":     "false",
			"requires_input": 0,
		},
	}
	if needsInputMethod("provider/status", payload) {
		t.Fatalf("expected falsey needs-input signals to be ignored")
	}
}

func TestCodexAppServerRunner_WrapsInitializeResponseErrors(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-13")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server-init-error.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"error\":{\"message\":\"nope\"}}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	runner := NewCodexAppServerRunner(script)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-13",
		Timeout:         3 * time.Second,
		AutoApprove:     true,
	}, nil)
	if err == nil {
		t.Fatalf("expected initialize failure")
	}
	if !strings.Contains(err.Error(), "initialize failed") {
		t.Fatalf("expected initialize failed error, got %v", err)
	}
}

func TestCodexAppServerRunner_UsesOnRequestPolicyWhenAutoApproveDisabled(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-14")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server-policy.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"result\":{\"ok\":true}}' ;;\n" +
		"    *\"\\\"method\\\":\\\"initialized\\\"\"*) : ;;\n" +
		"    *\"\\\"id\\\":2\"*\"\\\"approvalPolicy\\\":\\\"on-request\\\"\"*) printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}' ;;\n" +
		"    *\"\\\"id\\\":2\"*) printf '%s\\n' '{\"id\":2,\"error\":{\"message\":\"policy missing\"}}' ;;\n" +
		"    *\"\\\"id\\\":3\"*\"\\\"approvalPolicy\\\":\\\"on-request\\\"\"*) printf '%s\\n' '{\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-1\"}}}'; printf '%s\\n' '{\"method\":\"turn/completed\"}' ;;\n" +
		"    *\"\\\"id\\\":3\"*) printf '%s\\n' '{\"id\":3,\"error\":{\"message\":\"turn policy missing\"}}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	runner := NewCodexAppServerRunner(script)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-14",
		Timeout:         3 * time.Second,
		AutoApprove:     false,
	}, nil)
	if err != nil {
		t.Fatalf("expected run to succeed with on-request policy, got %v", err)
	}
}

func TestCodexAppServerRunner_IncludesTurnFailureDetails(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-15")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server-turn-failed.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"result\":{\"ok\":true}}' ;;\n" +
		"    *\"\\\"method\\\":\\\"initialized\\\"\"*) : ;;\n" +
		"    *\"\\\"id\\\":2\"*) printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}' ;;\n" +
		"    *\"\\\"id\\\":3\"*) printf '%s\\n' '{\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-1\"}}}'; printf '%s\\n' '{\"method\":\"turn/failed\",\"params\":{\"reason\":\"blocked\"}}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	runner := NewCodexAppServerRunner(script)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-15",
		Timeout:         3 * time.Second,
		AutoApprove:     true,
	}, nil)
	if err == nil {
		t.Fatalf("expected turn failure")
	}
	if !strings.Contains(err.Error(), "blocked") {
		t.Fatalf("expected error to include turn failure params, got %v", err)
	}
}

func TestCodexAppServerRunner_IgnoresProtocolJSONOnStderr(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-16")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server-stderr-protocol.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"result\":{\"ok\":true}}' ;;\n" +
		"    *\"\\\"method\\\":\\\"initialized\\\"\"*) : ;;\n" +
		"    *\"\\\"id\\\":2\"*) printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}' ;;\n" +
		"    *\"\\\"id\\\":3\"*) printf '%s\\n' '{\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-1\"}}}'; printf '%s\\n' '{\"method\":\"item/tool/call\",\"id\":88,\"params\":{\"tool\":\"linear_query\",\"arguments\":{\"query\":\"{}\"}}}' 1>&2; printf '%s\\n' '{\"method\":\"turn/completed\"}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	toolInvoked := false
	runner := NewCodexAppServerRunner(script)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-16",
		Timeout:         3 * time.Second,
		AutoApprove:     true,
		ToolExecutor: func(tool string, arguments map[string]any) map[string]any {
			toolInvoked = true
			return map[string]any{"success": true}
		},
	}, nil)
	if err != nil {
		t.Fatalf("expected run success, got %v", err)
	}
	if toolInvoked {
		t.Fatalf("expected stderr protocol json to be ignored for tool calls")
	}
}

func TestCodexAppServerRunner_AdvertisesDynamicToolsOnThreadStart(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-17")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server-dynamic-tools.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"result\":{\"ok\":true}}' ;;\n" +
		"    *\"\\\"method\\\":\\\"initialized\\\"\"*) : ;;\n" +
		"    *\"\\\"id\\\":2\"*\"\\\"name\\\":\\\"linear_query\\\"\"*) printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}' ;;\n" +
		"    *\"\\\"id\\\":2\"*) printf '%s\\n' '{\"id\":2,\"error\":{\"message\":\"dynamicTools missing\"}}' ;;\n" +
		"    *\"\\\"id\\\":3\"*) printf '%s\\n' '{\"id\":3,\"result\":{\"turn\":{\"id\":\"turn-1\"}}}'; printf '%s\\n' '{\"method\":\"turn/completed\"}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	runner := NewCodexAppServerRunner(script)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-17",
		Timeout:         3 * time.Second,
		AutoApprove:     true,
		ToolSpecs: []map[string]any{{
			"name": "linear_query",
		}},
	}, nil)
	if err != nil {
		t.Fatalf("expected run success with dynamic tools, got %v", err)
	}
}

func TestCodexAppServerRunner_WrapsThreadStartErrors(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-18")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server-thread-error.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"result\":{\"ok\":true}}' ;;\n" +
		"    *\"\\\"method\\\":\\\"initialized\\\"\"*) : ;;\n" +
		"    *\"\\\"id\\\":2\"*) printf '%s\\n' '{\"id\":2,\"error\":{\"message\":\"thread failed\"}}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	runner := NewCodexAppServerRunner(script)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-18",
		Timeout:         3 * time.Second,
		AutoApprove:     true,
	}, nil)
	if err == nil {
		t.Fatalf("expected thread/start failure")
	}
	if !strings.Contains(err.Error(), "thread/start failed") {
		t.Fatalf("expected wrapped thread/start error, got %v", err)
	}
}

func TestCodexAppServerRunner_WrapsTurnStartErrors(t *testing.T) {
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-19")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	script := filepath.Join(t.TempDir(), "fake-codex-app-server-turn-start-error.sh")
	scriptContent := "#!/usr/bin/env sh\n" +
		"while IFS= read -r line; do\n" +
		"  case \"$line\" in\n" +
		"    *\"\\\"id\\\":1\"*) printf '%s\\n' '{\"id\":1,\"result\":{\"ok\":true}}' ;;\n" +
		"    *\"\\\"method\\\":\\\"initialized\\\"\"*) : ;;\n" +
		"    *\"\\\"id\\\":2\"*) printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}' ;;\n" +
		"    *\"\\\"id\\\":3\"*) printf '%s\\n' '{\"id\":3,\"error\":{\"message\":\"turn failed\"}}' ;;\n" +
		"  esac\n" +
		"done\n"
	if err := os.WriteFile(script, []byte(scriptContent), 0o755); err != nil {
		t.Fatalf("write fake codex script: %v", err)
	}

	runner := NewCodexAppServerRunner(script)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "Implement feature",
		IssueIdentifier: "ORC-19",
		Timeout:         3 * time.Second,
		AutoApprove:     true,
	}, nil)
	if err == nil {
		t.Fatalf("expected turn/start failure")
	}
	if !strings.Contains(err.Error(), "turn/start failed") {
		t.Fatalf("expected wrapped turn/start error, got %v", err)
	}
}
