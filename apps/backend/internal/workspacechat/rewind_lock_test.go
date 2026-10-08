package workspacechat

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

// blockingRestore makes store hold its next Restore until the returned
// release runs; wait returns once that Restore has started.
func blockingRestore(t *testing.T, store *rewindStore) (wait func(), release func()) {
	t.Helper()
	entered, block := make(chan struct{}, 8), make(chan struct{})
	store.set(func(f *rewindStore) { f.entered, f.block = entered, block })
	var once sync.Once
	release = func() {
		once.Do(func() {
			close(block)
			store.set(func(f *rewindStore) { f.entered, f.block = nil, nil })
		})
	}
	t.Cleanup(release)
	wait = func() {
		t.Helper()
		select {
		case <-entered:
		case <-time.After(10 * time.Second):
			t.Fatal("restore never started")
		}
	}
	return wait, release
}

// within fails the test if fn does not return in d.
func within(t *testing.T, d time.Duration, what string, fn func()) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		defer close(done)
		fn()
	}()
	select {
	case <-done:
	case <-time.After(d):
		t.Fatalf("%s waited on the restore", what)
	}
}

func TestRestoreDoesNotBlockOtherConversations(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, database, pid, repo := fixture(t, r)
	store := &rewindStore{}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	otherDir := filepath.Join(filepath.Dir(repo), "other")
	if err := os.Mkdir(otherDir, 0o755); err != nil {
		t.Fatal(err)
	}
	otherPID, err := database.UpsertProject(ctx, otherDir, "")
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.Create(ctx, pid, "CODEX", "Restoring")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, a.ID, "c1", "one")
	b, err := s.Create(ctx, otherPID, "CODEX", "Elsewhere")
	if err != nil {
		t.Fatal(err)
	}
	wait, release := blockingRestore(t, store)
	done := make(chan error, 1)
	go func() {
		_, err := s.Edit(ctx, pid, a.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "uno"}})
		done <- err
	}()
	wait()
	// A whole turn elsewhere (send, before/after snapshots, finish) and a Stop
	// complete while the restore is held.
	within(t, 5*time.Second, "a send and turn in another folder", func() {
		if _, err := s.Send(ctx, otherPID, b.ID, SendRequest{ClientMessageID: "b1", Text: "work"}); err != nil {
			t.Error(err)
			return
		}
		awaitSettled(t, s, otherPID, b.ID, 4*time.Second)
	})
	within(t, 2*time.Second, "a Stop in another folder", func() {
		if _, err := s.Stop(ctx, otherPID, b.ID); err != nil {
			t.Error(err)
		}
	})
	release()
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	settled(t, s, pid, a.ID)
}

func TestRestoreMarksTheSharedCheckoutBusy(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, _, pid, _ := fixture(t, r)
	store := &rewindStore{}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	a, err := s.Create(ctx, pid, "CODEX", "Restoring conversation")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, a.ID, "c1", "one")
	c, err := s.Create(ctx, pid, "CODEX", "Neighbour")
	if err != nil {
		t.Fatal(err)
	}
	neighbour := say(t, s, pid, c.ID, "n1", "hello")
	wait, release := blockingRestore(t, store)
	done := make(chan error, 1)
	go func() {
		_, err := s.Edit(ctx, pid, a.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "uno"}})
		done <- err
	}()
	wait()
	within(t, 2*time.Second, "busy checks", func() {
		if _, err := s.Send(ctx, pid, c.ID, SendRequest{ClientMessageID: "n2", Text: "again"}); !errors.Is(err, ErrBusy) {
			t.Errorf("a send sharing the folder must be busy: %v", err)
		}
		preview, err := s.PreviewRewind(ctx, pid, c.ID, neighbour.Message.ID)
		if err != nil || !strings.Contains(preview.BusyReason, "Restoring conversation") {
			t.Errorf("the neighbour's preview should name the restoring conversation: %+v %v", preview, err)
		}
		if _, err := s.Edit(ctx, pid, c.ID, EditRequest{MessageID: neighbour.Message.ID, SendRequest: SendRequest{ClientMessageID: "n3", Text: "x"}}); !errors.Is(err, ErrBusy) {
			t.Errorf("the neighbour's edit must be busy: %v", err)
		}
		// The restoring conversation itself is busy everywhere.
		if _, err := s.Send(ctx, pid, a.ID, SendRequest{ClientMessageID: "a2", Text: "x"}); !errors.Is(err, ErrBusy) {
			t.Errorf("send on the restoring conversation: %v", err)
		}
		if _, err := s.Stop(ctx, pid, a.ID); !errors.Is(err, ErrBusy) {
			t.Errorf("stop on the restoring conversation: %v", err)
		}
		if err := s.Delete(ctx, pid, a.ID); !errors.Is(err, ErrBusy) {
			t.Errorf("delete on the restoring conversation: %v", err)
		}
		if _, err := s.SwitchProvider(ctx, pid, a.ID, SwitchProviderRequest{Provider: "claude", ExpectedProvider: a.Provider}); !errors.Is(err, ErrBusy) {
			t.Errorf("switch on the restoring conversation: %v", err)
		}
		if _, err := s.UndoRestore(ctx, pid, a.ID); !errors.Is(err, ErrBusy) {
			t.Errorf("undo on the restoring conversation: %v", err)
		}
		if _, err := s.ActivateBranch(ctx, pid, a.ID, a.ID, false); !errors.Is(err, ErrBusy) {
			t.Errorf("activate on the restoring conversation: %v", err)
		}
		preview, err = s.PreviewRewind(ctx, pid, a.ID, turn.Message.ID)
		if err != nil || preview.BusyReason == "" {
			t.Errorf("the restoring conversation's preview is busy: %+v %v", preview, err)
		}
	})
	release()
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	settled(t, s, pid, a.ID)
	say(t, s, pid, c.ID, "n4", "free again")
}

func TestRestoreMarkerClearedOnEveryPath(t *testing.T) {
	for _, path := range []string{"failure", "panic", "success"} {
		t.Run(path, func(t *testing.T) {
			r := newRewindRegistry()
			s, pid, _ := checkpointFixture(t, r)
			store := &rewindStore{}
			s.SetCheckpointStore(store)
			ctx := context.Background()
			sess, err := s.Create(ctx, pid, "codex", "marker")
			if err != nil {
				t.Fatal(err)
			}
			turn := say(t, s, pid, sess.ID, "c1", "one")
			switch path {
			case "failure":
				store.set(func(f *rewindStore) { f.failFrom = 1 })
			case "panic":
				store.set(func(f *rewindStore) { f.panicRestore = true })
			}
			_, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "uno"}})
			var restoreErr *RestoreError
			if path == "success" {
				if err != nil {
					t.Fatal(err)
				}
				settled(t, s, pid, sess.ID)
			} else if !errors.As(err, &restoreErr) {
				t.Fatalf("%s should report a restore error: %v", path, err)
			}
			store.set(func(f *rewindStore) { f.failFrom, f.panicRestore = 0, false })
			// No marker is left: the conversation and its folder take turns.
			say(t, s, pid, sess.ID, "c2", "after")
			other, err := s.Create(ctx, pid, "codex", "other")
			if err != nil {
				t.Fatal(err)
			}
			say(t, s, pid, other.ID, "o1", "next door")
		})
	}
}

// A panic inside the unlocked section still relocks and clears the mark.
func TestWhileRestoringClearsTheMarkOnPanic(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "panics")
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	func() {
		defer func() { _ = recover() }()
		s.mu.Lock()
		defer s.mu.Unlock()
		_ = s.whileRestoring(pid, d.Session, func() error { panic("bug") })
	}()
	say(t, s, pid, sess.ID, "c1", "still usable")
}

func TestEditValidationFailsBeforeAnyRestore(t *testing.T) {
	r := newRewindRegistry()
	r.write = writeFromPrompt
	s, pid, project := checkpointFixture(t, r)
	realStore(t, s)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "preflight")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, sess.ID, "c1", "write a.txt agent")
	post := folderState(t, project)
	maxTurns := 3
	_, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "x", RequestedMaxTurns: &maxTurns}})
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("send's check should fail the edit: %v", err)
	}
	r.setAccountErr(errors.New("account removed"))
	if _, err = s.Regenerate(ctx, pid, sess.ID, RegenerateRequest{MessageID: turn.Message.ID, ClientMessageID: "r1", RestoreFiles: true}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("an unusable account should fail the regenerate: %v", err)
	}
	if got := folderState(t, project); !reflect.DeepEqual(got, post) {
		t.Fatalf("the folder must be untouched:\n got %v\nwant %v", got, post)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_checkpoints WHERE session_id=? AND kind='safety'`, sess.ID); n != 0 {
		t.Fatalf("no safety snapshot may be taken: %d", n)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_branches WHERE session_id=?`, sess.ID); n != 0 {
		t.Fatalf("no branch: %d", n)
	}
}

func TestSendFailureAfterRestoreAutoRestoresTheFolder(t *testing.T) {
	r := newRewindRegistry()
	r.write = writeFromPrompt
	s, pid, project := checkpointFixture(t, r)
	realStore(t, s)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "auto restore")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, sess.ID, "c1", "write a.txt agent")
	post := folderState(t, project)
	s.rewindGap = func() { r.setAccountErr(errors.New("account removed")) }
	_, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "x"}})
	var restored *FilesRestoredError
	if !errors.Is(err, ErrUnsupported) || errors.As(err, &restored) {
		t.Fatalf("the send error should surface with the files put back: %v", err)
	}
	if got := folderState(t, project); !reflect.DeepEqual(got, post) {
		t.Fatalf("the folder should be back as before the edit:\n got %v\nwant %v", got, post)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_checkpoints WHERE session_id=? AND kind='safety'`, sess.ID); n != 0 {
		t.Fatalf("the spent safety checkpoint should be removed: %d", n)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_branches WHERE session_id=?`, sess.ID); n != 0 {
		t.Fatalf("no branch: %d", n)
	}
}

func TestSendFailureAfterRestoreWithFailedAutoRestoreReturnsFilesRestoredError(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	store := &rewindStore{failFrom: 2}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "stuck restore")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, sess.ID, "c1", "one")
	s.rewindGap = func() { r.setAccountErr(errors.New("account removed")) }
	_, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "x"}})
	var restored *FilesRestoredError
	if !errors.As(err, &restored) || !errors.Is(err, ErrUnsupported) {
		t.Fatalf("expected FilesRestoredError wrapping the send error: %v", err)
	}
	if got := store.restored(); len(got) != 2 {
		t.Fatalf("one restore and one attempted return: %v", got)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_checkpoints WHERE session_id=? AND kind='safety'`, sess.ID); n != 1 {
		t.Fatalf("the safety checkpoint must stay for Undo restore: %d", n)
	}
}

func TestRetryAfterFailedEditDoesNotStackSafetyCheckpoints(t *testing.T) {
	r := newRewindRegistry()
	r.write = writeFromPrompt
	s, pid, project := checkpointFixture(t, r)
	realStore(t, s)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "retry")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, sess.ID, "c1", "write a.txt agent")
	post := folderState(t, project)
	req := EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "nothing"}}
	s.rewindGap = func() { r.setAccountErr(errors.New("account removed")) }
	if _, err = s.Edit(ctx, pid, sess.ID, req); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("first attempt should fail: %v", err)
	}
	s.rewindGap = nil
	r.setAccountErr(nil)
	if _, err = s.Edit(ctx, pid, sess.ID, req); err != nil {
		t.Fatalf("retry: %v", err)
	}
	settled(t, s, pid, sess.ID)
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_checkpoints WHERE session_id=? AND kind='safety'`, sess.ID); n != 1 {
		t.Fatalf("exactly one safety checkpoint after the retry: %d", n)
	}
	if _, err = s.UndoRestore(ctx, pid, sess.ID); err != nil {
		t.Fatal(err)
	}
	if got := folderState(t, project); !reflect.DeepEqual(got, post) {
		t.Fatalf("one undo returns to the user's files:\n got %v\nwant %v", got, post)
	}
}
