package agents

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCommandRunnerParsesJSONUsageAndEvents(t *testing.T) {
	runner := NewCommandRunner(ProviderCodex, "printf '{\"event\":\"turn_completed\",\"usage\":{\"input_tokens\":12,\"output_tokens\":4,\"total_tokens\":16}}\\n'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-1")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	events := make([]Event, 0)
	result, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-1",
		Timeout:         2 * time.Second,
	}, func(event Event) {
		events = append(events, event)
	})

	if err != nil {
		t.Fatalf("run turn: %v", err)
	}
	if result.Usage.TotalTokens != 16 {
		t.Fatalf("expected total tokens 16, got %d", result.Usage.TotalTokens)
	}
	if len(events) == 0 || events[0].Kind == "" {
		t.Fatalf("expected parsed event kind, got %+v", events)
	}
}

func TestCommandRunnerReplacesPromptTemplateToken(t *testing.T) {
	runner := NewCommandRunner(ProviderClaude, "printf {{prompt}}")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-2")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	result, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello-world",
		IssueIdentifier: "ORC-2",
		Timeout:         2 * time.Second,
	}, nil)

	if err != nil {
		t.Fatalf("run turn: %v", err)
	}
	if result.Output != "hello-world" {
		t.Fatalf("expected output hello-world, got %q", result.Output)
	}
}

func TestRegistrySupportsCodexClaudeAndOpenCode(t *testing.T) {
	r := NewRegistry(map[string]string{
		"codex":    "codex app-server",
		"claude":   "printf claude",
		"opencode": "printf opencode",
	})

	for _, provider := range []Provider{ProviderCodex, ProviderClaude, ProviderOpenCode} {
		if !r.HasProvider(provider) {
			t.Fatalf("expected provider configured: %s", provider)
		}
	}

	if _, ok := r.runners[ProviderCodex].(*CodexAppServerRunner); !ok {
		t.Fatalf("expected codex provider to use CodexAppServerRunner")
	}
	if _, ok := r.runners[ProviderClaude].(*ClaudeRunner); !ok {
		t.Fatalf("expected claude provider to use ClaudeRunner")
	}
	if _, ok := r.runners[ProviderOpenCode].(*OpenCodeRunner); !ok {
		t.Fatalf("expected opencode provider to use OpenCodeRunner")
	}
}

func TestParseLineToEventClaudeParsesNestedMessageAndUsage(t *testing.T) {
	line := `{"type":"message_delta","delta":{"text":"continue"},"message":{"usage":{"input_tokens":10,"output_tokens":2}}}`
	event := parseLineToEvent(ProviderClaude, "stdout", line)
	if event.Kind != "message_delta" {
		t.Fatalf("expected message_delta kind, got %q", event.Kind)
	}
	if event.Message != "continue" {
		t.Fatalf("expected continue message, got %q", event.Message)
	}
	if event.Usage.TotalTokens != 12 {
		t.Fatalf("expected derived total tokens 12, got %d", event.Usage.TotalTokens)
	}
}

func TestParseLineToEventOpenCodeSupportsSSEDataPrefix(t *testing.T) {
	line := `data: {"event":"turn.completed","usage":{"inputTokens":3,"outputTokens":4}}`
	event := parseLineToEvent(ProviderOpenCode, "stdout", line)
	if event.Kind != "turn.completed" {
		t.Fatalf("expected turn.completed kind, got %q", event.Kind)
	}
	if event.Usage.TotalTokens != 7 {
		t.Fatalf("expected derived total tokens 7, got %d", event.Usage.TotalTokens)
	}
}

func TestParseLineToEventExtractsMessageFromContentArray(t *testing.T) {
	line := `{"type":"result","content":[{"type":"text","text":"done"}]}`
	event := parseLineToEvent(ProviderOpenCode, "stdout", line)
	if event.Message != "done" {
		t.Fatalf("expected done message, got %q", event.Message)
	}
}

func TestCommandRunnerReturnsApprovalRequiredFromStructuredEvent(t *testing.T) {
	runner := NewCommandRunner(ProviderClaude, "printf '{\"method\":\"execCommandApproval\"}\\n'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-3")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-3",
		Timeout:         2 * time.Second,
	}, nil)
	if err == nil {
		t.Fatalf("expected approval required error")
	}
	if got := err.Error(); got == "" || got != "approval required: execCommandApproval" {
		t.Fatalf("unexpected approval error: %v", err)
	}
}

func TestCommandRunnerReturnsInputRequiredFromStructuredEvent(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "echo '{\"event\":\"turn/input_required\"}'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-4")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-4",
		Timeout:         2 * time.Second,
	}, nil)
	if err == nil {
		t.Fatalf("expected input required error")
	}
	if got := err.Error(); got == "" || got != "input required: turn/input_required" {
		t.Fatalf("unexpected input required error: %v", err)
	}
}

func TestCommandRunnerReturnsInputRequiredFromDotStyleEvent(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "printf '{\"event\":\"turn.input_required\"}\\n'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-4B")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-4B",
		Timeout:         2 * time.Second,
	}, nil)
	if err == nil {
		t.Fatalf("expected input required error")
	}
	if got := err.Error(); got == "" || got != "input required: turn.input_required" {
		t.Fatalf("unexpected input required error: %v", err)
	}
}

func TestCommandRunnerReturnsInputRequiredFromNestedNeedsInputPayload(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "printf '{\"event\":\"provider.event\",\"meta\":{\"requires_input\":true}}\\n'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-4D")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-4D",
		Timeout:         2 * time.Second,
	}, nil)
	if err == nil {
		t.Fatalf("expected input required error")
	}
	if got := err.Error(); got == "" || !strings.Contains(got, "input required") {
		t.Fatalf("unexpected input required error: %v", err)
	}
}

func TestCommandRunnerReturnsApprovalRequiredFromGenericApprovalEvent(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "printf '{\"event\":\"approval_required\"}\\n'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-4C")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-4C",
		Timeout:         2 * time.Second,
	}, nil)
	if err == nil {
		t.Fatalf("expected approval required error")
	}
	if got := err.Error(); got == "" || got != "approval required: approval_required" {
		t.Fatalf("unexpected approval required error: %v", err)
	}
}

func TestParseLineToEventExtractsUsageFromParamsEnvelope(t *testing.T) {
	line := `{"method":"thread/tokenUsage/updated","params":{"usage":{"input_tokens":6,"output_tokens":2}}}`
	event := parseLineToEvent(ProviderCodex, "stdout", line)
	if event.Usage.InputTokens != 6 || event.Usage.OutputTokens != 2 || event.Usage.TotalTokens != 8 {
		t.Fatalf("expected usage from params envelope, got %+v", event.Usage)
	}
}

func TestParseLineToEventParsesSSEEventPrefix(t *testing.T) {
	event := parseLineToEvent(ProviderOpenCode, "stdout", "event: approval_required")
	if event.Kind != "approval_required" {
		t.Fatalf("expected SSE event kind approval_required, got %q", event.Kind)
	}
}

func TestParseLineToEventIgnoresSSEIDAndRetryPrefixes(t *testing.T) {
	event := parseLineToEvent(ProviderOpenCode, "stdout", "id: 123")
	if event.Kind != "stdout" || event.Message != "" {
		t.Fatalf("expected id line to be ignored as metadata, got %+v", event)
	}
	event = parseLineToEvent(ProviderOpenCode, "stdout", "retry: 1000")
	if event.Kind != "stdout" || event.Message != "" {
		t.Fatalf("expected retry line to be ignored as metadata, got %+v", event)
	}
}

func TestCommandRunnerAppliesSSEEventKindToDataPayload(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "printf 'event: turn.message\\n'; printf 'data: {\"message\":\"hello\"}\\n'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-6")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	var saw bool
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-6",
		Timeout:         2 * time.Second,
	}, func(event Event) {
		if event.Message == "hello" {
			saw = true
			if event.Kind != "turn.message" {
				t.Fatalf("expected SSE kind turn.message for data payload, got %q", event.Kind)
			}
		}
	})
	if err != nil {
		t.Fatalf("run turn: %v", err)
	}
	if !saw {
		t.Fatalf("expected to observe SSE data payload event")
	}
}

func TestCommandRunnerIgnoresSSECommentLines(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "printf ': keepalive\\n'; printf 'event: turn.message\\n'; printf 'data: {\"message\":\"hello\"}\\n'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-7")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	events := make([]Event, 0)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-7",
		Timeout:         2 * time.Second,
	}, func(event Event) {
		events = append(events, event)
	})
	if err != nil {
		t.Fatalf("run turn: %v", err)
	}
	for _, event := range events {
		if strings.Contains(event.Message, "keepalive") {
			t.Fatalf("expected SSE comment line to be ignored, got event %+v", event)
		}
	}
}

func TestParseLineToEventParsesJSONArrayEnvelope(t *testing.T) {
	line := `[{"event":"turn.completed","usage":{"inputTokens":5,"outputTokens":2}}]`
	event := parseLineToEvent(ProviderOpenCode, "stdout", line)
	if event.Kind != "turn.completed" {
		t.Fatalf("expected turn.completed kind from array payload, got %q", event.Kind)
	}
	if event.Usage.TotalTokens != 7 {
		t.Fatalf("expected usage from array payload, got %+v", event.Usage)
	}
}

func TestParseLineToEventParsesJSONArrayEnvelopeMergesUsageAcrossItems(t *testing.T) {
	line := `[{"event":"usage","usage":{"inputTokens":5}},{"event":"usage","usage":{"outputTokens":2}}]`
	event := parseLineToEvent(ProviderOpenCode, "stdout", line)
	if event.Usage.InputTokens != 5 || event.Usage.OutputTokens != 2 || event.Usage.TotalTokens != 7 {
		t.Fatalf("expected merged usage 5/2/7 from array payload, got %+v", event.Usage)
	}
}

func TestParseLineToEventParsesJSONArrayEnvelopeReturnsBlockingEvent(t *testing.T) {
	line := `[{"event":"turn.completed"},{"method":"turn/input_required","params":{"requiresInput":true}}]`
	event := parseLineToEvent(ProviderOpenCode, "stdout", line)
	if event.Kind != "turn/input_required" {
		t.Fatalf("expected blocking event kind turn/input_required, got %q", event.Kind)
	}
}

func TestCommandRunnerFlushesSSEDataAtEOF(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "printf 'event: turn.message\\n'; printf 'data: {\"message\":\"hello\"}\\n'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-8")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	seen := false
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-8",
		Timeout:         2 * time.Second,
	}, func(event Event) {
		if event.Message == "hello" {
			seen = true
			if event.Kind != "turn.message" {
				t.Fatalf("expected turn.message kind from SSE flush, got %q", event.Kind)
			}
		}
	})
	if err != nil {
		t.Fatalf("run turn: %v", err)
	}
	if !seen {
		t.Fatalf("expected SSE data payload to flush at EOF")
	}
}

func TestCommandRunnerCombinesMultipleSSEDataLines(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "printf 'event: stream.text\\n'; printf 'data: line1\\n'; printf 'data: line2\\n'; printf '\\n'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-9")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	seen := false
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-9",
		Timeout:         2 * time.Second,
	}, func(event Event) {
		if event.Kind == "stream.text" && strings.Contains(event.Message, "line1") {
			seen = true
			if event.Message != "line1\nline2" {
				t.Fatalf("expected joined SSE data lines, got %q", event.Message)
			}
		}
	})
	if err != nil {
		t.Fatalf("run turn: %v", err)
	}
	if !seen {
		t.Fatalf("expected combined SSE data event")
	}
}

func TestCommandRunnerReturnsTimeoutError(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "sleep 2")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-11")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-11",
		Timeout:         100 * time.Millisecond,
	}, nil)
	if err == nil {
		t.Fatalf("expected timeout error")
	}
	if !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("expected timeout message, got %v", err)
	}
}

func TestCommandRunnerReturnsParentContextCancellation(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "sleep 2")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-12")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(100*time.Millisecond, cancel)

	_, err := runner.RunTurn(ctx, TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-12",
		Timeout:         3 * time.Second,
	}, nil)
	if err == nil {
		t.Fatalf("expected canceled context error")
	}
	if !strings.Contains(err.Error(), "context canceled") {
		t.Fatalf("expected context canceled message, got %v", err)
	}
}

func TestCommandRunnerIgnoresSSEDoneSentinel(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "printf 'event: turn.message\\n'; printf 'data: {\"message\":\"hello\"}\\n'; printf '\\n'; printf 'data: [DONE]\\n'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-10")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	events := make([]Event, 0)
	_, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-10",
		Timeout:         2 * time.Second,
	}, func(event Event) {
		events = append(events, event)
	})
	if err != nil {
		t.Fatalf("run turn: %v", err)
	}
	for _, event := range events {
		if strings.Contains(strings.ToLower(event.Message), "[done]") {
			t.Fatalf("expected done sentinel to be ignored, got %+v", event)
		}
	}
}

func TestCommandRunnerMergesPartialUsageAcrossEvents(t *testing.T) {
	runner := NewCommandRunner(ProviderOpenCode, "echo '{\"event\":\"usage\",\"usage\":{\"inputTokens\":9}}'; echo '{\"event\":\"usage\",\"usage\":{\"outputTokens\":4}}'")
	root := t.TempDir()
	workspacePath := filepath.Join(root, "ORC-5")
	if err := os.MkdirAll(workspacePath, 0o755); err != nil {
		t.Fatalf("mkdir workspace: %v", err)
	}

	result, err := runner.RunTurn(context.Background(), TurnRequest{
		Workspace:       workspacePath,
		WorkspaceRoot:   root,
		Prompt:          "hello",
		IssueIdentifier: "ORC-5",
		Timeout:         2 * time.Second,
	}, nil)
	if err != nil {
		t.Fatalf("run turn: %v", err)
	}
	if result.Usage.InputTokens != 9 || result.Usage.OutputTokens != 4 || result.Usage.TotalTokens != 13 {
		t.Fatalf("expected merged usage 9/4/13, got %+v", result.Usage)
	}
}

func TestParseLineToEventDetectsNestedNeedsInputUnderArbitraryKeys(t *testing.T) {
	line := `{"event":"provider.event","details":{"nested":{"requires_input":true}}}`
	event := parseLineToEvent(ProviderOpenCode, "stdout", line)
	reason, blocked := detectBlockingEvent(event)
	if !blocked {
		t.Fatalf("expected nested requires_input to be treated as input required")
	}
	if !strings.Contains(reason, "input required") {
		t.Fatalf("expected input required reason, got %q", reason)
	}
}

func TestParseLineToEventDetectsStringTruthyNeedsInputFlags(t *testing.T) {
	line := `{"method":"provider/status","meta":{"needsInput":"true"}}`
	event := parseLineToEvent(ProviderOpenCode, "stdout", line)
	reason, blocked := detectBlockingEvent(event)
	if !blocked {
		t.Fatalf("expected string truthy needsInput to be treated as input required")
	}
	if !strings.Contains(reason, "input required") {
		t.Fatalf("expected input required reason, got %q", reason)
	}
}

func TestParseLineToEventDoesNotBlockOnStringFalseNeedsInputFlags(t *testing.T) {
	line := `{"method":"provider/status","meta":{"needsInput":"false","requires_input":"0"}}`
	event := parseLineToEvent(ProviderOpenCode, "stdout", line)
	if reason, blocked := detectBlockingEvent(event); blocked {
		t.Fatalf("expected no blocking for falsey string flags, got reason %q", reason)
	}
}

func TestParseLineToEventDoesNotBlockOnZeroNumericNeedsInputFlag(t *testing.T) {
	line := `{"method":"provider/status","meta":{"requires_input":0}}`
	event := parseLineToEvent(ProviderOpenCode, "stdout", line)
	if reason, blocked := detectBlockingEvent(event); blocked {
		t.Fatalf("expected no blocking for zero numeric flag, got reason %q", reason)
	}
}

func TestShouldIgnoreScannerError(t *testing.T) {
	if !shouldIgnoreScannerError(errors.New("read |0: file already closed"), nil) {
		t.Fatalf("expected file already closed to be ignored")
	}
	if !shouldIgnoreScannerError(errors.New("use of closed file"), context.Canceled) {
		t.Fatalf("expected closed file under canceled context to be ignored")
	}
	if shouldIgnoreScannerError(errors.New("permission denied"), nil) {
		t.Fatalf("did not expect unrelated scanner error to be ignored")
	}
}

func TestDetectBlockingEventPrefersApprovalOverInputSignals(t *testing.T) {
	line := `{"method":"execCommandApproval","meta":{"requires_input":true}}`
	event := parseLineToEvent(ProviderOpenCode, "stdout", line)
	reason, blocked := detectBlockingEvent(event)
	if !blocked {
		t.Fatalf("expected blocking event")
	}
	if reason != "approval required: execCommandApproval" {
		t.Fatalf("expected approval reason precedence, got %q", reason)
	}
}

func TestDetectBlockingEventDoesNotTreatApprovalSubstringAsApprovalMethod(t *testing.T) {
	line := `{"method":"provider/approval_status","params":{"requiresInput":true}}`
	event := parseLineToEvent(ProviderOpenCode, "stdout", line)
	reason, blocked := detectBlockingEvent(event)
	if !blocked {
		t.Fatalf("expected blocking event")
	}
	if reason != "input required: provider/approval_status" {
		t.Fatalf("expected input-required reason for non-approval method, got %q", reason)
	}
}
