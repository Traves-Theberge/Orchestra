package workspacechat

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/checkpoint"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

// fakeCheckpointer records snapshot calls. With release set it blocks until
// release closes, ignoring its context, as a wedged store would.
type fakeCheckpointer struct {
	mu        sync.Mutex
	worktrees []string
	release   chan struct{}
	err       error
}

func (f *fakeCheckpointer) Snapshot(ctx context.Context, worktree string) (checkpoint.Tree, error) {
	f.mu.Lock()
	f.worktrees = append(f.worktrees, worktree)
	n := len(f.worktrees)
	f.mu.Unlock()
	if f.release != nil {
		<-f.release
	}
	if f.err != nil {
		return checkpoint.Tree{}, f.err
	}
	return checkpoint.Tree{Hash: fmt.Sprintf("tree-%d", n), Files: n, Bytes: int64(10 * n)}, nil
}
func (f *fakeCheckpointer) Diff(context.Context, string, string) ([]checkpoint.Change, error) {
	return nil, nil
}
func (f *fakeCheckpointer) Restore(context.Context, string, string) (checkpoint.RestoreResult, error) {
	return checkpoint.RestoreResult{}, nil
}
func (f *fakeCheckpointer) calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.worktrees...)
}

// writingRegistry starts native sessions whose turn writes out.txt into the
// turn's workspace, and records when each turn reached the harness.
type writingRegistry struct {
	*fakeNativeRegistry
	mu      sync.Mutex
	started []time.Time
}

func (r *writingRegistry) StartNativeSession(_ context.Context, _ agents.Provider, req agents.TurnRequest, _ string, h agents.NativeEventHandler) (agents.NativeSession, error) {
	r.mu.Lock()
	r.started = append(r.started, time.Now())
	r.mu.Unlock()
	return &writingNative{fakeNative: &fakeNative{handler: h}, dir: req.Workspace}, nil
}
func (r *writingRegistry) firstStart() time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.started) == 0 {
		return time.Time{}
	}
	return r.started[0]
}

type writingNative struct {
	*fakeNative
	dir string
}

func (n *writingNative) SendTurnWithOptions(ctx context.Context, text string, _ agents.NativeTurnOptions) (agents.NativeTurnResult, error) {
	return n.SendTurn(ctx, text, "")
}
func (n *writingNative) SendTurn(ctx context.Context, text, model string) (agents.NativeTurnResult, error) {
	if err := os.WriteFile(filepath.Join(n.dir, "out.txt"), []byte("made by the turn\n"), 0o644); err != nil {
		return agents.NativeTurnResult{}, err
	}
	return n.fakeNative.SendTurn(ctx, text, model)
}

// checkpointFixture keeps the database outside the project folder so a
// snapshot of the folder only sees the project's own files.
func checkpointFixture(t *testing.T, registry Registry) (*Service, string, string) {
	t.Helper()
	base := t.TempDir()
	project := filepath.Join(base, "project")
	if err := os.Mkdir(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "keep.txt"), []byte("keep\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	database, err := db.Connect(filepath.Join(base, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	pid, err := database.UpsertProject(context.Background(), project, "")
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(database, registry, []string{project})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s, pid, project
}

func checkpointRows(t *testing.T, s *Service, sessionID string) []Checkpoint {
	t.Helper()
	rows, err := s.db.Query(`SELECT id,session_id,branch_id,message_id,kind,tree_hash,files,bytes,skipped,created_at FROM workspace_chat_checkpoints WHERE session_id=? ORDER BY rowid`, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var result []Checkpoint
	for rows.Next() {
		var c Checkpoint
		if err = rows.Scan(&c.ID, &c.SessionID, &c.BranchID, &c.MessageID, &c.Kind, &c.TreeHash, &c.Files, &c.Bytes, &c.Skipped, &c.CreatedAt); err != nil {
			t.Fatal(err)
		}
		result = append(result, c)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

// sendAndSettle sends one message and waits for the turn goroutine to exit,
// after-snapshot included (Close waits for it).
func sendAndSettle(t *testing.T, s *Service, pid, sessionID string) (Accepted, Detail) {
	t.Helper()
	ctx := context.Background()
	accepted, err := s.Send(ctx, pid, sessionID, SendRequest{ClientMessageID: "c-1", Text: "make a file"})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(60 * time.Second)
	for {
		d, detailErr := s.Detail(ctx, pid, sessionID)
		if detailErr != nil {
			t.Fatal(detailErr)
		}
		if d.Session.Status != "running" && d.Session.Status != "stopping" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("turn never settled")
		}
		time.Sleep(10 * time.Millisecond)
	}
	done := make(chan struct{})
	go func() { s.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(60 * time.Second):
		t.Fatal("turn never settled")
	}
	d, err := s.Detail(ctx, pid, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	return accepted, d
}

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
}

func TestTurnTakesBeforeAndAfterCheckpoints(t *testing.T) {
	requireGit(t)
	s, pid, project := checkpointFixture(t, &writingRegistry{fakeNativeRegistry: &fakeNativeRegistry{}})
	store := checkpoint.NewStore(filepath.Join(t.TempDir(), "checkpoints"), 2*1024*1024)
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "checkpoints")
	if err != nil {
		t.Fatal(err)
	}
	accepted, d := sendAndSettle(t, s, pid, sess.ID)
	if d.Session.Status != "idle" {
		t.Fatalf("turn did not complete: %+v", d.Session)
	}
	if _, err = os.Stat(filepath.Join(project, "out.txt")); err != nil {
		t.Fatalf("harness did not write its file: %v", err)
	}
	before, ok, err := s.checkpointFor(ctx, sess.ID, accepted.Message.ID, "before")
	if err != nil || !ok {
		t.Fatalf("no before checkpoint: %v %v", ok, err)
	}
	after, ok, err := s.checkpointFor(ctx, sess.ID, accepted.Message.ID, "after")
	if err != nil || !ok {
		t.Fatalf("no after checkpoint: %v %v", ok, err)
	}
	if before.BranchID != sess.ID || after.BranchID != sess.ID {
		t.Fatalf("checkpoints should be on the main branch %s: %+v %+v", sess.ID, before, after)
	}
	if before.Files != 1 || after.Files != 2 || before.TreeHash == after.TreeHash {
		t.Fatalf("unexpected trees: before %+v after %+v", before, after)
	}
	// Restoring the before tree would delete out.txt; the after tree matches.
	changes, err := store.Diff(ctx, project, before.TreeHash)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 1 || changes[0].Path != "out.txt" || changes[0].Kind != checkpoint.ChangeDelete {
		t.Fatalf("before tree should lack out.txt: %+v", changes)
	}
	if changes, err = store.Diff(ctx, project, after.TreeHash); err != nil || len(changes) != 0 {
		t.Fatalf("after tree should match the folder: %+v %v", changes, err)
	}
	var user *Message
	for i := range d.Messages {
		if d.Messages[i].ID == accepted.Message.ID {
			user = &d.Messages[i]
		}
	}
	if user == nil || !user.HasCheckpoint {
		t.Fatalf("user message should report has_checkpoint: %+v", d.Messages)
	}
	if rows := checkpointRows(t, s, sess.ID); len(rows) != 2 {
		t.Fatalf("expected exactly one before and one after row: %+v", rows)
	}
}

func TestSnapshotFailureNeverBlocksTheTurn(t *testing.T) {
	requireGit(t)
	s, pid, _ := checkpointFixture(t, &writingRegistry{fakeNativeRegistry: &fakeNativeRegistry{}})
	// The store directory is a regular file, so the shadow repo cannot be made.
	blocked := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(blocked, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	s.SetCheckpointStore(checkpoint.NewStore(blocked, 0))
	sess, err := s.Create(context.Background(), pid, "codex", "broken store")
	if err != nil {
		t.Fatal(err)
	}
	accepted, d := sendAndSettle(t, s, pid, sess.ID)
	if d.Session.Status != "idle" || len(d.Messages) != 2 {
		t.Fatalf("turn should complete despite the failed snapshot: %+v", d)
	}
	if d.Messages[0].ID != accepted.Message.ID || d.Messages[0].HasCheckpoint {
		t.Fatalf("message should have no checkpoint: %+v", d.Messages[0])
	}
	if rows := checkpointRows(t, s, sess.ID); len(rows) != 0 {
		t.Fatalf("failed snapshots must not be recorded: %+v", rows)
	}
}

func TestSnapshotTimeoutDoesNotDelayTheTurn(t *testing.T) {
	registry := &writingRegistry{fakeNativeRegistry: &fakeNativeRegistry{}}
	s, pid, _ := checkpointFixture(t, registry)
	store := &fakeCheckpointer{release: make(chan struct{})}
	// Registered after the fixture, so it runs before Close and frees the
	// abandoned snapshot goroutines.
	t.Cleanup(func() { close(store.release) })
	s.SetCheckpointStore(store)
	s.snapshotTimeout = 50 * time.Millisecond
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "slow store")
	if err != nil {
		t.Fatal(err)
	}
	sent := time.Now()
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "c-1", Text: "go"}); err != nil {
		t.Fatal(err)
	}
	d := awaitIdle(t, s, pid, sess.ID)
	if d.Session.Status != "idle" {
		t.Fatalf("turn should complete: %+v", d.Session)
	}
	started := registry.firstStart()
	if started.IsZero() {
		t.Fatal("harness never started")
	}
	if wait := started.Sub(sent); wait > time.Second {
		t.Fatalf("a hung snapshot delayed dispatch by %v (timeout 50ms)", wait)
	}
	settled := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(settled)
	}()
	select {
	case <-settled:
	case <-time.After(2 * time.Second):
		t.Fatal("a hung after-snapshot kept the turn goroutine alive past its timeout")
	}
	if rows := checkpointRows(t, s, sess.ID); len(rows) != 0 {
		t.Fatalf("timed-out snapshots must not be recorded: %+v", rows)
	}
}

func TestMaestroTurnsAreNotCheckpointed(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, _, _, root := fixture(t, r)
	if err := s.ConfigureOrchestrator(filepath.Join(root, ".orchestra", "orchestrator"), []map[string]any{{"type": "function"}}, func(context.Context, string, map[string]any) map[string]any {
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	store := &fakeCheckpointer{}
	s.SetCheckpointStore(store)
	sess, err := s.Create(context.Background(), OrchestratorScope, "CODEX", "Maestro")
	if err != nil {
		t.Fatal(err)
	}
	_, d := sendAndSettle(t, s, OrchestratorScope, sess.ID)
	if d.Session.Status != "idle" {
		t.Fatalf("maestro turn should complete: %+v", d.Session)
	}
	if calls := store.calls(); len(calls) != 0 {
		t.Fatalf("maestro turns must not snapshot: %v", calls)
	}
	if rows := checkpointRows(t, s, sess.ID); len(rows) != 0 {
		t.Fatalf("maestro turns must not record checkpoints: %+v", rows)
	}
}

func TestReplayTurnsAreCheckpointed(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, _, pid, repo := fixture(t, r)
	store := &fakeCheckpointer{}
	s.SetCheckpointStore(store)
	sess, err := s.Create(context.Background(), pid, "CODEX", "replay")
	if err != nil {
		t.Fatal(err)
	}
	accepted, d := sendAndSettle(t, s, pid, sess.ID)
	if d.Session.Status != "idle" {
		t.Fatalf("turn should complete: %+v", d.Session)
	}
	want, err := filepath.EvalSymlinks(repo)
	if err != nil {
		t.Fatal(err)
	}
	if calls := store.calls(); len(calls) != 2 || calls[0] != want || calls[1] != want {
		t.Fatalf("expected a before and an after snapshot of %s: %v", want, calls)
	}
	rows := checkpointRows(t, s, sess.ID)
	if len(rows) != 2 || rows[0].Kind != "before" || rows[1].Kind != "after" {
		t.Fatalf("expected before then after: %+v", rows)
	}
	for _, c := range rows {
		if c.MessageID != accepted.Message.ID || c.BranchID != sess.ID || c.TreeHash == "" || c.CreatedAt == "" {
			t.Fatalf("checkpoint row incomplete: %+v", c)
		}
	}
	if rows[0].TreeHash != "tree-1" || rows[0].Files != 1 || rows[0].Bytes != 10 {
		t.Fatalf("tree stats not recorded: %+v", rows[0])
	}
	if !d.Messages[0].HasCheckpoint {
		t.Fatalf("user message should report has_checkpoint: %+v", d.Messages[0])
	}
}

func TestNoGitMeansNoCheckpointButTurnRuns(t *testing.T) {
	s, pid, _ := checkpointFixture(t, &writingRegistry{fakeNativeRegistry: &fakeNativeRegistry{}})
	s.SetCheckpointStore(checkpoint.NewStore(filepath.Join(t.TempDir(), "checkpoints"), 0))
	t.Setenv("PATH", t.TempDir())
	if _, err := exec.LookPath("git"); err == nil {
		t.Fatal("git still on PATH")
	}
	sess, err := s.Create(context.Background(), pid, "codex", "no git")
	if err != nil {
		t.Fatal(err)
	}
	_, d := sendAndSettle(t, s, pid, sess.ID)
	if d.Session.Status != "idle" || len(d.Messages) != 2 || d.Messages[0].HasCheckpoint {
		t.Fatalf("turn should run without a checkpoint: %+v", d)
	}
	if rows := checkpointRows(t, s, sess.ID); len(rows) != 0 {
		t.Fatalf("no git means no rows: %+v", rows)
	}
}

// A panicking turn still records its after checkpoint: the harness may have
// changed files before the bug fired.
func TestPanickingTurnStillRecordsAfterCheckpoint(t *testing.T) {
	old, database, native, pid := nativeFixture(t)
	old.Close()
	s, err := New(database, &panicRegistry{native}, old.roots)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	store := &fakeCheckpointer{}
	s.SetCheckpointStore(store)
	sess, err := s.Create(context.Background(), pid, "codex", "panics")
	if err != nil {
		t.Fatal(err)
	}
	accepted, d := sendAndSettle(t, s, pid, sess.ID)
	if d.Session.Status != "failed" {
		t.Fatalf("panicking turn should fail: %+v", d.Session)
	}
	rows := checkpointRows(t, s, sess.ID)
	if len(rows) != 2 || rows[0].Kind != "before" || rows[1].Kind != "after" || rows[1].MessageID != accepted.Message.ID {
		t.Fatalf("expected before and after rows: %+v", rows)
	}
}

func TestCheckpointRowsAreNotDuplicated(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, _, pid, _ := fixture(t, r)
	store := &fakeCheckpointer{}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "CODEX", "dupes")
	if err != nil {
		t.Fatal(err)
	}
	accepted, _ := sendAndSettle(t, s, pid, sess.ID)
	d, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	s.checkpointTurn(d.Session, "", accepted.Message.ID, "before")
	s.checkpointTurn(d.Session, "", accepted.Message.ID, "after")
	rows := checkpointRows(t, s, sess.ID)
	if len(rows) != 2 {
		t.Fatalf("one before and one after row per message: %+v", rows)
	}
	if rows[0].Kind != "before" || rows[0].TreeHash != "tree-1" {
		t.Fatalf("the first before snapshot is the restore target and must be kept: %+v", rows)
	}
	if rows[1].Kind != "after" || rows[1].TreeHash != "tree-3" {
		t.Fatalf("a repeated after snapshot replaces the old one: %+v", rows)
	}
}

func TestSetCheckpointStoreToleratesNil(t *testing.T) {
	var none *Service
	none.SetCheckpointStore(checkpoint.NewStore(t.TempDir(), 0))
	r := &recordingRunner{output: `{"result":"done"}`}
	s, _, pid, _ := fixture(t, r)
	s.SetCheckpointStore((*checkpoint.Store)(nil))
	sess, err := s.Create(context.Background(), pid, "CODEX", "nil store")
	if err != nil {
		t.Fatal(err)
	}
	_, d := sendAndSettle(t, s, pid, sess.ID)
	if d.Session.Status != "idle" || len(checkpointRows(t, s, sess.ID)) != 0 {
		t.Fatalf("a nil store means no checkpoints: %+v", d.Session)
	}
}
