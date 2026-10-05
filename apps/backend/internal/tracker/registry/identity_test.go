package registry

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

type identityTestAdapter struct {
	items      []tracker.WorkItem
	lastFilter tracker.Filter
	created    tracker.WorkItem
	updated    bool
	deleted    bool
}

func (a *identityTestAdapter) Fetch(_ context.Context, filter tracker.Filter) ([]tracker.WorkItem, error) {
	a.lastFilter = filter
	return a.items, nil
}
func (a *identityTestAdapter) FetchByID(_ context.Context, id string) (*tracker.WorkItem, error) {
	for i := range a.items {
		if a.items[i].ID == id || a.items[i].Identifier == id {
			return &a.items[i], nil
		}
	}
	return nil, errors.New("not found")
}
func (a *identityTestAdapter) Search(ctx context.Context, _ string) ([]tracker.WorkItem, error) {
	return a.Fetch(ctx, tracker.Filter{})
}
func (a *identityTestAdapter) Create(_ context.Context, item tracker.WorkItem) (*tracker.WorkItem, error) {
	a.created = item
	item.ID = "linear:new"
	item.Identifier = "ENG-7"
	item.SourceID = "new"
	return &item, nil
}
func (a *identityTestAdapter) Update(_ context.Context, _ string, _ map[string]any) (*tracker.WorkItem, error) {
	a.updated = true
	return &a.items[0], nil
}
func (a *identityTestAdapter) Delete(context.Context, string) error          { a.deleted = true; return nil }
func (a *identityTestAdapter) Comment(context.Context, string, string) error { return nil }
func (a *identityTestAdapter) FetchProjects(context.Context) ([]tracker.TrackerProject, error) {
	return nil, nil
}
func (a *identityTestAdapter) FetchStates(context.Context) ([]tracker.TrackerState, error) {
	return nil, nil
}
func (a *identityTestAdapter) Ping(context.Context) error { return nil }

func TestSelectedProjectBindsLocalAndNativeIdentity(t *testing.T) {
	adapter := &identityTestAdapter{items: []tracker.WorkItem{{ID: "linear:abc", SourceID: "abc", Identifier: "ENG-1", Source: "linear", SourceProjectID: "ENG"}}}
	client := &adapterClient{adapter: adapter, projectID: "local-project-uuid", source: "linear", sourceProjectID: "ENG"}
	items, err := client.FetchIssues(context.Background(), tracker.Filter{ProjectID: "local-project-uuid"})
	if err != nil {
		t.Fatalf("FetchIssues: %v", err)
	}
	if adapter.lastFilter.ProjectID != "" {
		t.Fatalf("local project UUID reached hosted adapter filter: %q", adapter.lastFilter.ProjectID)
	}
	if items[0].ProjectID != "local-project-uuid" || items[0].SourceProjectID != "ENG" || items[0].SourceID != "abc" {
		t.Fatalf("identity binding lost a scope: %+v", items[0])
	}
	if _, err := client.FetchIssues(context.Background(), tracker.Filter{ProjectID: "another-local-project"}); err == nil {
		t.Fatal("mismatched local project filter was accepted")
	}
}

func TestHostedCreateDoesNotUseLocalUUIDAsNativeProject(t *testing.T) {
	adapter := &identityTestAdapter{}
	client := &adapterClient{adapter: adapter, projectID: "local-project-uuid", source: "linear", sourceProjectID: "ENG"}
	created, err := client.CreateIssue(context.Background(), "new", "description", "Backlog", 0, "", "local-project-uuid", "codex", nil)
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if adapter.created.ProjectID != "" || adapter.created.SourceProjectID != "ENG" {
		t.Fatalf("wrong create scope crossed adapter boundary: %+v", adapter.created)
	}
	if created.ProjectID != "local-project-uuid" || created.SourceProjectID != "ENG" {
		t.Fatalf("created issue was not bound to both identities: %+v", created)
	}
}

func TestHostedMutationRejectsScopeConflictBeforeEffect(t *testing.T) {
	adapter := &identityTestAdapter{items: []tracker.WorkItem{{ID: "linear:abc", Identifier: "MKT-1", Source: "linear", SourceProjectID: "MKT"}}}
	client := &adapterClient{adapter: adapter, projectID: "p1", source: "linear", sourceProjectID: "ENG"}
	if _, err := client.UpdateIssue(context.Background(), "linear:abc", map[string]any{"title": "wrong"}); err == nil {
		t.Fatal("expected scope mismatch")
	}
	if adapter.updated {
		t.Fatal("update was sent before source scope validation")
	}
	if err := client.DeleteIssue(context.Background(), "linear:abc"); err == nil {
		t.Fatal("expected scope mismatch")
	}
	if adapter.deleted {
		t.Fatal("delete was sent before source scope validation")
	}
}

func TestLocalFilterProjectIDIsPreserved(t *testing.T) {
	adapter := &identityTestAdapter{}
	client := &adapterClient{adapter: adapter, projectID: "local-project-uuid", source: "sqlite"}
	if _, err := client.FetchIssues(context.Background(), tracker.Filter{ProjectID: "local-project-uuid"}); err != nil {
		t.Fatalf("FetchIssues: %v", err)
	}
	if adapter.lastFilter.ProjectID != "local-project-uuid" {
		t.Fatalf("local tracker filter lost its project: %q", adapter.lastFilter.ProjectID)
	}
}

func TestLinkedConfigRetainsNativeScopeAfterDatabaseReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tracker.db")
	database, err := db.Connect(path)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	ctx := context.Background()
	if _, err := database.ExecContext(ctx, `INSERT INTO projects (id, name, root_path, remote_url) VALUES ('local-project', 'Test', '/tmp/test', '')`); err != nil {
		database.Close()
		t.Fatalf("insert project: %v", err)
	}
	if err := database.UpsertTrackerConfig(ctx, db.TrackerConfig{
		ID: "linear-config", Type: "linear", DisplayName: "Linear ENG",
		Endpoint: "https://api.linear.app/graphql", AuthMethod: "apikey", Extra: `{"team_key":"ENG"}`,
	}); err != nil {
		database.Close()
		t.Fatalf("save tracker config: %v", err)
	}
	if err := database.SetProjectTrackerConfig(ctx, "local-project", "linear-config"); err != nil {
		database.Close()
		t.Fatalf("link tracker config: %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	database, err = db.Connect(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer database.Close()
	project, err := database.GetProjectByID(ctx, "local-project")
	if err != nil {
		t.Fatalf("get project after reopen: %v", err)
	}
	var gotExtra string
	adapter := &identityTestAdapter{items: []tracker.WorkItem{{ID: "linear:abc", SourceID: "abc", Identifier: "ENG-1", Source: "linear", SourceProjectID: "ENG"}}}
	reg := NewWithFactory(database, func(cfg *db.TrackerConfig, _ string) (tracker.Adapter, error) {
		gotExtra = cfg.Extra
		return adapter, nil
	})
	client, err := reg.GetForProjectDirect(project)
	if err != nil {
		t.Fatalf("resolve linked client: %v", err)
	}
	issues, err := client.FetchIssues(ctx, tracker.Filter{})
	if err != nil {
		t.Fatalf("fetch linked issues: %v", err)
	}
	if gotExtra != `{"team_key":"ENG"}` {
		t.Fatalf("linked factory lost team scope metadata after reopen: %q", gotExtra)
	}
	if len(issues) != 1 || issues[0].ProjectID != "local-project" || issues[0].SourceProjectID != "ENG" {
		t.Fatalf("linked read did not preserve local/native identity: %+v", issues)
	}
}
