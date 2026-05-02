package registry_test

import (
	"context"
	"errors"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/registry"
)

// stubAdapter is a minimal tracker.Adapter for tests.
type stubAdapter struct {
	items []tracker.WorkItem
}

func (s *stubAdapter) Fetch(_ context.Context, _ tracker.Filter) ([]tracker.WorkItem, error) {
	return s.items, nil
}
func (s *stubAdapter) FetchByID(_ context.Context, id string) (*tracker.WorkItem, error) {
	for i := range s.items {
		if s.items[i].ID == id {
			return &s.items[i], nil
		}
	}
	return nil, errors.New("not found")
}
func (s *stubAdapter) Search(_ context.Context, _ string) ([]tracker.WorkItem, error) {
	return s.items, nil
}
func (s *stubAdapter) Create(_ context.Context, item tracker.WorkItem) (*tracker.WorkItem, error) {
	return &item, nil
}
func (s *stubAdapter) Update(_ context.Context, id string, _ map[string]any) (*tracker.WorkItem, error) {
	return s.FetchByID(context.Background(), id)
}
func (s *stubAdapter) Delete(_ context.Context, _ string) error              { return nil }
func (s *stubAdapter) Comment(_ context.Context, _, _ string) error          { return nil }
func (s *stubAdapter) FetchProjects(_ context.Context) ([]tracker.TrackerProject, error) {
	return []tracker.TrackerProject{{ID: "p1", Name: "Test"}}, nil
}
func (s *stubAdapter) FetchStates(_ context.Context) ([]tracker.TrackerState, error) {
	return []tracker.TrackerState{{ID: "s1", Name: "Todo", Type: "todo"}}, nil
}
func (s *stubAdapter) Ping(_ context.Context) error { return nil }

func TestRegistry_GetAdapter(t *testing.T) {
	stub := &stubAdapter{items: []tracker.WorkItem{{ID: "linear:abc", Title: "Stub"}}}
	reg := registry.NewWithAdapters(map[string]tracker.Adapter{"cfg-1": stub})

	a, err := reg.GetAdapter("cfg-1")
	if err != nil {
		t.Fatalf("GetAdapter: %v", err)
	}
	items, _ := a.Fetch(context.Background(), tracker.Filter{})
	if len(items) != 1 {
		t.Errorf("got %d items, want 1", len(items))
	}

	_, err = reg.GetAdapter("missing")
	if err == nil {
		t.Error("expected error for missing adapter, got nil")
	}
}

func TestRegistry_DefaultClient(t *testing.T) {
	stub := &stubAdapter{items: []tracker.WorkItem{{ID: "1", State: "Todo"}}}
	reg := registry.NewWithAdapters(map[string]tracker.Adapter{"cfg-1": stub})

	client := reg.DefaultClient()
	if client == nil {
		t.Fatal("expected non-nil client")
	}
	issues, err := client.FetchIssuesByStates(context.Background(), []string{"Todo"})
	if err != nil {
		t.Fatalf("FetchIssuesByStates: %v", err)
	}
	if len(issues) != 1 {
		t.Errorf("got %d issues, want 1", len(issues))
	}
}

func TestRegistry_DefaultClient_Empty(t *testing.T) {
	reg := registry.NewWithAdapters(nil)
	if reg.DefaultClient() != nil {
		t.Error("expected nil client for empty registry")
	}
}

func TestRegistry_GetForProject_NoDatabase(t *testing.T) {
	reg := registry.NewWithAdapters(nil)
	_, err := reg.GetForProject(context.Background(), "proj-1")
	if err == nil {
		t.Error("expected error when no database wired, got nil")
	}
}

// adapterClient delegation: verify Client.FetchIssueByIdentifier hits Adapter.FetchByID.
func TestAdapterClient_FetchByIdentifier(t *testing.T) {
	stub := &stubAdapter{items: []tracker.WorkItem{{ID: "linear:abc", Title: "Stub"}}}
	reg := registry.NewWithAdapters(map[string]tracker.Adapter{"cfg-1": stub})
	client := reg.DefaultClient()

	got, err := client.FetchIssueByIdentifier(context.Background(), "linear:abc")
	if err != nil {
		t.Fatalf("FetchIssueByIdentifier: %v", err)
	}
	if got.Title != "Stub" {
		t.Errorf("title: got %q, want %q", got.Title, "Stub")
	}
}
