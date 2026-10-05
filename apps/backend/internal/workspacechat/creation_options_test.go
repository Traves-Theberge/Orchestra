package workspacechat

import (
	"context"
	"errors"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

func TestCreationPreferencesPersistWithoutTurnAndBindRetryIdentity(t *testing.T) {
	old, database, native, pid := nativeFixture(t)
	old.Close()
	registry := &fixtureModelRegistry{fakeNativeRegistry: native}
	s, err := New(database, registry, old.roots)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	req := CreateRequest{Provider: "codex", ClientSessionID: "d08bfe4b-5112-4626-810f-e0bdc7bbf2a8", RequestedModel: "model-name", RequestedReasoningEffort: "high"}
	created, err := s.CreateWithRequest(t.Context(), pid, req)
	if err != nil {
		t.Fatal(err)
	}
	if created.RequestedModel != "model-name" || created.RequestedReasoningEffort != "high" || created.EffectiveModel != "" || created.EffectiveReasoningEffort != "" || created.ProviderThreadID != "" {
		t.Fatalf("fabricated provider observation %+v", created)
	}
	var messages, events int
	if err = database.QueryRow("SELECT COUNT(*) FROM workspace_chat_messages").Scan(&messages); err != nil {
		t.Fatal(err)
	}
	if err = database.QueryRow("SELECT COUNT(*) FROM workspace_chat_events").Scan(&events); err != nil {
		t.Fatal(err)
	}
	if messages != 0 || events != 0 || len(native.starts) != 0 {
		t.Fatalf("creation launched native turn: %d %d %+v", messages, events, native.starts)
	}
	registry.err = errors.New("catalog temporarily unavailable")
	if _, err = s.CreateWithRequest(t.Context(), pid, req); err != nil {
		t.Fatalf("same creation receipt failed: %v", err)
	}
	changed := req
	changed.RequestedReasoningEffort = "low"
	if _, err = s.CreateWithRequest(t.Context(), pid, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed creation preferences accepted: %v", err)
	}
	changed = req
	changed.RequestedModel = "another-model"
	if _, err = s.CreateWithRequest(t.Context(), pid, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed creation model accepted: %v", err)
	}
	s.Close()
	registry.err = nil
	reopened, err := New(database, registry, old.roots)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	detail, err := reopened.Detail(t.Context(), pid, created.ID)
	if err != nil || detail.Session.RequestedModel != "model-name" || detail.Session.RequestedReasoningEffort != "high" || detail.Session.EffectiveModel != "" {
		t.Fatalf("preference reopen %+v %v", detail, err)
	}
	send := SendRequest{ClientMessageID: "first", Text: "hello"}
	if _, err = reopened.Send(t.Context(), pid, created.ID, send); err != nil {
		t.Fatal(err)
	}
	settled := awaitIdle(t, reopened, pid, created.ID)
	native.mu.Lock()
	harness := native.native
	native.mu.Unlock()
	harness.mu.Lock()
	options := append([]agents.NativeTurnOptions(nil), harness.options...)
	harness.mu.Unlock()
	if len(options) != 1 || options[0].Model != "model-name" || options[0].ReasoningEffort != "high" {
		t.Fatalf("first turn ignored defaults %+v", options)
	}
	if settled.Session.EffectiveModel != "observed-model" {
		t.Fatalf("missing real fixture observation %+v", settled.Session)
	}
	if _, err = reopened.Send(t.Context(), pid, created.ID, send); err != nil {
		t.Fatalf("omitted-default submission retry failed: %v", err)
	}
	if _, err = reopened.CreateWithRequest(t.Context(), pid, req); err != nil {
		t.Fatalf("creation replay after turn failed: %v", err)
	}
}

func TestCreationPreferencesRejectUnsupportedCatalogBeforePersistence(t *testing.T) {
	old, database, native, pid := nativeFixture(t)
	old.Close()
	registry := &fixtureModelRegistry{fakeNativeRegistry: native}
	s, err := New(database, registry, old.roots)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, req := range []CreateRequest{
		{Provider: "codex", RequestedModel: "missing-model"},
		{Provider: "codex", RequestedReasoningEffort: "high"},
		{Provider: "codex", RequestedModel: "model-name", RequestedReasoningEffort: "unadvertised"},
		{Provider: "claude", RequestedModel: "model-name"},
	} {
		if _, err = s.CreateWithRequest(context.Background(), pid, req); !errors.Is(err, ErrUnsupported) {
			t.Fatalf("unsupported request %+v %v", req, err)
		}
	}
	var count int
	if err = database.QueryRow("SELECT COUNT(*) FROM workspace_chat_sessions").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 || len(native.starts) != 0 {
		t.Fatalf("unsupported request created agent: %d %+v", count, native.starts)
	}
}
