package workspacechat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"path/filepath"
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

// checkpointTurn snapshots the conversation's folder and records it against a
// user message: "before" just before the turn is dispatched, "after" once it
// has ended. It is best-effort: a missing store, Maestro scope or unbound
// folder skips it; a failure or timeout is logged and leaves the message
// without a checkpoint; it never waits longer than the snapshot timeout and
// never panics. An empty branchID means the message's own branch.
func (s *Service) checkpointTurn(sess Session, branchID, messageID, kind string) {
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
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
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
	tree, err := s.snapshot(ctx, store, sess.WorkspacePath)
	if err == nil && tree.Hash == "" {
		err = errors.New("snapshot returned no tree")
	}
	if err != nil {
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

// snapshot runs one snapshot, returning when it finishes or ctx ends, even if
// the store ignores ctx (its late result is then discarded). Snapshots of one
// folder are serialized, so a turn's after snapshot finishes before the next
// turn's before snapshot starts and that turn's harness is dispatched.
func (s *Service) snapshot(ctx context.Context, store checkpointer, worktree string) (checkpoint.Tree, error) {
	type outcome struct {
		tree checkpoint.Tree
		err  error
	}
	done := make(chan outcome, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				select {
				case done <- outcome{err: fmt.Errorf("snapshot panicked: %v", r)}:
				default:
				}
			}
		}()
		lock, _ := s.worktreeLocks.LoadOrStore(filepath.Clean(worktree), make(chan struct{}, 1))
		slot := lock.(chan struct{})
		select {
		case slot <- struct{}{}:
		case <-ctx.Done():
			done <- outcome{err: ctx.Err()}
			return
		}
		defer func() { <-slot }()
		tree, err := store.Snapshot(ctx, worktree)
		done <- outcome{tree, err}
	}()
	select {
	case res := <-done:
		return res.tree, res.err
	case <-ctx.Done():
		return checkpoint.Tree{}, fmt.Errorf("snapshot timed out: %w", ctx.Err())
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
