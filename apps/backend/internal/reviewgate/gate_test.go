package reviewgate_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/plangate"
	"github.com/orchestra/orchestra/apps/backend/internal/reviewgate"
)

type Identity = reviewgate.Identity
type StartRequest = reviewgate.StartRequest
type ResultRequest = reviewgate.ResultRequest
type ApprovalRequest = reviewgate.ApprovalRequest
type CompletionRequest = reviewgate.CompletionRequest
type QueryRower = reviewgate.QueryRower

var (
	EnsureSchema       = reviewgate.EnsureSchema
	Begin              = reviewgate.Begin
	Complete           = reviewgate.Complete
	Approve            = reviewgate.Approve
	Observe            = reviewgate.Observe
	InterruptRunning   = reviewgate.InterruptRunning
	ValidateIdentity   = reviewgate.ValidateIdentity
	CompleteMerged     = reviewgate.CompleteMerged
	ObserveStored      = reviewgate.ObserveStored
	ErrInvalidStatus   = reviewgate.ErrInvalidStatus
	ErrIdentityChanged = reviewgate.ErrIdentityChanged
	ErrInvalidIdentity = reviewgate.ErrInvalidIdentity
	ErrTaskUnsettled   = reviewgate.ErrTaskUnsettled
)

func reviewFixture(t *testing.T) (*db.DB, Identity) {
	t.Helper()
	database, err := db.Connect(filepath.Join(t.TempDir(), "review-gate.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	projectID, err := database.UpsertProject(context.Background(), t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	taskID := uuid.NewString()
	prURL := "https://github.com/Example/Repo/pull/17"
	if _, err := database.Exec(`UPDATE projects SET github_owner='Example',github_repo='Repo' WHERE id=?`, projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO issues(id,identifier,title,description,state,assignee_id,project_id,priority,branch_name,url,labels,blocked_by,provider,disabled_tools,updated_at,pr_url,plan,feedback,base_sha,runtime_target) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, taskID, "ORC-17", "Review task", "Review exact changes", "Review", "agent-CODEX", projectID, 0, "feature/review", "", "[]", "[]", "CODEX", "", "2026-10-05T00:00:00Z", prURL, "- [x] Existing implementation\n- [ ] Follow-up", "", "", ""); err != nil {
		t.Fatal(err)
	}
	if err := EnsureSchema(context.Background(), database); err != nil {
		t.Fatal(err)
	}
	return database, Identity{ProjectID: projectID, TaskID: taskID, PRURL: prURL, Repository: "example/repo", PRNumber: 17, HeadSHA: strings.Repeat("a", 40)}
}

func beginFixture(t *testing.T, database *db.DB, identity Identity) StartRequest {
	t.Helper()
	request := StartRequest{AttemptID: uuid.NewString(), Identity: identity, ContextHash: strings.Repeat("c", 64), ReviewerProvider: "codex", ReviewerAgentID: "pr-reviewer", ReviewerRunID: uuid.NewString(), ReviewerSessionID: "codex-thread-review-1"}
	attempt, err := Begin(context.Background(), database.DB, request)
	if err != nil {
		t.Fatal(err)
	}
	if attempt.Status != "running" {
		t.Fatalf("unexpected initial review status: %+v", attempt)
	}
	return request
}

func TestReviewGateBindsCleanReviewAndHumanApprovalToExactPRHead(t *testing.T) {
	database, identity := reviewFixture(t)
	request := beginFixture(t, database, identity)
	result, err := Complete(context.Background(), database.DB, ResultRequest{AttemptID: request.AttemptID, CurrentIdentity: identity, ContextHash: request.ContextHash, ReviewerRunID: request.ReviewerRunID, ReviewerSessionID: request.ReviewerSessionID, Conclusion: "clean"})
	if err != nil || result.Status != "awaiting_human_approval" {
		t.Fatalf("complete=%+v err=%v", result, err)
	}
	approval := ApprovalRequest{RequestID: uuid.NewString(), AttemptID: request.AttemptID, Identity: identity, ContextHash: request.ContextHash}
	gate, err := Approve(context.Background(), database.DB, approval)
	if err != nil || gate.Status != "approved" || gate.HeadSHA != identity.HeadSHA {
		t.Fatalf("approve=%+v err=%v", gate, err)
	}
	if _, err = Approve(context.Background(), database.DB, approval); err != nil {
		t.Fatalf("same approval receipt did not reconcile idempotently: %v", err)
	}
	var state, plan string
	if err = database.QueryRow(`SELECT state,plan FROM issues WHERE id=? AND project_id=?`, identity.TaskID, identity.ProjectID).Scan(&state, &plan); err != nil {
		t.Fatal(err)
	}
	if state != "Review" || !strings.Contains(plan, "Existing implementation") {
		t.Fatalf("review approval auto-completed task or lost plan context: state=%q plan=%q", state, plan)
	}
	if _, err = database.Exec(`UPDATE issues SET state='Done' WHERE id=? AND project_id=?`, identity.TaskID, identity.ProjectID); err != nil {
		t.Fatal(err)
	}
	if _, err = Approve(context.Background(), database.DB, approval); err != nil {
		t.Fatalf("same approval receipt did not reconcile after a separate completion: %v", err)
	}
	changed := identity
	changed.HeadSHA = strings.Repeat("b", 40)
	stale, err := Observe(context.Background(), database, identity.ProjectID, identity.TaskID, &changed)
	if err != nil || stale.Status != "stale" {
		t.Fatalf("head change should stale review evidence: gate=%+v err=%v", stale, err)
	}
	if _, err = Approve(context.Background(), database.DB, ApprovalRequest{RequestID: uuid.NewString(), AttemptID: request.AttemptID, Identity: changed, ContextHash: request.ContextHash}); !errors.Is(err, ErrInvalidStatus) && !errors.Is(err, ErrIdentityChanged) {
		t.Fatalf("changed head was approved: %v", err)
	}
}

func TestReviewFindingsReturnToTodoPreservingPlanAndContext(t *testing.T) {
	database, identity := reviewFixture(t)
	issue, _, err := plangate.LoadLocalTask(context.Background(), database, identity.TaskID, identity.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	priorPlanFingerprint := plangate.Fingerprint(*issue)
	if _, err := database.Exec(`INSERT INTO issue_history(id,issue_id,user_id,action,old_value,new_value) VALUES(?,?,?,?,?,?)`, "hist_"+uuid.NewString(), identity.TaskID, "User", "plan_approved", "", priorPlanFingerprint); err != nil {
		t.Fatal(err)
	}
	priorGate, err := plangate.Status(context.Background(), database, *issue)
	if err != nil || priorGate.Status != "approved" {
		t.Fatalf("fixture plan approval was not observed: %+v %v", priorGate, err)
	}
	request := beginFixture(t, database, identity)
	feedback := "Fix the checked-in error path; retain the existing API implementation."
	result, err := Complete(context.Background(), database.DB, ResultRequest{AttemptID: request.AttemptID, CurrentIdentity: identity, ContextHash: request.ContextHash, ReviewerRunID: request.ReviewerRunID, ReviewerSessionID: request.ReviewerSessionID, Conclusion: "changes_requested", Feedback: feedback})
	if err != nil || result.Status != "changes_requested" || result.Feedback != feedback {
		t.Fatalf("findings=%+v err=%v", result, err)
	}
	var state, plan, storedFeedback, prURL string
	if err = database.QueryRow(`SELECT state,plan,feedback,pr_url FROM issues WHERE id=? AND project_id=?`, identity.TaskID, identity.ProjectID).Scan(&state, &plan, &storedFeedback, &prURL); err != nil {
		t.Fatal(err)
	}
	if state != "Todo" || plan == "" || storedFeedback != feedback || prURL != identity.PRURL {
		t.Fatalf("findings did not preserve context: state=%q plan=%q feedback=%q pr=%q", state, plan, storedFeedback, prURL)
	}
	updatedIssue, _, err := plangate.LoadLocalTask(context.Background(), database, identity.TaskID, identity.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	updatedGate, err := plangate.Status(context.Background(), database, *updatedIssue)
	if err != nil || updatedGate.Status != "stale" {
		t.Fatalf("review feedback did not invalidate old human plan approval: %+v %v", updatedGate, err)
	}
	replayed, err := Begin(context.Background(), database.DB, request)
	if err != nil || replayed.Status != "changes_requested" || replayed.Feedback != feedback {
		t.Fatalf("same review request did not reconcile after returning to Todo: %+v %v", replayed, err)
	}
	if _, err := Approve(context.Background(), database.DB, ApprovalRequest{RequestID: uuid.NewString(), AttemptID: request.AttemptID, Identity: identity, ContextHash: request.ContextHash}); !errors.Is(err, ErrInvalidStatus) {
		t.Fatalf("findings attempt allowed clean approval: %v", err)
	}
}

func TestReviewCompletionRejectsDifferentHeadAndStalesAttempt(t *testing.T) {
	database, identity := reviewFixture(t)
	request := beginFixture(t, database, identity)
	changed := identity
	changed.HeadSHA = strings.Repeat("c", 40)
	_, err := Complete(context.Background(), database.DB, ResultRequest{AttemptID: request.AttemptID, CurrentIdentity: changed, ContextHash: request.ContextHash, ReviewerRunID: request.ReviewerRunID, ReviewerSessionID: request.ReviewerSessionID, Conclusion: "clean"})
	if !errors.Is(err, ErrIdentityChanged) {
		t.Fatalf("expected stale completion rejection, got %v", err)
	}
	gate, err := Observe(context.Background(), database, identity.ProjectID, identity.TaskID, &identity)
	if err != nil || gate.Status != "stale" {
		t.Fatalf("stale attempt not durable: gate=%+v err=%v", gate, err)
	}
}

func TestInterruptedReviewIsDurableAndCanBeRetriedAfterRestart(t *testing.T) {
	database, identity := reviewFixture(t)
	first := beginFixture(t, database, identity)
	count, err := InterruptRunning(context.Background(), database)
	if err != nil || count != 1 {
		t.Fatalf("restart recovery count=%d err=%v", count, err)
	}
	gate, err := Observe(context.Background(), database, identity.ProjectID, identity.TaskID, &identity)
	if err != nil || gate.Status != "interrupted" {
		t.Fatalf("interrupted attempt was not visible: %+v %v", gate, err)
	}
	if _, err = Approve(context.Background(), database.DB, ApprovalRequest{RequestID: uuid.NewString(), AttemptID: first.AttemptID, Identity: identity, ContextHash: first.ContextHash}); !errors.Is(err, ErrInvalidStatus) {
		t.Fatalf("interrupted attempt was approvable: %v", err)
	}
	second := StartRequest{AttemptID: uuid.NewString(), Identity: identity, ContextHash: strings.Repeat("d", 64), ReviewerProvider: "ANTIGRAVITY", ReviewerAgentID: "reviewer", ReviewerRunID: uuid.NewString(), ReviewerSessionID: "session-next"}
	attempt, err := Begin(context.Background(), database.DB, second)
	if err != nil || attempt.Status != "running" {
		t.Fatalf("retry after restart failed: %+v %v", attempt, err)
	}
}

func TestReviewAttemptRequiresExactTaskPRAndProviderRunIdentity(t *testing.T) {
	database, identity := reviewFixture(t)
	wrong := identity
	wrong.PRNumber++
	if _, err := Begin(context.Background(), database.DB, StartRequest{AttemptID: uuid.NewString(), Identity: wrong, ContextHash: strings.Repeat("c", 64), ReviewerProvider: "CODEX", ReviewerAgentID: "reviewer", ReviewerRunID: uuid.NewString(), ReviewerSessionID: "thread"}); !errors.Is(err, ErrInvalidIdentity) && !errors.Is(err, ErrIdentityChanged) {
		t.Fatalf("wrong PR identity accepted: %v", err)
	}
	request := beginFixture(t, database, identity)
	_, err := Complete(context.Background(), database.DB, ResultRequest{AttemptID: request.AttemptID, CurrentIdentity: identity, ContextHash: request.ContextHash, ReviewerRunID: uuid.NewString(), ReviewerSessionID: request.ReviewerSessionID, Conclusion: "clean"})
	if !errors.Is(err, ErrInvalidStatus) {
		t.Fatalf("wrong provider run completed review: %v", err)
	}
	var count int
	if err = database.QueryRow(`SELECT COUNT(*) FROM pr_review_attempts WHERE status='running'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("wrong run changed durable attempt: count=%d err=%v", count, err)
	}
}

func TestReviewIdentityValidationRejectsMalformedOrCrossRepositoryURL(t *testing.T) {
	base := Identity{ProjectID: "p", TaskID: "t", PRURL: "https://github.com/owner/repo/pull/3", Repository: "owner/repo", PRNumber: 3, HeadSHA: strings.Repeat("a", 40)}
	for name, mutate := range map[string]func(*Identity){
		"short sha":        func(value *Identity) { value.HeadSHA = "deadbeef" },
		"other repository": func(value *Identity) { value.Repository = "other/repo" },
		"query url":        func(value *Identity) { value.PRURL += "?head=main" },
		"other number":     func(value *Identity) { value.PRNumber = 4 },
		"non-https":        func(value *Identity) { value.PRURL = "http://github.com/owner/repo/pull/3" },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := base
			mutate(&candidate)
			if ValidateIdentity(candidate) {
				t.Fatalf("accepted invalid identity: %+v", candidate)
			}
		})
	}
}

func TestDoneRequiresApprovedAttemptAndFreshMergedHeadReceipt(t *testing.T) {
	database, identity := reviewFixture(t)
	request := beginFixture(t, database, identity)
	clean, err := Complete(context.Background(), database.DB, ResultRequest{AttemptID: request.AttemptID, CurrentIdentity: identity, ContextHash: request.ContextHash, ReviewerRunID: request.ReviewerRunID, ReviewerSessionID: request.ReviewerSessionID, Conclusion: "clean"})
	if err != nil || clean.Status != "awaiting_human_approval" {
		t.Fatalf("clean review=%+v err=%v", clean, err)
	}
	var state string
	if err := database.QueryRow(`SELECT state FROM issues WHERE id=? AND project_id=?`, identity.TaskID, identity.ProjectID).Scan(&state); err != nil || state != "Review" {
		t.Fatalf("reviewer completion auto-moved task: state=%q err=%v", state, err)
	}
	if _, err := CompleteMerged(context.Background(), database.DB, CompletionRequest{RequestID: uuid.NewString(), AttemptID: request.AttemptID, Identity: identity, ContextHash: request.ContextHash, Merged: true}); !errors.Is(err, ErrInvalidStatus) {
		t.Fatalf("unapproved review completed task: %v", err)
	}
	if _, err := Approve(context.Background(), database.DB, ApprovalRequest{RequestID: uuid.NewString(), AttemptID: request.AttemptID, Identity: identity, ContextHash: request.ContextHash}); err != nil {
		t.Fatal(err)
	}
	if _, err := CompleteMerged(context.Background(), database.DB, CompletionRequest{RequestID: uuid.NewString(), AttemptID: request.AttemptID, Identity: identity, ContextHash: request.ContextHash, Merged: false}); !errors.Is(err, ErrInvalidIdentity) {
		t.Fatalf("completion without merge proof accepted: %v", err)
	}
	completionRequest := CompletionRequest{RequestID: uuid.NewString(), AttemptID: request.AttemptID, Identity: identity, ContextHash: request.ContextHash, Merged: true}
	completion, err := CompleteMerged(context.Background(), database.DB, completionRequest)
	if err != nil || completion.TaskState != "Done" || completion.Gate.Status != "approved" {
		t.Fatalf("merged completion=%+v err=%v", completion, err)
	}
	if _, err := CompleteMerged(context.Background(), database.DB, completionRequest); err != nil {
		t.Fatalf("completion receipt did not reconcile: %v", err)
	}
	if _, err := CompleteMerged(context.Background(), database.DB, CompletionRequest{RequestID: uuid.NewString(), AttemptID: request.AttemptID, Identity: identity, ContextHash: request.ContextHash, Merged: true}); !errors.Is(err, ErrTaskUnsettled) {
		t.Fatalf("new completion receipt repeated state transition: %v", err)
	}
	stored, err := ObserveStored(context.Background(), database, identity.ProjectID, identity.TaskID)
	if err != nil || stored.Status != "approved" || stored.Freshness != "not_checked" {
		t.Fatalf("stored approval claimed freshness or was hidden: %+v err=%v", stored, err)
	}
}

func TestReviewContextFingerprintChangeStalesCompletionAndApproval(t *testing.T) {
	database, identity := reviewFixture(t)
	request := beginFixture(t, database, identity)
	changedContext := strings.Repeat("d", 64)
	_, err := Complete(context.Background(), database.DB, ResultRequest{AttemptID: request.AttemptID, CurrentIdentity: identity, ContextHash: changedContext, ReviewerRunID: request.ReviewerRunID, ReviewerSessionID: request.ReviewerSessionID, Conclusion: "clean"})
	if !errors.Is(err, ErrIdentityChanged) {
		t.Fatalf("changed task context was accepted at completion: %v", err)
	}
	stored, err := ObserveStored(context.Background(), database, identity.ProjectID, identity.TaskID)
	if err != nil || stored.Status != "stale" {
		t.Fatalf("context change did not stale pending review: %+v %v", stored, err)
	}

	second := beginFixture(t, database, identity)
	if _, err := Complete(context.Background(), database.DB, ResultRequest{AttemptID: second.AttemptID, CurrentIdentity: identity, ContextHash: second.ContextHash, ReviewerRunID: second.ReviewerRunID, ReviewerSessionID: second.ReviewerSessionID, Conclusion: "clean"}); err != nil {
		t.Fatal(err)
	}
	_, err = Approve(context.Background(), database.DB, ApprovalRequest{RequestID: uuid.NewString(), AttemptID: second.AttemptID, Identity: identity, ContextHash: changedContext})
	if !errors.Is(err, ErrIdentityChanged) {
		t.Fatalf("changed task context was approved: %v", err)
	}
	stored, err = ObserveStored(context.Background(), database, identity.ProjectID, identity.TaskID)
	if err != nil || stored.Status != "stale" {
		t.Fatalf("context change did not stale approval attempt: %+v %v", stored, err)
	}
}

var _ QueryRower = (*sql.Tx)(nil)
