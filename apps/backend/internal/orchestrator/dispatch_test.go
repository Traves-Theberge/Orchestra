package orchestrator

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
)

type staticTrackerClient struct {
	candidates []tracker.Issue
}

func (s staticTrackerClient) FetchCandidateIssues(_ context.Context, _ []string) ([]tracker.Issue, error) {
	return s.candidates, nil
}

func (s staticTrackerClient) FetchIssueStatesByIDs(_ context.Context, _ []string) (map[string]string, error) {
	return map[string]string{}, nil
}

func (s staticTrackerClient) FetchIssuesByIDs(_ context.Context, issueIDs []string) ([]tracker.Issue, error) {
	out := make([]tracker.Issue, 0, len(issueIDs))
	for _, id := range issueIDs {
		for _, issue := range s.candidates {
			if issue.ID == id {
				out = append(out, issue)
				break
			}
		}
	}
	return out, nil
}

func (s staticTrackerClient) FetchIssuesByStates(_ context.Context, _ []string) ([]tracker.Issue, error) {
	return []tracker.Issue{}, nil
}

type stateMapTrackerClient struct {
	states map[string]string
	err    error
}

func (s stateMapTrackerClient) FetchCandidateIssues(_ context.Context, _ []string) ([]tracker.Issue, error) {
	return []tracker.Issue{}, nil
}

func (s stateMapTrackerClient) FetchIssueStatesByIDs(_ context.Context, issueIDs []string) (map[string]string, error) {
	if s.err != nil {
		return nil, s.err
	}
	out := map[string]string{}
	for _, id := range issueIDs {
		if state, ok := s.states[id]; ok {
			out[id] = state
		}
	}
	return out, nil
}

func (s stateMapTrackerClient) FetchIssuesByIDs(_ context.Context, issueIDs []string) ([]tracker.Issue, error) {
	if s.err != nil {
		return nil, s.err
	}
	out := make([]tracker.Issue, 0, len(issueIDs))
	for _, id := range issueIDs {
		if state, ok := s.states[id]; ok {
			out = append(out, tracker.Issue{ID: id, Identifier: "ORC-" + id, State: state, AssignedToWorker: true})
		}
	}
	return out, nil
}

func (s stateMapTrackerClient) FetchIssuesByStates(_ context.Context, _ []string) ([]tracker.Issue, error) {
	return []tracker.Issue{}, nil
}

func TestPerformRefreshEnqueuesCandidatesUpToConcurrency(t *testing.T) {
	service := NewService()
	service.SetMaxConcurrent(2)
	service.SetTrackerClient(memory.NewClient([]tracker.Issue{
		{ID: "1", Identifier: "ORC-1", State: "Todo"},
		{ID: "2", Identifier: "ORC-2", State: "Todo"},
		{ID: "3", Identifier: "ORC-3", State: "Todo"},
	}))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 2 {
		t.Fatalf("expected 2 running due to concurrency limit, got %d", len(snapshot.Running))
	}
}

func TestShouldRetryAttemptHonorsMaxRetryPolicy(t *testing.T) {
	service := NewService()
	service.SetRetryPolicy(2, 1*time.Second, 1*time.Minute)

	if service.ShouldRetryAttempt(0) {
		t.Fatalf("expected attempt 0 to be non-retryable")
	}
	if !service.ShouldRetryAttempt(1) || !service.ShouldRetryAttempt(2) {
		t.Fatalf("expected attempts within max to be retryable")
	}
	if service.ShouldRetryAttempt(3) {
		t.Fatalf("expected attempts above max to be non-retryable")
	}
}

func TestPerformRefreshHonorsPerStateConcurrencyLimit(t *testing.T) {
	service := NewService()
	service.SetMaxConcurrent(5)
	service.SetMaxConcurrentByState(map[string]int{"Todo": 1, "In Progress": 2})
	service.SetTrackerClient(memory.NewClient([]tracker.Issue{
		{ID: "1", Identifier: "ORC-1", State: "Todo"},
		{ID: "2", Identifier: "ORC-2", State: "Todo"},
		{ID: "3", Identifier: "ORC-3", State: "In Progress"},
		{ID: "4", Identifier: "ORC-4", State: "In Progress"},
		{ID: "5", Identifier: "ORC-5", State: "In Progress"},
	}))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 3 {
		t.Fatalf("expected 3 running from per-state limits, got %d", len(snapshot.Running))
	}

	todoCount := 0
	inProgressCount := 0
	for _, entry := range snapshot.Running {
		switch entry.State {
		case "Todo":
			todoCount++
		case "In Progress":
			inProgressCount++
		}
	}
	if todoCount != 1 || inProgressCount != 2 {
		t.Fatalf("expected todo=1 and in_progress=2, got todo=%d in_progress=%d", todoCount, inProgressCount)
	}
}

func TestPerformRefreshSkipsIssuesNotAssignedToWorker(t *testing.T) {
	service := NewService()
	service.SetTrackerClient(staticTrackerClient{candidates: []tracker.Issue{
		{ID: "1", Identifier: "ORC-1", State: "Todo", AssignedToWorker: false},
		{ID: "2", Identifier: "ORC-2", State: "Todo", AssignedToWorker: true},
	}})

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 || snapshot.Running[0].IssueID != "2" {
		t.Fatalf("expected only worker-routable issue queued, got %+v", snapshot.Running)
	}
}

func TestPerformRefreshSkipsCandidatesOutsideActiveStates(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetTrackerClient(staticTrackerClient{candidates: []tracker.Issue{
		{ID: "1", Identifier: "ORC-1", State: "Done", AssignedToWorker: true},
		{ID: "2", Identifier: "ORC-2", State: "Todo", AssignedToWorker: true},
	}})

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 || snapshot.Running[0].IssueID != "2" {
		t.Fatalf("expected only active-state issue queued, got %+v", snapshot.Running)
	}
}

func TestPerformRefreshSkipsTodoBlockedByNonTerminalIssue(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done", "Cancelled"})
	service.SetTrackerClient(memory.NewClient([]tracker.Issue{
		{ID: "1", Identifier: "ORC-1", State: "Todo", BlockedBy: []tracker.Blocker{{ID: "B-1", State: "In Progress"}}},
		{ID: "2", Identifier: "ORC-2", State: "Todo"},
	}))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 || snapshot.Running[0].IssueID != "2" {
		t.Fatalf("expected only unblocked todo to be queued, got %+v", snapshot.Running)
	}
}

func TestPerformRefreshAllowsTodoBlockedOnlyByTerminalIssues(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done", "Cancelled"})
	service.SetTrackerClient(memory.NewClient([]tracker.Issue{
		{ID: "1", Identifier: "ORC-1", State: "Todo", BlockedBy: []tracker.Blocker{{ID: "B-1", State: "Done"}}},
	}))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 || snapshot.Running[0].IssueID != "1" {
		t.Fatalf("expected todo with terminal blockers to be queued, got %+v", snapshot.Running)
	}
}

func TestReleaseDueRetriesMovesToRunning(t *testing.T) {
	service := NewService()
	service.SetRetryingForTest([]RetryEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "Todo",
		Attempt:         2,
		DueAt:           time.Now().UTC().Add(-1 * time.Minute).Format(time.RFC3339),
		Error:           "transient",
	}})
	service.SetTrackerClient(memory.NewClient(nil))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 {
		t.Fatalf("expected retry to move into running queue, got %+v", snapshot)
	}
	if len(snapshot.Retrying) != 0 {
		t.Fatalf("expected retry queue drained for due entry")
	}
}

func TestReleaseDueRetriesRespectsPerStateConcurrencyLimits(t *testing.T) {
	service := NewService()
	service.SetMaxConcurrent(5)
	service.SetMaxConcurrentByState(map[string]int{"Todo": 1})
	service.SetRunningForTest([]RunningEntry{{IssueID: "active-1", IssueIdentifier: "ORC-0", State: "Todo"}})
	service.SetRetryingForTest([]RetryEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "Todo",
		Attempt:         2,
		DueAt:           time.Now().UTC().Add(-1 * time.Minute).Format(time.RFC3339),
		Error:           "transient",
	}})
	service.SetTrackerClient(memory.NewClient(nil))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 || snapshot.Running[0].IssueID != "active-1" {
		t.Fatalf("expected existing Todo to remain the only running item, got %+v", snapshot.Running)
	}
	if len(snapshot.Retrying) != 1 || snapshot.Retrying[0].IssueID != "1" {
		t.Fatalf("expected Todo retry to stay queued due to state limit, got %+v", snapshot.Retrying)
	}
}

func TestReleaseDueRetriesUsesRetryStateAsRunningState(t *testing.T) {
	service := NewService()
	service.SetRetryingForTest([]RetryEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "In Progress",
		Attempt:         2,
		DueAt:           time.Now().UTC().Add(-1 * time.Minute).Format(time.RFC3339),
		Error:           "transient",
	}})
	service.SetTrackerClient(memory.NewClient(nil))

	service.QueueRefresh()
	if err := service.PerformRefresh(context.Background()); err != nil {
		t.Fatalf("perform refresh: %v", err)
	}

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 {
		t.Fatalf("expected retry to move into running queue, got %+v", snapshot)
	}
	if snapshot.Running[0].State != "In Progress" {
		t.Fatalf("expected running state from retry metadata, got %q", snapshot.Running[0].State)
	}
}

func TestRecordRunFailureCreatesRetryAndRemovesRunning(t *testing.T) {
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
		}{InputTokens: 8, OutputTokens: 2, TotalTokens: 10},
	}})

	service.RecordRunFailure("1", "ORC-1", 3, time.Now().UTC().Add(10*time.Second), context.DeadlineExceeded)

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 0 {
		t.Fatalf("expected running cleared after failure")
	}
	if len(snapshot.Retrying) != 1 {
		t.Fatalf("expected one retry entry after failure")
	}
	if snapshot.Retrying[0].Attempt != 3 {
		t.Fatalf("expected retry attempt 3, got %d", snapshot.Retrying[0].Attempt)
	}
	if snapshot.Retrying[0].State != "In Progress" {
		t.Fatalf("expected retry state propagated from running entry, got %q", snapshot.Retrying[0].State)
	}
	if snapshot.CodexTotals.TotalTokens != 10 || snapshot.CodexTotals.InputTokens != 8 || snapshot.CodexTotals.OutputTokens != 2 {
		t.Fatalf("expected failure path to preserve token totals, got %+v", snapshot.CodexTotals)
	}
}

func TestRecordRunFailureDerivesTotalTokensWhenMissing(t *testing.T) {
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
		}{InputTokens: 5, OutputTokens: 3, TotalTokens: 0},
	}})

	service.RecordRunFailure("1", "ORC-1", 1, time.Now().UTC().Add(10*time.Second), context.DeadlineExceeded)
	snapshot := service.Snapshot()
	if snapshot.CodexTotals.TotalTokens != 8 {
		t.Fatalf("expected derived failure total tokens 8, got %+v", snapshot.CodexTotals)
	}
}

func TestRecordRunSuccessRemovesRunningEntry(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1"}, {IssueID: "2", IssueIdentifier: "ORC-2"}})

	service.RecordRunSuccess("1")

	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 || snapshot.Running[0].IssueID != "2" {
		t.Fatalf("expected only ORC-2 to remain running, got %+v", snapshot.Running)
	}
}

func TestClaimNextRunnableClaimsOnlyOnceUntilRelease(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1"}})

	first, ok := service.ClaimNextRunnable()
	if !ok || first.IssueID != "1" {
		t.Fatalf("expected first claim for issue 1, got %+v", first)
	}

	if _, ok := service.ClaimNextRunnable(); ok {
		t.Fatalf("expected no second claim while issue is claimed")
	}

	service.ReleaseClaim("1")
	if _, ok := service.ClaimNextRunnable(); !ok {
		t.Fatalf("expected claim available after release")
	}
}

func TestRecordRunResultAccumulatesTotals(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1"}})

	service.RecordRunResult("1", "session-1", 10, 3, 13)
	snapshot := service.Snapshot()

	if snapshot.CodexTotals.TotalTokens != 13 {
		t.Fatalf("expected codex total tokens 13, got %d", snapshot.CodexTotals.TotalTokens)
	}
	if snapshot.CodexTotals.InputTokens != 10 || snapshot.CodexTotals.OutputTokens != 3 {
		t.Fatalf("unexpected codex totals: %+v", snapshot.CodexTotals)
	}
}

func TestRecordRunFailureStopsRetryAfterMaxAttempts(t *testing.T) {
	service := NewService()
	service.SetRetryPolicy(2, 5*time.Second, 10*time.Minute)
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1"}})

	service.RecordRunFailure("1", "ORC-1", 3, time.Now().UTC().Add(1*time.Minute), context.DeadlineExceeded)

	snapshot := service.Snapshot()
	if len(snapshot.Retrying) != 0 {
		t.Fatalf("expected no retry beyond max attempts, got %+v", snapshot.Retrying)
	}
}

func TestNextRetryDueHonorsBackoffBounds(t *testing.T) {
	service := NewService()
	service.SetRetryPolicy(5, 2*time.Second, 8*time.Second)

	start := time.Now().UTC()
	due := service.NextRetryDue("ORC-42", 4)
	min := start.Add(8 * time.Second)
	max := start.Add(10 * time.Second)

	if due.Before(min) || due.After(max) {
		t.Fatalf("expected due between %s and %s, got %s", min.Format(time.RFC3339Nano), max.Format(time.RFC3339Nano), due.Format(time.RFC3339Nano))
	}
}

func TestComputeRetryDueUsesAttemptFloorOfOne(t *testing.T) {
	start := time.Now().UTC()
	due := computeRetryDue("ORC-42", 0, 2*time.Second, 30*time.Second)
	min := start.Add(2 * time.Second)
	max := start.Add(3 * time.Second)

	if due.Before(min) || due.After(max) {
		t.Fatalf("expected floored-attempt due between %s and %s, got %s", min.Format(time.RFC3339Nano), max.Format(time.RFC3339Nano), due.Format(time.RFC3339Nano))
	}
}

func TestComputeRetryDueSquaresAttemptBeforeApplyingJitter(t *testing.T) {
	start := time.Now().UTC()
	due := computeRetryDue("ORC-43", 2, 2*time.Second, 30*time.Second)
	min := start.Add(8 * time.Second)
	max := start.Add(9 * time.Second)

	if due.Before(min) || due.After(max) {
		t.Fatalf("expected squared-attempt due between %s and %s, got %s", min.Format(time.RFC3339Nano), max.Format(time.RFC3339Nano), due.Format(time.RFC3339Nano))
	}
}

func TestRetryJitterStableWithinSameMinuteForSameIssue(t *testing.T) {
	now := time.Date(2026, time.March, 6, 12, 30, 10, 0, time.UTC)
	first := retryJitter("ORC-42", now)
	second := retryJitter("ORC-42", now.Add(45*time.Second))

	if first != second {
		t.Fatalf("expected stable jitter within same minute, got %s vs %s", first, second)
	}
}

func TestRetryJitterDiffersAcrossIssueIDs(t *testing.T) {
	now := time.Date(2026, time.March, 6, 12, 30, 10, 0, time.UTC)
	left := retryJitter("ORC-42", now)
	right := retryJitter("ORC-99", now)

	if left == right {
		t.Fatalf("expected different jitter buckets across issue IDs, got %s", left)
	}
}

func TestRecordRunEventUpdatesRunningStatus(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", LastEvent: "dispatch_queued"}})

	service.RecordRunEvent("1", agents.Event{
		Provider:  agents.ProviderCodex,
		Kind:      "turn/completed",
		Message:   "Completed turn",
		Timestamp: time.Now().UTC(),
		Usage:     agents.TokenUsage{InputTokens: 20, OutputTokens: 7, TotalTokens: 27},
	})

	snapshot := service.Snapshot()
	if snapshot.Running[0].LastEvent != "turn/completed" {
		t.Fatalf("expected updated last event, got %q", snapshot.Running[0].LastEvent)
	}
	if snapshot.Running[0].Tokens.TotalTokens != 27 {
		t.Fatalf("expected running token total 27, got %d", snapshot.Running[0].Tokens.TotalTokens)
	}
}

func TestShouldContinueTurnHonorsMaxTurns(t *testing.T) {
	service := NewService()
	continueTurn, err := service.ShouldContinueTurn(context.Background(), "issue-1", 3, 3)
	if err != nil {
		t.Fatalf("should continue turn: %v", err)
	}
	if continueTurn {
		t.Fatalf("expected no continuation when max turns reached")
	}
}

func TestShouldContinueTurnChecksTrackerState(t *testing.T) {
	service := NewService()
	service.SetTrackerClient(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "In Progress"}}))
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})

	continueTurn, err := service.ShouldContinueTurn(context.Background(), "1", 1, 5)
	if err != nil {
		t.Fatalf("should continue turn: %v", err)
	}
	if !continueTurn {
		t.Fatalf("expected continuation for active state")
	}

	service.SetTrackerClient(memory.NewClient([]tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "Done"}}))
	continueTurn, err = service.ShouldContinueTurn(context.Background(), "1", 1, 5)
	if err != nil {
		t.Fatalf("should continue turn: %v", err)
	}
	if continueTurn {
		t.Fatalf("expected stop for terminal state")
	}
}

func TestShouldContinueTurnStopsWhenIssueUnassigned(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetTrackerClient(staticTrackerClient{candidates: []tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "In Progress", AssignedToWorker: false}}})

	continueTurn, err := service.ShouldContinueTurn(context.Background(), "1", 1, 5)
	if err != nil {
		t.Fatalf("should continue turn: %v", err)
	}
	if continueTurn {
		t.Fatalf("expected stop when issue becomes unassigned")
	}
}

func TestShouldContinueTurnStopsWhenTodoBlockedByNonTerminal(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetTrackerClient(staticTrackerClient{candidates: []tracker.Issue{{
		ID:               "1",
		Identifier:       "ORC-1",
		State:            "Todo",
		AssignedToWorker: true,
		BlockedBy:        []tracker.Blocker{{ID: "B-1", State: "In Progress"}},
	}}})

	continueTurn, err := service.ShouldContinueTurn(context.Background(), "1", 1, 5)
	if err != nil {
		t.Fatalf("should continue turn: %v", err)
	}
	if continueTurn {
		t.Fatalf("expected stop when todo becomes blocked by non-terminal issue")
	}
}

func TestPrepareNextTurnIncrementsTurnAndReleasesClaim(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", TurnCount: 0}})
	_, _ = service.ClaimNextRunnable()

	service.PrepareNextTurn("1", 1)

	snapshot := service.Snapshot()
	if snapshot.Running[0].TurnCount != 1 {
		t.Fatalf("expected turn count 1, got %d", snapshot.Running[0].TurnCount)
	}
	if _, ok := service.ClaimNextRunnable(); !ok {
		t.Fatalf("expected claim available after prepare next turn")
	}
}

func TestRecordRunSuccessAccumulatesSecondsRun(t *testing.T) {
	service := NewService()
	startedAt := time.Now().UTC().Add(-2 * time.Second).Format(time.RFC3339)
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", StartedAt: startedAt}})

	service.RecordRunSuccess("1")
	snapshot := service.Snapshot()

	if snapshot.CodexTotals.SecondsRun < 1 {
		t.Fatalf("expected seconds_running >= 1, got %f", snapshot.CodexTotals.SecondsRun)
	}
}

func TestRecordRunEventUpdatesRateLimits(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", StartedAt: time.Now().UTC().Format(time.RFC3339)}})

	service.RecordRunEvent("1", agents.Event{Kind: "rate_limit", Raw: map[string]any{"rate_limits": map[string]any{"remaining": 42}}, Timestamp: time.Now().UTC()})
	snapshot := service.Snapshot()

	rateLimits, ok := snapshot.RateLimits.(map[string]any)
	if !ok {
		t.Fatalf("expected rate_limits map, got %T", snapshot.RateLimits)
	}
	if rateLimits["remaining"] != float64(42) && rateLimits["remaining"] != 42 {
		t.Fatalf("unexpected rate limit payload: %+v", rateLimits)
	}
}

func TestRecordRunEventUpdatesNestedRateLimits(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", StartedAt: time.Now().UTC().Format(time.RFC3339)}})

	service.RecordRunEvent("1", agents.Event{
		Kind:      "provider_event",
		Raw:       map[string]any{"meta": map[string]any{"rateLimits": map[string]any{"remaining": 7, "reset_at": "soon"}}},
		Timestamp: time.Now().UTC(),
	})
	snapshot := service.Snapshot()

	rateLimits, ok := snapshot.RateLimits.(map[string]any)
	if !ok {
		t.Fatalf("expected nested rate limits map, got %T", snapshot.RateLimits)
	}
	if rateLimits["remaining"] != 7 {
		t.Fatalf("unexpected nested rate limits payload: %+v", rateLimits)
	}
}

func TestRecordRunEventPreservesExistingLastEventAndMessageWhenEmpty(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		LastEvent:       "run_claimed",
		LastMessage:     "claimed",
		StartedAt:       time.Now().UTC().Format(time.RFC3339),
	}})

	service.RecordRunEvent("1", agents.Event{Kind: "", Message: "", Timestamp: time.Now().UTC()})
	snapshot := service.Snapshot()

	if snapshot.Running[0].LastEvent != "run_claimed" {
		t.Fatalf("expected last event to be preserved, got %q", snapshot.Running[0].LastEvent)
	}
	if snapshot.Running[0].LastMessage != "claimed" {
		t.Fatalf("expected last message to be preserved, got %q", snapshot.Running[0].LastMessage)
	}
}

func TestRecordRunEventDerivesTotalTokensWhenMissing(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", StartedAt: time.Now().UTC().Format(time.RFC3339)}})

	service.RecordRunEvent("1", agents.Event{
		Kind:      "token_update",
		Timestamp: time.Now().UTC(),
		Usage:     agents.TokenUsage{InputTokens: 9, OutputTokens: 5},
	})

	snapshot := service.Snapshot()
	if snapshot.Running[0].Tokens.TotalTokens != 14 {
		t.Fatalf("expected derived total tokens 14, got %d", snapshot.Running[0].Tokens.TotalTokens)
	}
}

func TestRecordRunEventUpdatesRateLimitsFromParamsEnvelope(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", StartedAt: time.Now().UTC().Format(time.RFC3339)}})

	service.RecordRunEvent("1", agents.Event{
		Kind:      "thread/rate_limits",
		Timestamp: time.Now().UTC(),
		Raw:       map[string]any{"params": map[string]any{"rate_limits": map[string]any{"remaining": 11}}},
	})
	snapshot := service.Snapshot()

	rateLimits, ok := snapshot.RateLimits.(map[string]any)
	if !ok {
		t.Fatalf("expected params-envelope rate limits map, got %T", snapshot.RateLimits)
	}
	if rateLimits["remaining"] != 11 {
		t.Fatalf("unexpected params-envelope rate limits payload: %+v", rateLimits)
	}
}

func TestRecordRunEventUpdatesRateLimitsFromJSONStringEnvelope(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", StartedAt: time.Now().UTC().Format(time.RFC3339)}})

	service.RecordRunEvent("1", agents.Event{
		Kind:      "thread/rate_limits",
		Timestamp: time.Now().UTC(),
		Raw:       map[string]any{"meta": `{"rateLimits":{"remaining":5}}`},
	})
	snapshot := service.Snapshot()

	rateLimits, ok := snapshot.RateLimits.(map[string]any)
	if !ok {
		t.Fatalf("expected string-envelope rate limits map, got %T", snapshot.RateLimits)
	}
	if rateLimits["remaining"] != float64(5) && rateLimits["remaining"] != 5 {
		t.Fatalf("unexpected string-envelope rate limits payload: %+v", rateLimits)
	}
}

func TestRecordRunEventUpdatesRateLimitsFromArrayEnvelope(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", StartedAt: time.Now().UTC().Format(time.RFC3339)}})

	service.RecordRunEvent("1", agents.Event{
		Kind:      "thread/rate_limits",
		Timestamp: time.Now().UTC(),
		Raw: map[string]any{
			"data": []any{map[string]any{"meta": map[string]any{"rate-limits": map[string]any{"remaining": 3}}}},
		},
	})
	snapshot := service.Snapshot()

	rateLimits, ok := snapshot.RateLimits.(map[string]any)
	if !ok {
		t.Fatalf("expected array-envelope rate limits map, got %T", snapshot.RateLimits)
	}
	if rateLimits["remaining"] != 3 {
		t.Fatalf("unexpected array-envelope rate limits payload: %+v", rateLimits)
	}
}

func TestRevalidateClaimedIssueRemovesMissingIssue(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "Todo"}})
	if _, ok := service.ClaimNextRunnable(); !ok {
		t.Fatalf("expected claim")
	}
	service.SetTrackerClient(stateMapTrackerClient{states: map[string]string{}})

	keep, err := service.RevalidateClaimedIssue(context.Background(), "1")
	if err != nil {
		t.Fatalf("revalidate claimed issue: %v", err)
	}
	if keep {
		t.Fatalf("expected missing issue to be dropped")
	}
	snapshot := service.Snapshot()
	if len(snapshot.Running) != 0 {
		t.Fatalf("expected missing issue removed from running, got %+v", snapshot.Running)
	}
}

func TestRevalidateClaimedIssueRemovesTerminalIssue(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "In Progress"}})
	if _, ok := service.ClaimNextRunnable(); !ok {
		t.Fatalf("expected claim")
	}
	service.SetTrackerClient(stateMapTrackerClient{states: map[string]string{"1": "Done"}})

	keep, err := service.RevalidateClaimedIssue(context.Background(), "1")
	if err != nil {
		t.Fatalf("revalidate claimed issue: %v", err)
	}
	if keep {
		t.Fatalf("expected terminal issue to be dropped")
	}
	snapshot := service.Snapshot()
	if len(snapshot.Running) != 0 {
		t.Fatalf("expected terminal issue removed from running, got %+v", snapshot.Running)
	}
}

func TestRevalidateClaimedIssueRemovesUnassignedIssue(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "Todo"}})
	if _, ok := service.ClaimNextRunnable(); !ok {
		t.Fatalf("expected claim")
	}
	service.SetTrackerClient(staticTrackerClient{candidates: []tracker.Issue{{ID: "1", Identifier: "ORC-1", State: "Todo", AssignedToWorker: false}}})

	keep, err := service.RevalidateClaimedIssue(context.Background(), "1")
	if err != nil {
		t.Fatalf("revalidate claimed issue: %v", err)
	}
	if keep {
		t.Fatalf("expected unassigned issue to be dropped")
	}
}

func TestRevalidateClaimedIssueRemovesTodoBlockedByNonTerminal(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "Todo"}})
	if _, ok := service.ClaimNextRunnable(); !ok {
		t.Fatalf("expected claim")
	}
	service.SetTrackerClient(staticTrackerClient{candidates: []tracker.Issue{{
		ID:               "1",
		Identifier:       "ORC-1",
		State:            "Todo",
		AssignedToWorker: true,
		BlockedBy:        []tracker.Blocker{{ID: "B-1", State: "In Progress"}},
	}}})

	keep, err := service.RevalidateClaimedIssue(context.Background(), "1")
	if err != nil {
		t.Fatalf("revalidate claimed issue: %v", err)
	}
	if keep {
		t.Fatalf("expected blocked todo to be dropped")
	}
}

func TestRevalidateClaimedIssueUpdatesStateForActiveIssue(t *testing.T) {
	service := NewService()
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "Todo"}})
	if _, ok := service.ClaimNextRunnable(); !ok {
		t.Fatalf("expected claim")
	}
	service.SetTrackerClient(stateMapTrackerClient{states: map[string]string{"1": "In Progress"}})

	keep, err := service.RevalidateClaimedIssue(context.Background(), "1")
	if err != nil {
		t.Fatalf("revalidate claimed issue: %v", err)
	}
	if !keep {
		t.Fatalf("expected active issue to remain dispatchable")
	}
	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 || snapshot.Running[0].State != "In Progress" {
		t.Fatalf("expected running issue with updated state, got %+v", snapshot.Running)
	}
}

func TestRevalidateClaimedIssueReturnsErrorOnTrackerFailure(t *testing.T) {
	service := NewService()
	service.SetRunningForTest([]RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", State: "Todo"}})
	if _, ok := service.ClaimNextRunnable(); !ok {
		t.Fatalf("expected claim")
	}
	service.SetTrackerClient(stateMapTrackerClient{err: errors.New("tracker down")})

	keep, err := service.RevalidateClaimedIssue(context.Background(), "1")
	if err == nil {
		t.Fatalf("expected tracker error")
	}
	if keep {
		t.Fatalf("expected keep=false on tracker error")
	}
	snapshot := service.Snapshot()
	if len(snapshot.Running) != 1 {
		t.Fatalf("expected running entry unchanged on tracker failure, got %+v", snapshot.Running)
	}
}
