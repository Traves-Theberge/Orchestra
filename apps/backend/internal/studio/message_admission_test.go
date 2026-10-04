package studio

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/observability"
)

type failingMessageRunner struct {
	*FakeRunner
	started chan context.Context
	release chan struct{}
}

func (r *failingMessageRunner) SendMessage(ctx context.Context, _, _ string) error {
	r.started <- ctx
	<-r.release
	return errors.New("runner exited before emitting any event")
}

func TestSubmitMessageAdmissionAndFailureEvents(t *testing.T) {
	m := newTestManager(t)
	m.d.SetMaxOpenConns(1)
	r := &failingMessageRunner{FakeRunner: NewFakeRunner(), started: make(chan context.Context, 1), release: make(chan struct{})}
	m.spawner = r
	sess, err := m.StartSession(context.Background(), StartSessionRequest{Runner: "fake"})
	if err != nil {
		t.Fatal(err)
	}
	ch, unsub := m.bus.Subscribe(8)
	defer unsub()
	if err := m.SubmitMessage(sess.ID, "hello"); err != nil {
		t.Fatal(err)
	}
	select {
	case ctx := <-r.started:
		if ctx.Err() != nil {
			t.Fatalf("detached turn canceled: %v", ctx.Err())
		}
	case <-time.After(time.Second):
		t.Fatal("turn did not start")
	}
	if err := m.SubmitMessage(sess.ID, "duplicate"); !errors.Is(err, ErrTurnBusy) {
		t.Fatalf("busy turn admitted: %v", err)
	}
	close(r.release)
	for _, want := range []EventKind{EventError, EventSessionStatus} {
		select {
		case event := <-ch:
			ev, ok := event.Data.(Event)
			if !ok || ev.Kind != want || ev.SessionID != sess.ID {
				t.Fatalf("event=%+v, want %s", event, want)
			}
		case <-time.After(time.Second):
			t.Fatalf("missing %s", want)
		}
	}
	// A new manager sees the durable draft but has no live runner binding.
	restarted := NewManager(m.d, observability.NewPubSub(), NewFakeRunner())
	if err := restarted.SubmitMessage(sess.ID, "after restart"); !errors.Is(err, ErrRunnerUnavailable) {
		t.Fatalf("restart admitted: %v", err)
	}
	if err := m.Discard(sess.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.SubmitMessage(sess.ID, "after discard"); !errors.Is(err, ErrSessionInactive) {
		t.Fatalf("discard admitted: %v", err)
	}
	if err := m.SubmitMessage("absent", "hello"); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("unknown admitted: %v", err)
	}
}
