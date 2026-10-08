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

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/checkpoint"
)

// Rewind: Edit and Regenerate re-run an earlier user message on a new branch,
// optionally after restoring the folder to how it was before that message's
// turn; ActivateBranch switches versions; UndoRestore reverts the last files
// restore. A files restore always saves a safety snapshot of the folder first
// and aborts before touching the conversation if any file could not be
// restored, so nothing is lost silently and Undo restore can always return.

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
// and sends req on the new branch. Validation, the files restore and the fork
// happen under s.mu; send takes the lock itself. If send fails, the empty
// branch is removed and the previous branch is active again; a restored
// folder stays restored (its safety checkpoint remains for Undo restore).
func (s *Service) rewind(ctx context.Context, pid, id, messageID string, edit, restoreFiles bool, req SendRequest) (Accepted, error) {
	if strings.TrimSpace(messageID) == "" || strings.TrimSpace(req.ClientMessageID) == "" || len(req.ClientMessageID) > 200 {
		return Accepted{}, ErrInvalid
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
	if restoreFiles && pid == OrchestratorScope {
		return Accepted{}, ErrInvalid
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
		req.RequestedAgentID, req.RequestedAgentScope = d.Session.RequestedAgentID, d.Session.RequestedAgentScope
		req.RequestedAgentContentHash, req.RequestedAgentFormat = d.Session.RequestedAgentContentHash, d.Session.RequestedAgentFormat
	}
	previous, err := writeBranchIn(ctx, s.db, id)
	if err != nil {
		return Accepted{}, err
	}
	// Past this point the folder or conversation may change: finish the
	// operation even if the caller goes away.
	work := context.WithoutCancel(ctx)
	if restoreFiles {
		before, ok, err := s.checkpointFor(ctx, id, user.ID, "before")
		if err != nil {
			return Accepted{}, err
		}
		if !ok || s.checkpoints == nil || d.Session.WorkspacePath == "" {
			return Accepted{}, ErrCheckpointUnavailable
		}
		if _, err = s.restoreFolder(work, pid, d.Session, previous, user.ID, before.TreeHash); err != nil {
			return Accepted{}, err
		}
	}
	var branch Branch
	native, err := s.switchBranch(work, pid, d.Session, func(tx *sql.Tx) (string, error) {
		var e error
		branch, e = s.createBranch(work, tx, id, previous, forkOrdinal, forkTime)
		return branch.ID, e
	})
	if err != nil {
		return Accepted{}, err
	}
	s.mu.Unlock()
	locked = false
	if native != nil {
		closeNative(native)
	}
	accepted, err := s.send(work, pid, id, req, "", "")
	if err != nil {
		s.dropEmptyBranch(id, previous, branch.ID)
		return Accepted{}, err
	}
	return accepted, nil
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
	if branchID != id {
		var found int
		err = s.db.QueryRowContext(ctx, `SELECT 1 FROM workspace_chat_branches WHERE session_id=? AND id=?`, id, branchID).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return Detail{}, ErrNotFound
		}
		if err != nil {
			return Detail{}, err
		}
	}
	if restoreFiles && pid == OrchestratorScope {
		return Detail{}, ErrInvalid
	}
	current, err := writeBranchIn(ctx, s.db, id)
	if err != nil {
		return Detail{}, err
	}
	work := context.WithoutCancel(ctx)
	if restoreFiles {
		after, ok, err := s.latestAfter(ctx, id, branchID)
		if err != nil {
			return Detail{}, err
		}
		if !ok || s.checkpoints == nil || d.Session.WorkspacePath == "" {
			return Detail{}, ErrCheckpointUnavailable
		}
		if _, err = s.restoreFolder(work, pid, d.Session, current, after.MessageID, after.TreeHash); err != nil {
			return Detail{}, err
		}
	}
	if current != branchID {
		native, err := s.switchBranch(work, pid, d.Session, func(*sql.Tx) (string, error) { return branchID, nil })
		if err != nil {
			return Detail{}, err
		}
		s.mu.Unlock()
		locked = false
		if native != nil {
			closeNative(native)
		}
	}
	return s.Detail(ctx, pid, id)
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
	rctx, cancel := context.WithTimeout(work, s.restoreTimeout())
	defer cancel()
	res, err := s.checkpoints.Restore(rctx, d.Session.WorkspacePath, safety.TreeHash)
	if err != nil || len(res.Failed) > 0 {
		return res, &RestoreError{Failed: res.Failed, Err: err}
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
// send's occupancy rule: this conversation's turn, or any turn in another
// conversation of the same checkout (whose files a restore would change, and
// whose pending approvals must stay answerable). Maestro conversations share
// no files, so only their own turn counts. Callers hold s.mu.
func (s *Service) busyReason(ctx context.Context, pid string, sess Session) (string, error) {
	if _, ok := s.active[sess.ID]; ok || sess.Status == "running" || sess.Status == "stopping" {
		return "This conversation has a turn in progress.", nil
	}
	if pid == OrchestratorScope {
		return "", nil
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

// restoreFolder saves a safety checkpoint of the folder as it is now, then
// makes the folder equal tree. A failed safety snapshot aborts before any
// file is touched; a restore that leaves files behind returns *RestoreError
// and keeps the safety checkpoint. Callers hold s.mu, so no turn can start.
func (s *Service) restoreFolder(ctx context.Context, pid string, sess Session, branchID, messageID, tree string) (checkpoint.RestoreResult, error) {
	if err := s.rejectRemoval(ctx, pid, sess); err != nil {
		return checkpoint.RestoreResult{}, err
	}
	store := s.checkpoints
	sctx, cancel := context.WithTimeout(ctx, s.restoreTimeout())
	safety, err := snapshotWithin(sctx, store, sess.WorkspacePath)
	cancel()
	if err == nil && safety.Hash == "" {
		err = errors.New("snapshot returned no tree")
	}
	if err != nil {
		return checkpoint.RestoreResult{}, fmt.Errorf("%w: the safety snapshot of the current files failed, so nothing was restored: %v", ErrCheckpointUnavailable, err)
	}
	if err = s.saveCheckpoint(ctx, Checkpoint{SessionID: sess.ID, BranchID: branchID, MessageID: messageID, Kind: "safety", TreeHash: safety.Hash, Files: safety.Files, Bytes: safety.Bytes, Skipped: safety.Skipped}); err != nil {
		return checkpoint.RestoreResult{}, err
	}
	rctx, cancel := context.WithTimeout(ctx, s.restoreTimeout())
	defer cancel()
	res, err := store.Restore(rctx, sess.WorkspacePath, tree)
	if err != nil || len(res.Failed) > 0 {
		log.Printf("workspace chat files restore for session %s incomplete (%d failed): %v", sess.ID, len(res.Failed), err)
		return res, &RestoreError{Failed: res.Failed, Err: err}
	}
	return res, nil
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
