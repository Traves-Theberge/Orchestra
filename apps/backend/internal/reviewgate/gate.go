// Package reviewgate stores PR-agent review evidence bound to an exact local
// task and immutable pull-request head. It records approvals without changing
// task completion state; that decision belongs to a separately verified PR
// merge transition.
package reviewgate

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

var (
	ErrInvalidIdentity = errors.New("review requires an exact task, canonical PR, repository and full head SHA")
	ErrIdentityChanged = errors.New("task or pull-request identity changed; refresh before continuing")
	ErrAttemptConflict = errors.New("review attempt identity conflicts with an existing attempt")
	ErrInvalidStatus   = errors.New("review attempt is not in a state that accepts this operation")
	ErrTaskUnsettled   = errors.New("review task is not settled in the expected state")
)

type Identity struct {
	ProjectID  string `json:"project_id"`
	TaskID     string `json:"task_id"`
	PRURL      string `json:"pr_url"`
	Repository string `json:"repository"` // canonical owner/repository identity
	PRNumber   int    `json:"pr_number"`
	HeadSHA    string `json:"head_sha"`
}

type Attempt struct {
	AttemptID         string   `json:"attempt_id"`
	Identity          Identity `json:"identity"`
	ContextHash       string   `json:"context_hash"`
	ReviewerProvider  string   `json:"reviewer_provider"`
	ReviewerAgentID   string   `json:"reviewer_agent_id"`
	ReviewerRunID     string   `json:"reviewer_run_id,omitempty"`
	ReviewerSessionID string   `json:"reviewer_session_id,omitempty"`
	Status            string   `json:"status"`
	Feedback          string   `json:"feedback,omitempty"`
}

type Gate struct {
	Status           string `json:"status"`
	Freshness        string `json:"freshness,omitempty"`
	HeadSHA          string `json:"head_sha,omitempty"`
	PRURL            string `json:"pr_url,omitempty"`
	AttemptID        string `json:"attempt_id,omitempty"`
	ReviewerProvider string `json:"reviewer_provider,omitempty"`
	ReviewerAgentID  string `json:"reviewer_agent_id,omitempty"`
	Feedback         string `json:"feedback,omitempty"`
}

type StartRequest struct {
	AttemptID         string
	Identity          Identity
	ContextHash       string
	ReviewerProvider  string
	ReviewerAgentID   string
	ReviewerRunID     string
	ReviewerSessionID string
}

type ResultRequest struct {
	AttemptID         string
	CurrentIdentity   Identity // a freshly fetched PR snapshot, not request input echoed back
	ContextHash       string
	ReviewerRunID     string
	ReviewerSessionID string
	Conclusion        string // "clean" or "changes_requested"
	Feedback          string
}

type ApprovalRequest struct {
	RequestID   string
	AttemptID   string
	Identity    Identity // a freshly fetched PR snapshot
	ContextHash string
}

type CompletionRequest struct {
	RequestID   string
	AttemptID   string
	Identity    Identity // a freshly fetched merged PR snapshot
	ContextHash string
	Merged      bool
}

type Completion struct {
	Gate      Gate   `json:"review_gate"`
	TaskState string `json:"task_state"`
}

type QueryRower interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// EnsureSchema adds only the review-gate-owned tables. Call during app startup.
func EnsureSchema(ctx context.Context, database interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) error {
	if database == nil {
		return errors.New("review-gate database unavailable")
	}
	_, err := database.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS pr_review_attempts (
		attempt_id TEXT PRIMARY KEY,
		project_id TEXT NOT NULL,
		task_id TEXT NOT NULL,
		pr_url TEXT NOT NULL,
		repository TEXT NOT NULL,
		pr_number INTEGER NOT NULL,
		head_sha TEXT NOT NULL,
		context_hash TEXT NOT NULL DEFAULT '',
		reviewer_provider TEXT NOT NULL,
		reviewer_agent_id TEXT NOT NULL,
		reviewer_run_id TEXT NOT NULL DEFAULT '',
		reviewer_session_id TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL,
		feedback TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_pr_review_attempts_task ON pr_review_attempts(project_id, task_id, created_at);
		CREATE TABLE IF NOT EXISTS pr_review_approvals (
		request_id TEXT PRIMARY KEY,
		digest TEXT NOT NULL,
		attempt_id TEXT NOT NULL,
		project_id TEXT NOT NULL,
		task_id TEXT NOT NULL,
		pr_url TEXT NOT NULL,
		repository TEXT NOT NULL,
		pr_number INTEGER NOT NULL,
		head_sha TEXT NOT NULL,
		status TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (attempt_id) REFERENCES pr_review_attempts(attempt_id)
	);
	CREATE TABLE IF NOT EXISTS pr_review_completions (
		request_id TEXT PRIMARY KEY,
		digest TEXT NOT NULL,
		attempt_id TEXT NOT NULL,
		project_id TEXT NOT NULL,
		task_id TEXT NOT NULL,
		pr_url TEXT NOT NULL,
		repository TEXT NOT NULL,
		pr_number INTEGER NOT NULL,
		head_sha TEXT NOT NULL,
		status TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (attempt_id) REFERENCES pr_review_attempts(attempt_id)
	);`)
	if err != nil {
		return err
	}
	var found int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM pragma_table_info('pr_review_attempts') WHERE name='context_hash'`).Scan(&found); err != nil {
		return err
	}
	if found == 0 {
		_, err = database.ExecContext(ctx, `ALTER TABLE pr_review_attempts ADD COLUMN context_hash TEXT NOT NULL DEFAULT ''`)
	}
	return err
}

// InterruptRunning makes pre-crash attempts observable and retryable after an
// app restart. It never converts an incomplete provider result into approval.
func InterruptRunning(ctx context.Context, database interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}) (int64, error) {
	if database == nil {
		return 0, errors.New("review-gate database unavailable")
	}
	result, err := database.ExecContext(ctx, `UPDATE pr_review_attempts SET status='interrupted',updated_at=CURRENT_TIMESTAMP WHERE status='running'`)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func Begin(ctx context.Context, database *sql.DB, req StartRequest) (Attempt, error) {
	attempt, _, err := BeginOnce(ctx, database, req)
	return attempt, err
}

// BeginOnce atomically records a new review attempt and reports whether this
// call acquired the right to execute it. A replay receives the existing
// attempt with created=false and must observe it instead of starting another
// provider run.
func BeginOnce(ctx context.Context, database *sql.DB, req StartRequest) (Attempt, bool, error) {
	if database == nil || !validUUID(req.AttemptID) || !validIdentity(req.Identity) || !validContextHash(req.ContextHash) || strings.TrimSpace(req.ReviewerProvider) == "" || strings.TrimSpace(req.ReviewerAgentID) == "" {
		return Attempt{}, false, ErrInvalidIdentity
	}
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return Attempt{}, false, err
	}
	defer tx.Rollback()
	req.Identity = canonicalIdentity(req.Identity)
	var previous Attempt
	err = scanAttempt(tx.QueryRowContext(ctx, `SELECT attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,context_hash,reviewer_provider,reviewer_agent_id,reviewer_run_id,reviewer_session_id,status,feedback FROM pr_review_attempts WHERE attempt_id=?`, req.AttemptID), &previous)
	if err == nil {
		if !sameAttemptRequest(previous, req) {
			return Attempt{}, false, ErrAttemptConflict
		}
		return previous, false, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Attempt{}, false, err
	}
	if err := validateCurrentTask(ctx, tx, req.Identity, "Review"); err != nil {
		return Attempt{}, false, err
	}
	var latestStatus, latestSHA string
	latestErr := tx.QueryRowContext(ctx, `SELECT status,head_sha FROM pr_review_attempts WHERE project_id=? AND task_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`, req.Identity.ProjectID, req.Identity.TaskID).Scan(&latestStatus, &latestSHA)
	if latestErr == nil && (latestStatus == "running" || latestSHA == req.Identity.HeadSHA && (latestStatus == "awaiting_human_approval" || latestStatus == "approved")) {
		return Attempt{}, false, ErrInvalidStatus
	}
	if latestErr != nil && !errors.Is(latestErr, sql.ErrNoRows) {
		return Attempt{}, false, latestErr
	}
	attempt := Attempt{AttemptID: req.AttemptID, Identity: req.Identity, ContextHash: strings.ToLower(req.ContextHash), ReviewerProvider: strings.ToUpper(strings.TrimSpace(req.ReviewerProvider)), ReviewerAgentID: strings.TrimSpace(req.ReviewerAgentID), ReviewerRunID: strings.TrimSpace(req.ReviewerRunID), ReviewerSessionID: strings.TrimSpace(req.ReviewerSessionID), Status: "running"}
	_, err = tx.ExecContext(ctx, `INSERT INTO pr_review_attempts(attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,context_hash,reviewer_provider,reviewer_agent_id,reviewer_run_id,reviewer_session_id,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'running')`, attempt.AttemptID, attempt.Identity.ProjectID, attempt.Identity.TaskID, attempt.Identity.PRURL, attempt.Identity.Repository, attempt.Identity.PRNumber, strings.ToLower(attempt.Identity.HeadSHA), attempt.ContextHash, attempt.ReviewerProvider, attempt.ReviewerAgentID, attempt.ReviewerRunID, attempt.ReviewerSessionID)
	if err != nil {
		return Attempt{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return Attempt{}, false, err
	}
	attempt.Identity.HeadSHA = strings.ToLower(attempt.Identity.HeadSHA)
	return attempt, true, nil
}

// Complete records a verified reviewer outcome. Findings return the task to
// Todo while changing only its feedback/state; plan and working-copy metadata
// remain intact, making the new plan approval fingerprint differ.
func Complete(ctx context.Context, database *sql.DB, req ResultRequest) (Attempt, error) {
	if database == nil || !validUUID(req.AttemptID) || !validIdentity(req.CurrentIdentity) || !validContextHash(req.ContextHash) || (req.Conclusion != "clean" && req.Conclusion != "changes_requested") || req.Conclusion == "changes_requested" && strings.TrimSpace(req.Feedback) == "" {
		return Attempt{}, ErrInvalidIdentity
	}
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return Attempt{}, err
	}
	defer tx.Rollback()
	req.CurrentIdentity = canonicalIdentity(req.CurrentIdentity)
	var attempt Attempt
	if err = scanAttempt(tx.QueryRowContext(ctx, `SELECT attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,context_hash,reviewer_provider,reviewer_agent_id,reviewer_run_id,reviewer_session_id,status,feedback FROM pr_review_attempts WHERE attempt_id=?`, req.AttemptID), &attempt); err != nil {
		return Attempt{}, err
	}
	if attempt.Status != "running" || req.ReviewerRunID == "" || req.ReviewerSessionID == "" || attempt.ReviewerRunID != req.ReviewerRunID || attempt.ReviewerSessionID != req.ReviewerSessionID {
		return Attempt{}, ErrInvalidStatus
	}
	if !sameIdentity(attempt.Identity, req.CurrentIdentity) || !strings.EqualFold(attempt.ContextHash, req.ContextHash) {
		if _, err = tx.ExecContext(ctx, `UPDATE pr_review_attempts SET status='stale',updated_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND status='running'`, req.AttemptID); err != nil {
			return Attempt{}, err
		}
		if err = tx.Commit(); err != nil {
			return Attempt{}, err
		}
		return Attempt{}, ErrIdentityChanged
	}
	if err = validateCurrentTask(ctx, tx, req.CurrentIdentity, "Review"); err != nil {
		return Attempt{}, err
	}
	status := "awaiting_human_approval"
	feedback := ""
	if req.Conclusion == "changes_requested" {
		status, feedback = "changes_requested", strings.TrimSpace(req.Feedback)
		updated, updateErr := tx.ExecContext(ctx, `UPDATE issues SET state='Todo',feedback=?,updated_at=datetime('now') WHERE id=? AND project_id=? AND state='Review' AND pr_url=?`, feedback, req.CurrentIdentity.TaskID, req.CurrentIdentity.ProjectID, req.CurrentIdentity.PRURL)
		if updateErr != nil {
			return Attempt{}, updateErr
		}
		rows, rowsErr := updated.RowsAffected()
		if rowsErr != nil || rows != 1 {
			return Attempt{}, ErrIdentityChanged
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO issue_history(id,issue_id,user_id,action,old_value,new_value) VALUES(?,?,?,?,?,?)`, "hist_"+uuid.NewString(), req.CurrentIdentity.TaskID, "PRReviewer", "review_findings", "", feedback); err != nil {
			return Attempt{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE pr_review_attempts SET status=?,feedback=?,updated_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND status='running'`, status, feedback, req.AttemptID); err != nil {
		return Attempt{}, err
	}
	if err = tx.Commit(); err != nil {
		return Attempt{}, err
	}
	attempt.Status, attempt.Feedback = status, feedback
	return attempt, nil
}

// Fail settles a known non-success result or uncertain provider interruption.
// Both statuses are non-approvable and permit a fresh attempt with a new UUID.
func Fail(ctx context.Context, database *sql.DB, attemptID, reviewerRunID, reviewerSessionID, status, feedback string) (Attempt, error) {
	if database == nil || !validUUID(attemptID) || status != "failed" && status != "interrupted" {
		return Attempt{}, ErrInvalidIdentity
	}
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return Attempt{}, err
	}
	defer tx.Rollback()
	var attempt Attempt
	if err = scanAttempt(tx.QueryRowContext(ctx, `SELECT attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,context_hash,reviewer_provider,reviewer_agent_id,reviewer_run_id,reviewer_session_id,status,feedback FROM pr_review_attempts WHERE attempt_id=?`, attemptID), &attempt); err != nil {
		return Attempt{}, err
	}
	if attempt.Status != "running" || attempt.ReviewerRunID != reviewerRunID || attempt.ReviewerSessionID != reviewerSessionID {
		return Attempt{}, ErrInvalidStatus
	}
	if _, err = tx.ExecContext(ctx, `UPDATE pr_review_attempts SET status=?,feedback=?,updated_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND status='running'`, status, feedback, attemptID); err != nil {
		return Attempt{}, err
	}
	if err = tx.Commit(); err != nil {
		return Attempt{}, err
	}
	attempt.Status, attempt.Feedback = status, feedback
	return attempt, nil
}

// MarkStaleForPR marks a pending/approved attempt stale only when its UUID and
// exact project/task/PR URL match. It is used after a fresh remote observation
// proves that the requested head or PR readiness changed.
func MarkStaleForPR(ctx context.Context, database *sql.DB, attemptID, projectID, taskID, prURL string) error {
	if database == nil || !validUUID(attemptID) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(taskID) == "" || strings.TrimSpace(prURL) == "" {
		return ErrInvalidIdentity
	}
	_, err := database.ExecContext(ctx, `UPDATE pr_review_attempts SET status='stale',updated_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND project_id=? AND task_id=? AND pr_url=? AND status IN ('running','awaiting_human_approval','approved')`, attemptID, projectID, taskID, prURL)
	return err
}

func MarkStaleForContext(ctx context.Context, database *sql.DB, attemptID, projectID, taskID, contextHash string) error {
	if database == nil || !validUUID(attemptID) || strings.TrimSpace(projectID) == "" || strings.TrimSpace(taskID) == "" || !validContextHash(contextHash) {
		return ErrInvalidIdentity
	}
	_, err := database.ExecContext(ctx, `UPDATE pr_review_attempts SET status='stale',updated_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND project_id=? AND task_id=? AND context_hash<>? AND status IN ('running','awaiting_human_approval','approved')`, attemptID, projectID, taskID, strings.ToLower(contextHash))
	return err
}

// Approve records explicit human approval for a clean review. It never changes
// the task state; a separate fresh merged-PR observation is required to finish.
func Approve(ctx context.Context, database *sql.DB, req ApprovalRequest) (Gate, error) {
	if database == nil || !validUUID(req.RequestID) || !validUUID(req.AttemptID) || !validIdentity(req.Identity) || !validContextHash(req.ContextHash) {
		return Gate{}, ErrInvalidIdentity
	}
	req.Identity = canonicalIdentity(req.Identity)
	digestInput, _ := json.Marshal(struct {
		RequestID, AttemptID string
		Identity             Identity
		ContextHash          string
	}{req.RequestID, req.AttemptID, req.Identity, strings.ToLower(req.ContextHash)})
	sum := sha256.Sum256(digestInput)
	digest := hex.EncodeToString(sum[:])
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return Gate{}, err
	}
	defer tx.Rollback()
	var oldDigest, oldAttempt, oldStatus string
	err = tx.QueryRowContext(ctx, `SELECT digest,attempt_id,status FROM pr_review_approvals WHERE request_id=?`, req.RequestID).Scan(&oldDigest, &oldAttempt, &oldStatus)
	if err == nil {
		if oldDigest != digest || oldAttempt != req.AttemptID {
			return Gate{}, ErrAttemptConflict
		}
		var attempt Attempt
		if err = scanAttempt(tx.QueryRowContext(ctx, `SELECT attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,context_hash,reviewer_provider,reviewer_agent_id,reviewer_run_id,reviewer_session_id,status,feedback FROM pr_review_attempts WHERE attempt_id=?`, req.AttemptID), &attempt); err != nil {
			return Gate{}, err
		}
		if !sameIdentity(attempt.Identity, req.Identity) || !strings.EqualFold(attempt.ContextHash, req.ContextHash) || oldStatus != "completed" {
			return Gate{}, ErrIdentityChanged
		}
		if err = tx.Commit(); err != nil {
			return Gate{}, err
		}
		return gateFromAttempt(attempt), nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Gate{}, err
	}
	var attempt Attempt
	if err = scanAttempt(tx.QueryRowContext(ctx, `SELECT attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,context_hash,reviewer_provider,reviewer_agent_id,reviewer_run_id,reviewer_session_id,status,feedback FROM pr_review_attempts WHERE attempt_id=?`, req.AttemptID), &attempt); err != nil {
		return Gate{}, err
	}
	if attempt.Status != "awaiting_human_approval" || !sameIdentity(attempt.Identity, req.Identity) {
		return Gate{}, ErrInvalidStatus
	}
	if !strings.EqualFold(attempt.ContextHash, req.ContextHash) {
		if _, err = tx.ExecContext(ctx, `UPDATE pr_review_attempts SET status='stale',updated_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND status='awaiting_human_approval'`, req.AttemptID); err != nil {
			return Gate{}, err
		}
		if err = tx.Commit(); err != nil {
			return Gate{}, err
		}
		return Gate{}, ErrIdentityChanged
	}
	if err = validateCurrentTask(ctx, tx, req.Identity, "Review"); err != nil {
		return Gate{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO pr_review_approvals(request_id,digest,attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,status) VALUES(?,?,?,?,?,?,?,?,?,'completed')`, req.RequestID, digest, req.AttemptID, req.Identity.ProjectID, req.Identity.TaskID, req.Identity.PRURL, req.Identity.Repository, req.Identity.PRNumber, strings.ToLower(req.Identity.HeadSHA)); err != nil {
		return Gate{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE pr_review_attempts SET status='approved',updated_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND status='awaiting_human_approval'`, req.AttemptID); err != nil {
		return Gate{}, err
	}
	if err = tx.Commit(); err != nil {
		return Gate{}, err
	}
	attempt.Status = "approved"
	return gateFromAttempt(attempt), nil
}

// CompleteMerged marks a locally tracked task Done only after a caller has
// freshly observed the exact approved PR head as merged. It records a separate
// UUID receipt and never trusts provider exit or review approval alone.
func CompleteMerged(ctx context.Context, database *sql.DB, req CompletionRequest) (Completion, error) {
	if database == nil || !validUUID(req.RequestID) || !validUUID(req.AttemptID) || !validIdentity(req.Identity) || !req.Merged {
		return Completion{}, ErrInvalidIdentity
	}
	req.Identity = canonicalIdentity(req.Identity)
	digestInput, _ := json.Marshal(struct {
		RequestID, AttemptID string
		Identity             Identity
		Merged               bool
		ContextHash          string
	}{req.RequestID, req.AttemptID, req.Identity, req.Merged, strings.ToLower(req.ContextHash)})
	sum := sha256.Sum256(digestInput)
	digest := hex.EncodeToString(sum[:])
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return Completion{}, err
	}
	defer tx.Rollback()
	var oldDigest, oldAttempt, oldStatus string
	err = tx.QueryRowContext(ctx, `SELECT digest,attempt_id,status FROM pr_review_completions WHERE request_id=?`, req.RequestID).Scan(&oldDigest, &oldAttempt, &oldStatus)
	if err == nil {
		if oldDigest != digest || oldAttempt != req.AttemptID {
			return Completion{}, ErrAttemptConflict
		}
		var attempt Attempt
		if err = scanAttempt(tx.QueryRowContext(ctx, `SELECT attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,context_hash,reviewer_provider,reviewer_agent_id,reviewer_run_id,reviewer_session_id,status,feedback FROM pr_review_attempts WHERE attempt_id=?`, req.AttemptID), &attempt); err != nil {
			return Completion{}, err
		}
		if oldStatus != "completed" || !sameIdentity(attempt.Identity, req.Identity) || !strings.EqualFold(attempt.ContextHash, req.ContextHash) {
			return Completion{}, ErrIdentityChanged
		}
		if err = tx.Commit(); err != nil {
			return Completion{}, err
		}
		return Completion{Gate: gateFromAttempt(attempt), TaskState: "Done"}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Completion{}, err
	}
	var attempt Attempt
	if err = scanAttempt(tx.QueryRowContext(ctx, `SELECT attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,context_hash,reviewer_provider,reviewer_agent_id,reviewer_run_id,reviewer_session_id,status,feedback FROM pr_review_attempts WHERE attempt_id=?`, req.AttemptID), &attempt); err != nil {
		return Completion{}, err
	}
	if attempt.Status != "approved" || !sameIdentity(attempt.Identity, req.Identity) {
		return Completion{}, ErrInvalidStatus
	}
	if !strings.EqualFold(attempt.ContextHash, req.ContextHash) {
		if _, err = tx.ExecContext(ctx, `UPDATE pr_review_attempts SET status='stale',updated_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND status='approved'`, req.AttemptID); err != nil {
			return Completion{}, err
		}
		if err = tx.Commit(); err != nil {
			return Completion{}, err
		}
		return Completion{}, ErrIdentityChanged
	}
	if err = validateCurrentTask(ctx, tx, req.Identity, "Review"); err != nil {
		return Completion{}, err
	}
	updated, err := tx.ExecContext(ctx, `UPDATE issues SET state='Done',updated_at=datetime('now') WHERE id=? AND project_id=? AND state='Review' AND pr_url=?`, req.Identity.TaskID, req.Identity.ProjectID, req.Identity.PRURL)
	if err != nil {
		return Completion{}, err
	}
	rows, err := updated.RowsAffected()
	if err != nil || rows != 1 {
		return Completion{}, ErrIdentityChanged
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO issue_history(id,issue_id,user_id,action,old_value,new_value) VALUES(?,?,?,?,?,?)`, "hist_"+uuid.NewString(), req.Identity.TaskID, "PRReviewer", "review_merged", "Review", "Done"); err != nil {
		return Completion{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO pr_review_completions(request_id,digest,attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,status) VALUES(?,?,?,?,?,?,?,?,?,'completed')`, req.RequestID, digest, req.AttemptID, req.Identity.ProjectID, req.Identity.TaskID, req.Identity.PRURL, req.Identity.Repository, req.Identity.PRNumber, req.Identity.HeadSHA); err != nil {
		return Completion{}, err
	}
	if err = tx.Commit(); err != nil {
		return Completion{}, err
	}
	return Completion{Gate: gateFromAttempt(attempt), TaskState: "Done"}, nil
}

func Observe(ctx context.Context, q QueryRower, projectID, taskID string, current *Identity) (Gate, error) {
	var attempt Attempt
	err := scanAttempt(q.QueryRowContext(ctx, `SELECT attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,context_hash,reviewer_provider,reviewer_agent_id,reviewer_run_id,reviewer_session_id,status,feedback FROM pr_review_attempts WHERE project_id=? AND task_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`, projectID, taskID), &attempt)
	if errors.Is(err, sql.ErrNoRows) {
		return Gate{Status: "not_reviewed"}, nil
	}
	if err != nil {
		return Gate{}, err
	}
	gate := gateFromAttempt(attempt)
	if current == nil || !sameIdentity(attempt.Identity, *current) {
		gate.Status = "stale"
	}
	if !validContextHash(attempt.ContextHash) {
		gate.Status = "stale"
	}
	return gate, nil
}

// ObserveStored reports the last durable attempt without contacting the PR
// host. Freshness is explicitly `not_checked`; callers must use a separate
// request/approval/completion operation to obtain a current remote snapshot.
func ObserveStored(ctx context.Context, q QueryRower, projectID, taskID string) (Gate, error) {
	var attempt Attempt
	err := scanAttempt(q.QueryRowContext(ctx, `SELECT attempt_id,project_id,task_id,pr_url,repository,pr_number,head_sha,context_hash,reviewer_provider,reviewer_agent_id,reviewer_run_id,reviewer_session_id,status,feedback FROM pr_review_attempts WHERE project_id=? AND task_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`, projectID, taskID), &attempt)
	if errors.Is(err, sql.ErrNoRows) {
		return Gate{Status: "not_reviewed", Freshness: "not_checked"}, nil
	}
	if err != nil {
		return Gate{}, err
	}
	gate := gateFromAttempt(attempt)
	gate.Freshness = "not_checked"
	if !validContextHash(attempt.ContextHash) {
		gate.Status = "stale"
	}
	var prURL, owner, repo, state string
	err = q.QueryRowContext(ctx, `SELECT COALESCE(i.pr_url,''),COALESCE(p.github_owner,''),COALESCE(p.github_repo,''),i.state FROM issues i JOIN projects p ON p.id=i.project_id WHERE i.id=? AND i.project_id=?`, taskID, projectID).Scan(&prURL, &owner, &repo, &state)
	if err != nil || prURL != attempt.Identity.PRURL || !strings.EqualFold(strings.TrimSpace(owner)+"/"+strings.TrimSpace(repo), attempt.Identity.Repository) {
		gate.Status = "stale"
		return gate, nil
	}
	if (gate.Status == "awaiting_human_approval" || gate.Status == "approved") && !strings.EqualFold(strings.TrimSpace(state), "Review") && !(gate.Status == "approved" && strings.EqualFold(strings.TrimSpace(state), "Done")) {
		gate.Status = "stale"
	}
	return gate, nil
}

func validateCurrentTask(ctx context.Context, q QueryRower, identity Identity, expectedState string) error {
	if !validIdentity(identity) {
		return ErrInvalidIdentity
	}
	var state, prURL, owner, repo string
	err := q.QueryRowContext(ctx, `SELECT i.state,COALESCE(i.pr_url,''),COALESCE(p.github_owner,''),COALESCE(p.github_repo,'') FROM issues i JOIN projects p ON p.id=i.project_id WHERE i.id=? AND i.project_id=?`, identity.TaskID, identity.ProjectID).Scan(&state, &prURL, &owner, &repo)
	if err != nil {
		return err
	}
	if !strings.EqualFold(strings.TrimSpace(state), expectedState) {
		return ErrTaskUnsettled
	}
	if prURL != identity.PRURL || !strings.EqualFold(strings.TrimSpace(owner)+"/"+strings.TrimSpace(repo), identity.Repository) {
		return ErrIdentityChanged
	}
	return nil
}

func validIdentity(identity Identity) bool {
	if strings.TrimSpace(identity.ProjectID) == "" || strings.TrimSpace(identity.TaskID) == "" || identity.PRNumber < 1 || !validSHA(identity.HeadSHA) {
		return false
	}
	repository := strings.Split(identity.Repository, "/")
	if len(repository) != 2 || strings.TrimSpace(repository[0]) == "" || strings.TrimSpace(repository[1]) == "" {
		return false
	}
	parsed, err := url.Parse(strings.TrimSpace(identity.PRURL))
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Host, "github.com") || parsed.User != nil || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.Fragment != "" || strings.HasSuffix(parsed.Path, "/") {
		return false
	}
	parts := strings.Split(strings.Trim(path.Clean(parsed.Path), "/"), "/")
	return len(parts) == 4 && strings.EqualFold(parts[0]+"/"+parts[1], identity.Repository) && parts[2] == "pull" && parts[3] == strconv.Itoa(identity.PRNumber)
}

// ValidateIdentity reports whether a caller-supplied review identity contains
// a canonical GitHub PR URL, exact repository/number, and full commit SHA.
func ValidateIdentity(identity Identity) bool { return validIdentity(identity) }

func canonicalIdentity(identity Identity) Identity {
	identity.Repository = strings.ToLower(strings.TrimSpace(identity.Repository))
	identity.HeadSHA = strings.ToLower(strings.TrimSpace(identity.HeadSHA))
	return identity
}

func validSHA(value string) bool {
	if len(value) != 40 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func validContextHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func validUUID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id != uuid.Nil && id.String() == value
}

func sameIdentity(a, b Identity) bool {
	return a.ProjectID == b.ProjectID && a.TaskID == b.TaskID && a.PRURL == b.PRURL && strings.EqualFold(a.Repository, b.Repository) && a.PRNumber == b.PRNumber && strings.EqualFold(a.HeadSHA, b.HeadSHA)
}

func sameAttemptRequest(attempt Attempt, req StartRequest) bool {
	return sameIdentity(attempt.Identity, req.Identity) && strings.EqualFold(attempt.ContextHash, req.ContextHash) && attempt.ReviewerProvider == strings.ToUpper(strings.TrimSpace(req.ReviewerProvider)) && attempt.ReviewerAgentID == strings.TrimSpace(req.ReviewerAgentID) && attempt.ReviewerRunID == strings.TrimSpace(req.ReviewerRunID) && attempt.ReviewerSessionID == strings.TrimSpace(req.ReviewerSessionID)
}

func gateFromAttempt(attempt Attempt) Gate {
	return Gate{Status: attempt.Status, HeadSHA: attempt.Identity.HeadSHA, PRURL: attempt.Identity.PRURL, AttemptID: attempt.AttemptID, ReviewerProvider: attempt.ReviewerProvider, ReviewerAgentID: attempt.ReviewerAgentID, Feedback: attempt.Feedback}
}

func scanAttempt(row *sql.Row, out *Attempt) error {
	var identity Identity
	var head string
	if err := row.Scan(&out.AttemptID, &identity.ProjectID, &identity.TaskID, &identity.PRURL, &identity.Repository, &identity.PRNumber, &head, &out.ContextHash, &out.ReviewerProvider, &out.ReviewerAgentID, &out.ReviewerRunID, &out.ReviewerSessionID, &out.Status, &out.Feedback); err != nil {
		return err
	}
	identity.HeadSHA = strings.ToLower(head)
	out.Identity = identity
	out.ContextHash = strings.ToLower(out.ContextHash)
	return nil
}

func (a Attempt) String() string {
	return fmt.Sprintf("review attempt %s (%s)", a.AttemptID, a.Status)
}
