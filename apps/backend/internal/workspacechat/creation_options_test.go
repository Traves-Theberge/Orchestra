package workspacechat

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agentcatalog"
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

func TestUnsupportedAgentSelectionIsRejectedBeforeSessionOrMessageAcceptance(t *testing.T) {
	runner := &recordingRunner{}
	s, database, pid, repo := fixture(t, runner)
	home := filepath.Join(filepath.Dir(repo), "home")
	if err := os.MkdirAll(filepath.Join(home, ".codex", "agents"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	definition := "name = \"review\"\ndescription = \"Reviewer\"\n"
	if err := os.WriteFile(filepath.Join(home, ".codex", "agents", "review.toml"), []byte(definition), 0o600); err != nil {
		t.Fatal(err)
	}
	catalog, err := agentcatalog.New(database, []string{filepath.Dir(repo)}, repo)
	if err != nil {
		t.Fatal(err)
	}
	s.ConfigureAgentCatalog(catalog)
	items, err := catalog.List(t.Context(), agentcatalog.Request{ProjectID: pid, Harness: "CODEX", Scope: agentcatalog.ScopeGlobal})
	if err != nil || len(items.Items) != 1 {
		t.Fatalf("catalog fixture: %#v %v", items, err)
	}
	selected := CreateRequest{Provider: "CODEX", RequestedAgentID: "review", RequestedAgentScope: "global", RequestedAgentContentHash: items.Items[0].ContentHash, RequestedAgentFormat: items.Items[0].Format}
	if _, err = s.CreateWithRequest(t.Context(), pid, selected); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("configured but unverified agent should fail before create, got %v", err)
	}
	var count int
	if err = database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_sessions`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("unsupported agent created a session: count=%d error=%v", count, err)
	}
	sess, err := s.CreateWithRequest(t.Context(), pid, CreateRequest{Provider: "CODEX"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Send(t.Context(), pid, sess.ID, SendRequest{ClientMessageID: "bad-agent", Text: "do not send", RequestedAgentID: "review", RequestedAgentScope: "global", RequestedAgentContentHash: items.Items[0].ContentHash, RequestedAgentFormat: items.Items[0].Format})
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("fresh send with an unverified agent should fail preflight: %v", err)
	}
	if err = database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_messages`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rejected agent intent was accepted as a message: count=%d error=%v", count, err)
	}
	accepted, err := s.Send(t.Context(), pid, sess.ID, SendRequest{ClientMessageID: "provider-default", Text: "safe default"})
	if err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, s, pid, sess.ID)
	if _, err = s.Send(t.Context(), pid, sess.ID, SendRequest{ClientMessageID: "provider-default", Text: "safe default", RequestedAgentID: "review", RequestedAgentScope: "global", RequestedAgentContentHash: items.Items[0].ContentHash, RequestedAgentFormat: items.Items[0].Format}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("replay accepted a changed agent tuple: %v", err)
	}
	if accepted.Session.RequestedAgentID != "" {
		t.Fatalf("provider-default send fabricated an agent identity: %#v", accepted.Session)
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
