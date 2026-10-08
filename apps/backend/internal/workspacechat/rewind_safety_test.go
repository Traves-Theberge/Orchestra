package workspacechat

import (
	"context"
	"errors"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/checkpoint"
)

func safetyTrees(t *testing.T, s *Service, sessionID, kind string) []string {
	t.Helper()
	rows, err := s.db.Query(`SELECT tree_hash FROM workspace_chat_checkpoints WHERE session_id=? AND kind=? ORDER BY rowid`, sessionID, kind)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var h string
		if err = rows.Scan(&h); err != nil {
			t.Fatal(err)
		}
		out = append(out, h)
	}
	return out
}

// A retry after a partial restore must not snapshot the half-restored
// folder: Undo has to return to the folder as it was before the first try.
func TestRetryAfterPartialRestoreReusesTheFirstSafetySnapshot(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	store := &rewindStore{restoreRes: checkpoint.RestoreResult{Written: 1, Failed: []checkpoint.FileFailure{{Path: "locked.txt", Reason: "in use"}}}}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "retry")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, sess.ID, "c1", "one")
	edit := EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "uno"}}
	var restoreErr *RestoreError
	if _, err = s.Edit(ctx, pid, sess.ID, edit); !errors.As(err, &restoreErr) {
		t.Fatalf("first try should be partial: %v", err)
	}
	first := safetyTrees(t, s, sess.ID, "safety")
	if len(first) != 1 {
		t.Fatalf("one safety row expected: %v", first)
	}
	store.set(func(f *rewindStore) { f.restoreRes = checkpoint.RestoreResult{Written: 2} })
	if _, err = s.Edit(ctx, pid, sess.ID, edit); err != nil {
		t.Fatalf("retry: %v", err)
	}
	settled(t, s, pid, sess.ID)
	if got := safetyTrees(t, s, sess.ID, "safety"); len(got) != 1 || got[0] != first[0] {
		t.Fatalf("the retry must reuse the first safety snapshot %s: %v", first[0], got)
	}
	if _, err = s.UndoRestore(ctx, pid, sess.ID); err != nil {
		t.Fatal(err)
	}
	if got := store.restored(); got[len(got)-1] != first[0] {
		t.Fatalf("undo must return to the folder before the first try (%s): %v", first[0], got)
	}
}

// Undo restore snapshots the folder first, so the undo itself can be undone
// from the shadow store; a failed snapshot restores nothing.
func TestUndoRestoreTakesItsOwnSafetySnapshot(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	store := &rewindStore{}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "undo safety")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, sess.ID, "c1", "one")
	if _, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "uno"}}); err != nil {
		t.Fatal(err)
	}
	settled(t, s, pid, sess.ID)
	restores := len(store.restored())
	store.failSnapshots(errors.New("disk full"))
	if _, err = s.UndoRestore(ctx, pid, sess.ID); !errors.Is(err, ErrCheckpointUnavailable) {
		t.Fatalf("undo without its safety snapshot must abort: %v", err)
	}
	if got := store.restored(); len(got) != restores {
		t.Fatalf("nothing may be restored without a safety snapshot: %v", got)
	}
	store.failSnapshots(nil)
	store.mu.Lock()
	snaps := store.snapshots
	store.mu.Unlock()
	if _, err = s.UndoRestore(ctx, pid, sess.ID); err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	taken := store.snapshots - snaps
	store.mu.Unlock()
	if taken != 1 {
		t.Fatalf("undo should take one safety snapshot, took %d", taken)
	}
	if got := safetyTrees(t, s, sess.ID, "undo"); len(got) != 1 {
		t.Fatalf("the undo safety snapshot must be kept: %v", got)
	}
	if _, err = s.UndoRestore(ctx, pid, sess.ID); err == nil || err.Error() != "There is nothing to undo." {
		t.Fatalf("a second undo: %v", err)
	}
}

// A turn in another conversation of the same folder after the restore ends
// the Undo offer: undoing would overwrite that turn's files.
func TestUndoRestoreRefusedAfterAnotherConversationsTurn(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	store := &rewindStore{}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	a, err := s.Create(ctx, pid, "codex", "A")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, a.ID, "a1", "one")
	if _, err = s.Edit(ctx, pid, a.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "uno"}}); err != nil {
		t.Fatal(err)
	}
	settled(t, s, pid, a.ID)
	b, err := s.Create(ctx, pid, "codex", "B")
	if err != nil {
		t.Fatal(err)
	}
	say(t, s, pid, b.ID, "b1", "work in B")
	restores := len(store.restored())
	if _, err = s.UndoRestore(ctx, pid, a.ID); !errors.Is(err, ErrCheckpointUnavailable) || err.Error() != errUndoOvertaken.Error() {
		t.Fatalf("undo after another conversation's turn: %v", err)
	}
	if got := store.restored(); len(got) != restores {
		t.Fatalf("nothing may be restored: %v", got)
	}
}
