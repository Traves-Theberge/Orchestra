package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	trackergraphql "github.com/orchestra/orchestra/apps/backend/internal/tracker/graphql"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"github.com/rs/zerolog"
)

func TestNewTrackerClientUsesMemoryWhenEndpointUnset(t *testing.T) {
	client := newTrackerClient(config.Config{}, nil)
	if _, ok := client.(*memory.Client); !ok {
		t.Fatalf("expected memory tracker client when endpoint is unset")
	}
}

func TestNewTrackerClientUsesGraphQLWhenEndpointSet(t *testing.T) {
	client := newTrackerClient(config.Config{TrackerEndpoint: "http://tracker.local/graphql", TrackerToken: "token"}, nil)
	if _, ok := client.(*trackergraphql.Client); !ok {
		t.Fatalf("expected graphql tracker client when endpoint is set")
	}
}

func TestPublishRunEventIncludesIssueAndProvider(t *testing.T) {
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(1)
	defer unsub()

	entry := orchestrator.RunningEntry{IssueID: "1", IssueIdentifier: "ORC-1"}
	publishRunEvent(pubsub, entry, "opencode", agents.Event{Kind: "turn.completed"})

	select {
	case got := <-ch:
		if got.Type != "run_event" {
			t.Fatalf("expected run_event type, got %q", got.Type)
		}
		data, ok := got.Data.(map[string]any)
		if !ok {
			t.Fatalf("expected map payload, got %T", got.Data)
		}
		if data["issue_id"] != "1" || data["issue_identifier"] != "ORC-1" {
			t.Fatalf("unexpected issue payload: %+v", data)
		}
		if data["provider"] != "opencode" {
			t.Fatalf("expected provider opencode, got %+v", data["provider"])
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("expected run_event publication")
	}
}

func TestPublishLifecycleEventPublishesTypedEnvelope(t *testing.T) {
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(1)
	defer unsub()

	publishLifecycleEvent(pubsub, "run_succeeded", map[string]any{"issue_id": "1"})

	select {
	case got := <-ch:
		if got.Type != "run_succeeded" {
			t.Fatalf("expected run_succeeded type, got %q", got.Type)
		}
		data, ok := got.Data.(map[string]any)
		if !ok || data["issue_id"] != "1" {
			t.Fatalf("unexpected lifecycle payload: %+v", got.Data)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("expected lifecycle event publication")
	}
}

func TestProcessExecutionTickPublishesSuccessLifecycleEvents(t *testing.T) {
	service := orchestrator.NewService()
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "Todo",
		StartedAt:       now,
		LastEventAt:     now,
	}})

	workspaceRoot := t.TempDir()
	registry := agents.NewRegistry(map[string]string{"opencode": "printf '{\"event\":\"turn.completed\",\"message\":\"ok\"}\\n'"})
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(16)
	defer unsub()

	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		1,
		nil,
		nil,
		workspace.Hooks{},
		pubsub,
		nil,
		zerolog.Nop(),
	)

	seenStarted := false
	seenRunEvent := false
	seenSucceeded := false
	deadline := time.After(1 * time.Second)
	for !(seenStarted && seenRunEvent && seenSucceeded) {
		select {
		case evt := <-ch:
			switch evt.Type {
			case "run_started":
				seenStarted = true
			case "run_event":
				seenRunEvent = true
			case "run_succeeded":
				seenSucceeded = true
			}
		case <-deadline:
			t.Fatalf("timed out waiting for success lifecycle events")
		}
	}

	if !seenStarted || !seenRunEvent || !seenSucceeded {
		t.Fatalf("expected run_started/run_event/run_succeeded, got started=%v run_event=%v succeeded=%v", seenStarted, seenRunEvent, seenSucceeded)
	}
}

func TestProcessExecutionTickPublishesFailureAndRetryLifecycleEvents(t *testing.T) {
	service := orchestrator.NewService()
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "Todo",
		StartedAt:       now,
		LastEventAt:     now,
	}})

	workspaceRoot := t.TempDir()
	registry := agents.NewRegistry(map[string]string{"opencode": "exit 2"})
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(16)
	defer unsub()

	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		1,
		nil,
		nil,
		workspace.Hooks{},
		pubsub,
		nil,
		zerolog.Nop(),
	)

	seenStarted := false
	seenFailed := false
	seenRetry := false
	failedCause := ""
	retryCause := ""
	deadline := time.After(1 * time.Second)
	for !(seenStarted && seenFailed && seenRetry) {
		select {
		case evt := <-ch:
			switch evt.Type {
			case "run_started":
				seenStarted = true
			case "run_failed":
				seenFailed = true
				if data, ok := evt.Data.(map[string]any); ok {
					if cause, ok := data["cause"].(string); ok {
						failedCause = cause
					}
				}
			case "retry_scheduled":
				seenRetry = true
				if data, ok := evt.Data.(map[string]any); ok {
					if cause, ok := data["cause"].(string); ok {
						retryCause = cause
					}
				}
			}
		case <-deadline:
			t.Fatalf("timed out waiting for failure lifecycle events")
		}
	}

	if !seenStarted || !seenFailed || !seenRetry {
		t.Fatalf("expected run_started/run_failed/retry_scheduled, got started=%v failed=%v retry=%v", seenStarted, seenFailed, seenRetry)
	}
	if failedCause != "agent_run_failed" || retryCause != "agent_run_failed" {
		t.Fatalf("expected failure/retry cause agent_run_failed, got failed=%q retry=%q", failedCause, retryCause)
	}
}

func TestProcessExecutionTickDoesNotPublishRetryWhenAttemptExceedsMax(t *testing.T) {
	service := orchestrator.NewService()
	service.SetRetryPolicy(1, 1*time.Second, 1*time.Minute)
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "Todo",
		TurnCount:       1,
		StartedAt:       now,
		LastEventAt:     now,
	}})

	workspaceRoot := t.TempDir()
	registry := agents.NewRegistry(map[string]string{"opencode": "exit 2"})
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(16)
	defer unsub()

	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		2,
		nil,
		nil,
		workspace.Hooks{},
		pubsub,
		nil,
		zerolog.Nop(),
	)

	seenStarted := false
	seenFailed := false
	seenRetry := false
	failedCause := ""
	deadline := time.After(500 * time.Millisecond)
	for {
		select {
		case evt := <-ch:
			switch evt.Type {
			case "run_started":
				seenStarted = true
			case "run_failed":
				seenFailed = true
				if data, ok := evt.Data.(map[string]any); ok {
					if cause, ok := data["cause"].(string); ok {
						failedCause = cause
					}
				}
			case "retry_scheduled":
				seenRetry = true
			}
		case <-deadline:
			if !seenStarted || !seenFailed {
				t.Fatalf("expected run_started and run_failed, got started=%v failed=%v", seenStarted, seenFailed)
			}
			if failedCause != "agent_run_failed" {
				t.Fatalf("expected run_failed cause agent_run_failed, got %q", failedCause)
			}
			if seenRetry {
				t.Fatalf("did not expect retry_scheduled when attempt exceeds max retry policy")
			}
			return
		}
	}
}

func TestPublishRefreshRetryLifecycleEventsPublishesOnlyNewEntries(t *testing.T) {
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(8)
	defer unsub()

	before := orchestrator.Snapshot{Retrying: []orchestrator.RetryEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		Attempt:         1,
		DueAt:           "2026-01-01T00:00:00Z",
		Error:           "existing",
	}}}
	after := orchestrator.Snapshot{Retrying: []orchestrator.RetryEntry{
		{
			IssueID:         "1",
			IssueIdentifier: "ORC-1",
			Attempt:         1,
			DueAt:           "2026-01-01T00:00:00Z",
			Error:           "existing",
		},
		{
			IssueID:         "2",
			IssueIdentifier: "ORC-2",
			Attempt:         2,
			DueAt:           "2026-01-01T00:01:00Z",
			Error:           "new",
		},
	}}

	publishRefreshRetryLifecycleEvents(pubsub, before, after)

	seenRunFailed := false
	seenRetryScheduled := false
	deadline := time.After(1 * time.Second)
	for !(seenRunFailed && seenRetryScheduled) {
		select {
		case evt := <-ch:
			switch evt.Type {
			case "run_failed":
				seenRunFailed = true
				data, ok := evt.Data.(map[string]any)
				if !ok || data["issue_id"] != "2" || data["source"] != "refresh" || data["cause"] != "refresh_retry" {
					t.Fatalf("unexpected run_failed payload: %+v", evt.Data)
				}
			case "retry_scheduled":
				seenRetryScheduled = true
				data, ok := evt.Data.(map[string]any)
				if !ok || data["issue_id"] != "2" || data["source"] != "refresh" || data["cause"] != "refresh_retry" {
					t.Fatalf("unexpected retry_scheduled payload: %+v", evt.Data)
				}
			}
		case <-deadline:
			t.Fatalf("expected refresh lifecycle events for new retry")
		}
	}

	select {
	case evt := <-ch:
		t.Fatalf("expected only run_failed+retry_scheduled for new retry entry, got %+v", evt)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestClassifyRefreshRetryCause(t *testing.T) {
	if cause := classifyRefreshRetryCause("stalled run exceeded timeout"); cause != "stalled_timeout" {
		t.Fatalf("expected stalled_timeout cause, got %q", cause)
	}
	if cause := classifyRefreshRetryCause("tracker transient fetch error"); cause != "refresh_retry" {
		t.Fatalf("expected refresh_retry fallback cause, got %q", cause)
	}
}

func TestProcessExecutionTickPreservesRateLimitsFromMixedNestedEnvelope(t *testing.T) {
	service := orchestrator.NewService()
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "Todo",
		StartedAt:       now,
		LastEventAt:     now,
	}})

	workspaceRoot := t.TempDir()
	registry := agents.NewRegistry(map[string]string{"opencode": "printf '%s\\n' '{\"event\":\"thread/rate_limits\",\"meta\":{\"data\":[{\"rate_limits\":{\"remaining\":9,\"reset_at\":\"soon\"}}]}}' '{\"event\":\"turn.completed\",\"usage\":{\"inputTokens\":3,\"outputTokens\":2}}'"})

	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		1,
		nil,
		nil,
		workspace.Hooks{},
		nil,
		nil,
		zerolog.Nop(),
	)

	snapshot := service.Snapshot()
	rateLimits, ok := snapshot.RateLimits.(map[string]any)
	if !ok {
		t.Fatalf("expected rate limits map, got %T", snapshot.RateLimits)
	}
	if rateLimits["remaining"] != float64(9) && rateLimits["remaining"] != 9 {
		t.Fatalf("unexpected rate limits payload: %+v", rateLimits)
	}
}

func TestProcessExecutionTickSkipsBeforeRunHookAfterFirstTurn(t *testing.T) {
	service := orchestrator.NewService()
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "In Progress",
		TurnCount:       1,
		StartedAt:       now,
		LastEventAt:     now,
	}})

	workspaceRoot := t.TempDir()
	registry := agents.NewRegistry(map[string]string{"opencode": "printf '{\"event\":\"turn.completed\"}\\n'"})
	hooks := workspace.Hooks{BeforeRun: "echo ran > before-run.txt"}

	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		2,
		nil,
		nil,
		hooks,
		nil,
		nil,
		zerolog.Nop(),
	)

	workspacePath := filepath.Join(workspaceRoot, "ORC-1")
	if _, err := os.Stat(filepath.Join(workspacePath, "before-run.txt")); !os.IsNotExist(err) {
		t.Fatalf("expected before_run hook to be skipped after first turn, stat err=%v", err)
	}
}

func TestProcessExecutionTickPublishesBeforeRunHookFailureCause(t *testing.T) {
	service := orchestrator.NewService()
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "Todo",
		TurnCount:       0,
		StartedAt:       now,
		LastEventAt:     now,
	}})

	workspaceRoot := t.TempDir()
	registry := agents.NewRegistry(map[string]string{"opencode": "printf '{\"event\":\"turn.completed\"}\\n'"})
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(16)
	defer unsub()

	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		1,
		nil,
		nil,
		workspace.Hooks{BeforeRun: "exit 14"},
		pubsub,
		nil,
		zerolog.Nop(),
	)

	deadline := time.After(1 * time.Second)
	for {
		select {
		case evt := <-ch:
			if evt.Type != "run_failed" {
				continue
			}
			data, ok := evt.Data.(map[string]any)
			if !ok {
				t.Fatalf("expected map lifecycle payload, got %T", evt.Data)
			}
			if data["cause"] != "before_run_hook_failed" {
				t.Fatalf("expected before_run_hook_failed cause, got %+v", data)
			}
			return
		case <-deadline:
			t.Fatalf("expected run_failed lifecycle event with before_run_hook_failed cause")
		}
	}
}

func TestPublishRefreshRetryLifecycleEventsSuppressesDueAtOnlyChanges(t *testing.T) {
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(4)
	defer unsub()

	before := orchestrator.Snapshot{Retrying: []orchestrator.RetryEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		Attempt:         2,
		DueAt:           "2026-01-01T00:00:00Z",
		Error:           "stalled run exceeded timeout",
	}}}
	after := orchestrator.Snapshot{Retrying: []orchestrator.RetryEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		Attempt:         2,
		DueAt:           "2026-01-01T00:00:30Z",
		Error:           "stalled run exceeded timeout",
	}}}

	publishRefreshRetryLifecycleEvents(pubsub, before, after)

	select {
	case evt := <-ch:
		t.Fatalf("did not expect lifecycle event when only due_at changed, got %+v", evt)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestPublishRefreshRetryLifecycleEventsCarriesCompleteFields(t *testing.T) {
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(4)
	defer unsub()

	before := orchestrator.Snapshot{}
	after := orchestrator.Snapshot{Retrying: []orchestrator.RetryEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		Attempt:         3,
		DueAt:           "2026-01-01T00:00:30Z",
		Error:           "stalled run exceeded timeout",
	}}}

	publishRefreshRetryLifecycleEvents(pubsub, before, after)

	seenRunFailed := false
	seenRetryScheduled := false
	deadline := time.After(1 * time.Second)
	for !(seenRunFailed && seenRetryScheduled) {
		select {
		case evt := <-ch:
			payload, ok := evt.Data.(map[string]any)
			if !ok {
				t.Fatalf("expected map payload for %s, got %T", evt.Type, evt.Data)
			}
			if payload["issue_id"] != "1" || payload["issue_identifier"] != "ORC-1" || payload["attempt"] != int64(3) {
				t.Fatalf("unexpected base fields for %s: %+v", evt.Type, payload)
			}
			if payload["source"] != "refresh" || payload["cause"] != "stalled_timeout" {
				t.Fatalf("unexpected source/cause fields for %s: %+v", evt.Type, payload)
			}
			if evt.Type == "run_failed" {
				if payload["error"] != "stalled run exceeded timeout" {
					t.Fatalf("expected error in run_failed payload, got %+v", payload)
				}
				seenRunFailed = true
			}
			if evt.Type == "retry_scheduled" {
				if payload["due_at"] != "2026-01-01T00:00:30Z" {
					t.Fatalf("expected due_at in retry_scheduled payload, got %+v", payload)
				}
				seenRetryScheduled = true
			}
		case <-deadline:
			t.Fatalf("expected run_failed and retry_scheduled with complete fields")
		}
	}
}
