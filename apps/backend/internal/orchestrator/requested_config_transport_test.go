package orchestrator

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
)

func assertRequestedEntry(t *testing.T, entry RunningEntry) {
	t.Helper()
	if entry.RequestedModel != "frozen-model" || entry.RequestedMaxTurns == nil || *entry.RequestedMaxTurns != 7 || !reflect.DeepEqual(entry.DisabledTools, []string{"shell"}) || entry.RuntimeTarget != "TAILSCALE" {
		t.Fatalf("lost frozen request: %+v", entry)
	}
}

func TestRequestedConfigAdmissionClaimFailureAndRetryStayFrozen(t *testing.T) {
	turns := 7
	tools := []string{"shell"}
	client := memory.NewClient([]tracker.Issue{{ID: "task", Identifier: "OPS-1", State: "In Progress", Provider: "CODEX", RuntimeTarget: "TAILSCALE", RequestedModel: "frozen-model", RequestedMaxTurns: &turns, DisabledTools: tools}})
	svc := NewService()
	svc.SetTrackerClient(client)
	if err := svc.PerformRefresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	turns = 99
	tools[0] = "changed"
	assertRequestedEntry(t, svc.Snapshot().Running[0])
	claimed, ok := svc.ClaimNextRunnable()
	if !ok {
		t.Fatal("not claimed")
	}
	assertRequestedEntry(t, claimed)
	*claimed.RequestedMaxTurns = 88
	claimed.DisabledTools[0] = "changed"
	assertRequestedEntry(t, svc.Snapshot().Running[0])
	svc.RecordRunFailure("task", "CODEX", "OPS-1", 1, time.Now().Add(-time.Second), errors.New("retry fixture"))
	retry := svc.Snapshot().Retrying[0]
	if retry.RequestedModel != "frozen-model" || retry.RequestedMaxTurns == nil || *retry.RequestedMaxTurns != 7 {
		t.Fatalf("lost retry config: %+v", retry)
	}
	*retry.RequestedMaxTurns = 66
	retry.DisabledTools[0] = "changed"
	// New task config cannot replace the admitted request during retry.
	svc.SetTrackerClient(memory.NewClient([]tracker.Issue{{ID: "task", Identifier: "OPS-1", State: "In Progress", RequestedModel: "new-model", RequestedMaxTurns: &turns}}))
	if err := svc.PerformRefresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	assertRequestedEntry(t, svc.Snapshot().Running[0])
}

func TestRequestedConfigSnapshotsLookupsAndSetterInputsDoNotAlias(t *testing.T) {
	turns := 7
	entry := RunningEntry{IssueID: "task", IssueIdentifier: "OPS-1", RequestedModel: "frozen-model", RequestedMaxTurns: &turns, RuntimeTarget: "TAILSCALE", DisabledTools: []string{"shell"}}
	svc := NewService()
	svc.SetRunningForTest([]RunningEntry{entry})
	turns = 99
	entry.DisabledTools[0] = "changed"
	snap := svc.Snapshot()
	*snap.Running[0].RequestedMaxTurns = 88
	snap.Running[0].DisabledTools[0] = "changed"
	lookup, ok := svc.LookupIssue("OPS-1")
	if !ok {
		t.Fatal("missing lookup")
	}
	*lookup.Running.RequestedMaxTurns = 66
	lookup.Running.DisabledTools[0] = "changed"
	assertRequestedEntry(t, svc.Snapshot().Running[0])
	turns = 7
	tools := []string{"shell"}
	svc.SetRetryingForTest([]RetryEntry{{IssueID: "retry", IssueIdentifier: "OPS-2", RequestedModel: "frozen-model", RequestedMaxTurns: &turns, DisabledTools: tools}})
	turns = 99
	tools[0] = "changed"
	lookup, ok = svc.LookupIssue("OPS-2")
	if !ok {
		t.Fatal("missing retry lookup")
	}
	*lookup.Retry.RequestedMaxTurns = 66
	lookup.Retry.DisabledTools[0] = "changed"
	retry := svc.Snapshot().Retrying[0]
	if *retry.RequestedMaxTurns != 7 || retry.DisabledTools[0] != "shell" {
		t.Fatalf("retry alias: %+v", retry)
	}
}

func TestRequestedConfigSurvivesStallRetry(t *testing.T) {
	turns := 7
	svc := NewService()
	svc.SetStallTimeout(time.Second)
	svc.SetRunningForTest([]RunningEntry{{IssueID: "task", IssueIdentifier: "OPS-1", Provider: "CODEX", AssigneeID: "agent-codex", RequestedModel: "frozen-model", RequestedMaxTurns: &turns, RuntimeTarget: "TAILSCALE", DisabledTools: []string{"shell"}, StartedAt: time.Now().Add(-time.Hour).UTC().Format(time.RFC3339), LastEventAt: time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)}})
	svc.claimed["task"] = true
	svc.reconcileStalledRunningIssues()
	retry := svc.Snapshot().Retrying[0]
	if retry.Provider != "CODEX" || retry.AssigneeID != "agent-codex" || retry.RequestedModel != "frozen-model" || retry.RequestedMaxTurns == nil || *retry.RequestedMaxTurns != 7 || retry.RuntimeTarget != "TAILSCALE" || retry.DisabledTools[0] != "shell" {
		t.Fatalf("stall lost policy: %+v", retry)
	}
}

func TestRequestedRunningConfigPersistsAndRestoresAfterReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "runs.db")
	database, err := db.Connect(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	client := trackersqlite.NewClient(database, nil)
	issue, err := client.CreateIssue(ctx, "Task", "Body", "In Progress", 0, "", "", "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	turns := 7
	svc := NewService()
	svc.SetDB(database)
	svc.SetRunningForTest([]RunningEntry{{IssueID: issue.ID, IssueIdentifier: issue.Identifier, State: "In Progress", Provider: "CODEX", RequestedModel: "frozen-model", RequestedMaxTurns: &turns, RuntimeTarget: "TAILSCALE", DisabledTools: []string{"shell"}}})
	if err := svc.PersistStateToDB(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UpdateIssue(ctx, issue.ID, map[string]any{"requested_model": "new-model", "requested_max_turns": 99, "disabled_tools": []string{"other"}}); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := db.Connect(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	recovered := NewService()
	recovered.SetDB(reopened)
	if err := recovered.RestoreStateFromDB(ctx); err != nil {
		t.Fatal(err)
	}
	assertRequestedEntry(t, recovered.Snapshot().Running[0])
	// A corrupt stored tool policy must not silently restore unrestricted.
	for _, invalid := range []string{"invalid JSON", "[null]", "[true]"} {
		if _, err := reopened.ExecContext(ctx, "UPDATE runs SET disabled_tools = ?", invalid); err != nil {
			t.Fatal(err)
		}
		failClosed := NewService()
		failClosed.SetDB(reopened)
		if err := failClosed.RestoreStateFromDB(ctx); err == nil || len(failClosed.Snapshot().Running) != 0 {
			t.Fatalf("restored corrupt restrictions %s: %v", invalid, err)
		}
	}
}
