package workspacechat

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

type counterNativeRegistry struct {
	mu       sync.Mutex
	requests []agents.TurnRequest
}

func (*counterNativeRegistry) HasProvider(agents.Provider) bool { return true }
func (*counterNativeRegistry) ValidateTurnOptions(agents.Provider, agents.TurnRequest) error {
	return nil
}
func (*counterNativeRegistry) RunTurn(context.Context, agents.Provider, agents.TurnRequest, agents.EventHandler) (agents.TurnResult, error) {
	panic("native session must not replay")
}
func (*counterNativeRegistry) SupportsNativeSession(p agents.Provider) bool {
	return p == agents.ProviderAntigravity
}
func (r *counterNativeRegistry) StartNativeSession(_ context.Context, _ agents.Provider, request agents.TurnRequest, _ string, _ agents.NativeEventHandler) (agents.NativeSession, error) {
	r.mu.Lock()
	r.requests = append(r.requests, request)
	r.mu.Unlock()
	return &counterNativeSession{counter: request.ProviderTurnCounter}, nil
}

type counterNativeSession struct{ counter int64 }

func (*counterNativeSession) ThreadID() string { return "agy-persisted-conversation" }
func (n *counterNativeSession) ModelInfo() agents.NativeModelInfo {
	return agents.NativeModelInfo{ApprovalPolicy: "request-review"}
}
func (n *counterNativeSession) SendTurn(_ context.Context, text, _ string) (agents.NativeTurnResult, error) {
	n.counter++
	return agents.NativeTurnResult{Status: "completed", Text: "ok", CumulativeTurnCount: n.counter}, nil
}
func (*counterNativeSession) RespondRequest(context.Context, string, json.RawMessage) error {
	return errors.New("not implemented")
}
func (*counterNativeSession) Interrupt(context.Context) error { return nil }
func (*counterNativeSession) Close() error                    { return nil }

func TestAntigravityCumulativeTurnBaselineSurvivesServiceRestart(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	database, err := db.Connect(filepath.Join(root, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	pid, err := database.UpsertProject(ctx, root, "")
	if err != nil {
		t.Fatal(err)
	}
	registry := &counterNativeRegistry{}
	service, err := New(database, registry, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	session, err := service.Create(ctx, pid, "antigravity", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Send(ctx, pid, session.ID, SendRequest{ClientMessageID: "first", Text: "one"}); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, service, pid, session.ID)
	service.Close()

	restored, err := New(database, registry, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if _, err = restored.Send(ctx, pid, session.ID, SendRequest{ClientMessageID: "second", Text: "two"}); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, restored, pid, session.ID)
	registry.mu.Lock()
	defer registry.mu.Unlock()
	if len(registry.requests) != 2 || registry.requests[0].ProviderTurnCounter != 0 || registry.requests[1].ProviderTurnCounter != 1 {
		t.Fatalf("provider counter baselines across restart = %#v", registry.requests)
	}
}
