package workspacechat

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"testing"
)

func TestLateUsagePersistsWhileIdleAndAcrossRestartWithoutAnotherTurn(t *testing.T) {
	s, database, r, pid := nativeFixture(t)
	ctx := context.Background()
	sess, e := s.Create(ctx, pid, "codex", "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "first", Text: "hello"}); e != nil {
		t.Fatal(e)
	}
	before := awaitIdle(t, s, pid, sess.ID)
	r.mu.Lock()
	n := r.native
	r.mu.Unlock()
	usage := agents.NativeEvent{Type: "thread/tokenUsage/updated", ThreadID: "provider-thread", TurnID: "turn", Usage: &agents.NativeUsage{Total: agents.TokenUsage{InputTokens: 700, OutputTokens: 10, TotalTokens: 710}}, Payload: json.RawMessage(`{"threadId":"provider-thread","turnId":"turn","tokenUsage":{"total":{"inputTokens":700,"outputTokens":10,"totalTokens":710}}}`)}
	n.handler(usage)
	delta, e := s.DetailAfter(ctx, pid, sess.ID, before.Cursor)
	if e != nil || delta.Session.Status != "idle" || len(delta.Messages) != 2 || len(delta.Events) != 1 || delta.Events[0].Type != "thread/tokenUsage/updated" || delta.Events[0].TurnID != "turn" || delta.Events[0].Usage.Total.TotalTokens != 710 {
		t.Fatal(delta, e)
	}
	wrong := usage
	wrong.ThreadID = "another-thread"
	n.handler(wrong)
	after, e := s.Detail(ctx, pid, sess.ID)
	if e != nil || after.Cursor != delta.Cursor || len(after.Events) != len(before.Events)+1 {
		t.Fatal(after, e)
	}
	s.Close()
	restored, e := New(database, r, s.roots)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.Close()
	after, e = restored.Detail(ctx, pid, sess.ID)
	if e != nil || after.Session.Status != "idle" || after.Events[len(after.Events)-1].Usage.Total.TotalTokens != 710 || after.Events[len(after.Events)-1].TurnID != "turn" {
		t.Fatal(after, e)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.starts) != 1 {
		t.Fatal(r.starts)
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.texts) != 1 {
		t.Fatal(n.texts)
	}
}

func TestLateRuntimeRequestsCannotBecomeAnswerableAfterCompletion(t *testing.T) {
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
	r.mu.Lock()
	n := r.native
	r.mu.Unlock()
	n.handler(agents.NativeEvent{Type: "turn/completed", ThreadID: "provider-thread", TurnID: "turn", Payload: json.RawMessage(`{"threadId":"provider-thread","turn":{"id":"turn","status":"completed"}}`)})
	// A later turn may already own the checkout when an older request callback arrives.
	if _, e = database.Exec(`UPDATE workspace_chat_sessions SET status='running' WHERE id=?`, sess.ID); e != nil {
		t.Fatal(e)
	}
	n.handler(agents.NativeEvent{Type: "server_request", ThreadID: "provider-thread", TurnID: "turn", RequestID: "100", Payload: json.RawMessage(`{"method":"item/commandExecution/requestApproval","params":{"command":"git status"}}`)})
	d, e := s.Detail(ctx, pid, sess.ID)
	if e != nil || len(d.Requests) != 1 || d.Requests[0].Status != "stale" {
		t.Fatal(d, e)
	}
	if _, e = s.Reply(ctx, pid, sess.ID, d.Requests[0].ID, ReplyRequest{ClientResponseID: "reply", Answer: json.RawMessage(`{"decision":"accept"}`)}); !errors.Is(e, ErrBusy) {
		t.Fatal(e)
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.replies != 0 {
		t.Fatal(n.replies)
	}
}
