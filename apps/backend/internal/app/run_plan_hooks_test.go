package app

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/control"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"github.com/rs/zerolog"
)

func TestPlanningDefersConfiguredWorkspaceHooksUntilPlanApproval(t *testing.T) {
	ctx := context.Background()
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	service.SetDB(warehouseDB)
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done", "Cancelled"})
	client := sqlite.NewClient(warehouseDB, []string{"agent-CODEX"})
	service.SetTrackerClient(client)
	issue, err := client.CreateIssue(ctx, "Hook safety", "Planning must not run configured hooks", "Todo", 0, "agent-CODEX", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(map[string]string{"CODEX": "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {{prompt}}"})
	runner := &fakeLifecycleRunner{}
	registry.SetRunner(agents.ProviderCodex, runner)
	pubsub := observability.NewPubSub()
	hooks := workspace.Hooks{
		AfterCreate: "printf created > after-create.marker",
		BeforeRun:   "printf started > before-run.marker",
		AfterRun:    "printf finished > after-run.marker",
	}
	process := func() {
		processExecutionTick(service, workspace.Service{Root: workspaceRoot}, registry, agents.ProviderCodex, "codex", workspaceRoot, "missing-workflow.md", 0, nil, nil, hooks, pubsub, warehouseDB, nil, nil, &config.Config{}, nil, zerolog.Nop())
	}
	if err := service.PerformRefreshForClient(ctx, client); err != nil {
		t.Fatalf("queue planning task: %v", err)
	}
	process()

	workspaceService := workspace.Service{Root: workspaceRoot}
	worktreePath := workspaceService.WorktreePath(projectID, strings.ToLower(issue.Identifier))
	_, _, _, completedReceipt := afterCreateReceiptPaths(workspaceRoot, projectID, strings.ToLower(issue.Identifier), hooks.AfterCreate)
	for _, name := range []string{"after-create.marker", "before-run.marker", "after-run.marker"} {
		if _, err := os.Stat(filepath.Join(worktreePath, name)); !os.IsNotExist(err) {
			t.Fatalf("planning ran configured hook %q: stat err=%v", name, err)
		}
	}
	planned, err := client.FetchIssueByIdentifier(ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	gate := service.PlanGate(ctx, *planned)
	if planned.State != "Todo" || gate.Status != "awaiting_approval" {
		t.Fatalf("expected planning to stop at approval gate, got state=%q gate=%+v", planned.State, gate)
	}
	controls, err := control.New(warehouseDB, service, nil)
	if err != nil {
		t.Fatal(err)
	}
	result := controls.Execute(ctx, "orchestra_control", map[string]any{
		"operation": "approve_plan", "project_id": projectID, "task_id": issue.ID,
		"expected_state": "Todo", "expected_plan_hash": gate.PlanHash, "request_id": uuid.NewString(),
	})
	if result["success"] != true {
		t.Fatalf("approve planned task: %+v", result)
	}
	if err := service.PerformRefreshForClient(ctx, client); err != nil {
		t.Fatalf("queue approved execution: %v", err)
	}
	process()
	for _, name := range []string{"after-create.marker", "before-run.marker", "after-run.marker"} {
		if _, err := os.Stat(filepath.Join(worktreePath, name)); err != nil {
			t.Errorf("approved execution did not run configured hook %q: %v", name, err)
		}
	}
	if _, err := os.Stat(completedReceipt); err != nil {
		t.Fatalf("approved setup did not leave a durable completed receipt: %v", err)
	}
}

func TestFailedDeferredAfterCreateBlocksProviderAndCannotReplayUnknownReceipt(t *testing.T) {
	ctx := context.Background()
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	service.SetDB(warehouseDB)
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done", "Cancelled"})
	client := sqlite.NewClient(warehouseDB, []string{"agent-CODEX"})
	service.SetTrackerClient(client)
	issue, err := client.CreateIssue(ctx, "Hook failure", "Uncertain setup must block dispatch", "Todo", 0, "agent-CODEX", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(map[string]string{"CODEX": "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {{prompt}}"})
	runner := &fakeLifecycleRunner{}
	registry.SetRunner(agents.ProviderCodex, runner)
	hooks := workspace.Hooks{
		AfterCreate: "printf x >> after-create-attempts.txt; exit 7",
		BeforeRun:   "printf started > before-run.marker",
		AfterRun:    "printf finished > after-run.marker",
	}
	process := func() {
		processExecutionTick(service, workspace.Service{Root: workspaceRoot}, registry, agents.ProviderCodex, "codex", workspaceRoot, "missing-workflow.md", 0, nil, nil, hooks, observability.NewPubSub(), warehouseDB, nil, nil, &config.Config{}, nil, zerolog.Nop())
	}
	if err := service.PerformRefreshForClient(ctx, client); err != nil {
		t.Fatalf("queue planning task: %v", err)
	}
	process()
	planned, err := client.FetchIssueByIdentifier(ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	gate := service.PlanGate(ctx, *planned)
	controls, err := control.New(warehouseDB, service, nil)
	if err != nil {
		t.Fatal(err)
	}
	result := controls.Execute(ctx, "orchestra_control", map[string]any{
		"operation": "approve_plan", "project_id": projectID, "task_id": issue.ID,
		"expected_state": "Todo", "expected_plan_hash": gate.PlanHash, "request_id": uuid.NewString(),
	})
	if result["success"] != true {
		t.Fatalf("approve planned task: %+v", result)
	}
	if err := service.PerformRefreshForClient(ctx, client); err != nil {
		t.Fatalf("queue approved execution: %v", err)
	}
	process()
	if len(runner.requests) != 1 || !runner.requests[0].PlanOnly {
		t.Fatalf("provider ran after deferred setup failed: requests=%+v", runner.requests)
	}
	workspaceService := workspace.Service{Root: workspaceRoot}
	worktreePath := workspaceService.WorktreePath(projectID, strings.ToLower(issue.Identifier))
	if content, err := os.ReadFile(filepath.Join(worktreePath, "after-create-attempts.txt")); err != nil || string(content) != "x" {
		t.Fatalf("expected one failed setup attempt, content=%q err=%v", content, err)
	}
	if _, err := os.Stat(filepath.Join(worktreePath, "before-run.marker")); !os.IsNotExist(err) {
		t.Fatalf("before_run hook ran after setup failure: %v", err)
	}
	if _, err := os.Stat(filepath.Join(worktreePath, "after-run.marker")); !os.IsNotExist(err) {
		t.Fatalf("after_run hook ran after setup failure: %v", err)
	}
	_, claimed, unknown, _ := afterCreateReceiptPaths(workspaceRoot, projectID, strings.ToLower(issue.Identifier), hooks.AfterCreate)
	if _, err := os.Stat(unknown); err != nil {
		t.Fatalf("failed setup did not leave an unknown receipt: %v", err)
	}
	if shouldRun, err := claimAfterCreateReceipt(strings.TrimSuffix(claimed, ".claimed")+".pending", claimed, unknown, strings.TrimSuffix(claimed, ".claimed")+".completed"); err == nil || shouldRun {
		t.Fatalf("unknown receipt was not fail-closed on retry: shouldRun=%v err=%v", shouldRun, err)
	}
}

func TestChangedAfterCreateHookAfterPlanningBlocksProvider(t *testing.T) {
	ctx := context.Background()
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	service.SetDB(warehouseDB)
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done", "Cancelled"})
	client := sqlite.NewClient(warehouseDB, []string{"agent-CODEX"})
	service.SetTrackerClient(client)
	issue, err := client.CreateIssue(ctx, "Hook config change", "Changed setup must not dispatch", "Todo", 0, "agent-CODEX", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(map[string]string{"CODEX": "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {{prompt}}"})
	runner := &fakeLifecycleRunner{}
	registry.SetRunner(agents.ProviderCodex, runner)
	hooks := workspace.Hooks{BeforeRun: "printf started > before-run.marker"}
	process := func() {
		processExecutionTick(service, workspace.Service{Root: workspaceRoot}, registry, agents.ProviderCodex, "codex", workspaceRoot, "missing-workflow.md", 0, nil, nil, hooks, observability.NewPubSub(), warehouseDB, nil, nil, &config.Config{}, nil, zerolog.Nop())
	}
	if err := service.PerformRefreshForClient(ctx, client); err != nil {
		t.Fatalf("queue planning task: %v", err)
	}
	process()
	identityPath := planningAfterCreateIdentityPath(workspaceRoot, projectID, issue.ID, strings.ToLower(issue.Identifier))
	plannedIdentity, err := os.ReadFile(identityPath)
	if err != nil || string(plannedIdentity) != afterCreateHookIdentity("") {
		t.Fatalf("planning did not persist the empty after_create identity: %q err=%v", plannedIdentity, err)
	}
	planned, err := client.FetchIssueByIdentifier(ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	gate := service.PlanGate(ctx, *planned)
	project, err := warehouseDB.GetProjectByID(ctx, projectID)
	if err != nil {
		t.Fatal(err)
	}
	workspaceService := workspace.Service{Root: workspaceRoot}
	worktreePath := workspaceService.WorktreePath(projectID, strings.ToLower(issue.Identifier))
	if err := workspaceService.RemoveWorktree(project.RootPath, worktreePath, workspace.Hooks{}); err != nil {
		t.Fatalf("remove planned checkout fixture: %v", err)
	}
	hooks.AfterCreate = "printf changed > new-hook.marker"
	controls, err := control.New(warehouseDB, service, nil)
	if err != nil {
		t.Fatal(err)
	}
	result := controls.Execute(ctx, "orchestra_control", map[string]any{
		"operation": "approve_plan", "project_id": projectID, "task_id": issue.ID,
		"expected_state": "Todo", "expected_plan_hash": gate.PlanHash, "request_id": uuid.NewString(),
	})
	if result["success"] != true {
		t.Fatalf("approve planned task: %+v", result)
	}
	if err := service.PerformRefreshForClient(ctx, client); err != nil {
		t.Fatalf("queue approved execution: %v", err)
	}
	process()
	if len(runner.requests) != 1 || !runner.requests[0].PlanOnly {
		t.Fatalf("provider ran with setup hooks changed after planning: requests=%+v", runner.requests)
	}
	if _, err := os.Stat(worktreePath); !os.IsNotExist(err) {
		t.Fatalf("execution recreated the deleted planned checkout despite hook identity drift: %v", err)
	}
	if _, err := os.Stat(filepath.Join(worktreePath, "before-run.marker")); !os.IsNotExist(err) {
		t.Fatalf("before_run hook ran with unprepared checkout: %v", err)
	}
	if _, err := os.Stat(filepath.Join(worktreePath, "new-hook.marker")); !os.IsNotExist(err) {
		t.Fatalf("changed after_create hook ran before drift was rejected: %v", err)
	}
}

type stopSuccessfulLifecycleRunner struct {
	stop func() error
}

func (r *stopSuccessfulLifecycleRunner) RunTurn(_ context.Context, request agents.TurnRequest, _ agents.EventHandler) (agents.TurnResult, error) {
	if err := r.stop(); err != nil {
		return agents.TurnResult{}, err
	}
	return agents.TurnResult{
		Provider:  agents.ProviderCodex,
		SessionID: request.SessionID,
		ExitCode:  0,
		Output:    "- [x] inspect\n- [x] implement",
	}, nil
}

func TestStoppedSuccessfulExecutionCannotCommitOrAdvanceTask(t *testing.T) {
	ctx := context.Background()
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	service.SetDB(warehouseDB)
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done", "Cancelled"})
	client := sqlite.NewClient(warehouseDB, []string{"agent-CODEX"})
	service.SetTrackerClient(client)
	issue, err := client.CreateIssue(ctx, "Stop race", "Late successful turn must not finalize", "Todo", 0, "agent-CODEX", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(map[string]string{"CODEX": "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {{prompt}}"})
	planningRunner := &fakeLifecycleRunner{}
	registry.SetRunner(agents.ProviderCodex, planningRunner)
	process := func() {
		processExecutionTick(service, workspace.Service{Root: workspaceRoot}, registry, agents.ProviderCodex, "codex", workspaceRoot, "missing-workflow.md", 0, nil, nil, workspace.Hooks{}, observability.NewPubSub(), warehouseDB, nil, nil, &config.Config{}, nil, zerolog.Nop())
	}
	if err := service.PerformRefreshForClient(ctx, client); err != nil {
		t.Fatalf("queue planning task: %v", err)
	}
	process()
	planned, err := client.FetchIssueByIdentifier(ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	gate := service.PlanGate(ctx, *planned)
	controls, err := control.New(warehouseDB, service, nil)
	if err != nil {
		t.Fatal(err)
	}
	approved := controls.Execute(ctx, "orchestra_control", map[string]any{
		"operation": "approve_plan", "project_id": projectID, "task_id": issue.ID,
		"expected_state": "Todo", "expected_plan_hash": gate.PlanHash, "request_id": uuid.NewString(),
	})
	if approved["success"] != true {
		t.Fatalf("approve plan: %+v", approved)
	}
	if err := service.PerformRefreshForClient(ctx, client); err != nil {
		t.Fatalf("queue approved execution: %v", err)
	}
	workspaceService := workspace.Service{Root: workspaceRoot}
	worktreePath := workspaceService.WorktreePath(projectID, strings.ToLower(issue.Identifier))
	marker := filepath.Join(worktreePath, "late-turn.marker")
	if err := os.WriteFile(marker, []byte("must remain uncommitted"), 0o600); err != nil {
		t.Fatal(err)
	}
	headBefore, err := exec.Command("git", "-C", worktreePath, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatalf("read worktree HEAD before execution: %v", err)
	}
	registry.SetRunner(agents.ProviderCodex, &stopSuccessfulLifecycleRunner{stop: func() error {
		service.StopAllSessionsForIssue(issue.ID)
		_, err := service.StopIssue(ctx, issue.ID)
		return err
	}})
	process()

	current, err := client.FetchIssueByIdentifier(ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.State != "Backlog" {
		t.Fatalf("late result advanced stopped task: state=%q", current.State)
	}
	headAfter, err := exec.Command("git", "-C", worktreePath, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatalf("read worktree HEAD after execution: %v", err)
	}
	if string(headAfter) != string(headBefore) {
		t.Fatalf("late successful result committed after stop: HEAD %q -> %q", strings.TrimSpace(string(headBefore)), strings.TrimSpace(string(headAfter)))
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("late successful result removed its uncommitted marker: %v", err)
	}
	status, err := exec.Command("git", "-C", worktreePath, "status", "--porcelain").Output()
	if err != nil || !strings.Contains(string(status), "late-turn.marker") {
		t.Fatalf("late result unexpectedly finalized workspace changes: status=%q err=%v", status, err)
	}
}

func TestAfterCreateReceiptClaimIsSingleOwnerAndUnknownBlocksRetry(t *testing.T) {
	root := t.TempDir()
	pending, claimed, unknown, completed := afterCreateReceiptPaths(root, "project", "branch", "printf setup")
	if err := os.MkdirAll(filepath.Dir(pending), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pending, []byte("pending"), 0o600); err != nil {
		t.Fatal(err)
	}
	shouldRun, err := claimAfterCreateReceipt(pending, claimed, unknown, completed)
	if err != nil || !shouldRun {
		t.Fatalf("first execution should acquire pending receipt: shouldRun=%v err=%v", shouldRun, err)
	}
	if _, err := os.Stat(pending); !os.IsNotExist(err) {
		t.Fatalf("claim did not consume pending receipt: %v", err)
	}
	shouldRun, err = claimAfterCreateReceipt(pending, claimed, unknown, completed)
	if err == nil || shouldRun {
		t.Fatalf("second execution must not run while first claim is unresolved: shouldRun=%v err=%v", shouldRun, err)
	}
	if err := os.Rename(claimed, unknown); err != nil {
		t.Fatal(err)
	}
	shouldRun, err = claimAfterCreateReceipt(pending, claimed, unknown, completed)
	if err == nil || shouldRun {
		t.Fatalf("unknown receipt must block retries: shouldRun=%v err=%v", shouldRun, err)
	}
	if err := os.Rename(unknown, completed); err != nil {
		t.Fatal(err)
	}
	shouldRun, err = claimAfterCreateReceipt(pending, claimed, unknown, completed)
	if err != nil || shouldRun {
		t.Fatalf("completed receipt should not be replayed: shouldRun=%v err=%v", shouldRun, err)
	}
}

func TestPlanningCheckoutStatFailureBlocksProvider(t *testing.T) {
	ctx := context.Background()
	workspaceRoot, projectID, warehouseDB := testProjectSetup(t)
	service := orchestrator.NewService()
	service.SetDB(warehouseDB)
	service.SetStateSets([]string{"Todo", "In Progress"}, []string{"Done", "Cancelled"})
	client := sqlite.NewClient(warehouseDB, []string{"agent-CODEX"})
	service.SetTrackerClient(client)
	issue, err := client.CreateIssue(ctx, "Checkout stat", "A malformed checkout path must block planning", "Todo", 0, "agent-CODEX", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	workspaceService := workspace.Service{Root: workspaceRoot}
	worktreePath := workspaceService.WorktreePath(projectID, strings.ToLower(issue.Identifier))
	if err := os.MkdirAll(filepath.Dir(worktreePath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(worktreePath, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(map[string]string{"CODEX": "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {{prompt}}"})
	runner := &fakeLifecycleRunner{}
	registry.SetRunner(agents.ProviderCodex, runner)
	if err := service.PerformRefreshForClient(ctx, client); err != nil {
		t.Fatalf("queue planning task: %v", err)
	}
	processExecutionTick(service, workspaceService, registry, agents.ProviderCodex, "codex", workspaceRoot, "missing-workflow.md", 0, nil, nil, workspace.Hooks{}, observability.NewPubSub(), warehouseDB, nil, nil, &config.Config{}, nil, zerolog.Nop())
	if len(runner.requests) != 0 {
		t.Fatalf("provider ran despite an invalid worktree stat result: %+v", runner.requests)
	}
}

func TestPlanningCheckoutStatClassificationKeepsPermissionErrorsDistinctFromMissingPaths(t *testing.T) {
	permissionErr := &os.PathError{Op: "stat", Path: "checkout", Err: syscall.EACCES}
	exists, err := classifyPlanningCheckoutStat(nil, permissionErr)
	if exists || !errors.Is(err, syscall.EACCES) || os.IsNotExist(err) {
		t.Fatalf("permission errors must not be treated as a missing checkout: exists=%v err=%v", exists, err)
	}
	exists, err = classifyPlanningCheckoutStat(nil, &os.PathError{Op: "stat", Path: "checkout", Err: os.ErrNotExist})
	if exists || err != nil {
		t.Fatalf("a missing checkout should be eligible for preparation: exists=%v err=%v", exists, err)
	}
}
