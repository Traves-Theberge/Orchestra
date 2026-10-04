package workspacechat

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

type recordingRunner struct {
	mu      sync.Mutex
	calls   []agents.TurnRequest
	block   chan struct{}
	started chan struct{}
	output  string
}

func (r *recordingRunner) RunTurn(ctx context.Context, req agents.TurnRequest, _ agents.EventHandler) (agents.TurnResult, error) {
	r.mu.Lock()
	r.calls = append(r.calls, req)
	r.mu.Unlock()
	if r.started != nil {
		select {
		case r.started <- struct{}{}:
		default:
		}
	}
	if r.block != nil {
		select {
		case <-r.block:
		case <-ctx.Done():
			return agents.TurnResult{}, ctx.Err()
		}
	}
	return agents.TurnResult{Output: r.output}, nil
}
func fixture(t *testing.T, r *recordingRunner) (*Service, *db.DB, string, string) {
	t.Helper()
	root := t.TempDir()
	repo := filepath.Join(root, "project")
	if err := os.Mkdir(repo, 0755); err != nil {
		t.Fatal(err)
	}
	database, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	pid, err := database.UpsertProject(context.Background(), repo, "")
	if err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(nil)
	registry.SetRunner(agents.ProviderCodex, r)
	svc, err := New(database, registry, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(svc.Close)
	return svc, database, pid, repo
}
func awaitIdle(t *testing.T, s *Service, pid, id string) Detail {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		d, e := s.Detail(context.Background(), pid, id)
		if e != nil {
			t.Fatal(e)
		}
		if d.Session.Status != "running" && d.Session.Status != "stopping" {
			return d
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("turn did not settle")
	return Detail{}
}
func TestWorkspaceChatScopeHistoryAndReplay(t *testing.T) {
	r := &recordingRunner{output: `{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}`}
	s, database, pid, repo := fixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	if sess.ConversationMode != Mode {
		t.Fatal(sess)
	}
	other := filepath.Join(filepath.Dir(repo), "other")
	os.Mkdir(other, 0755)
	otherID, _ := database.UpsertProject(ctx, other, "")
	if _, err = s.Detail(ctx, otherID, sess.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross project: %v", err)
	}
	accepted, err := s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "first", Text: "Say hello"})
	if err != nil {
		t.Fatal(err)
	}
	d := awaitIdle(t, s, pid, sess.ID)
	if len(d.Messages) != 2 || d.Messages[1].Text != "Hello" {
		t.Fatalf("history: %#v", d)
	}
	again, err := s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "first", Text: "Say hello"})
	if err != nil || again.Message.ID != accepted.Message.ID {
		t.Fatalf("replay: %#v %v", again, err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "first", Text: "Different"}); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "next", Text: "Continue"}); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, s, pid, sess.ID)
	r.mu.Lock()
	defer r.mu.Unlock()
	repo, err = filepath.EvalSymlinks(repo)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.calls) != 2 || r.calls[0].Workspace != repo || r.calls[0].WorkspaceRoot != repo || !r.calls[0].ProjectRootWorkspace || !strings.Contains(r.calls[1].Prompt, "Hello") || r.calls[0].SessionID == r.calls[1].SessionID {
		t.Fatalf("dispatch: %#v", r.calls)
	}
}

func TestWorkspaceChatRegisteredHarnessCatalogAndDispatch(t *testing.T) {
	svc, _, pid, _ := fixture(t, &recordingRunner{})
	runner := &recordingRunner{output: "registered harness response"}
	svc.registry.(*agents.Registry).SetRunner(agents.Provider8gent, runner)
	providers, err := svc.Providers(context.Background(), pid)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, provider := range providers {
		if provider.ID == string(agents.Provider8gent) {
			found = true
			if !provider.Enabled || provider.ConversationMode != Mode || provider.ProviderResume {
				t.Fatalf("unexpected capabilities: %+v", provider)
			}
		}
	}
	if !found {
		t.Fatal("registered harness missing from catalog")
	}
	session, err := svc.Create(context.Background(), pid, "8gent", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Send(context.Background(), pid, session.ID, SendRequest{ClientMessageID: "registered-harness-message", Text: "use this harness"}); err != nil {
		t.Fatal(err)
	}
	detail := awaitIdle(t, svc, pid, session.ID)
	if detail.Session.Provider != "8GENT" || len(detail.Messages) != 2 || detail.Messages[1].Text != runner.output {
		t.Fatalf("unexpected result: %+v", detail)
	}
}
func TestWorkspaceChatCapabilityBusyCancelAndFiles(t *testing.T) {
	r := &recordingRunner{block: make(chan struct{}), started: make(chan struct{}, 1)}
	s, _, pid, repo := fixture(t, r)
	ctx := context.Background()
	marker := filepath.Join(repo, "keep.txt")
	os.WriteFile(marker, []byte("retained"), 0644)
	sess, err := s.Create(ctx, pid, "CODEX", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "unsupported", Text: "hi", RequestedModel: "not-supported"}); !errors.Is(err, ErrUnsupported) {
		t.Fatal(err)
	}
	d, _ := s.Detail(ctx, pid, sess.ID)
	if len(d.Messages) != 0 {
		t.Fatal("unsupported request persisted")
	}
	if _, err = s.Create(ctx, pid, "GEMINI", ""); !errors.Is(err, ErrUnsupported) {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "first", Text: "hi"}); err != nil {
		t.Fatal(err)
	}
	<-r.started
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "second", Text: "hi"}); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	if _, err = s.Stop(ctx, pid, sess.ID); err != nil {
		t.Fatal(err)
	}
	d = awaitIdle(t, s, pid, sess.ID)
	if d.Session.Status != "interrupted" || d.Messages[0].Status != "cancelled" {
		t.Fatal(d)
	}
	if b, err := os.ReadFile(marker); err != nil || string(b) != "retained" {
		t.Fatalf("file changed: %q %v", b, err)
	}
}
func TestWorkspaceChatRestartUnknownAndPathAuthority(t *testing.T) {
	r := &recordingRunner{}
	s, database, pid, repo := fixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "CODEX", "")
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec(`UPDATE workspace_chat_sessions SET status='running' WHERE id=?`, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "busy-without-process", Text: "do not duplicate"}); !errors.Is(err, ErrBusy) {
		t.Fatalf("persisted running was not blocked: %v", err)
	}
	_, err = database.Exec(`INSERT INTO workspace_chat_messages(id,session_id,role,text,status,client_message_id,created_at) VALUES('old',?,'user','uncertain','accepted','old-key','now')`, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := New(database, s.registry, s.roots)
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.Close()
	d, err := recovered.Detail(ctx, pid, sess.ID)
	if err != nil || d.Session.Status != "interrupted" || d.Messages[0].Status != "unknown" {
		t.Fatalf("recovery: %#v %v", d, err)
	}
	if _, err = recovered.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "old-key", Text: "uncertain"}); err != nil {
		t.Fatal(err)
	}
	r.mu.Lock()
	if len(r.calls) != 0 {
		t.Fatal("restart dispatched unknown message")
	}
	r.mu.Unlock()
	outside := t.TempDir()
	database.Exec(`UPDATE projects SET root_path=? WHERE id=?`, outside, pid)
	if _, err = recovered.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "new", Text: "go"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("escaped root: %v (%s)", err, repo)
	}
}
func TestWorkspaceChatAssistantOutput(t *testing.T) {
	for _, tc := range []struct{ raw, want string }{{`{"jsonrpc":"2.0","result":{"thread":{"id":"secret"}}}`, ""}, {`{"method":"item/completed","params":{"item":{"type":"agentMessage","text":"Done"}}}`, "Done"}, {"{\"type\":\"assistant\",\"message\":\"partial\"}\n{\"result\":\"complete\"}", "complete"}} {
		if got := assistantText(tc.raw); got != tc.want {
			t.Fatalf("%q != %q", got, tc.want)
		}
	}
}

func TestWorkspaceChatPersistenceFailureFailsClosed(t *testing.T) {
	r := &recordingRunner{output: `{"result":"done"}`}
	s, database, pid, _ := fixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "CODEX", "")
	if err != nil {
		t.Fatal(err)
	}
	// Terminal projection cannot commit; no successful assistant row or delivery
	// completion should leak out of the rolled-back transaction.
	_, err = database.Exec(`CREATE TRIGGER reject_chat_completion BEFORE UPDATE ON workspace_chat_sessions WHEN NEW.status='idle' BEGIN SELECT RAISE(ABORT,'fixture persistence error'); END;`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "one", Text: "go"}); err != nil {
		t.Fatal(err)
	}
	d := awaitIdle(t, s, pid, sess.ID)
	if d.Session.Status != "interrupted" || len(d.Messages) != 1 || d.Messages[0].Status != "unknown" {
		t.Fatalf("persistence recovery %#v", d)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "one", Text: "go"}); err != nil {
		t.Fatal(err)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.calls) != 1 {
		t.Fatal("unknown request replay dispatched")
	}
}

func TestWorkspaceChatProjectOwnership(t *testing.T) {
	r := &recordingRunner{block: make(chan struct{}), started: make(chan struct{}, 2)}
	s, database, pid, repo := fixture(t, r)
	ctx := context.Background()
	first, err := s.Create(ctx, pid, "CODEX", "First")
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Create(ctx, pid, "CODEX", "Second")
	if err != nil {
		t.Fatal(err)
	}
	original, err := s.Send(ctx, pid, first.ID, SendRequest{ClientMessageID: "one", Text: "go"})
	if err != nil {
		t.Fatal(err)
	}
	<-r.started
	if _, err = s.Send(ctx, pid, second.ID, SendRequest{ClientMessageID: "two", Text: "concurrent"}); !errors.Is(err, ErrBusy) {
		t.Fatalf("same checkout dispatched concurrently: %v", err)
	}
	duplicate, err := s.Send(ctx, pid, first.ID, SendRequest{ClientMessageID: "one", Text: "go"})
	if err != nil || duplicate.Message.ID != original.Message.ID {
		t.Fatalf("duplicate receipt blocked by ownership: %#v %v", duplicate, err)
	}
	other := filepath.Join(filepath.Dir(repo), "other")
	if err = os.Mkdir(other, 0755); err != nil {
		t.Fatal(err)
	}
	otherPID, err := database.UpsertProject(ctx, other, "")
	if err != nil {
		t.Fatal(err)
	}
	independent, err := s.Create(ctx, otherPID, "CODEX", "Independent")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, otherPID, independent.ID, SendRequest{ClientMessageID: "three", Text: "independent"}); err != nil {
		t.Fatalf("different checkout blocked: %v", err)
	}
	<-r.started
	if _, err = s.Stop(ctx, pid, first.ID); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, s, pid, first.ID)
	// A stale durable owner still blocks another session even without a local process.
	if _, err = database.Exec(`UPDATE workspace_chat_sessions SET status='running' WHERE id=?`, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, second.ID, SendRequest{ClientMessageID: "four", Text: "stale owner"}); !errors.Is(err, ErrBusy) {
		t.Fatalf("persisted project ownership ignored: %v", err)
	}
	if _, err = s.Stop(ctx, otherPID, independent.ID); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, s, otherPID, independent.ID)
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.calls) != 2 {
		t.Fatalf("unexpected dispatch count: %d", len(r.calls))
	}
}
