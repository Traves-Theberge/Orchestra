# Tracker Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the WorkItem domain type, TrackerRegistry, and Linear + Jira adapter backends to the Go daemon so any project can pull issues from any supported tracker.

**Architecture:** The new `tracker.Adapter` interface is implemented by each backend (linear, jira, github). A `TrackerRegistry` in `internal/tracker/registry/` loads adapter instances from `tracker_configs` DB rows and exposes `tracker.Client` to the rest of the codebase. `tracker.Issue` becomes a type alias for the new `tracker.WorkItem`. Existing deployments are unaffected — env-var config seeds a `tracker_configs` row on first run.

**Tech Stack:** Go 1.22+, SQLite (modernc.org/sqlite), `net/http`, AES-GCM encryption via existing `db.EncryptToken`/`db.DecryptToken`.

---

## File Map

**New files:**
- `apps/backend/internal/tracker/work_item.go` — WorkItem, Filter, TrackerProject, TrackerState, Adapter interface
- `apps/backend/internal/db/tracker_configs.go` — DB CRUD helpers for tracker_configs table
- `apps/backend/internal/tracker/registry/registry.go` — TrackerRegistry + adapterClient wrapper
- `apps/backend/internal/tracker/registry/registry_test.go`
- `apps/backend/internal/tracker/linear/client.go` — Linear Adapter implementation
- `apps/backend/internal/tracker/linear/mapper.go` — Linear API response → WorkItem
- `apps/backend/internal/tracker/linear/client_test.go`
- `apps/backend/internal/tracker/jira/client.go` — Jira Adapter implementation
- `apps/backend/internal/tracker/jira/mapper.go` — Jira API response → WorkItem
- `apps/backend/internal/tracker/jira/client_test.go`
- `apps/backend/internal/api/tracker_configs.go` — CRUD + test-connection API handlers

**Modified files:**
- `apps/backend/internal/tracker/types.go` — add `type Issue = WorkItem`, remove old Issue struct
- `apps/backend/internal/db/schema.go` — add `tracker_configs` CREATE TABLE
- `apps/backend/internal/db/migrate.go` — add `projects.tracker_config_id` migration
- `apps/backend/internal/app/run.go` — replace `newTrackerClient` with registry wiring
- `apps/backend/internal/api/router.go` — register tracker config routes
- `apps/backend/internal/api/state.go` — add `registry` field to Server struct

---

### Task 1: WorkItem domain type and Adapter interface

**Files:**
- Create: `apps/backend/internal/tracker/work_item.go`
- Modify: `apps/backend/internal/tracker/types.go`

- [ ] **Step 1: Create work_item.go**

```go
// apps/backend/internal/tracker/work_item.go
package tracker

import "context"

// WorkItem is the canonical domain type for a tracked work item across all backends.
type WorkItem struct {
	ID               string         `json:"id"`
	Identifier       string         `json:"identifier"`
	Source           string         `json:"source,omitempty"` // "github"|"linear"|"jira"|"sqlite"|"memory"
	Title            string         `json:"title"`
	Description      string         `json:"description,omitempty"`
	Priority         int            `json:"priority,omitempty"`
	State            string         `json:"state"`
	BranchName       string         `json:"branch_name,omitempty"`
	URL              string         `json:"url,omitempty"`
	ProjectID        string         `json:"project_id,omitempty"`
	AssigneeID       string         `json:"assignee_id,omitempty"`
	Assignees        []string       `json:"assignees,omitempty"`
	AssignedToWorker bool           `json:"assigned_to_worker"`
	Labels           []string       `json:"labels,omitempty"`
	BlockedBy        []Blocker      `json:"blocked_by,omitempty"`
	CreatedAt        string         `json:"created_at,omitempty"`
	UpdatedAt        string         `json:"updated_at,omitempty"`
	Provider         string         `json:"provider,omitempty"`
	DisabledTools    []string       `json:"disabled_tools,omitempty"`
	BaseSHA          string         `json:"base_sha,omitempty"`
	Feedback         string         `json:"feedback,omitempty"`
	PRURL            string         `json:"pr_url,omitempty"`
	Plan             string         `json:"plan,omitempty"`
	Extra            map[string]any `json:"extra,omitempty"`
}

// Filter narrows which WorkItems are returned by Adapter.Fetch.
type Filter struct {
	States     []string
	ProjectID  string
	AssigneeID string
}

// TrackerProject is a top-level container in a tracker (Linear team, Jira project, GitHub repo).
type TrackerProject struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// TrackerState is a workflow state available in a tracker connection.
type TrackerState struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"` // "todo"|"in_progress"|"done"|"cancelled"
}

// Adapter is the interface each tracker backend implements.
// The Registry wraps Adapter instances into tracker.Client for the rest of the codebase.
type Adapter interface {
	Fetch(ctx context.Context, filter Filter) ([]WorkItem, error)
	FetchByID(ctx context.Context, id string) (*WorkItem, error)
	Search(ctx context.Context, query string) ([]WorkItem, error)
	Create(ctx context.Context, item WorkItem) (*WorkItem, error)
	Update(ctx context.Context, id string, updates map[string]any) (*WorkItem, error)
	Delete(ctx context.Context, id string) error
	Comment(ctx context.Context, id, body string) error
	FetchProjects(ctx context.Context) ([]TrackerProject, error)
	FetchStates(ctx context.Context) ([]TrackerState, error)
	Ping(ctx context.Context) error
}
```

- [ ] **Step 2: Replace Issue struct with type alias in types.go**

Open `apps/backend/internal/tracker/types.go`. Remove the existing `Issue` struct (lines 8–30). Add the alias and keep `Blocker`, `IssueFilter`, and `Client` unchanged:

```go
// Issue is a backward-compatible alias for WorkItem.
// All existing code using tracker.Issue continues to compile unchanged.
type Issue = WorkItem
```

The file should now look like:

```go
package tracker

import "context"

// Issue is a backward-compatible alias for WorkItem.
type Issue = WorkItem

// Blocker represents an issue that blocks another issue from progressing.
type Blocker struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier,omitempty"`
	State      string `json:"state,omitempty"`
}

// IssueFilter specifies criteria for filtering issues by state, project, or assignee.
type IssueFilter struct {
	States     []string
	ProjectID  string
	AssigneeID string
}

// Client defines the interface for issue tracker operations.
// This interface is unchanged — existing backends continue to satisfy it.
type Client interface {
	FetchCandidateIssues(ctx context.Context, activeStates []string) ([]Issue, error)
	FetchIssuesByIDs(ctx context.Context, issueIDs []string) ([]Issue, error)
	FetchIssuesByStates(ctx context.Context, states []string) ([]Issue, error)
	FetchIssueStatesByIDs(ctx context.Context, issueIDs []string) (map[string]string, error)
	FetchIssues(ctx context.Context, filter IssueFilter) ([]Issue, error)
	SearchIssues(ctx context.Context, query string) ([]Issue, error)
	FetchIssueByIdentifier(ctx context.Context, identifier string) (*Issue, error)
	CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID string, provider string, disabledTools []string) (*Issue, error)
	UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*Issue, error)
	DeleteIssue(ctx context.Context, identifier string) error
}
```

- [ ] **Step 3: Verify the codebase still compiles**

```bash
cd apps/backend && go build ./...
```

Expected: no errors. `tracker.Issue` is still valid everywhere because it's an alias.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/internal/tracker/work_item.go apps/backend/internal/tracker/types.go
git commit -m "feat(tracker): add WorkItem domain type and Adapter interface"
```

---

### Task 2: DB schema — tracker_configs table + projects migration

**Files:**
- Modify: `apps/backend/internal/db/schema.go`
- Modify: `apps/backend/internal/db/migrate.go`
- Create: `apps/backend/internal/db/tracker_configs.go`

- [ ] **Step 1: Add tracker_configs to schema.go**

At the end of the `Schema` const (before the closing backtick), add:

```sql
CREATE TABLE IF NOT EXISTS tracker_configs (
	id           TEXT PRIMARY KEY,
	type         TEXT NOT NULL,
	display_name TEXT NOT NULL,
	endpoint     TEXT,
	auth_method  TEXT NOT NULL DEFAULT 'apikey',
	token_enc    TEXT,
	refresh_enc  TEXT,
	token_expiry INTEGER,
	extra        TEXT,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL
);
```

- [ ] **Step 2: Add projects.tracker_config_id migration**

In `apps/backend/internal/db/migrate.go`, add to the `migrations` slice inside `runMigrations`:

```go
{"projects", "tracker_config_id", "TEXT"},
```

- [ ] **Step 3: Write the test first**

Create `apps/backend/internal/db/tracker_configs_test.go`:

```go
package db_test

import (
	"context"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

func TestTrackerConfigCRUD(t *testing.T) {
	database := testDB(t)

	cfg := db.TrackerConfig{
		ID:          "tc-1",
		Type:        "linear",
		DisplayName: "Linear ENG",
		Endpoint:    "ENG",
		AuthMethod:  "apikey",
		TokenEnc:    "tok",
		CreatedAt:   1000,
		UpdatedAt:   1000,
	}

	ctx := context.Background()

	if err := database.UpsertTrackerConfig(ctx, cfg); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	got, err := database.GetTrackerConfig(ctx, "tc-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.DisplayName != "Linear ENG" {
		t.Errorf("display_name: got %q, want %q", got.DisplayName, "Linear ENG")
	}

	list, err := database.ListTrackerConfigs(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("list len: got %d, want 1", len(list))
	}

	if err := database.DeleteTrackerConfig(ctx, "tc-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := database.GetTrackerConfig(ctx, "tc-1"); err == nil {
		t.Error("expected error after delete, got nil")
	}
}
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd apps/backend && go test ./internal/db/... -run TestTrackerConfigCRUD -v
```

Expected: FAIL — `database.UpsertTrackerConfig undefined`

- [ ] **Step 5: Implement tracker_configs.go**

```go
// apps/backend/internal/db/tracker_configs.go
package db

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// TrackerConfig holds the configuration for a single tracker connection.
type TrackerConfig struct {
	ID          string
	Type        string // "github"|"linear"|"jira"|"sqlite"|"memory"
	DisplayName string
	Endpoint    string
	AuthMethod  string // "apikey"|"oauth"
	TokenEnc    string // AES-GCM encrypted via db.EncryptToken
	RefreshEnc  string // OAuth refresh token, encrypted
	TokenExpiry *int64 // Unix timestamp, nil if no expiry
	Extra       string // JSON blob
	CreatedAt   int64
	UpdatedAt   int64
}

// UpsertTrackerConfig inserts or replaces a tracker config row.
func (d *DB) UpsertTrackerConfig(ctx context.Context, cfg TrackerConfig) error {
	now := time.Now().Unix()
	if cfg.CreatedAt == 0 {
		cfg.CreatedAt = now
	}
	cfg.UpdatedAt = now
	_, err := d.db.ExecContext(ctx, `
		INSERT INTO tracker_configs (id, type, display_name, endpoint, auth_method,
			token_enc, refresh_enc, token_expiry, extra, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			type=excluded.type, display_name=excluded.display_name,
			endpoint=excluded.endpoint, auth_method=excluded.auth_method,
			token_enc=excluded.token_enc, refresh_enc=excluded.refresh_enc,
			token_expiry=excluded.token_expiry, extra=excluded.extra,
			updated_at=excluded.updated_at`,
		cfg.ID, cfg.Type, cfg.DisplayName, cfg.Endpoint, cfg.AuthMethod,
		cfg.TokenEnc, cfg.RefreshEnc, cfg.TokenExpiry, cfg.Extra,
		cfg.CreatedAt, cfg.UpdatedAt,
	)
	return err
}

// GetTrackerConfig returns the config with the given ID, or an error if not found.
func (d *DB) GetTrackerConfig(ctx context.Context, id string) (*TrackerConfig, error) {
	row := d.db.QueryRowContext(ctx, `
		SELECT id, type, display_name, endpoint, auth_method,
			token_enc, refresh_enc, token_expiry, extra, created_at, updated_at
		FROM tracker_configs WHERE id = ?`, id)
	return scanTrackerConfig(row)
}

// GetTrackerConfigForProject returns the tracker config assigned to the given project, or nil if none.
func (d *DB) GetTrackerConfigForProject(ctx context.Context, projectID string) (*TrackerConfig, error) {
	row := d.db.QueryRowContext(ctx, `
		SELECT tc.id, tc.type, tc.display_name, tc.endpoint, tc.auth_method,
			tc.token_enc, tc.refresh_enc, tc.token_expiry, tc.extra, tc.created_at, tc.updated_at
		FROM tracker_configs tc
		JOIN projects p ON p.tracker_config_id = tc.id
		WHERE p.id = ?`, projectID)
	cfg, err := scanTrackerConfig(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return cfg, err
}

// ListTrackerConfigs returns all configured tracker connections.
func (d *DB) ListTrackerConfigs(ctx context.Context) ([]TrackerConfig, error) {
	rows, err := d.db.QueryContext(ctx, `
		SELECT id, type, display_name, endpoint, auth_method,
			token_enc, refresh_enc, token_expiry, extra, created_at, updated_at
		FROM tracker_configs ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TrackerConfig
	for rows.Next() {
		cfg, err := scanTrackerConfig(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *cfg)
	}
	return out, rows.Err()
}

// DeleteTrackerConfig removes a tracker config by ID.
func (d *DB) DeleteTrackerConfig(ctx context.Context, id string) error {
	res, err := d.db.ExecContext(ctx, `DELETE FROM tracker_configs WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// SetProjectTrackerConfig assigns a tracker config to a project.
func (d *DB) SetProjectTrackerConfig(ctx context.Context, projectID, configID string) error {
	_, err := d.db.ExecContext(ctx,
		`UPDATE projects SET tracker_config_id = ? WHERE id = ?`, configID, projectID)
	return err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanTrackerConfig(s scanner) (*TrackerConfig, error) {
	var cfg TrackerConfig
	err := s.Scan(
		&cfg.ID, &cfg.Type, &cfg.DisplayName, &cfg.Endpoint, &cfg.AuthMethod,
		&cfg.TokenEnc, &cfg.RefreshEnc, &cfg.TokenExpiry, &cfg.Extra,
		&cfg.CreatedAt, &cfg.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd apps/backend && go test ./internal/db/... -run TestTrackerConfigCRUD -v
```

Expected: PASS

- [ ] **Step 7: Compile check**

```bash
cd apps/backend && go build ./...
```

- [ ] **Step 8: Commit**

```bash
git add apps/backend/internal/db/schema.go apps/backend/internal/db/migrate.go \
  apps/backend/internal/db/tracker_configs.go apps/backend/internal/db/tracker_configs_test.go
git commit -m "feat(db): add tracker_configs table and CRUD helpers"
```

---

### Task 3: TrackerRegistry

**Files:**
- Create: `apps/backend/internal/tracker/registry/registry.go`
- Create: `apps/backend/internal/tracker/registry/registry_test.go`

- [ ] **Step 1: Write the failing test**

```go
// apps/backend/internal/tracker/registry/registry_test.go
package registry_test

import (
	"context"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/registry"
)

type stubAdapter struct{}

func (s *stubAdapter) Fetch(_ context.Context, _ tracker.Filter) ([]tracker.WorkItem, error) {
	return []tracker.WorkItem{{ID: "linear:abc", Title: "stub"}}, nil
}
func (s *stubAdapter) FetchByID(_ context.Context, id string) (*tracker.WorkItem, error) {
	return &tracker.WorkItem{ID: id}, nil
}
func (s *stubAdapter) Search(_ context.Context, _ string) ([]tracker.WorkItem, error) { return nil, nil }
func (s *stubAdapter) Create(_ context.Context, item tracker.WorkItem) (*tracker.WorkItem, error) {
	return &item, nil
}
func (s *stubAdapter) Update(_ context.Context, id string, _ map[string]any) (*tracker.WorkItem, error) {
	return &tracker.WorkItem{ID: id}, nil
}
func (s *stubAdapter) Delete(_ context.Context, _ string) error  { return nil }
func (s *stubAdapter) Comment(_ context.Context, _, _ string) error { return nil }
func (s *stubAdapter) FetchProjects(_ context.Context) ([]tracker.TrackerProject, error) {
	return []tracker.TrackerProject{{ID: "p1", Name: "Test"}}, nil
}
func (s *stubAdapter) FetchStates(_ context.Context) ([]tracker.TrackerState, error) {
	return []tracker.TrackerState{{ID: "s1", Name: "Todo", Type: "todo"}}, nil
}
func (s *stubAdapter) Ping(_ context.Context) error { return nil }

func TestRegistryGetForProject(t *testing.T) {
	reg := registry.NewWithAdapters(map[string]tracker.Adapter{
		"cfg-1": &stubAdapter{},
	}, map[string]string{
		"proj-1": "cfg-1",
	})

	client, err := reg.GetForProject(context.Background(), "proj-1")
	if err != nil {
		t.Fatalf("GetForProject: %v", err)
	}

	issues, err := client.FetchIssuesByStates(context.Background(), []string{"Todo"})
	if err != nil {
		t.Fatalf("FetchIssuesByStates: %v", err)
	}
	if len(issues) == 0 {
		t.Error("expected at least one issue from stub adapter")
	}
}

func TestRegistryUnknownProject(t *testing.T) {
	reg := registry.NewWithAdapters(map[string]tracker.Adapter{}, map[string]string{})
	_, err := reg.GetForProject(context.Background(), "unknown")
	if err == nil {
		t.Error("expected error for unknown project")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/backend && go test ./internal/tracker/registry/... -v
```

Expected: FAIL — package not found

- [ ] **Step 3: Implement registry.go**

```go
// apps/backend/internal/tracker/registry/registry.go
package registry

import (
	"context"
	"fmt"
	"sync"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

// Registry holds all configured tracker adapter instances and routes per-project lookups.
type Registry struct {
	mu         sync.RWMutex
	adapters   map[string]tracker.Adapter // configID → adapter
	projectMap map[string]string          // projectID → configID
	database   *db.DB
}

// New loads all tracker configs from the database and instantiates their adapters.
// Adapters for unknown or misconfigured types are skipped with a log warning.
func New(database *db.DB) (*Registry, error) {
	r := &Registry{
		adapters:   make(map[string]tracker.Adapter),
		projectMap: make(map[string]string),
		database:   database,
	}
	if err := r.loadAll(context.Background()); err != nil {
		return nil, err
	}
	return r, nil
}

// NewWithAdapters creates a Registry with pre-built adapters (used in tests).
func NewWithAdapters(adapters map[string]tracker.Adapter, projectMap map[string]string) *Registry {
	return &Registry{
		adapters:   adapters,
		projectMap: projectMap,
	}
}

// GetForProject returns a tracker.Client for the project's configured tracker.
// Returns an error if the project has no tracker config assigned.
func (r *Registry) GetForProject(ctx context.Context, projectID string) (tracker.Client, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	configID, ok := r.projectMap[projectID]
	if !ok {
		// Try loading from DB if not cached
		if r.database != nil {
			cfg, err := r.database.GetTrackerConfigForProject(ctx, projectID)
			if err != nil || cfg == nil {
				return nil, fmt.Errorf("no tracker config for project %q", projectID)
			}
			configID = cfg.ID
		} else {
			return nil, fmt.Errorf("no tracker config for project %q", projectID)
		}
	}

	a, ok := r.adapters[configID]
	if !ok {
		return nil, fmt.Errorf("tracker config %q not loaded", configID)
	}
	return &adapterClient{adapter: a}, nil
}

// Reload re-instantiates the adapter for the given config ID from the database.
func (r *Registry) Reload(ctx context.Context, configID string) error {
	if r.database == nil {
		return nil
	}
	cfg, err := r.database.GetTrackerConfig(ctx, configID)
	if err != nil {
		return fmt.Errorf("load config %q: %w", configID, err)
	}
	a, err := buildAdapter(cfg)
	if err != nil {
		return fmt.Errorf("build adapter %q: %w", configID, err)
	}
	r.mu.Lock()
	r.adapters[configID] = a
	r.mu.Unlock()
	return nil
}

// GetAdapter returns the raw Adapter for the given config ID (used by browse/viewer endpoints).
func (r *Registry) GetAdapter(configID string) (tracker.Adapter, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.adapters[configID]
	if !ok {
		return nil, fmt.Errorf("adapter %q not found", configID)
	}
	return a, nil
}

func (r *Registry) loadAll(ctx context.Context) error {
	if r.database == nil {
		return nil
	}
	configs, err := r.database.ListTrackerConfigs(ctx)
	if err != nil {
		return err
	}
	for _, cfg := range configs {
		a, err := buildAdapter(&cfg)
		if err != nil {
			continue // skip misconfigured — surfaced as auth_error in Settings
		}
		r.adapters[cfg.ID] = a
	}
	return nil
}

// buildAdapter constructs the appropriate Adapter for a TrackerConfig.
// Returns an error for unknown types or missing credentials.
func buildAdapter(cfg *db.TrackerConfig) (tracker.Adapter, error) {
	token, err := db.DecryptToken(cfg.TokenEnc)
	if err != nil {
		return nil, fmt.Errorf("decrypt token: %w", err)
	}
	switch cfg.Type {
	case "linear":
		return newLinearAdapter(cfg, token), nil
	case "jira":
		return newJiraAdapter(cfg, token), nil
	default:
		return nil, fmt.Errorf("unsupported tracker type %q", cfg.Type)
	}
}

// Placeholder constructors — implemented in linear/ and jira/ packages.
// These are called here to keep the registry self-contained; the actual
// implementations live in their respective packages.
func newLinearAdapter(cfg *db.TrackerConfig, token string) tracker.Adapter {
	panic("import cycle prevention: wire via factory function in app/run.go")
}
func newJiraAdapter(cfg *db.TrackerConfig, token string) tracker.Adapter {
	panic("import cycle prevention: wire via factory function in app/run.go")
}
```

> **Note on import cycles:** The registry cannot import `linear` and `jira` directly without creating a cycle. In Task 6, we'll inject an `AdapterFactory` function into the registry at startup, following the same pattern used elsewhere in this codebase.

- [ ] **Step 4: Implement adapterClient — the tracker.Client wrapper**

Add to `registry.go`:

```go
// adapterClient wraps tracker.Adapter to satisfy the tracker.Client interface.
type adapterClient struct {
	adapter tracker.Adapter
}

func (c *adapterClient) FetchCandidateIssues(ctx context.Context, activeStates []string) ([]tracker.Issue, error) {
	return c.adapter.Fetch(ctx, tracker.Filter{States: activeStates})
}

func (c *adapterClient) FetchIssuesByIDs(ctx context.Context, ids []string) ([]tracker.Issue, error) {
	var out []tracker.Issue
	for _, id := range ids {
		item, err := c.adapter.FetchByID(ctx, id)
		if err != nil {
			continue
		}
		out = append(out, *item)
	}
	return out, nil
}

func (c *adapterClient) FetchIssuesByStates(ctx context.Context, states []string) ([]tracker.Issue, error) {
	return c.adapter.Fetch(ctx, tracker.Filter{States: states})
}

func (c *adapterClient) FetchIssueStatesByIDs(ctx context.Context, ids []string) (map[string]string, error) {
	items, err := c.FetchIssuesByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(items))
	for _, item := range items {
		out[item.ID] = item.State
	}
	return out, nil
}

func (c *adapterClient) FetchIssues(ctx context.Context, filter tracker.IssueFilter) ([]tracker.Issue, error) {
	return c.adapter.Fetch(ctx, tracker.Filter{
		States:     filter.States,
		ProjectID:  filter.ProjectID,
		AssigneeID: filter.AssigneeID,
	})
}

func (c *adapterClient) SearchIssues(ctx context.Context, query string) ([]tracker.Issue, error) {
	return c.adapter.Search(ctx, query)
}

func (c *adapterClient) FetchIssueByIdentifier(ctx context.Context, identifier string) (*tracker.Issue, error) {
	return c.adapter.FetchByID(ctx, identifier)
}

func (c *adapterClient) CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID, provider string, disabledTools []string) (*tracker.Issue, error) {
	item := tracker.WorkItem{
		Title:         title,
		Description:   description,
		State:         state,
		Priority:      priority,
		AssigneeID:    assigneeID,
		ProjectID:     projectID,
		Provider:      provider,
		DisabledTools: disabledTools,
	}
	return c.adapter.Create(ctx, item)
}

func (c *adapterClient) UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*tracker.Issue, error) {
	return c.adapter.Update(ctx, identifier, updates)
}

func (c *adapterClient) DeleteIssue(ctx context.Context, identifier string) error {
	return c.adapter.Delete(ctx, identifier)
}
```

- [ ] **Step 5: Run tests**

```bash
cd apps/backend && go test ./internal/tracker/registry/... -v
```

Expected: PASS

- [ ] **Step 6: Build check**

```bash
cd apps/backend && go build ./...
```

- [ ] **Step 7: Commit**

```bash
git add apps/backend/internal/tracker/registry/
git commit -m "feat(tracker): add TrackerRegistry and adapterClient wrapper"
```

---

### Task 4: Linear adapter

**Files:**
- Create: `apps/backend/internal/tracker/linear/client.go`
- Create: `apps/backend/internal/tracker/linear/mapper.go`
- Create: `apps/backend/internal/tracker/linear/client_test.go`

- [ ] **Step 1: Write the failing test (with httptest stub)**

```go
// apps/backend/internal/tracker/linear/client_test.go
package linear_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker/linear"
)

func TestFetch_ReturnsWorkItems(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes": []map[string]any{
						{
							"id":         "abc-123",
							"identifier": "ENG-42",
							"title":      "Fix login bug",
							"state":      map[string]any{"type": "started", "name": "In Progress"},
							"priority":   2,
							"url":        "https://linear.app/eng/issue/ENG-42",
						},
					},
				},
			},
		})
	}))
	defer srv.Close()

	client := linear.NewClient("ENG", "test-token", srv.Client(), srv.URL)
	items, err := client.Fetch(context.Background(), linear.FilterAll())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].Identifier != "ENG-42" {
		t.Errorf("identifier: got %q, want %q", items[0].Identifier, "ENG-42")
	}
	if items[0].State != "In Progress" {
		t.Errorf("state: got %q, want %q", items[0].State, "In Progress")
	}
	if items[0].Source != "linear" {
		t.Errorf("source: got %q, want %q", items[0].Source, "linear")
	}
}

func TestPing_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{"viewer": map[string]any{"id": "user-1", "email": "test@example.com"}},
		})
	}))
	defer srv.Close()

	client := linear.NewClient("ENG", "test-token", srv.Client(), srv.URL)
	if err := client.Ping(context.Background()); err != nil {
		t.Errorf("Ping: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/backend && go test ./internal/tracker/linear/... -v
```

Expected: FAIL — package not found

- [ ] **Step 3: Implement mapper.go**

```go
// apps/backend/internal/tracker/linear/mapper.go
package linear

import "github.com/orchestra/orchestra/apps/backend/internal/tracker"

// defaultStateMap maps Linear state types to Orchestra states.
var defaultStateMap = map[string]string{
	"backlog":    "Backlog",
	"unstarted":  "Todo",
	"started":    "In Progress",
	"completed":  "Done",
	"cancelled":  "Cancelled",
}

type linearIssueNode struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
	Description string `json:"description"`
	Priority   int    `json:"priority"`
	URL        string `json:"url"`
	State      struct {
		Type string `json:"type"`
		Name string `json:"name"`
	} `json:"state"`
	Labels struct {
		Nodes []struct{ Name string `json:"name"` } `json:"nodes"`
	} `json:"labels"`
	Assignee *struct{ ID string `json:"id"` } `json:"assignee"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func mapNode(n linearIssueNode, stateMap map[string]string) tracker.WorkItem {
	sm := stateMap
	if sm == nil {
		sm = defaultStateMap
	}
	state := n.State.Name
	if mapped, ok := sm[n.State.Type]; ok {
		state = mapped
	}
	labels := make([]string, 0, len(n.Labels.Nodes))
	for _, l := range n.Labels.Nodes {
		labels = append(labels, l.Name)
	}
	assigneeID := ""
	if n.Assignee != nil {
		assigneeID = n.Assignee.ID
	}
	return tracker.WorkItem{
		ID:          "linear:" + n.ID,
		Identifier:  n.Identifier,
		Source:      "linear",
		Title:       n.Title,
		Description: n.Description,
		Priority:    n.Priority,
		State:       state,
		URL:         n.URL,
		Labels:      labels,
		AssigneeID:  assigneeID,
		CreatedAt:   n.CreatedAt,
		UpdatedAt:   n.UpdatedAt,
	}
}
```

- [ ] **Step 4: Implement client.go**

```go
// apps/backend/internal/tracker/linear/client.go
package linear

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

const defaultEndpoint = "https://api.linear.app/graphql"

// Client implements tracker.Adapter against the Linear GraphQL API.
type Client struct {
	teamKey    string
	token      string
	httpClient *http.Client
	endpoint   string
	stateMap   map[string]string // from extra config, nil = use default
}

// NewClient creates a Linear adapter. Pass a custom endpoint for testing.
func NewClient(teamKey, token string, httpClient *http.Client, endpoint string) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	ep := defaultEndpoint
	if endpoint != "" {
		ep = endpoint
	}
	return &Client{teamKey: teamKey, token: token, httpClient: httpClient, endpoint: ep}
}

// FilterAll returns a Filter that fetches all issues (no state restriction).
func FilterAll() tracker.Filter { return tracker.Filter{} }

func (c *Client) graphql(ctx context.Context, query string, variables map[string]any, out any) error {
	body := map[string]any{"query": query, "variables": variables}
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("linear API: status %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) Fetch(ctx context.Context, filter tracker.Filter) ([]tracker.WorkItem, error) {
	const q = `query($teamKey: String!) {
		issues(filter: { team: { key: { eq: $teamKey } } }, first: 100) {
			nodes {
				id identifier title description priority url createdAt updatedAt
				state { type name }
				labels { nodes { name } }
				assignee { id }
			}
		}
	}`
	var resp struct {
		Data struct {
			Issues struct {
				Nodes []linearIssueNode `json:"nodes"`
			} `json:"issues"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{"teamKey": c.teamKey}, &resp); err != nil {
		return nil, err
	}
	items := make([]tracker.WorkItem, 0, len(resp.Data.Issues.Nodes))
	for _, n := range resp.Data.Issues.Nodes {
		items = append(items, mapNode(n, c.stateMap))
	}
	return items, nil
}

func (c *Client) FetchByID(ctx context.Context, id string) (*tracker.WorkItem, error) {
	const q = `query($id: String!) {
		issue(id: $id) {
			id identifier title description priority url createdAt updatedAt
			state { type name }
			labels { nodes { name } }
			assignee { id }
		}
	}`
	var resp struct {
		Data struct {
			Issue linearIssueNode `json:"issue"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{"id": id}, &resp); err != nil {
		return nil, err
	}
	item := mapNode(resp.Data.Issue, c.stateMap)
	return &item, nil
}

func (c *Client) Search(ctx context.Context, query string) ([]tracker.WorkItem, error) {
	const q = `query($teamKey: String!, $query: String!) {
		issues(filter: { team: { key: { eq: $teamKey } }, title: { containsIgnoreCase: $query } }, first: 50) {
			nodes { id identifier title description priority url createdAt updatedAt state { type name } labels { nodes { name } } assignee { id } }
		}
	}`
	var resp struct {
		Data struct {
			Issues struct{ Nodes []linearIssueNode `json:"nodes"` } `json:"issues"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{"teamKey": c.teamKey, "query": query}, &resp); err != nil {
		return nil, err
	}
	items := make([]tracker.WorkItem, 0, len(resp.Data.Issues.Nodes))
	for _, n := range resp.Data.Issues.Nodes {
		items = append(items, mapNode(n, c.stateMap))
	}
	return items, nil
}

func (c *Client) Create(ctx context.Context, item tracker.WorkItem) (*tracker.WorkItem, error) {
	const q = `mutation($title: String!, $description: String, $teamId: String!) {
		issueCreate(input: { title: $title, description: $description, teamId: $teamId }) {
			issue { id identifier title description priority url createdAt updatedAt state { type name } labels { nodes { name } } assignee { id } }
		}
	}`
	var resp struct {
		Data struct {
			IssueCreate struct {
				Issue linearIssueNode `json:"issue"`
			} `json:"issueCreate"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{
		"title": item.Title, "description": item.Description, "teamId": c.teamKey,
	}, &resp); err != nil {
		return nil, err
	}
	created := mapNode(resp.Data.IssueCreate.Issue, c.stateMap)
	return &created, nil
}

func (c *Client) Update(ctx context.Context, id string, updates map[string]any) (*tracker.WorkItem, error) {
	const q = `mutation($id: String!, $input: IssueUpdateInput!) {
		issueUpdate(id: $id, input: $input) {
			issue { id identifier title description priority url createdAt updatedAt state { type name } labels { nodes { name } } assignee { id } }
		}
	}`
	input := map[string]any{}
	if v, ok := updates["state"]; ok {
		input["stateId"] = v
	}
	if v, ok := updates["assignee_id"]; ok {
		input["assigneeId"] = v
	}
	if v, ok := updates["priority"]; ok {
		input["priority"] = v
	}
	var resp struct {
		Data struct {
			IssueUpdate struct {
				Issue linearIssueNode `json:"issue"`
			} `json:"issueUpdate"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{"id": id, "input": input}, &resp); err != nil {
		return nil, err
	}
	updated := mapNode(resp.Data.IssueUpdate.Issue, c.stateMap)
	return &updated, nil
}

func (c *Client) Delete(ctx context.Context, id string) error {
	const q = `mutation($id: String!) { issueDelete(id: $id) { success } }`
	return c.graphql(ctx, q, map[string]any{"id": id}, &struct{}{})
}

func (c *Client) Comment(ctx context.Context, id, body string) error {
	const q = `mutation($issueId: String!, $body: String!) {
		commentCreate(input: { issueId: $issueId, body: $body }) { comment { id } }
	}`
	return c.graphql(ctx, q, map[string]any{"issueId": id, "body": body}, &struct{}{})
}

func (c *Client) FetchProjects(ctx context.Context) ([]tracker.TrackerProject, error) {
	const q = `{ teams { nodes { id name } } }`
	var resp struct {
		Data struct {
			Teams struct {
				Nodes []struct {
					ID   string `json:"id"`
					Name string `json:"name"`
				} `json:"nodes"`
			} `json:"teams"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, nil, &resp); err != nil {
		return nil, err
	}
	out := make([]tracker.TrackerProject, 0, len(resp.Data.Teams.Nodes))
	for _, n := range resp.Data.Teams.Nodes {
		out = append(out, tracker.TrackerProject{ID: n.ID, Name: n.Name})
	}
	return out, nil
}

func (c *Client) FetchStates(ctx context.Context) ([]tracker.TrackerState, error) {
	const q = `query($teamKey: String!) {
		workflowStates(filter: { team: { key: { eq: $teamKey } } }) {
			nodes { id name type }
		}
	}`
	var resp struct {
		Data struct {
			WorkflowStates struct {
				Nodes []struct {
					ID   string `json:"id"`
					Name string `json:"name"`
					Type string `json:"type"`
				} `json:"nodes"`
			} `json:"workflowStates"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, map[string]any{"teamKey": c.teamKey}, &resp); err != nil {
		return nil, err
	}
	out := make([]tracker.TrackerState, 0, len(resp.Data.WorkflowStates.Nodes))
	for _, n := range resp.Data.WorkflowStates.Nodes {
		out = append(out, tracker.TrackerState{ID: n.ID, Name: n.Name, Type: n.Type})
	}
	return out, nil
}

func (c *Client) Ping(ctx context.Context) error {
	const q = `{ viewer { id email } }`
	var resp struct {
		Data struct {
			Viewer struct{ ID string `json:"id"` } `json:"viewer"`
		} `json:"data"`
	}
	if err := c.graphql(ctx, q, nil, &resp); err != nil {
		return err
	}
	if resp.Data.Viewer.ID == "" {
		return fmt.Errorf("linear: viewer ID empty — invalid token")
	}
	return nil
}
```

- [ ] **Step 5: Run tests**

```bash
cd apps/backend && go test ./internal/tracker/linear/... -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/internal/tracker/linear/
git commit -m "feat(tracker): add Linear GraphQL adapter"
```

---

### Task 5: Jira adapter

**Files:**
- Create: `apps/backend/internal/tracker/jira/client.go`
- Create: `apps/backend/internal/tracker/jira/mapper.go`
- Create: `apps/backend/internal/tracker/jira/client_test.go`

- [ ] **Step 1: Write the failing test**

```go
// apps/backend/internal/tracker/jira/client_test.go
package jira_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker/jira"
)

func TestFetch_ReturnsWorkItems(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/api/3/search":
			json.NewEncoder(w).Encode(map[string]any{
				"issues": []map[string]any{
					{
						"id":  "10001",
						"key": "PROJ-1",
						"fields": map[string]any{
							"summary":     "Fix the bug",
							"description": nil,
							"priority":    map[string]any{"name": "High"},
							"status":      map[string]any{"name": "In Progress"},
							"labels":      []string{"backend"},
						},
					},
				},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	client := jira.NewClient(srv.URL, "user@example.com", "pat-token", srv.Client(), map[string]string{
		"In Progress": "In Progress",
	})
	items, err := client.Fetch(context.Background(), jira.FilterFromJQL("project = PROJ"))
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].Identifier != "PROJ-1" {
		t.Errorf("identifier: got %q, want %q", items[0].Identifier, "PROJ-1")
	}
	if items[0].Source != "jira" {
		t.Errorf("source: got %q, want %q", items[0].Source, "jira")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/backend && go test ./internal/tracker/jira/... -v
```

Expected: FAIL — package not found

- [ ] **Step 3: Implement mapper.go**

```go
// apps/backend/internal/tracker/jira/mapper.go
package jira

import "github.com/orchestra/orchestra/apps/backend/internal/tracker"

type jiraIssue struct {
	ID  string `json:"id"`
	Key string `json:"key"`
	Fields struct {
		Summary     string `json:"summary"`
		Description any    `json:"description"` // v3 uses ADF, v2 uses string
		Priority    *struct{ Name string `json:"name"` } `json:"priority"`
		Status      struct{ Name string `json:"name"` } `json:"status"`
		Labels      []string `json:"labels"`
		Assignee    *struct{ AccountID string `json:"accountId"` } `json:"assignee"`
		Created     string `json:"created"`
		Updated     string `json:"updated"`
	} `json:"fields"`
}

func mapIssue(i jiraIssue, stateMap map[string]string, baseURL string) tracker.WorkItem {
	state := i.Fields.Status.Name
	if mapped, ok := stateMap[state]; ok {
		state = mapped
	}
	priority := 0
	if i.Fields.Priority != nil {
		switch i.Fields.Priority.Name {
		case "Highest", "Critical":
			priority = 1
		case "High":
			priority = 2
		case "Medium":
			priority = 3
		case "Low":
			priority = 4
		}
	}
	assigneeID := ""
	if i.Fields.Assignee != nil {
		assigneeID = i.Fields.Assignee.AccountID
	}
	desc := ""
	if s, ok := i.Fields.Description.(string); ok {
		desc = s
	}
	return tracker.WorkItem{
		ID:          "jira:" + i.ID,
		Identifier:  i.Key,
		Source:      "jira",
		Title:       i.Fields.Summary,
		Description: desc,
		Priority:    priority,
		State:       state,
		URL:         baseURL + "/browse/" + i.Key,
		Labels:      i.Fields.Labels,
		AssigneeID:  assigneeID,
		CreatedAt:   i.Fields.Created,
		UpdatedAt:   i.Fields.Updated,
	}
}
```

- [ ] **Step 4: Implement client.go**

```go
// apps/backend/internal/tracker/jira/client.go
package jira

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

// Client implements tracker.Adapter against the Jira REST API (Cloud v3 or Server v2).
type Client struct {
	baseURL    string
	apiBase    string // /rest/api/3 or /rest/api/2
	user       string // email for Cloud, username for Server
	token      string // Bearer token (Cloud) or PAT (Server)
	httpClient *http.Client
	stateMap   map[string]string
	jql        string
}

// NewClient creates a Jira adapter. baseURL is the Jira instance URL (e.g. https://myorg.atlassian.net).
// Cloud is detected by ".atlassian.net" in the URL; otherwise Server/DC auth is used.
func NewClient(baseURL, user, token string, httpClient *http.Client, stateMap map[string]string) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	apiBase := "/rest/api/3"
	if !strings.Contains(baseURL, ".atlassian.net") {
		apiBase = "/rest/api/2"
	}
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiBase:    apiBase,
		user:       user,
		token:      token,
		httpClient: httpClient,
		stateMap:   stateMap,
	}
}

// FilterFromJQL creates a Filter carrying a JQL string in its Extra field (used internally).
func FilterFromJQL(jql string) tracker.Filter {
	return tracker.Filter{States: []string{"__jql:" + jql}}
}

func (c *Client) request(ctx context.Context, method, path string, body any, out any) error {
	var bodyReader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(b)
	} else {
		bodyReader = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	// Cloud: Bearer token. Server: Basic auth with PAT.
	if strings.Contains(c.baseURL, ".atlassian.net") {
		req.Header.Set("Authorization", "Bearer "+c.token)
	} else {
		req.SetBasicAuth(c.user, c.token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("jira API %s %s: status %d", method, path, resp.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

func (c *Client) Fetch(ctx context.Context, filter tracker.Filter) ([]tracker.WorkItem, error) {
	jql := c.jql
	// Check for inline JQL from FilterFromJQL
	for _, s := range filter.States {
		if strings.HasPrefix(s, "__jql:") {
			jql = strings.TrimPrefix(s, "__jql:")
			break
		}
	}
	if jql == "" {
		jql = "order by created DESC"
	}
	path := c.apiBase + "/search?jql=" + url.QueryEscape(jql) + "&maxResults=100&fields=summary,description,priority,status,labels,assignee,created,updated"
	var resp struct {
		Issues []jiraIssue `json:"issues"`
	}
	if err := c.request(ctx, http.MethodGet, path, nil, &resp); err != nil {
		return nil, err
	}
	items := make([]tracker.WorkItem, 0, len(resp.Issues))
	for _, i := range resp.Issues {
		items = append(items, mapIssue(i, c.stateMap, c.baseURL))
	}
	return items, nil
}

func (c *Client) FetchByID(ctx context.Context, id string) (*tracker.WorkItem, error) {
	var i jiraIssue
	if err := c.request(ctx, http.MethodGet, c.apiBase+"/issue/"+id, nil, &i); err != nil {
		return nil, err
	}
	item := mapIssue(i, c.stateMap, c.baseURL)
	return &item, nil
}

func (c *Client) Search(ctx context.Context, query string) ([]tracker.WorkItem, error) {
	jql := fmt.Sprintf(`text ~ %q ORDER BY updated DESC`, query)
	return c.Fetch(ctx, FilterFromJQL(jql))
}

func (c *Client) Create(ctx context.Context, item tracker.WorkItem) (*tracker.WorkItem, error) {
	body := map[string]any{
		"fields": map[string]any{
			"summary":     item.Title,
			"description": item.Description,
		},
	}
	var resp jiraIssue
	if err := c.request(ctx, http.MethodPost, c.apiBase+"/issue", body, &resp); err != nil {
		return nil, err
	}
	return c.FetchByID(ctx, resp.Key)
}

func (c *Client) Update(ctx context.Context, id string, updates map[string]any) (*tracker.WorkItem, error) {
	fields := map[string]any{}
	if v, ok := updates["title"]; ok {
		fields["summary"] = v
	}
	if _, ok := updates["state"]; ok {
		// State changes require a transition call
		if err := c.transition(ctx, id, fmt.Sprintf("%v", updates["state"])); err != nil {
			return nil, err
		}
	}
	if len(fields) > 0 {
		if err := c.request(ctx, http.MethodPut, c.apiBase+"/issue/"+id, map[string]any{"fields": fields}, nil); err != nil {
			return nil, err
		}
	}
	return c.FetchByID(ctx, id)
}

func (c *Client) transition(ctx context.Context, id, targetState string) error {
	var resp struct {
		Transitions []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"transitions"`
	}
	if err := c.request(ctx, http.MethodGet, c.apiBase+"/issue/"+id+"/transitions", nil, &resp); err != nil {
		return err
	}
	for _, t := range resp.Transitions {
		if strings.EqualFold(t.Name, targetState) {
			return c.request(ctx, http.MethodPost, c.apiBase+"/issue/"+id+"/transitions",
				map[string]any{"transition": map[string]any{"id": t.ID}}, nil)
		}
	}
	return fmt.Errorf("jira: no transition named %q on issue %s", targetState, id)
}

func (c *Client) Delete(ctx context.Context, id string) error {
	return c.request(ctx, http.MethodDelete, c.apiBase+"/issue/"+id, nil, nil)
}

func (c *Client) Comment(ctx context.Context, id, body string) error {
	return c.request(ctx, http.MethodPost, c.apiBase+"/issue/"+id+"/comment",
		map[string]any{"body": body}, nil)
}

func (c *Client) FetchProjects(ctx context.Context) ([]tracker.TrackerProject, error) {
	var projects []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Key  string `json:"key"`
	}
	if err := c.request(ctx, http.MethodGet, c.apiBase+"/project", nil, &projects); err != nil {
		return nil, err
	}
	out := make([]tracker.TrackerProject, 0, len(projects))
	for _, p := range projects {
		out = append(out, tracker.TrackerProject{ID: p.Key, Name: p.Name})
	}
	return out, nil
}

func (c *Client) FetchStates(ctx context.Context) ([]tracker.TrackerState, error) {
	var statuses []struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		StatusCategory struct{ Key string `json:"key"` } `json:"statusCategory"`
	}
	if err := c.request(ctx, http.MethodGet, c.apiBase+"/status", nil, &statuses); err != nil {
		return nil, err
	}
	out := make([]tracker.TrackerState, 0, len(statuses))
	for _, s := range statuses {
		t := "todo"
		switch s.StatusCategory.Key {
		case "indeterminate":
			t = "in_progress"
		case "done":
			t = "done"
		}
		out = append(out, tracker.TrackerState{ID: s.ID, Name: s.Name, Type: t})
	}
	return out, nil
}

func (c *Client) Ping(ctx context.Context) error {
	var resp struct{ AccountID string `json:"accountId"` }
	return c.request(ctx, http.MethodGet, c.apiBase+"/myself", nil, &resp)
}
```

- [ ] **Step 5: Run tests**

```bash
cd apps/backend && go test ./internal/tracker/jira/... -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/backend/internal/tracker/jira/
git commit -m "feat(tracker): add Jira REST adapter (Cloud + Server)"
```

---

### Task 6: Wire TrackerRegistry into app/run.go

**Files:**
- Modify: `apps/backend/internal/app/run.go`

- [ ] **Step 1: Add registry imports and factory wiring**

At the top of `apps/backend/internal/app/run.go`, add imports:

```go
trackerregistry "github.com/orchestra/orchestra/apps/backend/internal/tracker/registry"
"github.com/orchestra/orchestra/apps/backend/internal/tracker/linear"
"github.com/orchestra/orchestra/apps/backend/internal/tracker/jira"
```

- [ ] **Step 2: Replace newTrackerClient with registry construction**

Find the line:
```go
trackerClient := newTrackerClient(cfg, warehouseDB)
```

Replace it with:

```go
trackerRegistry := trackerregistry.NewWithFactory(warehouseDB, buildTrackerAdapter)
if err := trackerRegistry.SeedFromEnvConfig(cfg, warehouseDB); err != nil {
    logger.Warn().Err(err).Msg("tracker registry seed from env config failed")
}
trackerClient := trackerRegistry.DefaultClient()
orchestratorService.SetTrackerClient(trackerClient)
orchestratorService.SetTrackerRegistry(trackerRegistry)
```

- [ ] **Step 3: Add buildTrackerAdapter factory function**

Add this function to `run.go`:

```go
// buildTrackerAdapter constructs the appropriate tracker.Adapter from a DB config.
// Passed to the registry as a factory to avoid import cycles.
func buildTrackerAdapter(cfg *db.TrackerConfig, token string) (tracker.Adapter, error) {
	switch cfg.Type {
	case "linear":
		return linear.NewClient(cfg.Endpoint, token, nil, ""), nil
	case "jira":
		var extra struct {
			StateMap map[string]string `json:"state_map"`
		}
		if cfg.Extra != "" {
			_ = json.Unmarshal([]byte(cfg.Extra), &extra)
		}
		return jira.NewClient(cfg.Endpoint, "", token, nil, extra.StateMap), nil
	default:
		return nil, fmt.Errorf("unsupported tracker type %q", cfg.Type)
	}
}
```

- [ ] **Step 4: Add NewWithFactory and SeedFromEnvConfig to registry**

Add to `apps/backend/internal/tracker/registry/registry.go`:

```go
// AdapterFactory builds an Adapter from a TrackerConfig and decrypted token.
type AdapterFactory func(cfg *db.TrackerConfig, token string) (tracker.Adapter, error)

// NewWithFactory creates a Registry using the provided factory to build adapters.
// This breaks the import cycle between registry → linear/jira packages.
func NewWithFactory(database *db.DB, factory AdapterFactory) *Registry {
	r := &Registry{
		adapters:   make(map[string]tracker.Adapter),
		projectMap: make(map[string]string),
		database:   database,
		factory:    factory,
	}
	if err := r.loadAllWithFactory(context.Background()); err != nil {
		// Non-fatal: log and continue; misconfigured adapters are skipped
		_ = err
	}
	return r
}

// SeedFromEnvConfig seeds a default tracker_config row from legacy env-var config if none exist.
// This ensures zero breaking change for existing deployments.
func (r *Registry) SeedFromEnvConfig(cfg config.Config, database *db.DB) error {
	if database == nil {
		return nil
	}
	existing, err := database.ListTrackerConfigs(context.Background())
	if err != nil || len(existing) > 0 {
		return err
	}
	if cfg.TrackerType == "" || cfg.TrackerType == "sqlite" || cfg.TrackerType == "memory" {
		return nil
	}
	encToken, err := db.EncryptToken(cfg.TrackerToken)
	if err != nil {
		encToken = cfg.TrackerToken
	}
	seed := db.TrackerConfig{
		ID:          "default",
		Type:        cfg.TrackerType,
		DisplayName: strings.Title(cfg.TrackerType) + " (from env)",
		Endpoint:    cfg.TrackerEndpoint,
		AuthMethod:  "apikey",
		TokenEnc:    encToken,
	}
	return database.UpsertTrackerConfig(context.Background(), seed)
}

// DefaultClient returns a tracker.Client for the default (first) config, or falls back to SQLite.
func (r *Registry) DefaultClient() tracker.Client {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, a := range r.adapters {
		return &adapterClient{adapter: a}
	}
	return nil // caller falls back to existing SQLite/memory client
}
```

Also add the `factory` field to the Registry struct:
```go
type Registry struct {
    mu         sync.RWMutex
    adapters   map[string]tracker.Adapter
    projectMap map[string]string
    database   *db.DB
    factory    AdapterFactory
}
```

And `loadAllWithFactory`:
```go
func (r *Registry) loadAllWithFactory(ctx context.Context) error {
    if r.database == nil || r.factory == nil {
        return nil
    }
    configs, err := r.database.ListTrackerConfigs(ctx)
    if err != nil {
        return err
    }
    for _, cfg := range configs {
        token, err := db.DecryptToken(cfg.TokenEnc)
        if err != nil {
            continue
        }
        a, err := r.factory(&cfg, token)
        if err != nil {
            continue
        }
        r.adapters[cfg.ID] = a
    }
    return nil
}
```

- [ ] **Step 5: Keep the legacy newTrackerClient as fallback**

Rename the existing `newTrackerClient` to `newLegacyTrackerClient` and call it as fallback when `registry.DefaultClient()` returns nil:

```go
trackerClient := trackerRegistry.DefaultClient()
if trackerClient == nil {
    trackerClient = newLegacyTrackerClient(cfg, warehouseDB)
}
```

- [ ] **Step 6: Build and run tests**

```bash
cd apps/backend && go build ./... && go test ./...
```

Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add apps/backend/internal/app/run.go apps/backend/internal/tracker/registry/registry.go
git commit -m "feat(app): wire TrackerRegistry with factory pattern and env-var seeding"
```

---

### Task 7: Tracker Configs API endpoints

**Files:**
- Create: `apps/backend/internal/api/tracker_configs.go`
- Modify: `apps/backend/internal/api/router.go`
- Modify: `apps/backend/internal/api/state.go` (add `registry` field to Server)

- [ ] **Step 1: Add registry field to Server struct**

In `apps/backend/internal/api/state.go`, find the `Server` struct and add:

```go
registry *trackerregistry.Registry
```

Add the import:
```go
trackerregistry "github.com/orchestra/orchestra/apps/backend/internal/tracker/registry"
```

Update the `NewServer` / `NewRouterWithPubSub` constructor to accept and wire the registry (check the existing signature in `router.go` and add the parameter there too).

- [ ] **Step 2: Implement tracker_configs.go**

```go
// apps/backend/internal/api/tracker_configs.go
package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

// GetTrackerConfigs handles GET /api/v1/tracker/configs
func (s *Server) GetTrackerConfigs(w http.ResponseWriter, r *http.Request) {
	configs, err := s.db.ListTrackerConfigs(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	// Redact tokens before returning
	for i := range configs {
		if configs[i].TokenEnc != "" {
			configs[i].TokenEnc = "***"
		}
		configs[i].RefreshEnc = ""
	}
	writeJSON(w, http.StatusOK, configs)
}

// PostTrackerConfig handles POST /api/v1/tracker/configs
func (s *Server) PostTrackerConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Type        string            `json:"type"`
		DisplayName string            `json:"display_name"`
		Endpoint    string            `json:"endpoint"`
		AuthMethod  string            `json:"auth_method"`
		Token       string            `json:"token"`
		Extra       map[string]any    `json:"extra"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if req.Type == "" || req.DisplayName == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_fields", "type and display_name are required")
		return
	}

	encToken, err := db.EncryptToken(req.Token)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "encrypt_error", "failed to encrypt token")
		return
	}

	extraJSON := "{}"
	if req.Extra != nil {
		b, _ := json.Marshal(req.Extra)
		extraJSON = string(b)
	}

	cfg := db.TrackerConfig{
		ID:          uuid.New().String(),
		Type:        req.Type,
		DisplayName: req.DisplayName,
		Endpoint:    req.Endpoint,
		AuthMethod:  req.AuthMethod,
		TokenEnc:    encToken,
		Extra:       extraJSON,
		CreatedAt:   time.Now().Unix(),
		UpdatedAt:   time.Now().Unix(),
	}
	if err := s.db.UpsertTrackerConfig(r.Context(), cfg); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if s.registry != nil {
		_ = s.registry.Reload(r.Context(), cfg.ID)
	}
	cfg.TokenEnc = "***"
	writeJSON(w, http.StatusCreated, cfg)
}

// PatchTrackerConfig handles PATCH /api/v1/tracker/configs/{config_id}
func (s *Server) PatchTrackerConfig(w http.ResponseWriter, r *http.Request) {
	configID := chi.URLParam(r, "config_id")
	existing, err := s.db.GetTrackerConfig(r.Context(), configID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", "tracker config not found")
		return
	}

	var req struct {
		DisplayName *string        `json:"display_name"`
		Endpoint    *string        `json:"endpoint"`
		Token       *string        `json:"token"`
		Extra       map[string]any `json:"extra"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}

	if req.DisplayName != nil {
		existing.DisplayName = *req.DisplayName
	}
	if req.Endpoint != nil {
		existing.Endpoint = *req.Endpoint
	}
	if req.Token != nil && *req.Token != "" {
		enc, err := db.EncryptToken(*req.Token)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "encrypt_error", "failed to encrypt token")
			return
		}
		existing.TokenEnc = enc
	}
	if req.Extra != nil {
		b, _ := json.Marshal(req.Extra)
		existing.Extra = string(b)
	}

	if err := s.db.UpsertTrackerConfig(r.Context(), *existing); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if s.registry != nil {
		_ = s.registry.Reload(r.Context(), configID)
	}
	existing.TokenEnc = "***"
	existing.RefreshEnc = ""
	writeJSON(w, http.StatusOK, existing)
}

// DeleteTrackerConfig handles DELETE /api/v1/tracker/configs/{config_id}
func (s *Server) DeleteTrackerConfig(w http.ResponseWriter, r *http.Request) {
	configID := chi.URLParam(r, "config_id")
	if err := s.db.DeleteTrackerConfig(r.Context(), configID); err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", "tracker config not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
}

// PostTrackerConfigTest handles POST /api/v1/tracker/configs/{config_id}/test
func (s *Server) PostTrackerConfigTest(w http.ResponseWriter, r *http.Request) {
	configID := chi.URLParam(r, "config_id")
	if s.registry == nil {
		writeJSONError(w, http.StatusInternalServerError, "no_registry", "registry not available")
		return
	}
	a, err := s.registry.GetAdapter(configID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", "adapter not loaded for config")
		return
	}
	if err := a.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GetTrackerProjects handles GET /api/v1/tracker/configs/{config_id}/projects
func (s *Server) GetTrackerProjects(w http.ResponseWriter, r *http.Request) {
	configID := chi.URLParam(r, "config_id")
	a, err := s.registry.GetAdapter(configID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", "adapter not loaded")
		return
	}
	projects, err := a.FetchProjects(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "fetch_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

// GetTrackerStates handles GET /api/v1/tracker/configs/{config_id}/states
func (s *Server) GetTrackerStates(w http.ResponseWriter, r *http.Request) {
	configID := chi.URLParam(r, "config_id")
	a, err := s.registry.GetAdapter(configID)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", "adapter not loaded")
		return
	}
	states, err := a.FetchStates(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "fetch_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, states)
}

// PostProjectTrackerConfig handles POST /api/v1/projects/{project_id}/tracker
func (s *Server) PostProjectTrackerConfig(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "project_id")
	var req struct {
		ConfigID string `json:"config_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "invalid request body")
		return
	}
	if err := s.db.SetProjectTrackerConfig(r.Context(), projectID, req.ConfigID); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
```

- [ ] **Step 3: Register routes in router.go**

In `apps/backend/internal/api/router.go`, inside the `protected` route block, add:

```go
// Tracker configs
protected.Get("/api/v1/tracker/configs", server.GetTrackerConfigs)
protected.Post("/api/v1/tracker/configs", server.PostTrackerConfig)
protected.Patch("/api/v1/tracker/configs/{config_id}", server.PatchTrackerConfig)
protected.Delete("/api/v1/tracker/configs/{config_id}", server.DeleteTrackerConfig)
protected.Post("/api/v1/tracker/configs/{config_id}/test", server.PostTrackerConfigTest)
protected.Get("/api/v1/tracker/configs/{config_id}/projects", server.GetTrackerProjects)
protected.Get("/api/v1/tracker/configs/{config_id}/states", server.GetTrackerStates)
// Per-project tracker assignment
protected.Post("/api/v1/projects/{project_id}/tracker", server.PostProjectTrackerConfig)
```

- [ ] **Step 4: Build and test**

```bash
cd apps/backend && go build ./... && go test ./...
```

Expected: all pass

- [ ] **Step 5: Smoke-test the API manually**

Start the backend:
```bash
ORCHESTRA_API_TOKEN=dev-token ORCHESTRA_WORKSPACE_ROOT=/tmp/orchestra ./apps/backend/orchestrad
```

Create a tracker config:
```bash
curl -s -X POST http://localhost:3284/api/v1/tracker/configs \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"linear","display_name":"Linear Test","endpoint":"ENG","auth_method":"apikey","token":"fake-token"}' | jq .
```

Expected: `{"id":"...","type":"linear","display_name":"Linear Test",...,"token_enc":"***"}`

- [ ] **Step 6: Commit**

```bash
git add apps/backend/internal/api/tracker_configs.go apps/backend/internal/api/router.go apps/backend/internal/api/state.go
git commit -m "feat(api): add tracker configs CRUD and test-connection endpoints"
```

---

## Completion Check

Run the full backend test suite:

```bash
cd apps/backend && go test -race ./...
```

Expected: all pass, no race conditions.

Verify no plaintext tokens appear in logs by grepping:
```bash
cd apps/backend && go build -o /tmp/orchestrad ./cmd/orchestrad && \
  ORCHESTRA_API_TOKEN=dev-token ORCHESTRA_WORKSPACE_ROOT=/tmp/orch-test /tmp/orchestrad 2>&1 | grep -i "token\|secret\|key" || echo "clean"
```
