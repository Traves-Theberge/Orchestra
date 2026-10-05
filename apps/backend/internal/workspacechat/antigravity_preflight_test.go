package workspacechat

import (
	"context"
	"errors"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

func TestAntigravityModelChangeRejectedBeforeSubmission(t *testing.T) {
	s, _, registry, pid := nativeFixture(t)
	registry.provider = agents.ProviderAntigravity
	ctx := context.Background()
	session, err := s.Create(ctx, pid, "ANTIGRAVITY", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, session.ID, SendRequest{ClientMessageID: "first", Text: "one", RequestedModel: "observed-model"}); err != nil {
		t.Fatal(err)
	}
	before := awaitIdle(t, s, pid, session.ID)
	for _, request := range []SendRequest{
		{ClientMessageID: "different-model", Text: "two", RequestedModel: "different-model"},
		{ClientMessageID: "unsupported-effort", Text: "two", RequestedReasoningEffort: "high"},
	} {
		if _, err = s.Send(ctx, pid, session.ID, request); !errors.Is(err, ErrUnsupported) {
			t.Fatalf("unsupported configuration accepted: %v", err)
		}
	}
	after, err := s.Detail(ctx, pid, session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Messages) != len(before.Messages) || after.Session.Status != "idle" || after.Session.EffectiveModel != "observed-model" {
		t.Fatalf("rejected configuration changed durable state: %#v", after.Session)
	}
	registry.native.mu.Lock()
	defer registry.native.mu.Unlock()
	if len(registry.native.texts) != 1 {
		t.Fatal("rejected configuration dispatched a prompt")
	}
}
