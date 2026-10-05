package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/control"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/plangate"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"github.com/rs/zerolog"
)

// testProjectSetup creates a temporary git repo and a SQLite DB with a project
// pointing at it, returning the workspace root, project ID, and DB handle.
func testProjectSetup(t *testing.T) (workspaceRoot string, projectID string, warehouseDB *db.DB) {
	t.Helper()
	workspaceRoot = t.TempDir()
	repoDir := filepath.Join(workspaceRoot, "repo")
	if err := os.MkdirAll(repoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Initialize a bare-minimum git repo with one commit so HEAD exists.
	for _, args := range [][]string{
		{"git", "init", repoDir},
		{"git", "-C", repoDir, "config", "user.email", "test@test.com"},
		{"git", "-C", repoDir, "config", "user.name", "test"},
		{"git", "-C", repoDir, "commit", "--allow-empty", "-m", "init"},
	} {
		cmd := exec.Command(args[0], args[1:]...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v failed: %s", args, out)
		}
	}
	dbPath := filepath.Join(workspaceRoot, "warehouse.db")
	warehouseDB, err := db.Connect(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { warehouseDB.Close() })
	projectID, err = warehouseDB.UpsertProject(context.Background(), repoDir, "")
	if err != nil {
		t.Fatal(err)
	}
	return workspaceRoot, projectID, warehouseDB
}

func setupApprovedLocalTask(t *testing.T, service *orchestrator.Service, warehouseDB *db.DB, projectID string) *tracker.Issue {
	t.Helper()
	ctx := context.Background()
	service.SetDB(warehouseDB)
	client := trackersqlite.NewClient(warehouseDB, []string{"agent-opencode"})
	service.SetTrackerClient(client)
	issue, err := client.CreateIssue(ctx, "Lifecycle test", "Exercise the execution stage", "Todo", 0, "agent-opencode", projectID, "OPENCODE", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.RecordPlanResult(ctx, projectID, issue.ID, "- [ ] inspect\n- [ ] implement", plangate.Fingerprint(*issue)); err != nil {
		t.Fatalf("record planning result: %v", err)
	}
	issue, err = client.FetchIssueByIdentifier(ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	gate := service.PlanGate(ctx, *issue)
	if gate.Status != "awaiting_approval" || gate.PlanHash == "" {
		t.Fatalf("expected exact persisted plan awaiting approval, got %+v", gate)
	}
	controlService, err := control.New(warehouseDB, service, nil)
	if err != nil {
		t.Fatal(err)
	}
	result := controlService.Execute(ctx, "orchestra_control", map[string]any{
		"operation": "approve_plan", "project_id": projectID, "task_id": issue.ID,
		"expected_state": "Todo", "expected_plan_hash": gate.PlanHash, "request_id": uuid.NewString(),
	})
	if ok, _ := result["success"].(bool); !ok {
		t.Fatalf("approve exact persisted plan: %+v", result)
	}
	approved, err := client.FetchIssueByIdentifier(ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	if approved.State != "In Progress" || service.PlanGate(ctx, *approved).Status != "approved" {
		t.Fatalf("expected exact local task to be approved for execution, state=%q gate=%+v", approved.State, service.PlanGate(ctx, *approved))
	}
	return approved
}

type fakeLifecycleRunner struct {
	requests []agents.TurnRequest
}

func (r *fakeLifecycleRunner) RunTurn(_ context.Context, request agents.TurnRequest, _ agents.EventHandler) (agents.TurnResult, error) {
	r.requests = append(r.requests, request)
	output := "- [ ] inspect\n- [ ] implement"
	if !request.PlanOnly {
		output = "- [x] inspect\n- [x] implement"
	}
	return agents.TurnResult{Provider: agents.ProviderCodex, SessionID: request.SessionID, ExitCode: 0, Output: output}, nil
}

func TestLocalTwoTaskLifecycleIsBoundedAndRequiresPlanApproval(t *testing.T) {
	ctx := context.Background()
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	service.SetDB(warehouseDB)
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done", "Cancelled"})
	service.SetMaxConcurrent(2)
	client := trackersqlite.NewClient(warehouseDB, []string{"agent-CODEX"})
	service.SetTrackerClient(client)

	var tasks []*tracker.Issue
	for _, owner := range []string{"agent-CODEX", "agent-CODEX", "person-smoke"} {
		task, err := client.CreateIssue(ctx, "Concurrent lifecycle", "Bounded local dispatch fixture", "Todo", 0, owner, projectID, "CODEX", nil)
		if err != nil {
			t.Fatal(err)
		}
		tasks = append(tasks, task)
	}

	registry := agents.NewRegistry(map[string]string{
		"CODEX": "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {{prompt}}",
	})
	fake := &fakeLifecycleRunner{}
	registry.SetRunner(agents.ProviderCodex, fake)
	pubsub := observability.NewPubSub()
	if err := service.PerformRefreshForClient(ctx, client); err != nil {
		t.Fatalf("initial local refresh: %v", err)
	}
	queued := service.Snapshot().Running
	if len(queued) != 2 || queued[0].IssueID != tasks[0].ID || queued[1].IssueID != tasks[1].ID {
		t.Fatalf("expected exactly the two worker-assigned local tasks queued under capacity 2, got %+v", queued)
	}

	process := func() {
		processExecutionTick(service, workspace.Service{Root: workspaceRoot}, registry, agents.ProviderCodex, "codex", workspaceRoot, "missing-workflow.md", 0, nil, nil, workspace.Hooks{}, pubsub, warehouseDB, nil, nil, &config.Config{}, nil, zerolog.Nop())
	}
	process()
	process()
	for _, task := range tasks[:2] {
		current, err := client.FetchIssueByIdentifier(ctx, task.ID)
		if err != nil {
			t.Fatal(err)
		}
		gate := service.PlanGate(ctx, *current)
		if current.State != "Todo" || gate.Status != "awaiting_approval" || gate.PlanHash == "" {
			t.Fatalf("planning must persist a reviewable plan and halt in Todo: state=%q gate=%+v", current.State, gate)
		}
	}
	if len(service.Snapshot().Running) != 0 {
		t.Fatalf("planning runs did not settle independently: %+v", service.Snapshot().Running)
	}
	humanTask, err := client.FetchIssueByIdentifier(ctx, tasks[2].ID)
	if err != nil || humanTask.AssignedToWorker {
		t.Fatalf("human-owned candidate became worker-routable: task=%+v err=%v", humanTask, err)
	}

	controls, err := control.New(warehouseDB, service, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i, task := range tasks[:2] {
		current, err := client.FetchIssueByIdentifier(ctx, task.ID)
		if err != nil {
			t.Fatal(err)
		}
		gate := service.PlanGate(ctx, *current)
		result := controls.Execute(ctx, "orchestra_control", map[string]any{
			"operation": "approve_plan", "project_id": projectID, "task_id": task.ID,
			"expected_state": "Todo", "expected_plan_hash": gate.PlanHash, "request_id": uuid.NewString(),
		})
		if result["success"] != true {
			t.Fatalf("approve task %d plan: %+v", i+1, result)
		}
	}
	if err := service.PerformRefreshForClient(ctx, client); err != nil {
		t.Fatalf("refresh after exact human approvals: %v", err)
	}
	queued = service.Snapshot().Running
	if len(queued) != 2 {
		t.Fatalf("expected two approved tasks within configured concurrency, got %+v", queued)
	}
	process()
	if len(service.Snapshot().Running) != 1 {
		t.Fatalf("one execution should settle while the other remains admitted: %+v", service.Snapshot().Running)
	}
	process()
	if len(service.Snapshot().Running) != 0 || len(service.Snapshot().Retrying) != 0 {
		t.Fatalf("both approved executions should settle independently: %+v", service.Snapshot())
	}
	for _, task := range tasks[:2] {
		current, err := client.FetchIssueByIdentifier(ctx, task.ID)
		if err != nil || current.State != "Review" {
			t.Fatalf("approved task did not settle in Review: task=%+v err=%v", current, err)
		}
	}
	if len(fake.requests) != 4 {
		t.Fatalf("expected two plan-only and two execution turns, got %d: %+v", len(fake.requests), fake.requests)
	}
	for i, request := range fake.requests {
		if request.RuntimeTarget != agents.RuntimeLocal {
			t.Fatalf("turn %d ran outside LOCAL: %s", i, request.RuntimeTarget)
		}
		if i < 2 {
			if !request.PlanOnly || request.CommandOverride != "codex exec --skip-git-repo-check --ignore-user-config --sandbox read-only --json {{prompt}}" || len(request.ToolSpecs) != 0 || len(request.ResourceSpecs) != 0 {
				t.Fatalf("turn %d was not routed through the read-only planning command: %+v", i, request)
			}
		} else if request.PlanOnly {
			t.Fatalf("execution turn %d incorrectly retained plan-only mode", i)
		}
	}
}

func TestLegacyTrackerClientUsesMemoryWhenEndpointUnset(t *testing.T) {
	client := newLegacyTrackerClient(config.Config{}, nil)
	if _, ok := client.(*memory.Client); !ok {
		t.Fatalf("expected memory tracker client when endpoint is unset")
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
		if got.Type != "RUN_EVENT" {
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

	publishLifecycleEvent(pubsub, "RUN_SUCCEEDED", map[string]any{"issue_id": "1"})

	select {
	case got := <-ch:
		if got.Type != "RUN_SUCCEEDED" {
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
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	issue := setupApprovedLocalTask(t, service, warehouseDB, projectID)
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         issue.ID,
		IssueIdentifier: issue.Identifier,
		ProjectID:       projectID,
		State:           issue.State,
		StartedAt:       now,
		LastEventAt:     now,
	}})

	registry := agents.NewRegistry(map[string]string{"opencode": "printf '{\"event\":\"turn.completed\",\"message\":\"ok\"}\\n'"})
	pubsub := observability.NewPubSub()

	service.SetMaxTurns(10)
	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		0,
		nil,
		nil,
		workspace.Hooks{},
		pubsub,
		warehouseDB,
		nil,
		nil,
		&config.Config{},
		nil,
		zerolog.Nop(),
	)

	snapshot := service.Snapshot()
	if snapshot.Counts.Running != 0 {
		t.Fatalf("expected no running entries after successful tick, got %d", snapshot.Counts.Running)
	}
	if snapshot.Counts.Retrying != 0 {
		t.Fatalf("expected no retry entries after successful tick, got %d", snapshot.Counts.Retrying)
	}
}

func TestProcessExecutionTickPublishesFailureAndRetryLifecycleEvents(t *testing.T) {
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	issue := setupApprovedLocalTask(t, service, warehouseDB, projectID)
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         issue.ID,
		IssueIdentifier: issue.Identifier,
		ProjectID:       projectID,
		State:           issue.State,
		StartedAt:       now,
		LastEventAt:     now,
	}})

	registry := agents.NewRegistry(map[string]string{"opencode": "exit 2"})
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(16)
	defer unsub()

	service.SetMaxTurns(10)
	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		0,
		nil,
		nil,
		workspace.Hooks{},
		pubsub,
		warehouseDB,
		nil,
		nil,
		&config.Config{},
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
			case "RUN_STARTED":
				seenStarted = true
			case "RUN_FAILED":
				seenFailed = true
				if data, ok := evt.Data.(map[string]any); ok {
					if cause, ok := data["cause"].(string); ok {
						failedCause = cause
					}
				}
			case "RETRY_SCHEDULED":
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
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	issue := setupApprovedLocalTask(t, service, warehouseDB, projectID)
	service.SetRetryPolicy(1, 1*time.Second, 1*time.Minute)
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         issue.ID,
		IssueIdentifier: issue.Identifier,
		ProjectID:       projectID,
		State:           issue.State,
		TurnCount:       1,
		StartedAt:       now,
		LastEventAt:     now,
	}})

	registry := agents.NewRegistry(map[string]string{"opencode": "exit 2"})
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(16)
	defer unsub()

	service.SetMaxTurns(2)
	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		0,
		nil,
		nil,
		workspace.Hooks{},
		pubsub,
		warehouseDB,
		nil,
		nil,
		&config.Config{},
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
			case "RUN_STARTED":
				seenStarted = true
			case "RUN_FAILED":
				seenFailed = true
				if data, ok := evt.Data.(map[string]any); ok {
					if cause, ok := data["cause"].(string); ok {
						failedCause = cause
					}
				}
			case "RETRY_SCHEDULED":
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
			case "RUN_FAILED":
				seenRunFailed = true
				data, ok := evt.Data.(map[string]any)
				if !ok || data["issue_id"] != "2" || data["source"] != "refresh" || data["cause"] != "refresh_retry" {
					t.Fatalf("unexpected run_failed payload: %+v", evt.Data)
				}
			case "RETRY_SCHEDULED":
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
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	issue := setupApprovedLocalTask(t, service, warehouseDB, projectID)
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         issue.ID,
		IssueIdentifier: issue.Identifier,
		ProjectID:       projectID,
		State:           issue.State,
		StartedAt:       now,
		LastEventAt:     now,
	}})

	registry := agents.NewRegistry(map[string]string{"opencode": "printf '%s\\n' '{\"event\":\"thread/rate_limits\",\"meta\":{\"data\":[{\"rate_limits\":{\"remaining\":9,\"reset_at\":\"soon\"}}]}}' '{\"event\":\"turn.completed\",\"usage\":{\"inputTokens\":3,\"outputTokens\":2}}'"})

	service.SetMaxTurns(10)
	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		0,
		nil,
		nil,
		workspace.Hooks{},
		nil,
		warehouseDB,
		nil,
		nil,
		&config.Config{},
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
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	issue := setupApprovedLocalTask(t, service, warehouseDB, projectID)
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         issue.ID,
		IssueIdentifier: issue.Identifier,
		ProjectID:       projectID,
		State:           "In Progress",
		TurnCount:       1,
		StartedAt:       now,
		LastEventAt:     now,
	}})

	registry := agents.NewRegistry(map[string]string{"opencode": "printf '{\"event\":\"turn.completed\"}\\n'"})
	hooks := workspace.Hooks{BeforeRun: "echo ran > before-run.txt"}

	service.SetMaxTurns(10)
	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		0,
		nil,
		nil,
		hooks,
		nil,
		warehouseDB,
		nil,
		nil,
		&config.Config{},
		nil,
		zerolog.Nop(),
	)

	// The worktree path is now under workspaceRoot/<projectID>/orc-1, not workspaceRoot/ORC-1.
	// Check that before-run.txt does NOT exist in the worktree.
	branchName := strings.ToLower(strings.ReplaceAll(issue.Identifier, " ", "-"))
	workspacePath := filepath.Join(workspaceRoot, projectID, branchName)
	if _, err := os.Stat(filepath.Join(workspacePath, "before-run.txt")); !os.IsNotExist(err) {
		t.Fatalf("expected before_run hook to be skipped after first turn, stat err=%v", err)
	}
}

func TestProcessExecutionTickPublishesBeforeRunHookFailureCause(t *testing.T) {
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	issue := setupApprovedLocalTask(t, service, warehouseDB, projectID)
	now := time.Now().UTC().Format(time.RFC3339)
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         issue.ID,
		IssueIdentifier: issue.Identifier,
		ProjectID:       projectID,
		State:           issue.State,
		TurnCount:       0,
		StartedAt:       now,
		LastEventAt:     now,
	}})

	registry := agents.NewRegistry(map[string]string{"opencode": "printf '{\"event\":\"turn.completed\"}\\n'"})
	pubsub := observability.NewPubSub()
	ch, unsub := pubsub.Subscribe(16)
	defer unsub()

	service.SetMaxTurns(10)
	processExecutionTick(
		service,
		workspace.Service{Root: workspaceRoot},
		registry,
		agents.ProviderOpenCode,
		"opencode",
		workspaceRoot,
		"does-not-exist.md",
		0,
		nil,
		nil,
		workspace.Hooks{BeforeRun: "exit 14"},
		pubsub,
		warehouseDB,
		nil,
		nil,
		&config.Config{},
		nil,
		zerolog.Nop(),
	)

	deadline := time.After(1 * time.Second)
	for {
		select {
		case evt := <-ch:
			if evt.Type != "RUN_FAILED" {
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
			if evt.Type == "RUN_FAILED" {
				if payload["error"] != "stalled run exceeded timeout" {
					t.Fatalf("expected error in run_failed payload, got %+v", payload)
				}
				seenRunFailed = true
			}
			if evt.Type == "RETRY_SCHEDULED" {
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
