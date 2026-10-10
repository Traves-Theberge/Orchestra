package workspacechat

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/checkpoint"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

// fakeCheckpointer records snapshot calls. With release set it blocks until
// release closes, ignoring its context, as a wedged store would: every call,
// or only call number blockCall (1-based) when that is set. entered, if set,
// receives each call number as the call starts.
type fakeCheckpointer struct {
	mu        sync.Mutex
	worktrees []string
	release   chan struct{}
	blockCall int
	entered   chan int
	err       error
}

func (f *fakeCheckpointer) Snapshot(ctx context.Context, worktree string) (checkpoint.Tree, error) {
	f.mu.Lock()
	f.worktrees = append(f.worktrees, worktree)
	n := len(f.worktrees)
	f.mu.Unlock()
	if f.entered != nil {
		f.entered <- n
	}
	if f.release != nil && (f.blockCall == 0 || f.blockCall == n) {
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
	sends   int
}

func (r *writingRegistry) StartNativeSession(_ context.Context, _ agents.Provider, req agents.TurnRequest, _ string, h agents.NativeEventHandler) (agents.NativeSession, error) {
	r.mu.Lock()
	r.started = append(r.started, time.Now())
	r.mu.Unlock()
	return &writingNative{fakeNative: &fakeNative{handler: h}, dir: req.Workspace, registry: r}, nil
}
func (r *writingRegistry) sendCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sends
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
	dir      string
	registry *writingRegistry
}

func (n *writingNative) SendTurnWithOptions(ctx context.Context, text string, _ agents.NativeTurnOptions) (agents.NativeTurnResult, error) {
	return n.SendTurn(ctx, text, "")
}
func (n *writingNative) SendTurn(ctx context.Context, text, model string) (agents.NativeTurnResult, error) {
	n.registry.mu.Lock()
	n.registry.sends++
	n.registry.mu.Unlock()
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

type writerFunc func([]byte) (int, error)

func (f writerFunc) Write(p []byte) (int, error) { return f(p) }

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
	} else if wait < 50*time.Millisecond {
		t.Fatalf("dispatch after %v: the before snapshot did not wait for its timeout", wait)
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
	// Both the before and the after snapshot reached the (hung) store.
	if calls := store.calls(); len(calls) != 2 {
		t.Fatalf("expected the before and after snapshots to reach the store: %v", calls)
	}
}

// awaitEntered waits for the fake store to start snapshot call number want.
func awaitEntered(t *testing.T, entered chan int, want int) {
	t.Helper()
	timeout := time.After(10 * time.Second)
	for {
		select {
		case n := <-entered:
			if n == want {
				return
			}
		case <-timeout:
			t.Fatalf("snapshot call %d never started", want)
		}
	}
}

// awaitSettled waits for the session to leave running/stopping.
func awaitSettled(t *testing.T, s *Service, pid, id string, within time.Duration) Detail {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		d, err := s.Detail(context.Background(), pid, id)
		if err != nil {
			t.Fatal(err)
		}
		if d.Session.Status != "running" && d.Session.Status != "stopping" {
			return d
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("session did not settle within %v", within)
	return Detail{}
}

// Stop while a resumed native turn is still taking its before snapshot: the
// provider has no turn yet, so Stop must cancel rather than interrupt it, and
// the harness must never receive the message.
func TestStopDuringBeforeSnapshotNeverDispatchesNativeTurn(t *testing.T) {
	registry := &writingRegistry{fakeNativeRegistry: &fakeNativeRegistry{}}
	s, pid, _ := checkpointFixture(t, registry)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "stop native")
	if err != nil {
		t.Fatal(err)
	}
	// The first turn leaves a live provider process, as in real use.
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "c-1", Text: "first"}); err != nil {
		t.Fatal(err)
	}
	awaitSettled(t, s, pid, sess.ID, 10*time.Second)
	if registry.sendCount() != 1 {
		t.Fatalf("first turn should have been dispatched once: %d", registry.sendCount())
	}
	store := &fakeCheckpointer{release: make(chan struct{}), entered: make(chan int, 8)}
	t.Cleanup(func() { close(store.release) })
	s.SetCheckpointStore(store)
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "c-2", Text: "second"}); err != nil {
		t.Fatal(err)
	}
	awaitEntered(t, store.entered, 1)
	stopped := time.Now()
	if _, err = s.Stop(ctx, pid, sess.ID); err != nil {
		t.Fatalf("Stop during the before snapshot failed: %v", err)
	}
	d := awaitSettled(t, s, pid, sess.ID, 5*time.Second)
	if time.Since(stopped) > 3*time.Second {
		t.Fatal("Stop waited for the snapshot timeout")
	}
	if d.Session.Status != "interrupted" {
		t.Fatalf("stopped turn should be interrupted: %+v", d.Session)
	}
	if last := d.Messages[len(d.Messages)-1]; last.Text != "second" || last.Status != "cancelled" {
		t.Fatalf("stopped message should be cancelled: %+v", last)
	}
	if registry.sendCount() != 1 {
		t.Fatalf("the stopped turn reached the harness: %d sends", registry.sendCount())
	}
}

func TestStopDuringBeforeSnapshotNeverDispatchesReplayTurn(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, _, pid, _ := fixture(t, r)
	store := &fakeCheckpointer{release: make(chan struct{}), entered: make(chan int, 8)}
	t.Cleanup(func() { close(store.release) })
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "CODEX", "stop replay")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "c-1", Text: "go"}); err != nil {
		t.Fatal(err)
	}
	awaitEntered(t, store.entered, 1)
	if _, err = s.Stop(ctx, pid, sess.ID); err != nil {
		t.Fatalf("Stop during the before snapshot failed: %v", err)
	}
	d := awaitSettled(t, s, pid, sess.ID, 3*time.Second)
	if d.Session.Status != "interrupted" || d.Messages[0].Status != "cancelled" {
		t.Fatalf("stopped turn should be interrupted: %+v", d)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.calls) != 0 {
		t.Fatalf("the stopped turn reached the harness: %d calls", len(r.calls))
	}
}

// The after snapshot runs while the turn still owns the session: sends and
// deletes are refused until it is recorded, and the row exists before idle.
func TestAfterSnapshotHoldsTheSession(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, _, pid, _ := fixture(t, r)
	store := &fakeCheckpointer{release: make(chan struct{}), blockCall: 2, entered: make(chan int, 8)}
	released := false
	t.Cleanup(func() {
		if !released {
			close(store.release)
		}
	})
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "CODEX", "after holds")
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "c-1", Text: "go"})
	if err != nil {
		t.Fatal(err)
	}
	awaitEntered(t, store.entered, 2)
	d, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if d.Session.Status != "running" {
		t.Fatalf("session should still be running during the after snapshot: %+v", d.Session)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "c-2", Text: "too soon"}); !errors.Is(err, ErrBusy) {
		t.Fatalf("send during the after snapshot should be busy: %v", err)
	}
	if err = s.Delete(ctx, pid, sess.ID); !errors.Is(err, ErrBusy) {
		t.Fatalf("delete during the after snapshot should be busy: %v", err)
	}
	close(store.release)
	released = true
	d = awaitSettled(t, s, pid, sess.ID, 5*time.Second)
	if d.Session.Status != "idle" {
		t.Fatalf("turn should complete: %+v", d.Session)
	}
	// Read immediately at idle: the after row must already be there.
	if _, ok, err := s.checkpointFor(ctx, sess.ID, accepted.Message.ID, "after"); err != nil || !ok {
		t.Fatalf("after row missing when the session reported idle: %v %v", ok, err)
	}
	if err = s.Delete(ctx, pid, sess.ID); err != nil {
		t.Fatal(err)
	}
	if rows := checkpointRows(t, s, sess.ID); len(rows) != 0 {
		t.Fatalf("delete left orphan checkpoint rows: %+v", rows)
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
	var logs bytes.Buffer
	var logMu sync.Mutex
	log.SetOutput(writerFunc(func(p []byte) (int, error) {
		logMu.Lock()
		defer logMu.Unlock()
		return logs.Write(p)
	}))
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	_, d := sendAndSettle(t, s, pid, sess.ID)
	if d.Session.Status != "idle" || len(d.Messages) != 2 || d.Messages[0].HasCheckpoint {
		t.Fatalf("turn should run without a checkpoint: %+v", d)
	}
	logMu.Lock()
	text := logs.String()
	logMu.Unlock()
	if n := strings.Count(text, "file checkpoints unavailable"); n != 1 {
		t.Fatalf("missing git should be logged once, got %d:\n%s", n, text)
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
