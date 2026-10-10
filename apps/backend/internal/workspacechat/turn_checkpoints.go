package workspacechat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/checkpoint"
)

// checkpointer snapshots, diffs and restores a folder. *checkpoint.Store
// satisfies it; tests substitute fakes.
type checkpointer interface {
	Snapshot(ctx context.Context, worktree string) (checkpoint.Tree, error)
	Diff(ctx context.Context, worktree, treeHash string) ([]checkpoint.Change, error)
	Restore(ctx context.Context, worktree, treeHash string) (checkpoint.RestoreResult, error)
}

// defaultSnapshotTimeout bounds one snapshot; past it the turn goes on without.
const defaultSnapshotTimeout = 20 * time.Second

// Turn phases outside the harness. A turn in s.active with no phase has
// dispatched its harness, so Stop must interrupt the provider; a preparing
// turn has not, so Stop cancels it; a settling turn's harness is done.
const (
	phasePreparing = "preparing"
	phaseSettling  = "settling"
)

const notDispatchedError = "Turn stopped before it was sent to the agent. Workspace files were not changed by this turn."

// SetCheckpointStore enables per-turn file checkpoints. Nil (including a nil
// *checkpoint.Store) disables them.
func (s *Service) SetCheckpointStore(c checkpointer) {
	if s == nil {
		return
	}
	if store, ok := c.(*checkpoint.Store); ok && store == nil {
		c = nil
	}
	s.mu.Lock()
	s.checkpoints = c
	s.mu.Unlock()
}

// setTurnPhase records a turn's phase; callers hold s.mu. Empty clears it.
func (s *Service) setTurnPhase(id, phase string) {
	if phase == "" {
		delete(s.turnPhases, id)
		return
	}
	if s.turnPhases == nil {
		s.turnPhases = map[string]string{}
	}
	s.turnPhases[id] = phase
}

// beginDispatch ends the preparing phase. It reports false when the turn was
// cancelled or Stop was requested while preparing (the before snapshot); the
// caller then settles the turn as interrupted without running the harness.
// Holding s.mu makes the check atomic with Stop.
func (s *Service) beginDispatch(ctx context.Context, id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.setTurnPhase(id, "")
	if ctx.Err() != nil {
		return false
	}
	var status string
	if err := s.db.QueryRow(`SELECT status FROM workspace_chat_sessions WHERE id=?`, id).Scan(&status); err == nil && status == "stopping" {
		return false
	}
	return true
}

// settleUndispatched finishes a turn whose harness never ran.
func (s *Service) settleUndispatched(sess Session, m Message) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.active, sess.ID)
	if err := s.finish(sess, m, "", "interrupted", "cancelled", notDispatchedError); err != nil {
		log.Printf("workspace chat finalization failed for session %s: %v", sess.ID, err)
		_, _ = s.db.Exec(`UPDATE workspace_chat_sessions SET status='interrupted',error='Chat history persistence failed; delivery outcome unknown. Inspect before sending again.' WHERE id=?`, sess.ID)
		_, _ = s.db.Exec(`UPDATE workspace_chat_messages SET status='unknown' WHERE id=?`, m.ID)
	}
}

// settleTurn takes the after snapshot while the turn still owns the session
// (running and in s.active), so no new turn or Delete can start until it is
// recorded. The cost: the session reads "running" for up to the snapshot
// timeout after the harness finished.
func (s *Service) settleTurn(sess Session, m Message) {
	s.mu.Lock()
	s.setTurnPhase(sess.ID, phaseSettling)
	s.mu.Unlock()
	s.checkpointTurn(sess, "", m.ID, "after")
}

// checkpointTurn snapshots the conversation's folder and records it against a
// user message: "before" just before the turn is dispatched, "after" once the
// harness has ended. It is best-effort: a missing store, Maestro scope or
// unbound folder skips it; a failure or timeout is logged and leaves the
// message without a checkpoint; it never waits longer than the snapshot
// timeout and never panics. An empty branchID means the message's own branch.
func (s *Service) checkpointTurn(sess Session, branchID, messageID, kind string) {
	s.checkpointTurnCtx(context.Background(), sess, branchID, messageID, kind)
}

// checkpointTurnCtx is checkpointTurn bounded also by parent, so a turn that
// is stopped cuts its before snapshot short.
func (s *Service) checkpointTurnCtx(parent context.Context, sess Session, branchID, messageID, kind string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("workspace chat %s checkpoint for message %s panicked: %v", kind, messageID, r)
		}
	}()
	s.mu.Lock()
	store, timeout := s.checkpoints, s.snapshotTimeout
	s.mu.Unlock()
	if store == nil || sess.ProjectID == OrchestratorScope || sess.WorkspacePath == "" {
		return
	}
	if timeout <= 0 {
		timeout = defaultSnapshotTimeout
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	if branchID == "" {
		var err error
		if branchID, err = s.messageBranch(ctx, sess.ID, messageID); err != nil {
			log.Printf("workspace chat %s checkpoint for message %s skipped: %v", kind, messageID, err)
			return
		}
	}
	if kind == "before" {
		// The first before snapshot is the message's restore target; a later
		// one would capture files the turn already changed.
		if _, ok, err := s.checkpointFor(ctx, sess.ID, messageID, "before"); err != nil || ok {
			if err != nil {
				log.Printf("workspace chat before checkpoint for message %s skipped: %v", messageID, err)
			}
			return
		}
	}
	tree, err := snapshotWithin(ctx, store, sess.WorkspacePath)
	if err == nil && tree.Hash == "" {
		err = errors.New("snapshot returned no tree")
	}
	if err != nil {
		if errors.Is(err, checkpoint.ErrUnavailable) {
			// Git missing or the store unusable: say so once, not twice a turn.
			if s.unavailableLogged.CompareAndSwap(false, true) {
				log.Printf("workspace chat file checkpoints unavailable; turns run without them: %v", err)
			}
			return
		}
		log.Printf("workspace chat %s checkpoint for message %s skipped: %v", kind, messageID, err)
		return
	}
	// Recording gets its own deadline: the snapshot may have used most of ctx.
	recordCtx, recordCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer recordCancel()
	if kind == "after" {
		// One after row per message and branch: the newest outcome wins.
		if _, err = s.db.ExecContext(recordCtx, `DELETE FROM workspace_chat_checkpoints WHERE session_id=? AND message_id=? AND branch_id=? AND kind='after'`, sess.ID, messageID, branchID); err != nil {
			log.Printf("workspace chat after checkpoint for message %s not recorded: %v", messageID, err)
			return
		}
	}
	if err = s.saveCheckpoint(recordCtx, Checkpoint{SessionID: sess.ID, BranchID: branchID, MessageID: messageID, Kind: kind, TreeHash: tree.Hash, Files: tree.Files, Bytes: tree.Bytes, Skipped: tree.Skipped}); err != nil {
		log.Printf("workspace chat %s checkpoint for message %s not recorded: %v", kind, messageID, err)
	}
}

// snapshotWithin returns when the snapshot finishes or ctx ends, even if the
// store ignores ctx (its late result is then discarded). Snapshots of one
// folder never overlap a harness: before and after both run while the turn
// owns the session, and Send serializes turns per checkout (Maestro, which
// does not, is never checkpointed).
func snapshotWithin(ctx context.Context, store checkpointer, worktree string) (checkpoint.Tree, error) {
	type outcome struct {
		tree checkpoint.Tree
		err  error
	}
	done := make(chan outcome, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				done <- outcome{err: fmt.Errorf("snapshot panicked: %v", r)}
			}
		}()
		tree, err := store.Snapshot(ctx, worktree)
		done <- outcome{tree, err}
	}()
	select {
	case res := <-done:
		return res.tree, res.err
	case <-ctx.Done():
		return checkpoint.Tree{}, fmt.Errorf("snapshot did not finish: %w", ctx.Err())
	}
}

// messageBranch is the branch a message was written on (main when stored empty).
func (s *Service) messageBranch(ctx context.Context, sessionID, messageID string) (string, error) {
	var branchID string
	err := s.db.QueryRowContext(ctx, `SELECT branch_id FROM workspace_chat_messages WHERE session_id=? AND id=?`, sessionID, messageID).Scan(&branchID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if branchID == "" {
		return sessionID, nil
	}
	return branchID, nil
}
