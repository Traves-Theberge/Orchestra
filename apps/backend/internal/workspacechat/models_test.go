package workspacechat

import (
	"context"
	"errors"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"testing"
)

type fixtureModelRegistry struct {
	*fakeNativeRegistry
	calls []agents.TurnRequest
	err   error
}

func (r *fixtureModelRegistry) NativeModels(_ context.Context, _ agents.Provider, req agents.TurnRequest) ([]agents.NativeModel, error) {
	r.calls = append(r.calls, req)
	if r.err != nil {
		return nil, r.err
	}
	return []agents.NativeModel{{ID: "catalog-id", Model: "model-name", DisplayName: "Model", IsDefault: true, SupportedReasoningEfforts: []agents.NativeReasoningEffort{{ReasoningEffort: "low"}, {ReasoningEffort: "high"}}}}, nil
}
func TestModelsAuthorizationAndReadOnlyFailure(t *testing.T) {
	old, database, native, pid := nativeFixture(t)
	old.Close()
	r := &fixtureModelRegistry{fakeNativeRegistry: native}
	s, e := New(database, r, old.roots)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	ctx := context.Background()
	catalog, e := s.Models(ctx, pid, "codex")
	if e != nil || catalog.Observation != "provider_catalog" || catalog.Provider != "CODEX" || len(catalog.Models) != 1 || catalog.Models[0].Model != "model-name" {
		t.Fatal(catalog, e)
	}
	project, e := database.GetProjectByID(ctx, pid)
	if e != nil {
		t.Fatal(e)
	}
	if len(r.calls) != 1 || r.calls[0].Workspace != project.RootPath || r.calls[0].RuntimeTarget != agents.RuntimeLocal || r.calls[0].RequestedModel != "" || r.calls[0].Prompt != "" {
		t.Fatal(r.calls)
	}
	if _, e = s.Models(ctx, "missing", "codex"); !errors.Is(e, ErrNotFound) {
		t.Fatal(e)
	}
	if claude, e := s.Models(ctx, pid, "claude"); e != nil || len(claude.Models) == 0 {
		t.Fatal(claude, e)
	}
	if _, e = s.Models(ctx, pid, "8gent"); !errors.Is(e, ErrUnsupported) {
		t.Fatal(e)
	}
	r.err = errors.New("catalog read failed")
	if _, e = s.Models(ctx, pid, "codex"); e == nil {
		t.Fatal("failed catalog was replaced with defaults")
	}
	var sessions, messages, events int
	database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_sessions`).Scan(&sessions)
	database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_messages`).Scan(&messages)
	database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_events`).Scan(&events)
	if sessions != 0 || messages != 0 || events != 0 || len(native.starts) != 0 {
		t.Fatal(sessions, messages, events, native.starts)
	}
	blocked, e := New(database, r, []string{t.TempDir()})
	if e != nil {
		t.Fatal(e)
	}
	defer blocked.Close()
	if _, e = blocked.Models(ctx, pid, "codex"); !errors.Is(e, ErrForbidden) {
		t.Fatal(e)
	}
}

func TestParseOpenCodeModels(t *testing.T) {
	got := parseOpenCodeModels("opencode/ling-3.1-flash-free\r\nINFO noise line\n\nanthropic/claude-sonnet-5-5\n")
	if len(got) != 2 || got[0].Model != "opencode/ling-3.1-flash-free" || got[1].Model != "anthropic/claude-sonnet-5-5" {
		t.Fatal(got)
	}
}
