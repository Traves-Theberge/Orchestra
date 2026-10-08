package workspacechat

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

// panicRegistry panics inside the turn goroutine, as a bug in a harness adapter would.
type panicRegistry struct{ *fakeNativeRegistry }

func (r *panicRegistry) StartNativeSession(context.Context, agents.Provider, agents.TurnRequest, string, agents.NativeEventHandler) (agents.NativeSession, error) {
	panic("adapter bug")
}

func TestAPanickingTurnFailsTheConversationInsteadOfCrashingTheBackend(t *testing.T) {
	old, database, native, pid := nativeFixture(t)
	old.Close()
	s, err := New(database, &panicRegistry{native}, old.roots)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "recover-session")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "boom", Text: "hello"}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		d, detailErr := s.Detail(ctx, pid, sess.ID)
		if detailErr != nil {
			t.Fatal(detailErr)
		}
		if d.Session.Status == "failed" {
			if !strings.Contains(d.Session.Error, "internal error") {
				t.Fatalf("failure should explain itself, got %q", d.Session.Error)
			}
			// The conversation is usable again: not stuck as running.
			if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "again", Text: "retry"}); err != nil {
				t.Fatalf("session stayed busy after a recovered panic: %v", err)
			}
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("conversation never left running after the panic")
}
