package presenter

import (
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
)

func TestStatePayloadIncludesRunningAndRetrying(t *testing.T) {
	snapshot := orchestrator.Snapshot{
		GeneratedAt: "2026-01-01T00:00:00Z",
		Counts:      orchestrator.SnapshotCount{Running: 1, Retrying: 1},
		Running:     []orchestrator.RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "In Progress", SessionLogPath: "/tmp/s.log", LastMessage: "ok"}},
		Retrying:    []orchestrator.RetryEntry{{IssueID: "2", IssueIdentifier: "ORC-2", State: "Todo", Attempt: 2, Error: "failed"}},
	}

	payload := StatePayload(snapshot)
	running, ok := payload["running"].([]map[string]any)
	if !ok || len(running) != 1 {
		t.Fatalf("expected one running entry, got %T %#v", payload["running"], payload["running"])
	}
	retrying, ok := payload["retrying"].([]map[string]any)
	if !ok || len(retrying) != 1 {
		t.Fatalf("expected one retrying entry, got %T %#v", payload["retrying"], payload["retrying"])
	}
	if running[0]["session_log_path"] != "/tmp/s.log" {
		t.Fatalf("expected running session_log_path, got %+v", running[0])
	}
	if retrying[0]["state"] != "Todo" {
		t.Fatalf("expected retrying state field, got %+v", retrying[0])
	}
}

func TestStatePayloadIncludesTotalsAndRateLimits(t *testing.T) {
	snapshot := orchestrator.Snapshot{
		CodexTotals: orchestrator.CodexTotals{InputTokens: 7, OutputTokens: 3, TotalTokens: 10, SecondsRun: 4.5},
		RateLimits:  map[string]any{"remaining": 12},
	}

	payload := StatePayload(snapshot)
	totals, ok := payload["codex_totals"].(orchestrator.CodexTotals)
	if !ok {
		t.Fatalf("expected codex_totals payload, got %T", payload["codex_totals"])
	}
	if totals.TotalTokens != 10 || totals.InputTokens != 7 || totals.OutputTokens != 3 {
		t.Fatalf("unexpected codex totals payload: %+v", totals)
	}
	rateLimits, ok := payload["rate_limits"].(map[string]any)
	if !ok || rateLimits["remaining"] != 12 {
		t.Fatalf("unexpected rate limits payload: %+v", payload["rate_limits"])
	}
}

func TestStatePayloadHumanizesLongMessages(t *testing.T) {
	long := ""
	for i := 0; i < 260; i++ {
		long += "x"
	}
	snapshot := orchestrator.Snapshot{
		Running:  []orchestrator.RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", LastMessage: long}},
		Retrying: []orchestrator.RetryEntry{{IssueID: "2", IssueIdentifier: "ORC-2", Error: long}},
	}

	payload := StatePayload(snapshot)
	running := payload["running"].([]map[string]any)
	retrying := payload["retrying"].([]map[string]any)

	if len(running[0]["last_message"].(string)) > 241 {
		t.Fatalf("expected running last_message to be truncated, got len=%d", len(running[0]["last_message"].(string)))
	}
	if len(retrying[0]["error"].(string)) > 241 {
		t.Fatalf("expected retry error to be truncated, got len=%d", len(retrying[0]["error"].(string)))
	}
}

func TestIssuePayloadFindsRunningIssue(t *testing.T) {
	snapshot := orchestrator.Snapshot{
		Running: []orchestrator.RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "In Progress", SessionLogPath: "/tmp/run.log"}},
	}

	payload, ok := IssuePayload(snapshot, "ORC-1")
	if !ok {
		t.Fatalf("expected issue payload")
	}
	if payload["status"] != "running" {
		t.Fatalf("expected running status, got %v", payload["status"])
	}
	running, _ := payload["running"].(map[string]any)
	if running["session_log_path"] != "/tmp/run.log" {
		t.Fatalf("expected issue payload running session_log_path, got %+v", running)
	}
}

func TestIssuePayloadFindsRetryIssueIncludesState(t *testing.T) {
	snapshot := orchestrator.Snapshot{
		Retrying: []orchestrator.RetryEntry{{IssueID: "2", IssueIdentifier: "ORC-2", State: "Todo", Attempt: 2, DueAt: "soon", Error: "failed"}},
	}

	payload, ok := IssuePayload(snapshot, "ORC-2")
	if !ok {
		t.Fatalf("expected retry issue payload")
	}
	if payload["status"] != "retrying" {
		t.Fatalf("expected retrying status, got %v", payload["status"])
	}
	retry, _ := payload["retry"].(map[string]any)
	if retry["state"] != "Todo" {
		t.Fatalf("expected retry payload state, got %+v", retry)
	}
}

func TestIssuePayloadMissingIssue(t *testing.T) {
	payload, ok := IssuePayload(orchestrator.Snapshot{}, "ORC-404")
	if ok || payload != nil {
		t.Fatalf("expected missing issue result")
	}
}

func TestHumanizeMessageTruncatesLongInput(t *testing.T) {
	long := ""
	for i := 0; i < 260; i++ {
		long += "x"
	}
	out := humanizeMessage(long)
	if len(out) > 241 {
		t.Fatalf("expected truncated message length <= 241, got %d", len(out))
	}
}
