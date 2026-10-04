package workspacechat

import (
	"context"
	"errors"
	"testing"
)

func TestRequestedEffortValidationPersistenceAndReplay(t *testing.T) {
	old, database, native, pid := nativeFixture(t)
	old.Close()
	r := &fixtureModelRegistry{fakeNativeRegistry: native}
	s, e := New(database, r, old.roots)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	ctx := context.Background()
	sess, e := s.Create(ctx, pid, "codex", "")
	if e != nil {
		t.Fatal(e)
	}
	for _, req := range []SendRequest{{ClientMessageID: "missing-model", Text: "x", RequestedReasoningEffort: "low"}, {ClientMessageID: "unsupported", Text: "x", RequestedModel: "model-name", RequestedReasoningEffort: "unadvertised"}, {ClientMessageID: "bad-model", Text: "x", RequestedModel: "unknown", RequestedReasoningEffort: "low"}} {
		if _, e = s.Send(ctx, pid, sess.ID, req); !errors.Is(e, ErrUnsupported) {
			t.Fatal(req, e)
		}
	}
	d, e := s.Detail(ctx, pid, sess.ID)
	if e != nil || len(d.Messages) != 0 || d.Session.Status != "idle" || d.Session.RequestedReasoningEffort != "" || len(native.starts) != 0 {
		t.Fatal(d, e, native.starts)
	}
	req := SendRequest{ClientMessageID: "valid", Text: "x", RequestedModel: "model-name", RequestedReasoningEffort: "low"}
	if _, e = s.Send(ctx, pid, sess.ID, req); e != nil {
		t.Fatal(e)
	}
	d = awaitIdle(t, s, pid, sess.ID)
	if d.Session.RequestedReasoningEffort != "low" || d.Session.EffectiveReasoningEffort != "" {
		t.Fatal(d.Session)
	}
	native.mu.Lock()
	n := native.native
	native.mu.Unlock()
	n.mu.Lock()
	if len(n.options) != 1 || n.options[0].ReasoningEffort != "low" || n.options[0].Model != "model-name" {
		t.Fatal(n.options)
	}
	n.mu.Unlock()
	calls := len(r.calls)
	if _, e = s.Send(ctx, pid, sess.ID, req); e != nil {
		t.Fatal(e)
	}
	if len(r.calls) != calls {
		t.Fatal("replayed request repeated catalog/provider operation")
	}
	changed := req
	changed.RequestedReasoningEffort = "high"
	if _, e = s.Send(ctx, pid, sess.ID, changed); !errors.Is(e, ErrInvalid) {
		t.Fatal(e)
	}
	s.Close()
	restored, e := New(database, r, s.roots)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.Close()
	d, e = restored.Detail(ctx, pid, sess.ID)
	if e != nil || d.Session.RequestedReasoningEffort != "low" || d.Session.EffectiveReasoningEffort != "" {
		t.Fatal(d, e)
	}
	if _, e = restored.Send(ctx, pid, sess.ID, req); e != nil {
		t.Fatal(e)
	}
	if len(native.starts) != 1 {
		t.Fatal(native.starts)
	}
}
func TestRequestedEffortFailedCatalogHasNoAcceptanceEffects(t *testing.T) {
	old, database, native, pid := nativeFixture(t)
	old.Close()
	r := &fixtureModelRegistry{fakeNativeRegistry: native, err: errors.New("catalog unavailable")}
	s, e := New(database, r, old.roots)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	sess, e := s.Create(context.Background(), pid, "codex", "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Send(context.Background(), pid, sess.ID, SendRequest{ClientMessageID: "x", Text: "x", RequestedModel: "model-name", RequestedReasoningEffort: "low"}); e == nil {
		t.Fatal("failed catalog accepted")
	}
	d, e := s.Detail(context.Background(), pid, sess.ID)
	if e != nil || len(d.Messages) != 0 || d.Session.Status != "idle" || len(native.starts) != 0 {
		t.Fatal(d, e, native.starts)
	}
}
