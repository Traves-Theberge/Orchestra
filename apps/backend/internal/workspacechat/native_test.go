package workspacechat

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type fakeNativeRegistry struct {
	mu       sync.Mutex
	starts   []string
	native   *fakeNative
	provider agents.Provider
}

func (r *fakeNativeRegistry) HasProvider(agents.Provider) bool { return true }
func (r *fakeNativeRegistry) ValidateTurnOptions(agents.Provider, agents.TurnRequest) error {
	return nil
}
func (r *fakeNativeRegistry) RunTurn(context.Context, agents.Provider, agents.TurnRequest, agents.EventHandler) (agents.TurnResult, error) {
	panic("native must not replay")
}
func (r *fakeNativeRegistry) SupportsNativeSession(p agents.Provider) bool {
	return p == agents.ProviderCodex || p == r.provider
}
func (r *fakeNativeRegistry) StartNativeSession(_ context.Context, _ agents.Provider, _ agents.TurnRequest, id string, h agents.NativeEventHandler) (agents.NativeSession, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.starts = append(r.starts, id)
	r.native = &fakeNative{handler: h}
	return r.native, nil
}

type fakeNative struct {
	mu          sync.Mutex
	handler     agents.NativeEventHandler
	texts       []string
	options     []agents.NativeTurnOptions
	replies     int
	approval    bool
	reply       chan struct{}
	interrupted chan struct{}
	once        sync.Once
}

func (n *fakeNative) ThreadID() string { return "provider-thread" }
func (n *fakeNative) ModelInfo() agents.NativeModelInfo {
	return agents.NativeModelInfo{Model: "observed-model", ApprovalPolicy: "on-request", SandboxMode: "workspace-write"}
}
func (n *fakeNative) SendTurnWithOptions(ctx context.Context, text string, options agents.NativeTurnOptions) (agents.NativeTurnResult, error) {
	n.mu.Lock()
	n.options = append(n.options, options)
	n.mu.Unlock()
	return n.SendTurn(ctx, text, options.Model)
}
func (n *fakeNative) SendTurn(ctx context.Context, text, model string) (agents.NativeTurnResult, error) {
	n.mu.Lock()
	n.texts = append(n.texts, text)
	approval := n.approval
	n.mu.Unlock()
	n.handler(agents.NativeEvent{Type: "item/agentMessage/delta", ThreadID: n.ThreadID(), TurnID: "turn", ItemID: "item", Delta: "hello"})
	if approval {
		n.handler(agents.NativeEvent{Type: "server_request", ThreadID: n.ThreadID(), TurnID: "turn", RequestID: "100", Payload: json.RawMessage(`{"method":"item/commandExecution/requestApproval","params":{"command":"git status"}}`)})
		select {
		case <-n.reply:
		case <-n.interrupted:
			return agents.NativeTurnResult{Status: "interrupted"}, nil
		case <-ctx.Done():
			return agents.NativeTurnResult{}, ctx.Err()
		}
	}
	return agents.NativeTurnResult{TurnID: "turn", Status: "completed", Text: "hello", Model: "observed-model"}, nil
}
func (n *fakeNative) RespondRequest(_ context.Context, id string, _ json.RawMessage) error {
	if id != "100" {
		return errors.New("wire identity changed")
	}
	n.mu.Lock()
	n.replies++
	n.mu.Unlock()
	n.once.Do(func() { close(n.reply) })
	return nil
}
func (n *fakeNative) Interrupt(context.Context) error {
	n.once.Do(func() { close(n.interrupted) })
	return nil
}
func (n *fakeNative) Close() error { return nil }
func nativeFixture(t *testing.T) (*Service, *db.DB, *fakeNativeRegistry, string) {
	t.Helper()
	root := t.TempDir()
	database, e := db.Connect(filepath.Join(root, "chat.db"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { database.Close() })
	pid, e := database.UpsertProject(context.Background(), root, "")
	if e != nil {
		t.Fatal(e)
	}
	r := &fakeNativeRegistry{}
	s, e := New(database, r, []string{root})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.Close)
	return s, database, r, pid
}
func TestNativeThreadPersistenceAndNoReplay(t *testing.T) {
	s, database, r, pid := nativeFixture(t)
	ctx := context.Background()
	sess, e := s.Create(ctx, pid, "codex", "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "first", Text: "one", RequestedModel: "requested"}); e != nil {
		t.Fatal(e)
	}
	d := awaitIdle(t, s, pid, sess.ID)
	if d.Session.ProviderThreadID != "provider-thread" || d.Session.EffectiveModel != "observed-model" || len(d.Events) != 1 {
		t.Fatal(d)
	}
	if _, e = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "second", Text: "two"}); e != nil {
		t.Fatal(e)
	}
	awaitIdle(t, s, pid, sess.ID)
	if _, e = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "first", Text: "one", RequestedModel: "requested"}); e != nil {
		t.Fatal(e)
	}
	r.mu.Lock()
	if len(r.starts) != 1 {
		t.Fatal(r.starts)
	}
	n := r.native
	r.mu.Unlock()
	n.mu.Lock()
	if len(n.texts) != 2 || n.texts[0] != "one" || n.texts[1] != "two" {
		t.Fatal(n.texts)
	}
	n.mu.Unlock()
	s.Close()
	restored, e := New(database, r, s.roots)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.Close()
	if _, e = restored.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "third", Text: "three"}); e != nil {
		t.Fatal(e)
	}
	awaitIdle(t, restored, pid, sess.ID)
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.starts) != 2 || r.starts[1] != "provider-thread" {
		t.Fatal(r.starts)
	}
}
func TestNativeRequestReceiptAndStaleScope(t *testing.T) {
	s, _, r, pid := nativeFixture(t)
	ctx := context.Background()
	sess, e := s.Create(ctx, pid, "codex", "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "first", Text: "warmup"}); e != nil {
		t.Fatal(e)
	}
	awaitIdle(t, s, pid, sess.ID)
	r.mu.Lock()
	n := r.native
	r.mu.Unlock()
	n.mu.Lock()
	n.approval = true
	n.reply = make(chan struct{})
	n.interrupted = make(chan struct{})
	n.mu.Unlock()
	if _, e = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "second", Text: "tool"}); e != nil {
		t.Fatal(e)
	}
	var d Detail
	for i := 0; i < 500; i++ {
		d, e = s.Detail(ctx, pid, sess.ID)
		if e != nil {
			t.Fatal(e)
		}
		if len(d.Requests) > 0 {
			break
		}
		time.Sleep(time.Millisecond)
		select {
		case <-ctx.Done():
		default:
		}
	}
	if len(d.Requests) != 1 {
		t.Fatal(d)
	}
	id := d.Requests[0].ID
	req := ReplyRequest{ClientResponseID: "reply", Answer: json.RawMessage(`{"decision":"accept"}`)}
	if _, e = s.Reply(ctx, pid, "wrong", id, req); !errors.Is(e, ErrNotFound) {
		t.Fatal(e)
	}
	if _, e = s.Reply(ctx, pid, sess.ID, id, ReplyRequest{ClientResponseID: "bad", Answer: json.RawMessage(`{"decision":"anything"}`)}); !errors.Is(e, ErrInvalid) {
		t.Fatal(e)
	}
	receipt, e := s.Reply(ctx, pid, sess.ID, id, req)
	if e != nil || receipt.Status != "answered" {
		t.Fatal(receipt, e)
	}
	if _, e = s.Reply(ctx, pid, sess.ID, id, req); e != nil {
		t.Fatal(e)
	}
	awaitIdle(t, s, pid, sess.ID)
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.replies != 1 {
		t.Fatal(n.replies)
	}
}

func TestNativeQuestionScopeAndCursor(t *testing.T) {
	r := RuntimeRequest{Method: "item/tool/requestUserInput", Params: json.RawMessage(`{"questions":[{"id":"choice"}]}`)}
	for _, raw := range []string{`{"answers":{"wrong":{"answers":["x"]}}}`, `{"answers":{"choice":{"answers":[]}}}`, `{"answers":{"choice":{"answers":["x"]}},"extra":true}`} {
		if !errors.Is(validateReply(r, json.RawMessage(raw)), ErrInvalid) {
			t.Fatal(raw)
		}
	}
	if err := validateReply(r, json.RawMessage(`{"answers":{"choice":{"answers":["x"]}}}`)); err != nil {
		t.Fatal(err)
	}
	s, _, _, pid := nativeFixture(t)
	ctx := context.Background()
	sess, e := s.Create(ctx, pid, "codex", "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "x", Text: "hello"}); e != nil {
		t.Fatal(e)
	}
	d := awaitIdle(t, s, pid, sess.ID)
	delta, e := s.DetailAfter(ctx, pid, sess.ID, d.Cursor)
	if e != nil || len(delta.Events) != 0 || delta.Cursor != d.Cursor || len(delta.Messages) != 2 {
		t.Fatal(delta, e)
	}
}

func TestNativeRestartPreservesUnknownRequestAndNeverResends(t *testing.T) {
	s, database, r, pid := nativeFixture(t)
	ctx := context.Background()
	sess, e := s.Create(ctx, pid, "codex", "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "first", Text: "hello"}); e != nil {
		t.Fatal(e)
	}
	awaitIdle(t, s, pid, sess.ID)
	s.Close()
	_, e = database.Exec(`UPDATE workspace_chat_sessions SET status='running' WHERE id=?; INSERT INTO workspace_chat_requests(session_id,id,turn_id,method,params,status,answer,client_response_id,created_at) VALUES(?,'old:100','turn','item/commandExecution/requestApproval','{}','sending','{"decision":"accept"}','reply',?)`, sess.ID, sess.ID, stamp())
	if e != nil {
		t.Fatal(e)
	}
	restored, e := New(database, r, s.roots)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.Close()
	d, e := restored.Detail(ctx, pid, sess.ID)
	if e != nil || d.Session.Status != "interrupted" || len(d.Requests) != 1 || d.Requests[0].Status != "unknown" {
		t.Fatal(d, e)
	}
	receipt, e := restored.Reply(ctx, pid, sess.ID, "old:100", ReplyRequest{ClientResponseID: "reply", Answer: json.RawMessage(`{"decision":"accept"}`)})
	if e != nil || receipt.Status != "unknown" {
		t.Fatal(receipt, e)
	}
	if _, e = restored.Reply(ctx, pid, sess.ID, "old:100", ReplyRequest{ClientResponseID: "different", Answer: json.RawMessage(`{"decision":"accept"}`)}); !errors.Is(e, ErrBusy) {
		t.Fatal(e)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.starts) != 1 {
		t.Fatal(r.starts)
	}
}
