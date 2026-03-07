package orchestrator

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
)

func TestOrchestratorSoakRefreshDispatchRetryLoop(t *testing.T) {
	if os.Getenv("ORCHESTRA_RUN_SOAK") != "1" {
		t.Skip("set ORCHESTRA_RUN_SOAK=1 to run soak tests")
	}

	seed := make([]tracker.Issue, 0, 20)
	for i := 1; i <= 20; i++ {
		seed = append(seed, tracker.Issue{
			ID:               "issue-" + itoa(i),
			Identifier:       "ORC-" + itoa(i),
			Title:            "issue",
			State:            "Todo",
			AssignedToWorker: true,
		})
	}

	trackerClient := memory.NewClient(seed)
	service := NewService()
	service.SetTrackerClient(trackerClient)
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done"})
	service.SetMaxConcurrent(4)
	service.SetRetryPolicy(4, 1*time.Millisecond, 10*time.Millisecond)

	for cycle := 1; cycle <= 1200; cycle++ {
		service.QueueRefresh()
		if err := service.PerformRefresh(context.Background()); err != nil {
			t.Fatalf("perform refresh cycle %d: %v", cycle, err)
		}

		for claims := 0; claims < 6; claims++ {
			entry, ok := service.ClaimNextRunnable()
			if !ok {
				break
			}

			attempt := entry.TurnCount + 1
			if (cycle+claims)%9 == 0 {
				service.RecordRunFailure(entry.IssueID, entry.IssueIdentifier, attempt, time.Now().UTC().Add(2*time.Millisecond), errors.New("transient"))
				continue
			}

			service.RecordRunEvent(entry.IssueID, agents.Event{
				Kind:      "token_update",
				Timestamp: time.Now().UTC(),
				Usage:     agents.TokenUsage{InputTokens: 10, OutputTokens: 3, TotalTokens: 13},
			})
			service.RecordRunSuccess(entry.IssueID)
			trackerClient.SetIssueState(entry.IssueID, "Done")
		}

		if cycle%25 == 0 {
			for i := 1; i <= 5; i++ {
				trackerClient.SetIssueState("issue-"+itoa(i), "Todo")
			}
		}

		snapshot := service.Snapshot()
		if snapshot.Counts.Running > 4 {
			t.Fatalf("running count exceeds max concurrent at cycle %d: %d", cycle, snapshot.Counts.Running)
		}
		assertNoDuplicateIssueIDs(t, snapshot)
	}
}

func assertNoDuplicateIssueIDs(t *testing.T, snapshot Snapshot) {
	t.Helper()
	seen := map[string]struct{}{}
	for _, entry := range snapshot.Running {
		if _, ok := seen[entry.IssueID]; ok {
			t.Fatalf("duplicate issue id in running snapshot: %s", entry.IssueID)
		}
		seen[entry.IssueID] = struct{}{}
	}
	for _, entry := range snapshot.Retrying {
		if _, ok := seen[entry.IssueID]; ok {
			t.Fatalf("duplicate issue id across running/retrying snapshot: %s", entry.IssueID)
		}
		seen[entry.IssueID] = struct{}{}
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	buf := [20]byte{}
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + (i % 10))
		i /= 10
	}
	return string(buf[pos:])
}
