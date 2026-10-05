package reviewpipeline

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/reviewgate"
	ghutil "github.com/orchestra/orchestra/apps/backend/internal/utils/github"
)

const codexDefault = "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --json {{prompt}}"

type snapshotFixture struct {
	mu        sync.Mutex
	snapshots []*ghutil.ReviewSnapshot
	loads     int
}

func (f *snapshotFixture) Load(context.Context, db.Project, int) (*ghutil.ReviewSnapshot, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.snapshots) == 0 {
		return nil, errors.New("no snapshot fixture")
	}
	index := f.loads
	f.loads++
	if index >= len(f.snapshots) {
		index = len(f.snapshots) - 1
	}
	return f.snapshots[index], nil
}

type reviewTurnRunner struct {
	calls  atomic.Int32
	req    agents.TurnRequest
	result agents.TurnResult
	err    error
}

func (f *reviewTurnRunner) RunTurn(_ context.Context, req agents.TurnRequest, _ agents.EventHandler) (agents.TurnResult, error) {
	f.calls.Add(1)
	f.req = req
	result := f.result
	if result.SessionID == "review-session" {
		result.SessionID = req.SessionID
	}
	return result, f.err
}

type concurrentReviewTurnRunner struct {
	started         chan agents.TurnRequest
	release         <-chan struct{}
	findingsSession string
	mu              sync.Mutex
	calls           map[string]int
}

func (f *concurrentReviewTurnRunner) RunTurn(ctx context.Context, req agents.TurnRequest, _ agents.EventHandler) (agents.TurnResult, error) {
	f.mu.Lock()
	f.calls[req.SessionID]++
	f.mu.Unlock()
	f.started <- req
	select {
	case <-f.release:
	case <-ctx.Done():
		return agents.TurnResult{}, ctx.Err()
	}
	if req.SessionID == f.findingsSession {
		return agents.TurnResult{ExitCode: 0, SessionID: req.SessionID, Output: `{"decision":"changes_requested","feedback":"Task two needs its own follow-up."}`}, nil
	}
	return agents.TurnResult{ExitCode: 0, SessionID: req.SessionID, Output: `{"decision":"clean","feedback":""}`}, nil
}

func (f *concurrentReviewTurnRunner) callCount(sessionID string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[sessionID]
}

func reviewSnapshot(head string, state string, draft bool, merged bool) *ghutil.ReviewSnapshot {
	snapshot := &ghutil.ReviewSnapshot{Diff: "diff --git a/a.go b/a.go\n+return error"}
	snapshot.PR.Number = 17
	snapshot.PR.Title = "Review title"
	snapshot.PR.Body = "Please inspect this patch"
	snapshot.PR.State = state
	snapshot.PR.Draft = draft
	snapshot.PR.HTMLURL = "https://github.com/Example/Repo/pull/17"
	snapshot.PR.Head.Ref = "feature/review"
	snapshot.PR.Head.SHA = head
	snapshot.PR.Base.Ref = "main"
	snapshot.PR.Base.SHA = strings.Repeat("b", 40)
	snapshot.PR.User.Login = "author"
	if merged {
		value := "2026-10-05T12:00:00Z"
		snapshot.PR.MergedAt = &value
	}
	return snapshot
}

func reviewPipelineFixture(t *testing.T, result agents.TurnResult, runErr error, snapshots ...*ghutil.ReviewSnapshot) (*Runner, *db.DB, reviewgate.Identity, *reviewTurnRunner) {
	t.Helper()
	// Capability preflight intentionally checks the configured executable. Keep
	// this fixture independent of whichever provider CLIs happen to be installed
	// on the developer or CI host; the registered fake runner handles the turn.
	commandDir := t.TempDir()
	executableName := "codex"
	if runtime.GOOS == "windows" {
		executableName += ".exe"
	}
	if err := os.WriteFile(filepath.Join(commandDir, executableName), []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", commandDir)
	database, err := db.Connect(filepath.Join(t.TempDir(), "pipeline.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	projectID, err := database.UpsertProject(context.Background(), t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = database.Exec(`UPDATE projects SET github_owner='Example',github_repo='Repo' WHERE id=?`, projectID); err != nil {
		t.Fatal(err)
	}
	taskID := uuid.NewString()
	prURL := "https://github.com/Example/Repo/pull/17"
	if _, err = database.Exec(`INSERT INTO issues(id,identifier,title,description,state,assignee_id,project_id,provider,updated_at,pr_url,plan) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, taskID, "ORC-17", "Review this change", "Exact task context", "Review", "person", projectID, "CODEX", "2026-10-05T00:00:00Z", prURL, "- [x] Keep prior plan"); err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(map[string]string{
		"CODEX":    codexDefault,
		"OPENCODE": "opencode -p {{prompt}} -f json",
	})
	turn := &reviewTurnRunner{result: result, err: runErr}
	registry.SetRunner(agents.ProviderCodex, turn)
	registry.SetRunner(agents.ProviderOpenCode, turn)
	lifecycle, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	runner, err := New(lifecycle, database, registry, &snapshotFixture{snapshots: snapshots})
	if err != nil {
		t.Fatal(err)
	}
	identity := reviewgate.Identity{ProjectID: projectID, TaskID: taskID, PRURL: prURL, Repository: "example/repo", PRNumber: 17, HeadSHA: strings.Repeat("a", 40)}
	return runner, database, identity, turn
}

func reviewRequest(identity reviewgate.Identity, provider string) Request {
	return Request{Operation: "request_review", ProjectID: identity.ProjectID, TaskID: identity.TaskID, RequestID: uuid.NewString(), ReviewAttemptID: uuid.NewString(), ExpectedState: "Review", ExpectedPRURL: identity.PRURL, ExpectedHeadSHA: identity.HeadSHA, ReviewerProvider: provider, ReviewerAgentID: ProviderDefaultAgent}
}

func waitForStatus(t *testing.T, database *db.DB, identity reviewgate.Identity, statuses ...string) reviewgate.Gate {
	t.Helper()
	wanted := map[string]bool{}
	for _, status := range statuses {
		wanted[status] = true
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		gate, err := reviewgate.ObserveStored(context.Background(), database, identity.ProjectID, identity.TaskID)
		if err != nil {
			t.Fatal(err)
		}
		if wanted[gate.Status] {
			return gate
		}
		time.Sleep(10 * time.Millisecond)
	}
	gate, _ := reviewgate.ObserveStored(context.Background(), database, identity.ProjectID, identity.TaskID)
	t.Fatalf("timed out waiting for review state; current=%+v", gate)
	return reviewgate.Gate{}
}

func TestRequestReviewRunsOnceWithVerifiedReadonlyToolFreeTurnAndReconciles(t *testing.T) {
	identity := reviewgate.Identity{HeadSHA: strings.Repeat("a", 40)}
	runner, database, identity, turn := reviewPipelineFixture(t, agents.TurnResult{ExitCode: 0, SessionID: "review-session", Output: `{"decision":"clean","feedback":""}`}, nil, reviewSnapshot(identity.HeadSHA, "open", false, false))
	req := reviewRequest(identity, "CODEX")
	req.ReviewAttemptID = "ignored caller value"
	req.RequestID = uuid.NewString()
	gate, err := runner.Execute(context.Background(), req)
	if err != nil || gate.Status != "running" || gate.AttemptID != req.RequestID {
		t.Fatalf("review admission=%+v err=%v", gate, err)
	}
	gate, err = runner.Execute(context.Background(), req)
	if err != nil || gate.Status != "running" && gate.Status != "awaiting_human_approval" {
		t.Fatalf("replay did not observe running attempt: %+v %v", gate, err)
	}
	settled := waitForStatus(t, database, identity, "awaiting_human_approval", "failed", "interrupted")
	if settled.Status != "awaiting_human_approval" {
		t.Fatalf("clean review did not stop at human approval: %+v", settled)
	}
	if turn.calls.Load() != 1 {
		t.Fatalf("same UUID launched %d reviewer turns", turn.calls.Load())
	}
	expectedStageCommand := "codex exec --skip-git-repo-check --ignore-user-config --sandbox read-only --json {{prompt}}"
	if runtime.GOOS == "windows" {
		expectedStageCommand = "codex exec --skip-git-repo-check --ignore-user-config -c windows.sandbox='\"unelevated\"' -c approval_policy='\"never\"' --sandbox read-only --json {{prompt}}"
	}
	if !turn.req.PlanOnly || turn.req.RuntimeTarget != agents.RuntimeLocal || turn.req.CommandOverride != expectedStageCommand || turn.req.ToolExecutor != nil || len(turn.req.ToolSpecs) != 0 || len(turn.req.ResourceSpecs) != 0 || turn.req.RequestedAgentID != "" || turn.req.SessionID != "review-"+req.RequestID {
		t.Fatalf("reviewer did not receive the constrained stage request: %+v", turn.req)
	}
	if !strings.Contains(turn.req.Prompt, identity.HeadSHA) || !strings.Contains(turn.req.Prompt, "immutable diff") || !strings.Contains(turn.req.Prompt, "untrusted") {
		t.Fatalf("reviewer prompt lacks pinned context: %q", turn.req.Prompt)
	}
	if settled.Freshness != "not_checked" {
		t.Fatalf("stored view claimed remote freshness: %+v", settled)
	}
}

func TestConcurrentReviewAttemptsAreIsolatedByTask(t *testing.T) {
	head := strings.Repeat("a", 40)
	snapshot := reviewSnapshot(head, "open", false, false)
	runner, database, firstIdentity, _ := reviewPipelineFixture(t, agents.TurnResult{}, nil,
		snapshot, snapshot, snapshot, snapshot, snapshot, snapshot,
	)
	secondTaskID := uuid.NewString()
	if _, err := database.Exec(`INSERT INTO issues(id,identifier,title,description,state,assignee_id,project_id,provider,updated_at,pr_url,plan) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, secondTaskID, "ORC-18", "Review another change", "Second task context", "Review", "person", firstIdentity.ProjectID, "CODEX", "2026-10-05T00:00:00Z", firstIdentity.PRURL, "- [x] Task two plan"); err != nil {
		t.Fatal(err)
	}
	secondIdentity := firstIdentity
	secondIdentity.TaskID = secondTaskID
	firstReq := reviewRequest(firstIdentity, "CODEX")
	firstReq.RequestID = uuid.NewString()
	secondReq := reviewRequest(secondIdentity, "CODEX")
	secondReq.RequestID = uuid.NewString()
	firstReq.ReviewerAgentID = ProviderDefaultAgent
	secondReq.ReviewerAgentID = ProviderDefaultAgent

	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseBoth := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(releaseBoth)
	turn := &concurrentReviewTurnRunner{started: make(chan agents.TurnRequest, 2), release: release, findingsSession: "review-" + secondReq.RequestID, calls: map[string]int{}}
	runner.registry.SetRunner(agents.ProviderCodex, turn)
	for _, item := range []struct {
		identity reviewgate.Identity
		request  Request
	}{{firstIdentity, firstReq}, {secondIdentity, secondReq}} {
		gate, err := runner.Execute(context.Background(), item.request)
		if err != nil || gate.Status != "running" || gate.AttemptID != item.request.RequestID {
			t.Fatalf("task %s review admission=%+v err=%v", item.identity.TaskID, gate, err)
		}
	}

	seen := map[string]bool{}
	for range 2 {
		select {
		case req := <-turn.started:
			seen[req.SessionID] = true
		case <-time.After(3 * time.Second):
			t.Fatalf("both provider turns did not start before release; started=%v", seen)
		}
	}
	if !seen["review-"+firstReq.RequestID] || !seen["review-"+secondReq.RequestID] {
		t.Fatalf("provider turns did not retain their request identities: %v", seen)
	}

	for _, req := range []Request{firstReq, secondReq} {
		gate, err := runner.Execute(context.Background(), req)
		if err != nil || gate.Status != "running" || gate.AttemptID != req.RequestID {
			t.Fatalf("duplicate request %s did not observe its running attempt: %+v err=%v", req.RequestID, gate, err)
		}
	}
	if calls := turn.callCount("review-" + firstReq.RequestID); calls != 1 {
		t.Fatalf("first request launched %d provider turns before settlement", calls)
	}
	if calls := turn.callCount("review-" + secondReq.RequestID); calls != 1 {
		t.Fatalf("second request launched %d provider turns before settlement", calls)
	}
	releaseBoth()

	firstGate := waitForStatus(t, database, firstIdentity, "awaiting_human_approval", "changes_requested", "failed", "interrupted")
	secondGate := waitForStatus(t, database, secondIdentity, "awaiting_human_approval", "changes_requested", "failed", "interrupted")
	if firstGate.Status != "awaiting_human_approval" || firstGate.AttemptID != firstReq.RequestID || firstGate.Feedback != "" {
		t.Fatalf("first task observed another task's result: %+v", firstGate)
	}
	if secondGate.Status != "changes_requested" || secondGate.AttemptID != secondReq.RequestID || secondGate.Feedback != "Task two needs its own follow-up." {
		t.Fatalf("second task observed another task's result: %+v", secondGate)
	}
	if calls := turn.callCount("review-" + firstReq.RequestID); calls != 1 {
		t.Fatalf("first request launched %d provider turns total", calls)
	}
	if calls := turn.callCount("review-" + secondReq.RequestID); calls != 1 {
		t.Fatalf("second request launched %d provider turns total", calls)
	}

	var firstState, firstFeedback, firstPlan, secondState, secondFeedback, secondPlan string
	if err := database.QueryRow(`SELECT state,COALESCE(feedback,''),plan FROM issues WHERE id=? AND project_id=?`, firstIdentity.TaskID, firstIdentity.ProjectID).Scan(&firstState, &firstFeedback, &firstPlan); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRow(`SELECT state,feedback,plan FROM issues WHERE id=? AND project_id=?`, secondIdentity.TaskID, secondIdentity.ProjectID).Scan(&secondState, &secondFeedback, &secondPlan); err != nil {
		t.Fatal(err)
	}
	if firstState != "Review" || firstFeedback != "" || firstPlan != "- [x] Keep prior plan" {
		t.Fatalf("first task state/context crossed with second task: state=%q feedback=%q plan=%q", firstState, firstFeedback, firstPlan)
	}
	if secondState != "Todo" || secondFeedback != secondGate.Feedback || secondPlan != "- [x] Task two plan" {
		t.Fatalf("second task state/context crossed with first task: state=%q feedback=%q plan=%q", secondState, secondFeedback, secondPlan)
	}
	var firstReceiptTask, secondReceiptTask string
	if err := database.QueryRow(`SELECT task_id FROM pr_review_attempts WHERE attempt_id=? AND project_id=?`, firstReq.RequestID, firstIdentity.ProjectID).Scan(&firstReceiptTask); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRow(`SELECT task_id FROM pr_review_attempts WHERE attempt_id=? AND project_id=?`, secondReq.RequestID, secondIdentity.ProjectID).Scan(&secondReceiptTask); err != nil {
		t.Fatal(err)
	}
	if firstReceiptTask != firstIdentity.TaskID || secondReceiptTask != secondIdentity.TaskID {
		t.Fatalf("attempt receipts crossed tasks: first=%q second=%q", firstReceiptTask, secondReceiptTask)
	}
}

func TestReviewFindingsAndRunnerFailureSettleWithoutApproving(t *testing.T) {
	identity := reviewgate.Identity{HeadSHA: strings.Repeat("a", 40)}
	feedback := "Fix the unchecked error return."
	runner, database, identity, _ := reviewPipelineFixture(t, agents.TurnResult{ExitCode: 0, SessionID: "review-session", Output: `{"decision":"changes_requested","feedback":"Fix the unchecked error return."}`}, nil, reviewSnapshot(identity.HeadSHA, "open", false, false))
	req := reviewRequest(identity, "CODEX")
	req.RequestID = uuid.NewString()
	if _, err := runner.Execute(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	gate := waitForStatus(t, database, identity, "changes_requested", "failed", "interrupted")
	if gate.Status != "changes_requested" || gate.Feedback != feedback {
		t.Fatalf("findings not returned to planning: %+v", gate)
	}
	var state, plan, storedFeedback string
	if err := database.QueryRow(`SELECT state,plan,feedback FROM issues WHERE id=? AND project_id=?`, identity.TaskID, identity.ProjectID).Scan(&state, &plan, &storedFeedback); err != nil {
		t.Fatal(err)
	}
	if state != "Todo" || plan != "- [x] Keep prior plan" || storedFeedback != feedback {
		t.Fatalf("review findings did not preserve plan context: state=%q plan=%q feedback=%q", state, plan, storedFeedback)
	}

	failedRunner, failedDB, failedIdentity, failedTurn := reviewPipelineFixture(t, agents.TurnResult{}, errors.New("provider unavailable"), reviewSnapshot(identity.HeadSHA, "open", false, false))
	failReq := reviewRequest(failedIdentity, "CODEX")
	failReq.RequestID = uuid.NewString()
	if _, err := failedRunner.Execute(context.Background(), failReq); err != nil {
		t.Fatal(err)
	}
	failed := waitForStatus(t, failedDB, failedIdentity, "failed", "interrupted")
	if failed.Status != "failed" || failedTurn.calls.Load() != 1 {
		t.Fatalf("provider failure not durably settled: %+v calls=%d", failed, failedTurn.calls.Load())
	}
}

func TestReviewAdmissionRequiresFreshExactHeadAndVerifiedHarness(t *testing.T) {
	identity := reviewgate.Identity{HeadSHA: strings.Repeat("a", 40)}
	runner, database, identity, turn := reviewPipelineFixture(t, agents.TurnResult{}, nil, reviewSnapshot(strings.Repeat("c", 40), "open", false, false))
	req := reviewRequest(identity, "CODEX")
	if _, err := runner.Execute(context.Background(), req); !errors.Is(err, ErrPRSnapshotChanged) {
		t.Fatalf("stale caller SHA admitted: %v", err)
	}
	var count int
	if err := database.QueryRow(`SELECT count(*) FROM pr_review_attempts`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("stale request wrote an attempt: count=%d err=%v", count, err)
	}
	req = reviewRequest(identity, "OPENCODE")
	if _, err := runner.Execute(context.Background(), req); !errors.Is(err, ErrUnsupportedReviewer) {
		t.Fatalf("unverified provider was accepted: %v", err)
	}
	if turn.calls.Load() != 0 {
		t.Fatalf("preflight failure started provider: %d", turn.calls.Load())
	}
}
