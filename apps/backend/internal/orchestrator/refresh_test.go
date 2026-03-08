package orchestrator

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
)

type failingTrackerClient struct{}

func (failingTrackerClient) FetchCandidateIssues(context.Context, []string) ([]tracker.Issue, error) {
	return nil, errors.New("candidate failure")
}

func (failingTrackerClient) FetchIssueStatesByIDs(context.Context, []string) (map[string]string, error) {
	return nil, errors.New("states failure")
}

func (failingTrackerClient) FetchIssuesByIDs(context.Context, []string) ([]tracker.Issue, error) {
	return nil, errors.New("issues-by-id failure")
}

func (failingTrackerClient) FetchIssuesByStates(context.Context, []string) ([]tracker.Issue, error) {
	return nil, errors.New("issues failure")
}

func (failingTrackerClient) FetchIssues(context.Context, tracker.IssueFilter) ([]tracker.Issue, error) {
	return nil, errors.New("fetch-issues failure")
}

func (failingTrackerClient) SearchIssues(context.Context, string) ([]tracker.Issue, error) {
	return nil, errors.New("search-issues failure")
}

func (failingTrackerClient) CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID string) (*tracker.Issue, error) {
	return nil, errors.New("create-issue failure")
}

func (failingTrackerClient) UpdateIssue(context.Context, string, map[string]any) (*tracker.Issue, error) {
	return nil, errors.New("update-issue failure")
}

func TestPerformRefreshReconcilesRunningEntries(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{
		{IssueID: "1", IssueIdentifier: "ORC-1", State: "In Progress"},
		{IssueID: "2", IssueIdentifier: "ORC-2", State: "In Progress"},
	})

	service.SetTrackerClient(memory.NewClient([]tracker.Issue{
		{ID: "1", Identifier: "ORC-1", State: "In Progress"},
		{ID: "2", Identifier: "ORC-2", State: "Done"},
	}))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 || snapshot.Running[0].IssueID != "1" {
		t.Fatalf("expected ORC-1 only after refresh reconcile, got %+v", snapshot.Running)
	}
	if service.RefreshPending() {
		t.Fatalf("expected refresh pending to be cleared")
	}
}

func TestPerformRefreshClearsClaimsForReconciledOutIssues(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "In Progress"}, {IssueID: "2", IssueIdentifier: "ORC-2", State: "In Progress"}})
	service.SetTrackerClient(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "In Progress"}, {ID: "2", Identifier: "ORC-2", State: "Done"}}))

	first, ok := service.ClaimNextRunnable()
	if !ok {
		t.Fatalf("expected first claim")
	}
	if first.IssueID != "1" {
		_, ok = service.ClaimNextRunnable()
		if !ok {
			t.Fatalf("expected second claim")
		}
	}

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	service.RecordRunSuccess("1")
	if _, ok := service.ClaimNextRunnable(); ok {
		t.Fatalf("expected no stale claimed issue after reconcile")
	}
}

func TestPerformRefreshMovesStalledClaimedRunToRetry(t *testing.T) {
	service := NewService()
	service.SetStallTimeout(1 * time.Second)
	service.SetRetryPolicy(5, 1*time.Second, 10*time.Second)
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "In Progress"}})
	if _, ok := service.ClaimNextRunnable(); !ok {
		t.Fatalf("expected claim")
	}
	service.SetRunningForTest([]RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "In Progress",
		TurnCount:       2,
		StartedAt:       time.Now().UTC().Add(-3 * time.Second).Format(time.RFC3339),
		LastEventAt:     time.Now().UTC().Add(-3 * time.Second).Format(time.RFC3339),
		Tokens: struct {
			InputTokens  int64 `json:"input_tokens"`
			OutputTokens int64 `json:"output_tokens"`
			TotalTokens  int64 `json:"total_tokens"`
		}{InputTokens: 7, OutputTokens: 4, TotalTokens: 11},
	}})
	service.SetTrackerClient(memory.NewClient(nil))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 0 {
		t.Fatalf("expected stalled running entry removed, got %+v", snapshot.Running)
	}
	if len(snapshot.Retrying) != 1 {
		t.Fatalf("expected retry entry for stalled run, got %+v", snapshot.Retrying)
	}
	if snapshot.Retrying[0].Attempt != 3 {
		t.Fatalf("expected retry attempt 3, got %d", snapshot.Retrying[0].Attempt)
	}
	if snapshot.Retrying[0].State != "In Progress" {
		t.Fatalf("expected retry state to carry over stalled running state, got %q", snapshot.Retrying[0].State)
	}
	if snapshot.CodexTotals.TotalTokens != 11 {
		t.Fatalf("expected stalled run rollover to add tokens to totals, got %+v", snapshot.CodexTotals)
	}
}

func TestPerformRefreshDropsStalledRunAfterMaxAttempts(t *testing.T) {
	service := NewService()
	service.SetStallTimeout(1 * time.Second)
	service.SetRetryPolicy(2, 1*time.Second, 10*time.Second)
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "In Progress", TurnCount: 2}})
	if _, ok := service.ClaimNextRunnable(); !ok {
		t.Fatalf("expected claim")
	}
	service.SetRunningForTest([]RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "In Progress",
		TurnCount:       2,
		StartedAt:       time.Now().UTC().Add(-3 * time.Second).Format(time.RFC3339),
		LastEventAt:     time.Now().UTC().Add(-3 * time.Second).Format(time.RFC3339),
	}})
	service.SetTrackerClient(memory.NewClient(nil))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 0 {
		t.Fatalf("expected stalled run removed after max attempts")
	}
	if len(snapshot.Retrying) != 0 {
		t.Fatalf("expected no retry entries after max attempts, got %+v", snapshot.Retrying)
	}
	if _, ok := service.ClaimNextRunnable(); ok {
		t.Fatalf("expected no stale claim to remain")
	}
}

func TestPerformRefreshDoesNotRetryUnclaimedOldRun(t *testing.T) {
	service := NewService()
	service.SetStallTimeout(1 * time.Second)
	service.SetRunningForTest([]RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "In Progress",
		TurnCount:       2,
		StartedAt:       time.Now().UTC().Add(-3 * time.Second).Format(time.RFC3339),
		LastEventAt:     time.Now().UTC().Add(-3 * time.Second).Format(time.RFC3339),
	}})
	service.SetTrackerClient(memory.NewClient(nil))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 {
		t.Fatalf("expected unclaimed run to remain running, got %+v", snapshot.Running)
	}
	if len(snapshot.Retrying) != 0 {
		t.Fatalf("expected no retry for unclaimed run, got %+v", snapshot.Retrying)
	}
}

func TestPerformRefreshDropsRunningIssueNoLongerAssignedToWorker(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "Todo"}})
	service.SetTrackerClient(staticTrackerClient{candidates: []tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "Todo", AssignedToWorker: false}}})

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 0 {
		t.Fatalf("expected running issue to be dropped when unassigned, got %+v", snapshot.Running)
	}
}

func TestPerformRefreshDropsRunningTodoBlockedByNonTerminal(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "Todo"}})
	service.SetTrackerClient(staticTrackerClient{candidates: []tracker.Issue{{
		ID:               "1",
		Identifier:       "ORC-1",
		State:            "Todo",
		AssignedToWorker: true,
		BlockedBy:        []tracker.Blocker{{ID: "B-1", State: "In Progress"}},
	}}})

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 0 {
		t.Fatalf("expected blocked todo to be dropped from running, got %+v", snapshot.Running)
	}
}

func TestPerformRefreshClearsPendingFlagOnError(t *testing.T) {
	service := NewService()
	service.SetTrackerClient(failingTrackerClient{})

	service.QueueRefresh()
	err := service.PerformRefresh(context.Background())
	if err == nil {
		t.Fatalf("expected perform refresh error")
	}
	if service.RefreshPending() {
		t.Fatalf("expected refresh pending to be cleared after error")
	}
}

func TestPerformRefreshDropsRetryEntriesForTerminalIssuesButKeepsMissing(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done", "Cancelled"})
	service.SetRetryingForTest([]RetryEntry{
		{IssueID: "1", IssueIdentifier: "ORC-1", Attempt: 1, DueAt: time.Now().UTC().Add(1 * time.Hour).Format(time.RFC3339), Error: "transient"},
		{IssueID: "2", IssueIdentifier: "ORC-2", Attempt: 1, DueAt: time.Now().UTC().Add(1 * time.Hour).Format(time.RFC3339), Error: "transient"},
		{IssueID: "3", IssueIdentifier: "ORC-3", Attempt: 1, DueAt: time.Now().UTC().Add(1 * time.Hour).Format(time.RFC3339), Error: "transient"},
	})
	service.SetTrackerClient(memory.NewClient([]tracker.Issue{
		{ID: "1", Identifier: "ORC-1", State: "In Progress"},
		{ID: "2", Identifier: "ORC-2", State: "Done"},
	}))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Retrying) != 2 {
		t.Fatalf("expected active+missing retry entries to remain, got %+v", snapshot.Retrying)
	}
	if snapshot.Retrying[0].IssueID != "1" || snapshot.Retrying[1].IssueID != "3" {
		t.Fatalf("expected retry issues 1 and 3 to remain, got %+v", snapshot.Retrying)
	}
}

func TestPerformRefreshBackfillsRetryStateFromTracker(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetRetryingForTest([]RetryEntry{{IssueID: "1", IssueIdentifier: "ORC-1", Attempt: 1, DueAt: time.Now().UTC().Add(1 * time.Hour).Format(time.RFC3339), Error: "transient"}})
	service.SetTrackerClient(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "In Progress"}}))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Retrying) != 1 {
		t.Fatalf("expected retry entry to remain")
	}
	if snapshot.Retrying[0].State != "In Progress" {
		t.Fatalf("expected retry state backfilled from tracker, got %+v", snapshot.Retrying[0])
	}
}

func TestPerformRefreshDropsRetryEntriesNotDispatchableByAssignmentOrBlockers(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetRetryingForTest([]RetryEntry{
		{IssueID: "1", IssueIdentifier: "ORC-1", Attempt: 1, DueAt: time.Now().UTC().Add(1 * time.Hour).Format(time.RFC3339), Error: "transient"},
		{IssueID: "2", IssueIdentifier: "ORC-2", Attempt: 1, DueAt: time.Now().UTC().Add(1 * time.Hour).Format(time.RFC3339), Error: "transient"},
		{IssueID: "3", IssueIdentifier: "ORC-3", Attempt: 1, DueAt: time.Now().UTC().Add(1 * time.Hour).Format(time.RFC3339), Error: "transient"},
	})
	service.SetTrackerClient(staticTrackerClient{candidates: []tracker.Issue{
		{ID: "1", Identifier: "ORC-1", State: "In Progress", AssignedToWorker: true},
		{ID: "2", Identifier: "ORC-2", State: "Todo", AssignedToWorker: false},
		{ID: "3", Identifier: "ORC-3", State: "Todo", AssignedToWorker: true, BlockedBy: []tracker.Blocker{{ID: "B-1", State: "In Progress"}}},
	}})

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Retrying) != 1 || snapshot.Retrying[0].IssueID != "1" {
		t.Fatalf("expected only dispatchable retry entry to remain, got %+v", snapshot.Retrying)
	}
}
