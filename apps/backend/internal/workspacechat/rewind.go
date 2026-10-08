package workspacechat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/checkpoint"
)

// Rewind: Edit and Regenerate re-run an earlier user message on a new branch,
// optionally after restoring the folder to how it was before that message's
// turn; ActivateBranch switches versions; UndoRestore reverts the last files
// restore. A files restore always saves a safety snapshot of the folder first
// and aborts before touching the conversation if any file could not be
// restored, so nothing is lost silently and Undo restore can always return.
//
// The snapshot and restore run without the service lock, so no other
// conversation waits on them. Meanwhile the conversation and its checkout
// are marked restoring: every busy check refuses them, so nothing else can
// start a turn in that folder or change the conversation.

var ErrCheckpointUnavailable = errors.New("no file checkpoint for that message")

// RestoreError reports a files restore that left some paths unrestored (or
// stopped with Err). The safety checkpoint taken before it is kept.
type RestoreError struct {
	Failed []checkpoint.FileFailure
	Err    error
}

func (e *RestoreError) Error() string {
	paths := make([]string, 0, len(e.Failed))
	for _, f := range e.Failed {
		paths = append(paths, f.Path)
	}
	msg := "files restore incomplete"
	if e.Err != nil {
		msg += ": " + e.Err.Error()
	}
	if len(paths) > 0 {
		msg += "; not restored: " + strings.Join(paths, ", ")
	}
	return msg
}

func (e *RestoreError) Unwrap() error { return e.Err }

// FilesRestoredError reports a rewind whose files restore succeeded but whose
// message was not sent (Err says why), and whose automatic return of the
// files failed too. The folder is left restored; Undo restore puts it back.
type FilesRestoredError struct{ Err error }

func (e *FilesRestoredError) Error() string {
	return fmt.Sprintf("files were restored but the message was not sent (%v); use Undo restore to put the files back", e.Err)
}

func (e *FilesRestoredError) Unwrap() error { return e.Err }

// RewindPreview describes what rewinding to a message would do, read-only.
type RewindPreview struct {
	MessageID      string `json:"message_id"`
	HasCheckpoint  bool   `json:"has_checkpoint"`
	FilesAvailable bool   `json:"files_available"`
	BusyReason     string `json:"busy_reason,omitempty"`
	// Changes is what a files restore would do; ChangedSinceTurn lists paths
	// that differ from what the turn left (edited since it finished).
	Changes          []checkpoint.Change `json:"changes"`
	ChangedSinceTurn []string            `json:"changed_since_turn"`
	Skipped          int                 `json:"skipped"`
}

// EditRequest re-runs a user message with new text; the embedded SendRequest
// supplies the text, client message id and model/agent fields.
type EditRequest struct {
	MessageID    string `json:"message_id"`
	RestoreFiles bool   `json:"restore_files"`
	SendRequest
}

// RegenerateRequest re-runs a message's user prompt unchanged. MessageID may
// name the user message or a reply to it.
type RegenerateRequest struct {
	MessageID       string `json:"message_id"`
	ClientMessageID string `json:"client_message_id"`
	RestoreFiles    bool   `json:"restore_files"`
}

// restoreMark records a files restore in flight for a conversation.
type restoreMark struct {
	projectID   string
	workspaceID string
	title       string
}

const branchHeader = "The user edited an earlier message; your session restarts here. The conversation before that point follows as context. Work only in the selected project.\n"

// branchTranscript seeds a new branch's first native turn with the history
// the branch keeps.
func branchTranscript(messages []Message, prompt string, budget int) string {
	return replayTranscript(branchHeader, messages, prompt, budget)
}

func (s *Service) branchSeedPending(ctx context.Context, id string) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM workspace_chat_branch_seed WHERE session_id=?`, id).Scan(&n)
	return n > 0, err
}

func (s *Service) Edit(ctx context.Context, pid, id string, req EditRequest) (Accepted, error) {
	if strings.TrimSpace(req.Text) == "" || len(req.Text) > maxText {
		return Accepted{}, ErrInvalid
	}
	return s.rewind(ctx, pid, id, req.MessageID, true, req.RestoreFiles, req.SendRequest)
}

func (s *Service) Regenerate(ctx context.Context, pid, id string, req RegenerateRequest) (Accepted, error) {
	return s.rewind(ctx, pid, id, req.MessageID, false, req.RestoreFiles, SendRequest{ClientMessageID: req.ClientMessageID})
}

// rewind forks the active branch just before the user message being re-run
// and sends req on the new branch. send's own checks run first, before any
// file changes. Validation and the fork happen under s.mu; the files restore
// runs without it (the conversation and checkout marked restoring); send
// takes the lock itself. Between the fork and send the lock is free for a
// moment: a turn started there (by another conversation of the checkout)
// makes send fail busy, which is handled like any send failure. If send
// fails, the empty branch is removed and the previous branch is active
// again, and restored files are put back from the safety checkpoint; if that
// is impossible the error is a *FilesRestoredError.
func (s *Service) rewind(ctx context.Context, pid, id, messageID string, edit, restoreFiles bool, req SendRequest) (Accepted, error) {
	if strings.TrimSpace(messageID) == "" || strings.TrimSpace(req.ClientMessageID) == "" || len(req.ClientMessageID) > 200 {
		return Accepted{}, ErrInvalid
	}
	if restoreFiles && pid == OrchestratorScope {
		return Accepted{}, ErrInvalid
	}
	if err := s.rewindPreflight(ctx, pid, id, edit, &req); err != nil {
		return Accepted{}, err
	}
	s.mu.Lock()
	locked := true
	defer func() {
		if locked {
			s.mu.Unlock()
		}
	}()
	d, err := s.rewindable(ctx, pid, id)
	if err != nil {
		return Accepted{}, err
	}
	// A retried request returns its first acceptance, on whichever branch.
	if existing, ok, err := s.submittedMessage(ctx, id, req.ClientMessageID); err != nil || ok {
		if err != nil {
			return Accepted{}, err
		}
		if edit && existing.Text != req.Text {
			return Accepted{}, ErrInvalid
		}
		return Accepted{d.Session, existing}, nil
	}
	if reason, err := s.busyReason(ctx, pid, d.Session); err != nil || reason != "" {
		if err != nil {
			return Accepted{}, err
		}
		return Accepted{}, ErrBusy
	}
	user, forkOrdinal, forkTime, err := s.rewindTarget(ctx, d, messageID, edit)
	if err != nil {
		return Accepted{}, err
	}
	if !edit {
		req.Text = user.Text
	}
	previous, err := writeBranchIn(ctx, s.db, id)
	if err != nil {
		return Accepted{}, err
	}
	// Past this point the folder or conversation may change: finish the
	// operation even if the caller goes away.
	work := context.WithoutCancel(ctx)
	var safety *Checkpoint
	if restoreFiles {
		before, ok, err := s.checkpointFor(ctx, id, user.ID, "before")
		if err != nil {
			return Accepted{}, err
		}
		if !ok || s.checkpoints == nil || d.Session.WorkspacePath == "" {
			return Accepted{}, ErrCheckpointUnavailable
		}
		c, err := s.restoreFolder(work, pid, d.Session, previous, user.ID, before.TreeHash)
		if err != nil {
			return Accepted{}, err
		}
		safety = &c
		// The lock was free during the restore; make sure nothing moved.
		if err = s.recheckRewind(work, pid, id, messageID, edit, user.ID, forkOrdinal, previous); err != nil {
			return Accepted{}, s.revertRestore(work, pid, id, c, err)
		}
	}
	var branch Branch
	native, err := s.switchBranch(work, pid, d.Session, func(tx *sql.Tx) (string, error) {
		var e error
		branch, e = s.createBranch(work, tx, id, previous, forkOrdinal, forkTime)
		return branch.ID, e
	})
	if err != nil {
		if safety != nil {
			return Accepted{}, s.revertRestore(work, pid, id, *safety, err)
		}
		return Accepted{}, err
	}
	gap := s.rewindGap
	s.mu.Unlock()
	locked = false
	if native != nil {
		closeNative(native)
	}
	if gap != nil {
		gap()
	}
	accepted, err := s.send(work, pid, id, req, "", "")
	if err != nil {
		s.dropEmptyBranch(id, previous, branch.ID)
		if safety != nil {
			s.mu.Lock()
			err = s.revertRestore(work, pid, id, *safety, err)
			s.mu.Unlock()
		}
		return Accepted{}, err
	}
	return accepted, nil
}

// rewindPreflight runs send's checks that change nothing (account, profile,
// agent, MCP servers, harness options, model and effort) before anything is
// restored, so a message send would refuse never rewinds the files first.
// A retried request skips them: it returns its first acceptance. Regenerate
// re-runs with the conversation's current agent selection.
func (s *Service) rewindPreflight(ctx context.Context, pid, id string, edit bool, req *SendRequest) error {
	if _, ok, err := s.submittedMessage(ctx, id, req.ClientMessageID); err != nil || ok {
		return err
	}
	d, err := s.Detail(ctx, pid, id)
	if err != nil {
		return err
	}
	if !edit {
		req.RequestedAgentID, req.RequestedAgentScope = d.Session.RequestedAgentID, d.Session.RequestedAgentScope
		req.RequestedAgentContentHash, req.RequestedAgentFormat = d.Session.RequestedAgentContentHash, d.Session.RequestedAgentFormat
	}
	// send fills model and effort defaults itself; check a copy.
	check := *req
	agent, err := s.sendChecks(ctx, pid, d.Session, &check)
	if err != nil {
		return err
	}
	root, err := s.root(ctx, pid)
	if err != nil {
		return err
	}
	turn, err := s.newTurn(ctx, pid, root, d.Session, check, agent)
	if err != nil {
		return err
	}
	if err = s.turnShape(d.Session, check); err != nil {
		return err
	}
	if check.RequestedReasoningEffort != "" {
		if err = s.validateEffort(ctx, pid, d.Session.Provider, d.Session.AccountID, check.RequestedModel, check.RequestedReasoningEffort); err != nil {
			return err
		}
	}
	if d.Session.ConversationMode != "native_session" {
		if err = s.registry.ValidateTurnOptions(agents.Provider(d.Session.Provider), turn); err != nil {
			return fmt.Errorf("%w: %s", ErrUnsupported, err)
		}
	}
	return nil
}

// recheckRewind confirms, after the unlocked restore, that the rewind still
// applies: the conversation is idle, its active branch and the re-run message
// are unchanged. Callers hold s.mu.
func (s *Service) recheckRewind(ctx context.Context, pid, id, messageID string, edit bool, userID string, forkOrdinal int64, previous string) error {
	d, err := s.rewindable(ctx, pid, id)
	if err != nil {
		return err
	}
	if reason, err := s.busyReason(ctx, pid, d.Session); err != nil || reason != "" {
		if err != nil {
			return err
		}
		return ErrBusy
	}
	if current, err := writeBranchIn(ctx, s.db, id); err != nil || current != previous {
		if err != nil {
			return err
		}
		return ErrConflict
	}
	user, ordinal, _, err := s.rewindTarget(ctx, d, messageID, edit)
	if err != nil {
		return err
	}
	if user.ID != userID || ordinal != forkOrdinal {
		return ErrConflict
	}
	return nil
}

// ActivateBranch shows another version of the conversation. With
// restoreFiles the folder is first restored to what that version's latest
// turn left behind (after a safety snapshot).
func (s *Service) ActivateBranch(ctx context.Context, pid, id, branchID string, restoreFiles bool) (Detail, error) {
	if strings.TrimSpace(branchID) == "" {
		return Detail{}, ErrInvalid
	}
	s.mu.Lock()
	locked := true
	defer func() {
		if locked {
			s.mu.Unlock()
		}
	}()
	d, err := s.rewindable(ctx, pid, id)
	if err != nil {
		return Detail{}, err
	}
	if reason, err := s.busyReason(ctx, pid, d.Session); err != nil || reason != "" {
		if err != nil {
			return Detail{}, err
		}
		return Detail{}, ErrBusy
	}
	if err = s.branchExists(ctx, id, branchID); err != nil {
		return Detail{}, err
	}
	if restoreFiles && pid == OrchestratorScope {
		return Detail{}, ErrInvalid
	}
	current, err := writeBranchIn(ctx, s.db, id)
	if err != nil {
		return Detail{}, err
	}
	work := context.WithoutCancel(ctx)
	var safety *Checkpoint
	if restoreFiles {
		after, ok, err := s.latestAfter(ctx, id, branchID)
		if err != nil {
			return Detail{}, err
		}
		if !ok || s.checkpoints == nil || d.Session.WorkspacePath == "" {
			return Detail{}, ErrCheckpointUnavailable
		}
		c, err := s.restoreFolder(work, pid, d.Session, current, after.MessageID, after.TreeHash)
		if err != nil {
			return Detail{}, err
		}
		safety = &c
		// The lock was free during the restore; make sure nothing moved.
		if err = s.recheckActivate(work, pid, id, branchID, current); err != nil {
			return Detail{}, s.revertRestore(work, pid, id, c, err)
		}
	}
	if current != branchID {
		native, err := s.switchBranch(work, pid, d.Session, func(*sql.Tx) (string, error) { return branchID, nil })
		if err != nil {
			if safety != nil {
				return Detail{}, s.revertRestore(work, pid, id, *safety, err)
			}
			return Detail{}, err
		}
		s.mu.Unlock()
		locked = false
		if native != nil {
			closeNative(native)
		}
	}
	return s.Detail(work, pid, id)
}

func (s *Service) branchExists(ctx context.Context, sessionID, branchID string) error {
	if branchID == sessionID {
		return nil
	}
	var found int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM workspace_chat_branches WHERE session_id=? AND id=?`, sessionID, branchID).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// recheckActivate confirms, after the unlocked restore, that the switch still
// applies. Callers hold s.mu.
func (s *Service) recheckActivate(ctx context.Context, pid, id, branchID, current string) error {
	d, err := s.rewindable(ctx, pid, id)
	if err != nil {
		return err
	}
	if reason, err := s.busyReason(ctx, pid, d.Session); err != nil || reason != "" {
		if err != nil {
			return err
		}
		return ErrBusy
	}
	if err = s.branchExists(ctx, id, branchID); err != nil {
		return err
	}
	if now, err := writeBranchIn(ctx, s.db, id); err != nil || now != current {
		if err != nil {
			return err
		}
		return ErrConflict
	}
	return nil
}

// UndoRestore puts the folder back to the newest safety checkpoint, taken
// just before the last files restore, and consumes it. A restore that leaves
// files behind keeps the checkpoint so Undo can be retried.
func (s *Service) UndoRestore(ctx context.Context, pid, id string) (checkpoint.RestoreResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.rewindable(ctx, pid, id)
	if err != nil {
		return checkpoint.RestoreResult{}, err
	}
	if reason, err := s.busyReason(ctx, pid, d.Session); err != nil || reason != "" {
		if err != nil {
			return checkpoint.RestoreResult{}, err
		}
		return checkpoint.RestoreResult{}, ErrBusy
	}
	if pid == OrchestratorScope || s.checkpoints == nil || d.Session.WorkspacePath == "" {
		return checkpoint.RestoreResult{}, ErrCheckpointUnavailable
	}
	safety, ok, err := s.queryCheckpoint(ctx, `WHERE session_id=? AND kind='safety' ORDER BY rowid DESC LIMIT 1`, id)
	if err != nil {
		return checkpoint.RestoreResult{}, err
	}
	if !ok {
		return checkpoint.RestoreResult{}, ErrCheckpointUnavailable
	}
	if err = s.rejectRemoval(ctx, pid, d.Session); err != nil {
		return checkpoint.RestoreResult{}, err
	}
	work := context.WithoutCancel(ctx)
	store, timeout := s.checkpoints, s.restoreTimeout()
	var res checkpoint.RestoreResult
	err = s.whileRestoring(pid, d.Session, func() error {
		var e error
		res, e = restoreWithin(work, store, d.Session.WorkspacePath, safety.TreeHash, timeout)
		if e != nil || len(res.Failed) > 0 {
			return &RestoreError{Failed: res.Failed, Err: e}
		}
		return nil
	})
	if err != nil {
		return res, err
	}
	if _, err = s.db.ExecContext(work, `DELETE FROM workspace_chat_checkpoints WHERE id=?`, safety.ID); err != nil {
		return res, err
	}
	return res, nil
}

// PreviewRewind reports what rewinding to a message would change. It never
// writes: no snapshot, no restore, no conversation change. A message without
// a checkpoint previews as conversation-only.
func (s *Service) PreviewRewind(ctx context.Context, pid, id, messageID string) (RewindPreview, error) {
	if strings.TrimSpace(messageID) == "" {
		return RewindPreview{}, ErrInvalid
	}
	s.mu.Lock()
	d, err := s.rewindable(ctx, pid, id)
	var reason string
	if err == nil {
		reason, err = s.busyReason(ctx, pid, d.Session)
	}
	store, timeout := s.checkpoints, s.restoreTimeout()
	s.mu.Unlock()
	if err != nil {
		return RewindPreview{}, err
	}
	user, _, _, err := s.rewindTarget(ctx, d, messageID, false)
	if err != nil {
		return RewindPreview{}, err
	}
	p := RewindPreview{MessageID: messageID, BusyReason: reason, Changes: []checkpoint.Change{}, ChangedSinceTurn: []string{}}
	before, ok, err := s.checkpointFor(ctx, id, user.ID, "before")
	if err != nil {
		return RewindPreview{}, err
	}
	p.HasCheckpoint = ok
	if !ok || pid == OrchestratorScope || store == nil || d.Session.WorkspacePath == "" {
		return p, nil
	}
	dctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	changes, err := store.Diff(dctx, d.Session.WorkspacePath, before.TreeHash)
	if err != nil {
		// Files cannot be compared (git missing, store unreadable): offer
		// conversation-only rather than failing the dialog.
		log.Printf("workspace chat rewind preview for message %s: files unavailable: %v", user.ID, err)
		return p, nil
	}
	after, ok, err := s.checkpointFor(ctx, id, user.ID, "after")
	if err != nil {
		return RewindPreview{}, err
	}
	if ok {
		since, err := store.Diff(dctx, d.Session.WorkspacePath, after.TreeHash)
		if err != nil {
			// Without this list the dialog could not warn about the user's own
			// edits, so do not offer the files restore.
			log.Printf("workspace chat rewind preview for message %s: files unavailable: %v", user.ID, err)
			return p, nil
		}
		for _, c := range since {
			p.ChangedSinceTurn = append(p.ChangedSinceTurn, c.Path)
		}
		sort.Strings(p.ChangedSinceTurn)
	}
	if changes != nil {
		p.Changes = changes
	}
	p.Skipped = before.Skipped
	p.FilesAvailable = true
	return p, nil
}

// rewindable loads a conversation that can be rewound; callers hold s.mu.
func (s *Service) rewindable(ctx context.Context, pid, id string) (Detail, error) {
	if s.closed {
		return Detail{}, fmt.Errorf("chat service shutting down")
	}
	d, err := s.Detail(ctx, pid, id)
	if err != nil {
		return Detail{}, err
	}
	if d.Session.Archived {
		return Detail{}, ErrNotFound
	}
	return d, nil
}

// busyReason says why the conversation cannot rewind now, or "". It applies
// send's occupancy rule: this conversation's turn or files restore, or a turn
// or files restore in another conversation of the same checkout (whose files
// a restore would change, and whose pending approvals must stay answerable).
// Maestro conversations share no files, so only their own state counts.
// Callers hold s.mu.
func (s *Service) busyReason(ctx context.Context, pid string, sess Session) (string, error) {
	if s.restoring[sess.ID] != nil {
		return "This conversation is restoring files.", nil
	}
	if _, ok := s.active[sess.ID]; ok || sess.Status == "running" || sess.Status == "stopping" {
		return "This conversation has a turn in progress.", nil
	}
	if pid == OrchestratorScope {
		return "", nil
	}
	if title, ok := s.restoringCheckout(pid, sess.WorkspaceID, sess.ID); ok {
		return fmt.Sprintf("Another conversation in this folder is restoring files: %s", title), nil
	}
	_, _, primary, err := s.scope(ctx, pid)
	if err != nil {
		return "", err
	}
	var title string
	err = s.db.QueryRowContext(ctx, `SELECT title FROM workspace_chat_sessions WHERE project_id=? AND id<>? AND status IN ('running','stopping') AND (id IN (SELECT session_id FROM workspace_chat_workspaces WHERE workspace_id=?) OR (? AND id NOT IN (SELECT session_id FROM workspace_chat_workspaces))) ORDER BY updated_at DESC LIMIT 1`, pid, sess.ID, sess.WorkspaceID, primary).Scan(&title)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Another conversation in this folder is running: %s", title), nil
}

// restoringCheckout names another conversation restoring files in a
// checkout. Callers hold s.mu.
func (s *Service) restoringCheckout(pid, workspaceID, except string) (string, bool) {
	for id, m := range s.restoring {
		if id != except && m.projectID == pid && m.workspaceID == workspaceID {
			return m.title, true
		}
	}
	return "", false
}

// whileRestoring runs fn without s.mu while the conversation and its checkout
// are marked restoring. Callers hold s.mu; it is held again when this returns,
// and the mark is cleared, on every path including a panic in fn. Close waits
// for fn to finish.
func (s *Service) whileRestoring(pid string, sess Session, fn func() error) error {
	if s.closed {
		return fmt.Errorf("chat service shutting down")
	}
	if s.restoring == nil {
		s.restoring = map[string]*restoreMark{}
	}
	s.restoring[sess.ID] = &restoreMark{projectID: pid, workspaceID: sess.WorkspaceID, title: sess.Title}
	s.wg.Add(1)
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.restoring, sess.ID)
		s.wg.Done()
	}()
	return fn()
}

// rewindTarget resolves the user message to re-run among the visible
// messages, and the fork point: the visible message just before it (ordinal
// 0 and no time when it is the first). An edit must name a user message; a
// regenerate may name a reply, which re-runs the user message before it.
func (s *Service) rewindTarget(ctx context.Context, d Detail, messageID string, edit bool) (Message, int64, string, error) {
	idx := -1
	for i := range d.Messages {
		if d.Messages[i].ID == messageID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return Message{}, 0, "", ErrNotFound
	}
	if edit && d.Messages[idx].Role != "user" {
		return Message{}, 0, "", ErrInvalid
	}
	for idx >= 0 && d.Messages[idx].Role != "user" {
		idx--
	}
	if idx < 0 {
		return Message{}, 0, "", ErrInvalid
	}
	if idx == 0 {
		return d.Messages[0], 0, "", nil
	}
	prev := d.Messages[idx-1]
	var ordinal int64
	if err := s.db.QueryRowContext(ctx, `SELECT ordinal FROM workspace_chat_messages WHERE session_id=? AND id=?`, d.Session.ID, prev.ID).Scan(&ordinal); err != nil {
		return Message{}, 0, "", err
	}
	return d.Messages[idx], ordinal, prev.CreatedAt, nil
}

// submittedMessage finds a message by client id on any branch.
func (s *Service) submittedMessage(ctx context.Context, sessionID, clientID string) (Message, bool, error) {
	var m Message
	err := s.db.QueryRowContext(ctx, `SELECT m.id,m.session_id,m.role,m.text,m.status,m.client_message_id,m.created_at,COALESCE(mp.provider,'') FROM workspace_chat_messages m LEFT JOIN workspace_chat_message_providers mp ON mp.message_id=m.id WHERE m.session_id=? AND m.client_message_id=?`, sessionID, clientID).Scan(&m.ID, &m.SessionID, &m.Role, &m.Text, &m.Status, &m.ClientMessageID, &m.CreatedAt, &m.Provider)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, false, nil
	}
	return m, err == nil, err
}

// restoreTimeout bounds one safety snapshot, diff or restore, like a turn's
// snapshot.
func (s *Service) restoreTimeout() time.Duration {
	if s.snapshotTimeout > 0 {
		return s.snapshotTimeout
	}
	return defaultSnapshotTimeout
}

// rejectRemoval refuses to change a folder that is being removed.
func (s *Service) rejectRemoval(ctx context.Context, pid string, sess Session) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	return rejectPendingRemoval(ctx, tx, pid, sess.WorkspaceID, sess.WorkspacePath)
}

// restoreWithin restores within the timeout and reports a panicking store as
// an error.
func restoreWithin(ctx context.Context, store checkpointer, worktree, tree string, timeout time.Duration) (res checkpoint.RestoreResult, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("restore panicked: %v", r)
		}
	}()
	rctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return store.Restore(rctx, worktree, tree)
}

// restoreFolder saves a safety checkpoint of the folder as it is now, then
// makes the folder equal tree, both without s.mu (see whileRestoring). A
// failed safety snapshot aborts before any file is touched; a restore that
// leaves files behind returns *RestoreError and keeps the safety checkpoint.
// Callers hold s.mu; it is held again on return.
func (s *Service) restoreFolder(ctx context.Context, pid string, sess Session, branchID, messageID, tree string) (Checkpoint, error) {
	if err := s.rejectRemoval(ctx, pid, sess); err != nil {
		return Checkpoint{}, err
	}
	store, timeout := s.checkpoints, s.restoreTimeout()
	safety := Checkpoint{ID: uuid.NewString(), SessionID: sess.ID, BranchID: branchID, MessageID: messageID, Kind: "safety"}
	err := s.whileRestoring(pid, sess, func() error {
		sctx, cancel := context.WithTimeout(ctx, timeout)
		snap, err := snapshotWithin(sctx, store, sess.WorkspacePath)
		cancel()
		if err == nil && snap.Hash == "" {
			err = errors.New("snapshot returned no tree")
		}
		if err != nil {
			return fmt.Errorf("%w: the safety snapshot of the current files failed, so nothing was restored: %v", ErrCheckpointUnavailable, err)
		}
		safety.TreeHash, safety.Files, safety.Bytes, safety.Skipped = snap.Hash, snap.Files, snap.Bytes, snap.Skipped
		if err = s.saveCheckpoint(ctx, safety); err != nil {
			return err
		}
		res, err := restoreWithin(ctx, store, sess.WorkspacePath, tree, timeout)
		if err != nil || len(res.Failed) > 0 {
			log.Printf("workspace chat files restore for session %s incomplete (%d failed): %v", sess.ID, len(res.Failed), err)
			return &RestoreError{Failed: res.Failed, Err: err}
		}
		return nil
	})
	return safety, err
}

// revertRestore puts a rewind's restored files back from its safety
// checkpoint after the rewind failed with cause, and consumes the checkpoint.
// It returns cause, or a *FilesRestoredError when the files stay restored
// (the conversation is busy again, or the return restore fails). Callers hold
// s.mu; it is held again on return.
func (s *Service) revertRestore(ctx context.Context, pid, id string, safety Checkpoint, cause error) error {
	keep := func(why error) error {
		log.Printf("workspace chat rewind of session %s failed (%v) and its files stay restored: %v", id, cause, why)
		return &FilesRestoredError{Err: cause}
	}
	d, err := s.rewindable(ctx, pid, id)
	if err != nil {
		return keep(err)
	}
	if reason, err := s.busyReason(ctx, pid, d.Session); err != nil || reason != "" {
		if err == nil {
			err = errors.New(reason)
		}
		return keep(err)
	}
	store, timeout := s.checkpoints, s.restoreTimeout()
	if store == nil {
		return keep(errors.New("checkpoints disabled"))
	}
	err = s.whileRestoring(pid, d.Session, func() error {
		res, e := restoreWithin(ctx, store, d.Session.WorkspacePath, safety.TreeHash, timeout)
		if e == nil && len(res.Failed) > 0 {
			e = &RestoreError{Failed: res.Failed}
		}
		return e
	})
	if err != nil {
		return keep(err)
	}
	if _, err = s.db.ExecContext(ctx, `DELETE FROM workspace_chat_checkpoints WHERE id=?`, safety.ID); err != nil {
		log.Printf("workspace chat could not remove spent safety checkpoint %s: %v", safety.ID, err)
	}
	return cause
}

// switchBranch makes the branch returned by pick active in one transaction,
// and makes the next native turn start a fresh provider thread seeded with
// the branch's history: the seed row, the thread reset the agent-switch path
// uses, and stale approvals of the old thread. Callers hold s.mu; the
// returned in-memory provider session, already dropped, is theirs to close
// after unlocking.
func (s *Service) switchBranch(ctx context.Context, pid string, sess Session, pick func(*sql.Tx) (string, error)) (agents.NativeSession, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = rejectPendingRemoval(ctx, tx, pid, sess.WorkspaceID, sess.WorkspacePath); err != nil {
		return nil, err
	}
	branchID, err := pick(tx)
	if err != nil {
		return nil, err
	}
	now := stamp()
	steps := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO workspace_chat_active_branch(session_id,branch_id) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET branch_id=excluded.branch_id`, []any{sess.ID, branchID}},
		{`INSERT INTO workspace_chat_branch_seed(session_id,created_at) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET created_at=excluded.created_at`, []any{sess.ID, now}},
		{`UPDATE workspace_chat_native SET thread_id='',cumulative_turn_count=NULL WHERE session_id=?`, []any{sess.ID}},
		{`UPDATE workspace_chat_requests SET status='stale' WHERE session_id=? AND status='pending'`, []any{sess.ID}},
	}
	for _, step := range steps {
		if _, err = tx.ExecContext(ctx, step.query, step.args...); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	native := s.native[sess.ID]
	delete(s.native, sess.ID)
	delete(s.nativePrefixes, sess.ID)
	return native, nil
}

// dropEmptyBranch undoes a fork whose send failed: the previous branch is
// active again and the new branch is deleted, unless a message already landed
// on it. The seed stays: the provider thread was reset, so the next native
// turn must still be seeded with the visible history.
func (s *Service) dropEmptyBranch(sessionID, previous, branchID string) {
	ctx := context.Background()
	s.mu.Lock()
	defer s.mu.Unlock()
	err := func() error {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		var used int
		if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM workspace_chat_messages WHERE session_id=? AND branch_id=?`, sessionID, branchID).Scan(&used); err != nil || used > 0 {
			return err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE workspace_chat_active_branch SET branch_id=? WHERE session_id=? AND branch_id=?`, previous, sessionID, branchID); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM workspace_chat_branches WHERE session_id=? AND id=?`, sessionID, branchID); err != nil {
			return err
		}
		return tx.Commit()
	}()
	if err != nil {
		log.Printf("workspace chat could not remove unused branch %s of session %s: %v", branchID, sessionID, err)
	}
}

// latestAfter is the after checkpoint of a branch's newest own message.
func (s *Service) latestAfter(ctx context.Context, sessionID, branchID string) (Checkpoint, bool, error) {
	return s.queryCheckpoint(ctx, `WHERE session_id=? AND kind='after' AND branch_id=? ORDER BY (SELECT ordinal FROM workspace_chat_messages m WHERE m.id=workspace_chat_checkpoints.message_id) DESC, rowid DESC LIMIT 1`, sessionID, branchID)
}

func (s *Service) queryCheckpoint(ctx context.Context, where string, args ...any) (Checkpoint, bool, error) {
	var c Checkpoint
	err := s.db.QueryRowContext(ctx, `SELECT id,session_id,branch_id,message_id,kind,tree_hash,files,bytes,skipped,created_at FROM workspace_chat_checkpoints `+where, args...).Scan(&c.ID, &c.SessionID, &c.BranchID, &c.MessageID, &c.Kind, &c.TreeHash, &c.Files, &c.Bytes, &c.Skipped, &c.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Checkpoint{}, false, nil
	}
	if err != nil {
		return Checkpoint{}, false, err
	}
	return c, true, nil
}
