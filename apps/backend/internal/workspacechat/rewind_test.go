package workspacechat

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/checkpoint"
)

// rewindRegistry starts native sessions that record the thread each start
// resumes, the provider, and every prompt; write, when set, lets a turn change
// the folder from its prompt.
type rewindRegistry struct {
	*fakeNativeRegistry
	mu        sync.Mutex
	threads   []string
	providers []agents.Provider
	prompts   []string
	write     func(dir, prompt string) error
}

func newRewindRegistry() *rewindRegistry {
	return &rewindRegistry{fakeNativeRegistry: &fakeNativeRegistry{}}
}

func (r *rewindRegistry) StartNativeSession(_ context.Context, p agents.Provider, req agents.TurnRequest, thread string, h agents.NativeEventHandler) (agents.NativeSession, error) {
	r.mu.Lock()
	r.threads = append(r.threads, thread)
	r.providers = append(r.providers, p)
	r.mu.Unlock()
	return &rewindNative{fakeNative: &fakeNative{handler: h}, dir: req.Workspace, registry: r}, nil
}

func (r *rewindRegistry) snapshot() (threads []string, providers []agents.Provider, prompts []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.threads...), append([]agents.Provider(nil), r.providers...), append([]string(nil), r.prompts...)
}

type rewindNative struct {
	*fakeNative
	dir      string
	registry *rewindRegistry
}

func (n *rewindNative) SendTurnWithOptions(ctx context.Context, text string, _ agents.NativeTurnOptions) (agents.NativeTurnResult, error) {
	return n.SendTurn(ctx, text, "")
}
func (n *rewindNative) SendTurn(ctx context.Context, text, model string) (agents.NativeTurnResult, error) {
	n.registry.mu.Lock()
	n.registry.prompts = append(n.registry.prompts, text)
	write := n.registry.write
	n.registry.mu.Unlock()
	if write != nil {
		if err := write(n.dir, text); err != nil {
			return agents.NativeTurnResult{}, err
		}
	}
	return agents.NativeTurnResult{TurnID: "turn", Status: "completed", Text: "reply: " + lastLine(text), Model: "observed-model"}, nil
}

func lastLine(text string) string {
	return text[strings.LastIndex(text, "\n")+1:]
}

// rewindStore is a fake checkpointer with scripted Snapshot/Diff/Restore.
type rewindStore struct {
	mu          sync.Mutex
	snapshots   int
	snapshotErr error
	restores    []string
	restoreRes  checkpoint.RestoreResult
	restoreErr  error
	diffs       map[string][]checkpoint.Change
}

func (f *rewindStore) Snapshot(context.Context, string) (checkpoint.Tree, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.snapshotErr != nil {
		return checkpoint.Tree{}, f.snapshotErr
	}
	f.snapshots++
	return checkpoint.Tree{Hash: fmt.Sprintf("tree-%d", f.snapshots), Files: 1}, nil
}
func (f *rewindStore) Diff(_ context.Context, _, tree string) ([]checkpoint.Change, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.diffs[tree], nil
}
func (f *rewindStore) Restore(_ context.Context, _, tree string) (checkpoint.RestoreResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.restores = append(f.restores, tree)
	return f.restoreRes, f.restoreErr
}
func (f *rewindStore) restored() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.restores...)
}
func (f *rewindStore) failSnapshots(err error) {
	f.mu.Lock()
	f.snapshotErr = err
	f.mu.Unlock()
}

// say sends one message and waits for its turn to settle.
func say(t *testing.T, s *Service, pid, id, client, text string) Accepted {
	t.Helper()
	accepted, err := s.Send(context.Background(), pid, id, SendRequest{ClientMessageID: client, Text: text})
	if err != nil {
		t.Fatalf("send %q: %v", text, err)
	}
	if d := awaitSettled(t, s, pid, id, 60*time.Second); d.Session.Status != "idle" {
		t.Fatalf("turn %q did not complete: %+v", text, d.Session)
	}
	return accepted
}

func settled(t *testing.T, s *Service, pid, id string) Detail {
	t.Helper()
	d := awaitSettled(t, s, pid, id, 60*time.Second)
	if d.Session.Status != "idle" {
		t.Fatalf("turn did not complete: %+v", d.Session)
	}
	return d
}

func texts(d Detail) []string {
	out := []string{}
	for _, m := range d.Messages {
		out = append(out, m.Role+":"+m.Text)
	}
	return out
}

func countRows(t *testing.T, s *Service, query string, args ...any) int {
	t.Helper()
	var n int
	if err := s.db.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func branchIDs(t *testing.T, s *Service, sessionID string) []string {
	t.Helper()
	rows, err := s.db.Query(`SELECT id FROM workspace_chat_branches WHERE session_id=? ORDER BY rowid`, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	return ids
}

// folderState maps every file under dir (slash paths) to its content.
func folderState(t *testing.T, dir string) map[string]string {
	t.Helper()
	state := map[string]string{}
	err := filepath.WalkDir(dir, func(p string, e os.DirEntry, err error) error {
		if err != nil || e.IsDir() {
			return err
		}
		raw, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(dir, p)
		state[filepath.ToSlash(rel)] = string(raw)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func realStore(t *testing.T, s *Service) *checkpoint.Store {
	t.Helper()
	requireGit(t)
	store := checkpoint.NewStore(filepath.Join(t.TempDir(), "checkpoints"), 2*1024*1024)
	s.SetCheckpointStore(store)
	return store
}

// writeFromPrompt makes a turn whose last prompt line is "write NAME CONTENT"
// write that file.
func writeFromPrompt(dir, prompt string) error {
	fields := strings.Fields(lastLine(prompt))
	if len(fields) == 3 && fields[0] == "write" {
		return os.WriteFile(filepath.Join(dir, fields[1]), []byte(fields[2]), 0o644)
	}
	return nil
}

func TestEditCreatesABranchKeepingTheOriginal(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "branching")
	if err != nil {
		t.Fatal(err)
	}
	say(t, s, pid, sess.ID, "c1", "one")
	m2 := say(t, s, pid, sess.ID, "c2", "two")
	say(t, s, pid, sess.ID, "c3", "three")
	edited, err := s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: m2.Message.ID, SendRequest: SendRequest{ClientMessageID: "e1", Text: "deux"}})
	if err != nil {
		t.Fatal(err)
	}
	if edited.Message.Text != "deux" || edited.Message.Role != "user" {
		t.Fatalf("edit should accept the new text: %+v", edited.Message)
	}
	d := settled(t, s, pid, sess.ID)
	want := []string{"user:one", "assistant:reply: one", "user:deux", "assistant:reply: deux"}
	if got := texts(d); !reflect.DeepEqual(got, want) {
		t.Fatalf("edited view:\n got %v\nwant %v", got, want)
	}
	branches := branchIDs(t, s, sess.ID)
	if len(branches) != 1 {
		t.Fatalf("one branch expected: %v", branches)
	}
	versions := []VersionRef{{BranchID: sess.ID}, {BranchID: branches[0], Active: true}}
	if !reflect.DeepEqual(d.Messages[2].Versions, versions) {
		t.Fatalf("edited message should list both versions: %+v", d.Messages[2].Versions)
	}
	main, err := s.ActivateBranch(ctx, pid, sess.ID, sess.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	want = []string{"user:one", "assistant:reply: one", "user:two", "assistant:reply: two", "user:three", "assistant:reply: three"}
	if got := texts(main); !reflect.DeepEqual(got, want) {
		t.Fatalf("original view:\n got %v\nwant %v", got, want)
	}
	versions = []VersionRef{{BranchID: sess.ID, Active: true}, {BranchID: branches[0]}}
	if !reflect.DeepEqual(main.Messages[2].Versions, versions) {
		t.Fatalf("original message should list both versions: %+v", main.Messages[2].Versions)
	}
}

func TestEditingTheFirstMessage(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, _, pid, _ := fixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "CODEX", "first")
	if err != nil {
		t.Fatal(err)
	}
	first := say(t, s, pid, sess.ID, "c1", "alpha-first")
	if _, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: first.Message.ID, SendRequest: SendRequest{ClientMessageID: "e1", Text: "beta-first"}}); err != nil {
		t.Fatal(err)
	}
	d := settled(t, s, pid, sess.ID)
	if got, want := texts(d), []string{"user:beta-first", "assistant:done"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("view after editing the only message: %v", got)
	}
	var ordinal int64
	var forkTime string
	if err = s.db.QueryRow(`SELECT fork_after_ordinal,fork_after_time FROM workspace_chat_branches WHERE session_id=?`, sess.ID).Scan(&ordinal, &forkTime); err != nil {
		t.Fatal(err)
	}
	if ordinal != 0 || forkTime != "" {
		t.Fatalf("a first-message edit forks before everything: %d %q", ordinal, forkTime)
	}
	r.mu.Lock()
	prompt := r.calls[len(r.calls)-1].Prompt
	r.mu.Unlock()
	if strings.Contains(prompt, "alpha-first") || !strings.HasSuffix(prompt, "[user]\nbeta-first") {
		t.Fatalf("replay prompt must not carry the replaced message: %q", prompt)
	}
	// A longer conversation: editing its first message again keeps nothing
	// before it either.
	say(t, s, pid, sess.ID, "c2", "gamma-second")
	d, err = s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: d.Messages[0].ID, SendRequest: SendRequest{ClientMessageID: "e2", Text: "delta-first"}}); err != nil {
		t.Fatal(err)
	}
	d = settled(t, s, pid, sess.ID)
	if got, want := texts(d), []string{"user:delta-first", "assistant:done"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("view after editing the first of several: %v", got)
	}
	r.mu.Lock()
	prompt = r.calls[len(r.calls)-1].Prompt
	r.mu.Unlock()
	if strings.Contains(prompt, "first\n") || strings.Contains(prompt, "gamma") {
		t.Fatalf("replay prompt must hold no earlier messages: %q", prompt)
	}
}

func TestRegenerateResendsTheSameText(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "regen")
	if err != nil {
		t.Fatal(err)
	}
	say(t, s, pid, sess.ID, "c1", "one")
	say(t, s, pid, sess.ID, "c2", "two")
	d, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	reply := d.Messages[3]
	if reply.Role != "assistant" {
		t.Fatalf("fixture: %+v", d.Messages)
	}
	accepted, err := s.Regenerate(ctx, pid, sess.ID, RegenerateRequest{MessageID: reply.ID, ClientMessageID: "r1"})
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Message.Text != "two" || accepted.Message.ID == d.Messages[2].ID {
		t.Fatalf("regenerate should resend the user text as a new message: %+v", accepted.Message)
	}
	d = settled(t, s, pid, sess.ID)
	if got, want := texts(d), []string{"user:one", "assistant:reply: one", "user:two", "assistant:reply: two"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("regenerated view: %v", got)
	}
	if d.Messages[2].ID != accepted.Message.ID || len(branchIDs(t, s, sess.ID)) != 1 {
		t.Fatalf("regenerate should run on a new branch: %+v", d.Messages)
	}
	// A user-message target regenerates that message.
	again, err := s.Regenerate(ctx, pid, sess.ID, RegenerateRequest{MessageID: d.Messages[0].ID, ClientMessageID: "r2"})
	if err != nil || again.Message.Text != "one" {
		t.Fatalf("regenerate a user message: %+v %v", again, err)
	}
	settled(t, s, pid, sess.ID)
}

func TestRestoreFilesRewindsTheFolder(t *testing.T) {
	r := newRewindRegistry()
	r.write = func(dir, prompt string) error {
		if lastLine(prompt) != "make files" {
			return nil
		}
		if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("made\n"), 0o644); err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dir, "keep.txt"), []byte("changed by the turn\n"), 0o644)
	}
	s, pid, project := checkpointFixture(t, r)
	realStore(t, s)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "restore")
	if err != nil {
		t.Fatal(err)
	}
	pre := folderState(t, project)
	turn := say(t, s, pid, sess.ID, "c1", "make files")
	post := folderState(t, project)
	if post["a.txt"] != "made\n" || reflect.DeepEqual(pre, post) {
		t.Fatalf("harness did not change the folder: %v", post)
	}
	if _, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "leave files alone"}}); err != nil {
		t.Fatal(err)
	}
	settled(t, s, pid, sess.ID)
	if got := folderState(t, project); !reflect.DeepEqual(got, pre) {
		t.Fatalf("folder should equal the pre-turn state:\n got %v\nwant %v", got, pre)
	}
	if _, err = s.UndoRestore(ctx, pid, sess.ID); err != nil {
		t.Fatal(err)
	}
	if got := folderState(t, project); !reflect.DeepEqual(got, post) {
		t.Fatalf("undo restore should bring the turn's files back:\n got %v\nwant %v", got, post)
	}
}

func TestRestoreOverwritesUserEditsAfterSafetySnapshot(t *testing.T) {
	r := newRewindRegistry()
	r.write = writeFromPrompt
	s, pid, project := checkpointFixture(t, r)
	realStore(t, s)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "hand edits")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, sess.ID, "c1", "write b.txt agent")
	keep := filepath.Join(project, "keep.txt")
	if err = os.WriteFile(keep, []byte("hand edit\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "nothing"}}); err != nil {
		t.Fatal(err)
	}
	settled(t, s, pid, sess.ID)
	if raw, _ := os.ReadFile(keep); string(raw) != "keep\n" {
		t.Fatalf("restore should overwrite the hand edit: %q", raw)
	}
	if _, err = os.Stat(filepath.Join(project, "b.txt")); !os.IsNotExist(err) {
		t.Fatalf("restore should remove the turn's file: %v", err)
	}
	if _, err = s.UndoRestore(ctx, pid, sess.ID); err != nil {
		t.Fatal(err)
	}
	if raw, _ := os.ReadFile(keep); string(raw) != "hand edit\n" {
		t.Fatalf("undo should recover the hand edit: %q", raw)
	}
	if raw, _ := os.ReadFile(filepath.Join(project, "b.txt")); string(raw) != "agent" {
		t.Fatalf("undo should recover the turn's file: %q", raw)
	}
}

func TestPartialRestoreAbortsBeforeBranching(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	store := &rewindStore{restoreRes: checkpoint.RestoreResult{Written: 1, Failed: []checkpoint.FileFailure{{Path: "locked.txt", Reason: "in use"}}}}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "partial")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, sess.ID, "c1", "one")
	before, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "uno"}})
	var restoreErr *RestoreError
	if !errors.As(err, &restoreErr) || len(restoreErr.Failed) != 1 || restoreErr.Failed[0].Path != "locked.txt" {
		t.Fatalf("partial restore should report its failures: %v", err)
	}
	if got := store.restored(); len(got) != 1 {
		t.Fatalf("one restore expected: %v", got)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_branches WHERE session_id=?`, sess.ID); n != 0 {
		t.Fatalf("no branch may be created: %d", n)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_branch_seed WHERE session_id=?`, sess.ID); n != 0 {
		t.Fatalf("no seed may be left: %d", n)
	}
	after, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(texts(before), texts(after)) || after.Session.Status != "idle" {
		t.Fatalf("conversation must be unchanged: %v -> %v (%s)", texts(before), texts(after), after.Session.Status)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_checkpoints WHERE session_id=? AND kind='safety'`, sess.ID); n != 1 {
		t.Fatalf("the safety checkpoint must be kept for undo: %d", n)
	}
	r.mu.Lock()
	sends := len(r.prompts)
	r.mu.Unlock()
	if sends != 1 {
		t.Fatalf("nothing may be resent: %d", sends)
	}
}

// otherConversationRunning starts a blocked turn in a second conversation of
// the same folder and returns its title and a release function.
func blockedSecondConversation(t *testing.T, s *Service, r *recordingRunner, pid string) (string, func()) {
	t.Helper()
	block := make(chan struct{})
	r.block = block
	other, err := s.Create(context.Background(), pid, "CODEX", "Busy neighbour")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(context.Background(), pid, other.ID, SendRequest{ClientMessageID: "o1", Text: "work"}); err != nil {
		t.Fatal(err)
	}
	var once sync.Once
	release := func() {
		once.Do(func() { close(block) })
		awaitSettled(t, s, pid, other.ID, 10*time.Second)
	}
	t.Cleanup(func() { once.Do(func() { close(block) }) })
	return other.Title, release
}

func assertRewindBusy(t *testing.T, s *Service, pid, id string, user, reply Message) {
	t.Helper()
	ctx := context.Background()
	if _, err := s.Edit(ctx, pid, id, EditRequest{MessageID: user.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "busy-e", Text: "x"}}); !errors.Is(err, ErrBusy) {
		t.Fatalf("edit should be busy: %v", err)
	}
	if _, err := s.Edit(ctx, pid, id, EditRequest{MessageID: user.ID, SendRequest: SendRequest{ClientMessageID: "busy-e2", Text: "x"}}); !errors.Is(err, ErrBusy) {
		t.Fatalf("conversation-only edit should be busy: %v", err)
	}
	if _, err := s.Regenerate(ctx, pid, id, RegenerateRequest{MessageID: reply.ID, ClientMessageID: "busy-r"}); !errors.Is(err, ErrBusy) {
		t.Fatalf("regenerate should be busy: %v", err)
	}
	if _, err := s.ActivateBranch(ctx, pid, id, id, false); !errors.Is(err, ErrBusy) {
		t.Fatalf("activate should be busy: %v", err)
	}
	if _, err := s.UndoRestore(ctx, pid, id); !errors.Is(err, ErrBusy) {
		t.Fatalf("undo restore should be busy: %v", err)
	}
}

func TestBlockedWhileAnotherConversationRunsInTheSameWorktree(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, _, pid, _ := fixture(t, r)
	store := &rewindStore{}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "CODEX", "Mine")
	if err != nil {
		t.Fatal(err)
	}
	say(t, s, pid, sess.ID, "c1", "one")
	d, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	title, release := blockedSecondConversation(t, s, r, pid)
	assertRewindBusy(t, s, pid, sess.ID, d.Messages[0], d.Messages[1])
	preview, err := s.PreviewRewind(ctx, pid, sess.ID, d.Messages[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(preview.BusyReason, title) {
		t.Fatalf("busy reason should name the other conversation %q: %q", title, preview.BusyReason)
	}
	if got := store.restored(); len(got) != 0 {
		t.Fatalf("nothing may be restored while busy: %v", got)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_branches`); n != 0 {
		t.Fatalf("no branch while busy: %d", n)
	}
	release()
	preview, err = s.PreviewRewind(ctx, pid, sess.ID, d.Messages[0].ID)
	if err != nil || preview.BusyReason != "" {
		t.Fatalf("not busy once the neighbour settles: %+v %v", preview, err)
	}
}

func TestEditAndRegenerateAreBusyWhileTheSessionRuns(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, _, pid, _ := fixture(t, r)
	s.SetCheckpointStore(&rewindStore{})
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "CODEX", "Running")
	if err != nil {
		t.Fatal(err)
	}
	say(t, s, pid, sess.ID, "c1", "one")
	d, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	block := make(chan struct{})
	r.block = block
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(block) }) })
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "c2", Text: "two"}); err != nil {
		t.Fatal(err)
	}
	assertRewindBusy(t, s, pid, sess.ID, d.Messages[0], d.Messages[1])
	preview, err := s.PreviewRewind(ctx, pid, sess.ID, d.Messages[0].ID)
	if err != nil || preview.BusyReason == "" {
		t.Fatalf("preview should say the conversation is busy: %+v %v", preview, err)
	}
	once.Do(func() { close(block) })
	settled(t, s, pid, sess.ID)
	if _, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: d.Messages[0].ID, SendRequest: SendRequest{ClientMessageID: "e1", Text: "uno"}}); err != nil {
		t.Fatalf("edit once idle: %v", err)
	}
	settled(t, s, pid, sess.ID)
}

func TestNativeBranchSeedsTranscriptAndResetsTheThread(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "seed")
	if err != nil {
		t.Fatal(err)
	}
	say(t, s, pid, sess.ID, "c1", "kept-one")
	second := say(t, s, pid, sess.ID, "c2", "dropped-two")
	if _, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: second.Message.ID, SendRequest: SendRequest{ClientMessageID: "e1", Text: "edited-two"}}); err != nil {
		t.Fatal(err)
	}
	settled(t, s, pid, sess.ID)
	say(t, s, pid, sess.ID, "c3", "after-edit")
	threads, _, prompts := r.snapshot()
	if len(threads) != 2 || threads[0] != "" || threads[1] != "" {
		t.Fatalf("the edit must start a fresh provider thread: %q", threads)
	}
	if len(prompts) != 4 {
		t.Fatalf("expected four turns: %q", prompts)
	}
	seeded := prompts[2]
	if !strings.HasPrefix(seeded, "The user edited an earlier message; your session restarts here.") ||
		!strings.Contains(seeded, "[user]\nkept-one") || !strings.Contains(seeded, "[assistant]\nreply: kept-one") ||
		strings.Contains(seeded, "dropped-two") || !strings.HasSuffix(seeded, "[user]\nedited-two") {
		t.Fatalf("seeded prompt: %q", seeded)
	}
	if prompts[3] != "after-edit" {
		t.Fatalf("the seed must be delivered once: %q", prompts[3])
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_branch_seed WHERE session_id=?`, sess.ID); n != 0 {
		t.Fatalf("seed should be cleared after the turn completes: %d", n)
	}
}

func TestMaestroEditIsConversationOnly(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, _, _, root := fixture(t, r)
	if err := s.ConfigureOrchestrator(filepath.Join(root, ".orchestra", "orchestrator"), []map[string]any{{"type": "function"}}, func(context.Context, string, map[string]any) map[string]any {
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	store := &rewindStore{}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, OrchestratorScope, "CODEX", "Maestro")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, OrchestratorScope, sess.ID, "c1", "plan")
	if _, err = s.Edit(ctx, OrchestratorScope, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "replan"}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("maestro file restore must be invalid: %v", err)
	}
	if _, err = s.ActivateBranch(ctx, OrchestratorScope, sess.ID, sess.ID, true); !errors.Is(err, ErrInvalid) {
		t.Fatalf("maestro activate with files must be invalid: %v", err)
	}
	preview, err := s.PreviewRewind(ctx, OrchestratorScope, sess.ID, turn.Message.ID)
	if err != nil || preview.FilesAvailable {
		t.Fatalf("maestro preview offers no files: %+v %v", preview, err)
	}
	if _, err = s.Edit(ctx, OrchestratorScope, sess.ID, EditRequest{MessageID: turn.Message.ID, SendRequest: SendRequest{ClientMessageID: "e1", Text: "replan"}}); err != nil {
		t.Fatal(err)
	}
	d := settled(t, s, OrchestratorScope, sess.ID)
	if got, want := texts(d), []string{"user:replan", "assistant:done"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("maestro edit view: %v", got)
	}
	if got := store.restored(); len(got) != 0 {
		t.Fatalf("maestro must never restore: %v", got)
	}
}

func TestRewindAfterHarnessOrAgentSwitch(t *testing.T) {
	r := newRewindRegistry()
	r.provider = agents.ProviderClaude
	s, pid, _ := checkpointFixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "switch")
	if err != nil {
		t.Fatal(err)
	}
	say(t, s, pid, sess.ID, "c1", "kept-one")
	second := say(t, s, pid, sess.ID, "c2", "dropped-two")
	if _, err = s.SwitchProvider(ctx, pid, sess.ID, SwitchProviderRequest{Provider: "claude", ExpectedProvider: "codex"}); err != nil {
		t.Fatal(err)
	}
	accepted, err := s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: second.Message.ID, SendRequest: SendRequest{ClientMessageID: "e1", Text: "edited-two"}})
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Message.Provider != string(agents.ProviderClaude) {
		t.Fatalf("the new branch runs on the current harness: %+v", accepted.Message)
	}
	d := settled(t, s, pid, sess.ID)
	threads, providers, prompts := r.snapshot()
	if len(threads) != 2 || threads[1] != "" || providers[1] != agents.ProviderClaude {
		t.Fatalf("the edit should start a fresh thread on the new harness: %q %q", threads, providers)
	}
	seeded := prompts[len(prompts)-1]
	if !strings.HasPrefix(seeded, "The user edited an earlier message") || strings.Contains(seeded, "dropped-two") || !strings.Contains(seeded, "[user]\nkept-one") {
		t.Fatalf("the branch seed should replace the handoff replay: %q", seeded)
	}
	if got, want := texts(d), []string{"user:kept-one", "assistant:reply: kept-one", "user:edited-two", "assistant:reply: edited-two"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("view: %v", got)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_handoffs WHERE session_id=?`, sess.ID); n != 0 {
		t.Fatalf("the handoff is delivered by the seeded turn: %d", n)
	}
}

func TestPreviewListsChangesAndUserEdits(t *testing.T) {
	r := newRewindRegistry()
	r.write = writeFromPrompt
	s, pid, project := checkpointFixture(t, r)
	store := realStore(t, s)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "preview")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, sess.ID, "c1", "write a.txt agent")
	if err = os.WriteFile(filepath.Join(project, "keep.txt"), []byte("hand edit\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	preview, err := s.PreviewRewind(ctx, pid, sess.ID, turn.Message.ID)
	if err != nil {
		t.Fatal(err)
	}
	before, ok, err := s.checkpointFor(ctx, sess.ID, turn.Message.ID, "before")
	if err != nil || !ok {
		t.Fatal("no before checkpoint", err)
	}
	want, err := store.Diff(ctx, project, before.TreeHash)
	if err != nil {
		t.Fatal(err)
	}
	sortChanges := func(c []checkpoint.Change) {
		sort.Slice(c, func(i, j int) bool { return c[i].Path < c[j].Path })
	}
	sortChanges(want)
	sortChanges(preview.Changes)
	if !preview.HasCheckpoint || !preview.FilesAvailable || preview.MessageID != turn.Message.ID || preview.BusyReason != "" {
		t.Fatalf("preview flags: %+v", preview)
	}
	if !reflect.DeepEqual(preview.Changes, want) || len(want) != 2 {
		t.Fatalf("changes should match Diff:\n got %+v\nwant %+v", preview.Changes, want)
	}
	if !reflect.DeepEqual(preview.ChangedSinceTurn, []string{"keep.txt"}) {
		t.Fatalf("only the hand edit changed since the turn: %v", preview.ChangedSinceTurn)
	}
	d, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	// The reply previews its user message's rewind.
	replyPreview, err := s.PreviewRewind(ctx, pid, sess.ID, d.Messages[1].ID)
	if err != nil || !replyPreview.HasCheckpoint || len(replyPreview.Changes) != 2 {
		t.Fatalf("reply preview: %+v %v", replyPreview, err)
	}
	// Read-only: nothing changed on disk or in the conversation.
	if raw, _ := os.ReadFile(filepath.Join(project, "keep.txt")); string(raw) != "hand edit\n" {
		t.Fatalf("preview must not touch files: %q", raw)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_checkpoints WHERE kind='safety'`); n != 0 {
		t.Fatalf("preview must not snapshot: %d", n)
	}
	// A message without a checkpoint previews as conversation-only.
	s.SetCheckpointStore(nil)
	plain := say(t, s, pid, sess.ID, "c2", "no checkpoint")
	none, err := s.PreviewRewind(ctx, pid, sess.ID, plain.Message.ID)
	if err != nil || none.HasCheckpoint || none.FilesAvailable {
		t.Fatalf("no-checkpoint preview: %+v %v", none, err)
	}
	if none.Changes == nil || none.ChangedSinceTurn == nil {
		t.Fatalf("lists must encode as []: %+v", none)
	}
}

func TestEditIsIdempotentOnClientMessageID(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	store := &rewindStore{}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "idempotent")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, sess.ID, "c1", "one")
	req := EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "uno"}}
	first, err := s.Edit(ctx, pid, sess.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	settled(t, s, pid, sess.ID)
	// Switch away so the retried edit's message is not on the active branch.
	if _, err = s.ActivateBranch(ctx, pid, sess.ID, sess.ID, false); err != nil {
		t.Fatal(err)
	}
	again, err := s.Edit(ctx, pid, sess.ID, req)
	if err != nil || again.Message.ID != first.Message.ID {
		t.Fatalf("retry should return the first acceptance: %+v %v", again, err)
	}
	if _, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, SendRequest: SendRequest{ClientMessageID: "e1", Text: "different"}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a reused client id with other text is invalid: %v", err)
	}
	regen, err := s.Regenerate(ctx, pid, sess.ID, RegenerateRequest{MessageID: turn.Message.ID, ClientMessageID: "r1"})
	if err != nil {
		t.Fatal(err)
	}
	settled(t, s, pid, sess.ID)
	regenAgain, err := s.Regenerate(ctx, pid, sess.ID, RegenerateRequest{MessageID: turn.Message.ID, ClientMessageID: "r1"})
	if err != nil || regenAgain.Message.ID != regen.Message.ID {
		t.Fatalf("regenerate retry: %+v %v", regenAgain, err)
	}
	if got := branchIDs(t, s, sess.ID); len(got) != 2 {
		t.Fatalf("retries must not branch again: %v", got)
	}
	if got := store.restored(); len(got) != 1 {
		t.Fatalf("retries must not restore again: %v", got)
	}
}

func TestSendFailureAfterBranchCreationRollsBackTheBranch(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "rollback")
	if err != nil {
		t.Fatal(err)
	}
	say(t, s, pid, sess.ID, "c1", "one")
	second := say(t, s, pid, sess.ID, "c2", "two")
	before, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	maxTurns := 3
	// send rejects max turns only after its own checks, past branch creation.
	_, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: second.Message.ID, SendRequest: SendRequest{ClientMessageID: "e1", Text: "deux", RequestedMaxTurns: &maxTurns}})
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("send failure should surface: %v", err)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_branches WHERE session_id=?`, sess.ID); n != 0 {
		t.Fatalf("the empty branch must be removed: %d", n)
	}
	active, err := s.activeBranchID(ctx, sess.ID)
	if err != nil || active != sess.ID {
		t.Fatalf("the previous branch must be active again: %q %v", active, err)
	}
	after, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(texts(before), texts(after)) {
		t.Fatalf("conversation must be unchanged: %v", texts(after))
	}
	// The provider thread was already reset, so the next turn on the restored
	// branch is seeded with its whole history, and then the seed is spent.
	say(t, s, pid, sess.ID, "c3", "three")
	threads, _, prompts := r.snapshot()
	if len(threads) != 2 || threads[1] != "" {
		t.Fatalf("the next turn starts a fresh thread: %q", threads)
	}
	last := prompts[len(prompts)-1]
	if !strings.HasPrefix(last, branchHeader) || !strings.Contains(last, "[user]\ntwo") || !strings.HasSuffix(last, "[user]\nthree") {
		t.Fatalf("the next turn must be seeded with the kept history: %q", last)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_branch_seed WHERE session_id=?`, sess.ID); n != 0 {
		t.Fatalf("the seed is spent by the completed turn: %d", n)
	}
}

func TestActivateBranchRestoresThatBranchesFiles(t *testing.T) {
	r := newRewindRegistry()
	r.write = writeFromPrompt
	s, pid, project := checkpointFixture(t, r)
	realStore(t, s)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "activate")
	if err != nil {
		t.Fatal(err)
	}
	say(t, s, pid, sess.ID, "c1", "write base.txt base")
	turn := say(t, s, pid, sess.ID, "c2", "write a.txt main")
	if _, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "write a.txt branch"}}); err != nil {
		t.Fatal(err)
	}
	settled(t, s, pid, sess.ID)
	read := func() string {
		raw, err := os.ReadFile(filepath.Join(project, "a.txt"))
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}
	if read() != "branch" {
		t.Fatalf("branch turn should have written a.txt: %q", read())
	}
	branch := branchIDs(t, s, sess.ID)[0]
	d, err := s.ActivateBranch(ctx, pid, sess.ID, sess.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if read() != "main" || d.Messages[2].Text != "write a.txt main" {
		t.Fatalf("main's files and view: %q %v", read(), texts(d))
	}
	if d, err = s.ActivateBranch(ctx, pid, sess.ID, branch, true); err != nil {
		t.Fatal(err)
	}
	if read() != "branch" || d.Messages[2].Text != "write a.txt branch" {
		t.Fatalf("branch's files and view: %q %v", read(), texts(d))
	}
	// Undo puts back what the folder held before the last switch.
	if _, err = s.UndoRestore(ctx, pid, sess.ID); err != nil {
		t.Fatal(err)
	}
	if read() != "main" {
		t.Fatalf("undo after a switch: %q", read())
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_branch_seed WHERE session_id=?`, sess.ID); n != 1 {
		t.Fatalf("switching must reseed the provider thread: %d", n)
	}
	if _, err = s.ActivateBranch(ctx, pid, sess.ID, "no-such-branch", false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown branch: %v", err)
	}
}

func TestUndoRestoreNeedsASafetyCheckpoint(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	store := &rewindStore{}
	s.SetCheckpointStore(store)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "undo")
	if err != nil {
		t.Fatal(err)
	}
	turn := say(t, s, pid, sess.ID, "c1", "one")
	if _, err = s.UndoRestore(ctx, pid, sess.ID); !errors.Is(err, ErrCheckpointUnavailable) {
		t.Fatalf("undo without a safety checkpoint: %v", err)
	}
	if _, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "uno"}}); err != nil {
		t.Fatal(err)
	}
	settled(t, s, pid, sess.ID)
	var safety string
	if err = s.db.QueryRow(`SELECT tree_hash FROM workspace_chat_checkpoints WHERE session_id=? AND kind='safety'`, sess.ID).Scan(&safety); err != nil {
		t.Fatal(err)
	}
	if _, err = s.UndoRestore(ctx, pid, sess.ID); err != nil {
		t.Fatal(err)
	}
	if got := store.restored(); len(got) != 2 || got[1] != safety {
		t.Fatalf("undo should restore the safety tree %s: %v", safety, got)
	}
	if _, err = s.UndoRestore(ctx, pid, sess.ID); !errors.Is(err, ErrCheckpointUnavailable) {
		t.Fatalf("undo twice: %v", err)
	}
}

func TestRestoreWithoutASafetyCheckpointAborts(t *testing.T) {
	r := newRewindRegistry()
	s, pid, _ := checkpointFixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "no safety")
	if err != nil {
		t.Fatal(err)
	}
	unchecked := say(t, s, pid, sess.ID, "c1", "before the store")
	store := &rewindStore{}
	s.SetCheckpointStore(store)
	if _, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: unchecked.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e1", Text: "x"}}); !errors.Is(err, ErrCheckpointUnavailable) {
		t.Fatalf("a message without a before checkpoint cannot restore files: %v", err)
	}
	turn := say(t, s, pid, sess.ID, "c2", "two")
	store.failSnapshots(errors.New("disk full"))
	_, err = s.Edit(ctx, pid, sess.ID, EditRequest{MessageID: turn.Message.ID, RestoreFiles: true, SendRequest: SendRequest{ClientMessageID: "e2", Text: "deux"}})
	if err == nil || !errors.Is(err, ErrCheckpointUnavailable) {
		t.Fatalf("a failed safety snapshot must abort: %v", err)
	}
	if got := store.restored(); len(got) != 0 {
		t.Fatalf("never restore without a safety net: %v", got)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_checkpoints WHERE session_id=? AND kind='safety'`, sess.ID); n != 0 {
		t.Fatalf("no safety row: %d", n)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM workspace_chat_branches WHERE session_id=?`, sess.ID); n != 0 {
		t.Fatalf("no branch: %d", n)
	}
}

func TestBranchTranscriptHeader(t *testing.T) {
	got := branchTranscript([]Message{{Role: "user", Text: "hi", Status: "completed"}}, "next", maxText)
	if !strings.HasPrefix(got, "The user edited an earlier message; your session restarts here. The conversation before that point follows as context. Work only in the selected project.\n") || !strings.Contains(got, "[user]\nhi") || !strings.HasSuffix(got, "[user]\nnext") {
		t.Fatal(got)
	}
}
