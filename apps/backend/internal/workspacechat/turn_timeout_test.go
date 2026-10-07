package workspacechat

import (
	"context"
	"testing"
	"time"
)

func TestTurnTimeoutDefaultsAndContextOverride(t *testing.T) {
	r := &recordingRunner{output: "ok"}
	s, _, pid, _ := fixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "one", Text: "hi"}); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, s, pid, sess.ID)
	if _, err = s.Send(WithTurnTimeout(ctx, 30*time.Minute), pid, sess.ID, SendRequest{ClientMessageID: "two", Text: "again"}); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, s, pid, sess.ID)
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.calls) != 2 || r.calls[0].Timeout != DefaultTurnTimeout || r.calls[1].Timeout != 30*time.Minute {
		t.Fatalf("timeouts: %+v", r.calls)
	}
	for _, bad := range []time.Duration{-time.Second, 0, 3 * time.Hour} {
		if got := turnTimeout(WithTurnTimeout(ctx, bad)); got != DefaultTurnTimeout {
			t.Fatalf("%v -> %v", bad, got)
		}
	}
}
