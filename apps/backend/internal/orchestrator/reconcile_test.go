package orchestrator

import (
	"testing"
	"time"
)

func TestReconcileRunningStatesRemovesTerminalAndInactive(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{
		{IssueID: "1", IssueIdentifier: "ORC-1", State: "In Progress"},
		{IssueID: "2", IssueIdentifier: "ORC-2", State: "In Progress"},
		{IssueID: "3", IssueIdentifier: "ORC-3", State: "In Progress"},
	})

	service.ReconcileRunningStates(
		[]string{"Todo", "In Progress"},
		[]string{"Done", "Cancelled"},
		map[string]string{
			"1": "In Progress",
			"2": "Done",
			"3": "Backlog",
		},
	)

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 {
		t.Fatalf("expected only one running issue after reconcile, got %d", len(snapshot.Running))
	}
	if snapshot.Running[0].IssueID != "1" {
		t.Fatalf("expected ORC-1 to remain, got %+v", snapshot.Running)
	}
}

func TestReconcileRunningStatesUpdatesStateFromRefresh(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "Todo"}})

	service.ReconcileRunningStates(
		[]string{"Todo", "In Progress"},
		[]string{"Done"},
		map[string]string{"1": "In Progress"},
	)

	snapshot := service.Snapshot()
	if snapshot.Running[0].State != "In Progress" {
		t.Fatalf("expected updated running state, got %q", snapshot.Running[0].State)
	}
}

func TestReconcileRunningStatesAccumulatesTotalsForRemovedEntries(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "In Progress",
		StartedAt:       time.Now().UTC().Add(-2 * time.Second).Format(time.RFC3339),
		Tokens: struct {
			InputTokens  int64 `json:"input_tokens"`
			OutputTokens int64 `json:"output_tokens"`
			TotalTokens  int64 `json:"total_tokens"`
		}{InputTokens: 6, OutputTokens: 2, TotalTokens: 8},
	}})

	service.ReconcileRunningStates(
		[]string{"Todo", "In Progress"},
		[]string{"Done"},
		map[string]string{"1": "Done"},
	)

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 0 {
		t.Fatalf("expected reconciled terminal issue removed from running")
	}
	if snapshot.CodexTotals.TotalTokens != 8 || snapshot.CodexTotals.InputTokens != 6 || snapshot.CodexTotals.OutputTokens != 2 {
		t.Fatalf("expected reconcile removal to accumulate tokens, got %+v", snapshot.CodexTotals)
	}
}
