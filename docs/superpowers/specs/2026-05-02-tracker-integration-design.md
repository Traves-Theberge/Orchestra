# Tracker Integration Design: Linear + Jira + Viewer Panels + Settings Overhaul

**Date:** 2026-05-02  
**Issue:** #150  
**Status:** Approved

---

## Overview

Add Linear and Jira as first-class issue tracker backends alongside the existing GitHub/SQLite/memory backends. Introduce a unified `WorkItem` domain type that normalises issues, stories, and tasks across all sources. Ship viewer panels (browse + detail) for Linear, Jira, and Git. Overhaul Settings into a proper multi-section system with a dedicated Connections page for managing tracker credentials and per-project tracker assignment.

---

## Section 1: Domain Model + TrackerRegistry

### WorkItem domain type (Go)

All tracker backends normalise into a single `WorkItem` type. `tracker.Issue` becomes a type alias for `WorkItem` during migration to avoid breaking existing call sites.

```go
type WorkItem struct {
    ID               string         // Tracker-prefixed: "gh:123", "linear:abc", "jira:PROJ-45"
    Identifier       string         // Native display ID: "PROJ-45", "#123", "TEAM-42"
    Source           string         // "github" | "linear" | "jira" | "sqlite" | "memory"
    Title            string
    Description      string
    State            string         // Normalised Orchestra state
    Priority         int
    URL              string
    Labels           []string
    Assignees        []string
    ProjectID        string
    BlockedBy        []Blocker
    Extra            map[string]any // Tracker-specific metadata (cycle, sprint, JQL match, etc.)
    CreatedAt        string
    UpdatedAt        string
    // Orchestra-managed fields
    BranchName       string
    AssignedToWorker bool
    DisabledTools    []string
    BaseSHA          string
    Feedback         string
    PRURL            string
    Plan             string
}
```

### Adapter interface

Each tracker package implements `Adapter`. `tracker.Client` wraps this so the rest of the codebase is unchanged.

```go
// Filter narrows which WorkItems are returned by Fetch.
type Filter struct {
    States     []string
    ProjectID  string
    AssigneeID string
}

// TrackerProject is a top-level container in the tracker (Linear team, Jira project, GitHub repo).
type TrackerProject struct {
    ID   string
    Name string
}

// TrackerState is a workflow state available in the tracker connection.
type TrackerState struct {
    ID   string
    Name string
    Type string // "todo" | "in_progress" | "done" | "cancelled"
}

type Adapter interface {
    Fetch(ctx context.Context, filter Filter) ([]WorkItem, error)
    FetchByID(ctx context.Context, id string) (*WorkItem, error)
    Search(ctx context.Context, query string) ([]WorkItem, error)
    Create(ctx context.Context, item WorkItem) (*WorkItem, error)
    Update(ctx context.Context, id string, updates map[string]any) (*WorkItem, error)
    Delete(ctx context.Context, id string) error
    Comment(ctx context.Context, id, body string) error
    // Browse support — used by the viewer panels
    FetchProjects(ctx context.Context) ([]TrackerProject, error)
    FetchStates(ctx context.Context) ([]TrackerState, error)
}
```

### Frontend WorkItem type (TypeScript)

```ts
type WorkItem = {
    id: string           // "gh:123", "linear:abc", "jira:PROJ-45"
    identifier: string   // Display ID
    source: 'github' | 'linear' | 'jira' | 'sqlite'
    title: string
    description: string
    state: string
    priority: number
    url: string
    labels: string[]
    assignees: string[]
    extra: Record<string, unknown>  // Cycle, sprint, JQL metadata
}
```

Viewer components (`WorkItemBrowser`, `WorkItemDetail`) accept `WorkItem` and never reference tracker-specific types.

---

## Section 2: TrackerRegistry + Per-Project Config

### TrackerRegistry (`internal/tracker/registry/`)

Owns all adapter instances keyed by config ID. Loaded at startup from `tracker_configs`, hot-reloadable when Settings saves a connection change. Runs a background goroutine refreshing OAuth tokens 5 minutes before expiry.

```go
type Registry struct {
    adapters map[string]tracker.Client  // configID → client
    db       *db.DB
    key      []byte                     // AES-GCM encryption key
}

func (r *Registry) GetForProject(projectID string) (tracker.Client, error)
func (r *Registry) Reload(configID string) error
func (r *Registry) List() []TrackerConfig
```

`app/run.go`'s `newTrackerClient()` is replaced by wiring the registry. All consumers (orchestrator, API handlers, tool executor) call `registry.GetForProject(projectID)`.

### Database schema

```sql
CREATE TABLE tracker_configs (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,      -- github|linear|jira|sqlite|memory
    display_name TEXT NOT NULL,
    endpoint     TEXT,               -- repo slug, Linear team key, Jira base URL
    auth_method  TEXT NOT NULL,      -- apikey|oauth
    token_enc    BLOB,               -- AES-GCM encrypted access token
    refresh_enc  BLOB,               -- AES-GCM encrypted refresh token (OAuth only)
    token_expiry INTEGER,            -- Unix timestamp, NULL if no expiry
    extra        TEXT,               -- JSON: JQL, cycle filter, state map overrides
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

ALTER TABLE projects ADD COLUMN tracker_config_id TEXT REFERENCES tracker_configs(id);
```

Encryption key lives at `{workspace_root}/.orchestra/keyfile` — generated once on first run, never stored in the DB.

### OAuth token lifecycle

Registry background goroutine checks expiry every minute. On refresh failure the config is marked `auth_error` and surfaced in the Connections page. Initial OAuth popup is handled in Electron via `BrowserWindow` + `orchestra://oauth/callback` custom protocol handler.

### Backward compatibility

Existing env-var config (`ORCHESTRA_TRACKER_TYPE`, `ORCHESTRA_TRACKER_TOKEN`, etc.) seeds a `tracker_configs` row on first run if none exist. Zero breaking change for existing deployments.

---

## Section 3: Linear + Jira Backends

### Package structure (shared pattern)

```
internal/tracker/linear/
    client.go      # Adapter implementation
    mapper.go      # API response → WorkItem normalisation
    auth.go        # OAuth exchange + refresh
internal/tracker/jira/
    client.go
    mapper.go
    auth.go
```

Mappers are the seam — all tracker-specific field names, state strings, and ID formats are resolved here. Everything above the mapper sees only `WorkItem`.

### Linear (`internal/tracker/linear/`)

- GraphQL client over `net/http` against `api.linear.app/graphql`, Bearer token auth
- No external SDK dependency
- Identifier format: `TEAM-123`
- Default ingestion scope: active cycle only; configurable via `extra.cycle_filter: false` for full backlog
- Write-back: `issueUpdate` mutation for state/assignee changes, `commentCreate` for comments and PR URL

**Default state mapping** (stored in `extra`, user-overridable):

| Linear state type | Orchestra state |
|---|---|
| `backlog` | `Backlog` |
| `unstarted` | `Todo` |
| `started` | `In Progress` |
| `completed` | `Done` |
| `cancelled` | `Cancelled` |

### Jira (`internal/tracker/jira/`)

- REST client; Cloud (`/rest/api/3`) vs Server (`/rest/api/2`) detected by base URL (`.atlassian.net` = Cloud)
- Cloud auth: Bearer token. Server auth: Basic auth (Personal Access Token)
- Identifier format: `PROJ-123`
- Ingestion via JQL stored in `extra.jql`, e.g. `project = PROJ AND sprint in openSprints()`
- State transitions via `POST /rest/api/3/issue/{id}/transitions`
- Comments via `POST /rest/api/3/issue/{id}/comment`

**State mapping** is fully user-defined in `extra.state_map` (Jira workflows are arbitrary):

```json
{
  "jql": "project = PROJ AND sprint in openSprints()",
  "state_map": {
    "To Do": "Todo",
    "In Progress": "In Progress",
    "In Review": "In Review",
    "Done": "Done"
  }
}
```

---

## Section 4: Viewer Panels

### Layout

All three viewers share a two-pane layout:

```
┌─────────────────────────────────────────────────┐
│  [Tracker selector]  [Search]  [Filter toolbar] │
├──────────────────┬──────────────────────────────┤
│  WorkItemBrowser │  WorkItemDetail               │
│  (list)          │  (title, description,         │
│                  │   state, comments, PR link)    │
└──────────────────┴──────────────────────────────┘
```

### Components

- **`WorkItemBrowser`** — virtualised list, search, filter by state/label/assignee, drag-to-kanban
- **`WorkItemDetail`** — renders any `WorkItem` regardless of source; `extra` fields displayed as metadata chips (cycle, sprint, JQL match)
- **`TrackerToolbar`** — slot component per tracker: `LinearToolbar` (cycle selector), `JiraToolbar` (JQL input), `GitToolbar` (branch selector, CI badge)

### Git viewer specifics

Git is modeled as `source: 'github'` so it uses the same viewer shell. The browse panel lists PRs + issues. The detail panel renders file-by-file diff (reusing `widgets/git/DiffViewer`), review comments, and approve/merge/close actions. Repo activity (commits, branches) lives in an **Activity tab** within the detail panel.

### Frontend data flow

```
TrackerRegistry (backend)
    ↓  REST API  ↓
useTrackerWorkItems(projectId, filter)   ← SWR/polling hook
    ↓
WorkItemBrowser + WorkItemDetail
```

`useTrackerWorkItems` handles fetching, caching (5-min TTL stale-while-revalidate), and deduplication. Cache keys are tracker-prefixed: `"linear:TEAM::abc"`, `"jira:PROJ::PROJ-45"`, `"gh:owner/repo::123"`.

---

## Section 5: Settings Overhaul

### Structure

Settings opens as a full-page overlay with a left nav. Each section is lazy-loaded and uses the `AppShell` section routing pattern from `src/components/app-shell/sections/`.

```
Settings
├── Connections       ← tracker + OAuth management
├── Agents            ← Claude/Codex/Gemini config (restructured from existing)
├── Workspace         ← worktree root, hooks, concurrency limits
├── Appearance        ← theme, density (foundation for #149 Theme Studio)
├── Integrations      ← MCP servers, webhooks
└── About             ← version, update channel
```

### Connections page

Tracker connections displayed as cards with status indicator:

```
┌─────────────────────────────────────────────────┐
│  + Add connection                               │
├─────────────────────────────────────────────────┤
│  ● GitHub        owner/repo       [Edit] [Test] │
│  ● Linear        Team: ENG        [Edit] [Test] │
│  ◌ Jira          auth error       [Fix]         │
└─────────────────────────────────────────────────┘
```

Each card opens an edit drawer with:
- Provider picker (GitHub / Linear / Jira / SQLite)
- Auth method: API Key or OAuth (OAuth triggers Electron `BrowserWindow` popup)
- Endpoint config: repo slug / team key / base URL + JQL
- State mapping editor: drag-and-drop map of tracker states → Orchestra states
- Test connection button: live ping showing latency + authenticated user
- Webhook URL + secret: display-only, for pasting into the tracker's webhook config

Per-project tracker assignment is on the **Project settings page** — a dropdown: "This project pulls from [connection selector]".

---

## Out of Scope (Follow-ups)

- Asana, ClickUp, Shortcut, Notion
- Bidirectional comment sync (Orchestra → tracker only on first pass)
- Custom field editing (standard fields only)
- Webhook ingestion for live push updates (polling first pass; webhooks as follow-up)

---

## Deliverables / Success Criteria

- Linear E2E: pull issues into Kanban → dispatch agent → PR opened → Linear issue moves to Done with PR link in comments
- Jira E2E: same loop against a Jira Cloud project
- Viewer panels reachable for Linear, Jira, and Git (browse + detail)
- Settings Connections page fully functional with test-connection and OAuth flow
- Per-project tracker switching works without daemon restart
- Encrypted token storage — no plaintext tokens on disk or in API responses
- Existing env-var deployments continue working without changes
