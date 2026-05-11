# Task Authoring Studio — Phase 1: Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend that holds in-progress task drafts, exposes the `orchestra-studio` MCP server's tool set, and serves a studio session API with SSE — testable end-to-end against an in-process fake runner. No real CLI agents and no frontend yet.

**Architecture:** New SQLite tables (`issue_drafts`, `studio_sessions`) and added columns on `issues`. A new `internal/studio/` package owns session lifecycle and draft state, composing existing primitives (DB, tracker, pubsub). A new `internal/mcp/studio/` in-process MCP server exposes draft-mutation tools and `push_to_backlog`. Chi routes under `/api/studio` provide REST + SSE. A fake runner is registered in tests to exercise the full chat→tool-call→draft→push flow without shelling out.

**Tech Stack:** Go 1.x, Chi router, modernc.org/sqlite, existing PubSub bus, existing tracker abstraction. No new external dependencies.

---

## File Structure

**New files:**
- `apps/backend/internal/db/studio.go` — DAO for `issue_drafts` and `studio_sessions`
- `apps/backend/internal/db/studio_test.go`
- `apps/backend/internal/studio/types.go` — `Draft`, `Session`, `Status`, event types
- `apps/backend/internal/studio/manager.go` — session lifecycle, draft mutations, push
- `apps/backend/internal/studio/manager_test.go`
- `apps/backend/internal/studio/fake_runner.go` — test-only in-process fake (build tag `studio_test` or exported as test helper)
- `apps/backend/internal/mcp/studio/server.go` — MCP server with the tool set
- `apps/backend/internal/mcp/studio/server_test.go`
- `apps/backend/internal/mcp/studio/tools.go` — tool handlers (`set_title`, etc.)
- `apps/backend/internal/api/studio.go` — Chi route handlers
- `apps/backend/internal/api/studio_test.go`

**Modified files:**
- `apps/backend/internal/db/schema.go` — add `CREATE TABLE` statements for new tables
- `apps/backend/internal/db/migrate.go` — add new column migrations on `issues`
- `apps/backend/internal/api/router.go` — mount `/api/studio` routes
- `apps/backend/internal/app/run.go` — wire `studio.Manager` into the service graph

---

## Task 1: Database schema — new tables

**Files:**
- Modify: `apps/backend/internal/db/schema.go`
- Test: `apps/backend/internal/db/studio_test.go` (create)

- [ ] **Step 1: Write the failing test**

```go
// apps/backend/internal/db/studio_test.go
package db

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := d.Exec(Schema); err != nil {
		t.Fatalf("schema: %v", err)
	}
	if err := runMigrations(d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return d
}

func TestStudioTablesExist(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	for _, table := range []string{"issue_drafts", "studio_sessions"} {
		var name string
		row := d.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table)
		if err := row.Scan(&name); err != nil {
			t.Fatalf("table %s missing: %v", table, err)
		}
	}
}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/backend && go test ./internal/db/ -run TestStudioTablesExist -v`
Expected: FAIL — `table issue_drafts missing`

- [ ] **Step 3: Add the tables to `schema.go`**

Append before the closing backtick of `const Schema = ` in `apps/backend/internal/db/schema.go`:

```sql
CREATE TABLE IF NOT EXISTS studio_sessions (
	id TEXT PRIMARY KEY,
	project_id TEXT,
	runner TEXT NOT NULL,
	started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	ended_at DATETIME,
	outcome TEXT,
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_studio_sessions_project_id ON studio_sessions(project_id);

CREATE TABLE IF NOT EXISTS issue_drafts (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL UNIQUE,
	title TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	acceptance_criteria TEXT NOT NULL DEFAULT '[]',
	attachments TEXT NOT NULL DEFAULT '[]',
	suggested_provider TEXT,
	suggested_model TEXT,
	max_turns INTEGER,
	template_name TEXT,
	template_vars TEXT NOT NULL DEFAULT '{}',
	agent_guidance TEXT NOT NULL DEFAULT '{}',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (session_id) REFERENCES studio_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issue_drafts_session_id ON issue_drafts(session_id);
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd apps/backend && go test ./internal/db/ -run TestStudioTablesExist -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/db/schema.go apps/backend/internal/db/studio_test.go
git commit -m "feat(db): add studio_sessions and issue_drafts tables"
```

---

## Task 2: Database migrations — new columns on `issues`

**Files:**
- Modify: `apps/backend/internal/db/migrate.go`
- Test: `apps/backend/internal/db/studio_test.go`

- [ ] **Step 1: Add failing test**

Append to `apps/backend/internal/db/studio_test.go`:

```go
func TestIssuesStudioColumnsExist(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	wanted := []string{"acceptance_criteria", "attachments", "agent_guidance", "source_template", "authoring_session_id"}
	for _, col := range wanted {
		ok, err := columnExists(d, "issues", col)
		if err != nil {
			t.Fatalf("columnExists(%s): %v", col, err)
		}
		if !ok {
			t.Fatalf("issues.%s missing", col)
		}
	}
}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/backend && go test ./internal/db/ -run TestIssuesStudioColumnsExist -v`
Expected: FAIL — `issues.acceptance_criteria missing`

- [ ] **Step 3: Add migrations**

In `apps/backend/internal/db/migrate.go`, append to the `migrations` slice in `runMigrations`:

```go
		{"issues", "acceptance_criteria", "TEXT NOT NULL DEFAULT '[]'"},
		{"issues", "attachments", "TEXT NOT NULL DEFAULT '[]'"},
		{"issues", "agent_guidance", "TEXT NOT NULL DEFAULT '{}'"},
		{"issues", "source_template", "TEXT"},
		{"issues", "authoring_session_id", "TEXT"},
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd apps/backend && go test ./internal/db/ -run TestIssuesStudioColumnsExist -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/db/migrate.go apps/backend/internal/db/studio_test.go
git commit -m "feat(db): add studio fields to issues table"
```

---

## Task 3: Studio DAO — CRUD for sessions and drafts

**Files:**
- Create: `apps/backend/internal/db/studio.go`
- Test: `apps/backend/internal/db/studio_test.go` (append)

- [ ] **Step 1: Write failing tests**

Append to `apps/backend/internal/db/studio_test.go`:

```go
func TestCreateAndGetStudioSession(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	s := StudioSession{ID: "sess1", ProjectID: "proj1", Runner: "claude-code"}
	if err := CreateStudioSession(d, s); err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := GetStudioSession(d, "sess1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Runner != "claude-code" {
		t.Fatalf("runner = %q, want claude-code", got.Runner)
	}
}

func TestCreateDraftAndUpdate(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()
	_ = CreateStudioSession(d, StudioSession{ID: "sess1", ProjectID: "proj1", Runner: "claude-code"})

	if err := CreateDraft(d, "sess1"); err != nil {
		t.Fatalf("create draft: %v", err)
	}
	if err := UpdateDraftField(d, "sess1", "title", "Refactor auth"); err != nil {
		t.Fatalf("update title: %v", err)
	}
	d2, err := GetDraft(d, "sess1")
	if err != nil {
		t.Fatalf("get draft: %v", err)
	}
	if d2.Title != "Refactor auth" {
		t.Fatalf("title = %q", d2.Title)
	}
}

func TestUpdateDraftFieldRejectsUnknownColumn(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()
	_ = CreateStudioSession(d, StudioSession{ID: "sess1", ProjectID: "proj1", Runner: "claude-code"})
	_ = CreateDraft(d, "sess1")
	if err := UpdateDraftField(d, "sess1", "id; DROP TABLE issues;--", "x"); err == nil {
		t.Fatalf("expected rejection of unknown column")
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/db/ -run TestCreateAndGetStudioSession -v`
Expected: FAIL — `undefined: CreateStudioSession`

- [ ] **Step 3: Implement DAO**

Create `apps/backend/internal/db/studio.go`:

```go
package db

import (
	"database/sql"
	"fmt"
	"time"
)

type StudioSession struct {
	ID        string
	ProjectID string
	Runner    string
	StartedAt time.Time
	EndedAt   *time.Time
	Outcome   string
}

type IssueDraft struct {
	ID                  string
	SessionID           string
	Title               string
	Description         string
	AcceptanceCriteria  string // JSON array
	Attachments         string // JSON array
	SuggestedProvider   string
	SuggestedModel      string
	MaxTurns            *int
	TemplateName        string
	TemplateVars        string // JSON object
	AgentGuidance       string // JSON object
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

var draftAllowedColumns = map[string]bool{
	"title":               true,
	"description":         true,
	"acceptance_criteria": true,
	"attachments":         true,
	"suggested_provider":  true,
	"suggested_model":     true,
	"max_turns":           true,
	"template_name":       true,
	"template_vars":       true,
	"agent_guidance":      true,
}

func CreateStudioSession(d *sql.DB, s StudioSession) error {
	_, err := d.Exec(
		`INSERT INTO studio_sessions (id, project_id, runner) VALUES (?, ?, ?)`,
		s.ID, s.ProjectID, s.Runner,
	)
	return err
}

func GetStudioSession(d *sql.DB, id string) (StudioSession, error) {
	row := d.QueryRow(`SELECT id, project_id, runner, started_at, ended_at, COALESCE(outcome,'') FROM studio_sessions WHERE id=?`, id)
	var s StudioSession
	var ended sql.NullTime
	if err := row.Scan(&s.ID, &s.ProjectID, &s.Runner, &s.StartedAt, &ended, &s.Outcome); err != nil {
		return StudioSession{}, err
	}
	if ended.Valid {
		s.EndedAt = &ended.Time
	}
	return s, nil
}

func EndStudioSession(d *sql.DB, id, outcome string) error {
	_, err := d.Exec(
		`UPDATE studio_sessions SET ended_at=CURRENT_TIMESTAMP, outcome=? WHERE id=?`,
		outcome, id,
	)
	return err
}

func CreateDraft(d *sql.DB, sessionID string) error {
	_, err := d.Exec(
		`INSERT INTO issue_drafts (id, session_id) VALUES (?, ?)`,
		"draft-"+sessionID, sessionID,
	)
	return err
}

func GetDraft(d *sql.DB, sessionID string) (IssueDraft, error) {
	row := d.QueryRow(`
		SELECT id, session_id, title, description, acceptance_criteria, attachments,
		       COALESCE(suggested_provider,''), COALESCE(suggested_model,''), max_turns,
		       COALESCE(template_name,''), template_vars, agent_guidance,
		       created_at, updated_at
		FROM issue_drafts WHERE session_id=?`, sessionID)
	var d2 IssueDraft
	var maxTurns sql.NullInt64
	if err := row.Scan(
		&d2.ID, &d2.SessionID, &d2.Title, &d2.Description, &d2.AcceptanceCriteria, &d2.Attachments,
		&d2.SuggestedProvider, &d2.SuggestedModel, &maxTurns,
		&d2.TemplateName, &d2.TemplateVars, &d2.AgentGuidance,
		&d2.CreatedAt, &d2.UpdatedAt,
	); err != nil {
		return IssueDraft{}, err
	}
	if maxTurns.Valid {
		v := int(maxTurns.Int64)
		d2.MaxTurns = &v
	}
	return d2, nil
}

func UpdateDraftField(d *sql.DB, sessionID, column string, value interface{}) error {
	if !draftAllowedColumns[column] {
		return fmt.Errorf("studio: column not allowed: %q", column)
	}
	q := fmt.Sprintf("UPDATE issue_drafts SET %s=?, updated_at=CURRENT_TIMESTAMP WHERE session_id=?", column)
	_, err := d.Exec(q, value, sessionID)
	return err
}

func DeleteDraft(d *sql.DB, sessionID string) error {
	_, err := d.Exec(`DELETE FROM issue_drafts WHERE session_id=?`, sessionID)
	return err
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd apps/backend && go test ./internal/db/ -v -run 'Studio|Draft'`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/db/studio.go apps/backend/internal/db/studio_test.go
git commit -m "feat(db): studio session and draft DAO with column whitelist"
```

---

## Task 4: Studio types and event taxonomy

**Files:**
- Create: `apps/backend/internal/studio/types.go`

- [ ] **Step 1: Write the types directly (no tests — declarations only)**

```go
// apps/backend/internal/studio/types.go
package studio

import "time"

type Status string

const (
	StatusActive    Status = "active"
	StatusPushed    Status = "pushed"
	StatusDiscarded Status = "discarded"
)

type EventKind string

const (
	EventChatMessage    EventKind = "chat.message"
	EventChatToken      EventKind = "chat.token"
	EventToolCall       EventKind = "tool.call"
	EventDraftUpdated   EventKind = "draft.updated"
	EventSessionStatus  EventKind = "session.status"
	EventError          EventKind = "error"
)

type Event struct {
	SessionID string      `json:"session_id"`
	Kind      EventKind   `json:"kind"`
	Payload   interface{} `json:"payload"`
	Timestamp time.Time   `json:"timestamp"`
}

type DraftSnapshot struct {
	SessionID          string                 `json:"session_id"`
	Title              string                 `json:"title"`
	Description        string                 `json:"description"`
	AcceptanceCriteria []string               `json:"acceptance_criteria"`
	Attachments        []Attachment           `json:"attachments"`
	SuggestedProvider  string                 `json:"suggested_provider"`
	SuggestedModel     string                 `json:"suggested_model"`
	MaxTurns           *int                   `json:"max_turns,omitempty"`
	TemplateName       string                 `json:"template_name,omitempty"`
	TemplateVars       map[string]string      `json:"template_vars"`
	AgentGuidance      map[string]interface{} `json:"agent_guidance"`
}

type Attachment struct {
	Kind  string `json:"kind"`  // "file" | "link"
	Path  string `json:"path,omitempty"`
	URL   string `json:"url,omitempty"`
	Label string `json:"label,omitempty"`
}

type Session struct {
	ID        string
	ProjectID string
	Runner    string
	Status    Status
}

type StartSessionRequest struct {
	ProjectID    string            `json:"project_id"`
	Runner       string            `json:"runner"`
	Template     string            `json:"template,omitempty"`
	TemplateVars map[string]string `json:"template_vars,omitempty"`
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/backend && go build ./internal/studio/`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/internal/studio/types.go
git commit -m "feat(studio): event taxonomy and draft snapshot types"
```

---

## Task 5: Studio Manager — session lifecycle (no runner yet)

**Files:**
- Create: `apps/backend/internal/studio/manager.go`
- Test: `apps/backend/internal/studio/manager_test.go`

- [ ] **Step 1: Write failing test**

```go
// apps/backend/internal/studio/manager_test.go
package studio

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
)

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	d, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := d.Exec(db.Schema); err != nil {
		t.Fatalf("schema: %v", err)
	}
	bus := observability.NewPubSub()
	return NewManager(d, bus, nil)
}

func TestStartSession_CreatesDraft(t *testing.T) {
	m := newTestManager(t)
	sess, err := m.StartSession(context.Background(), StartSessionRequest{ProjectID: "p", Runner: "claude-code"})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	snap, err := m.GetDraft(sess.ID)
	if err != nil {
		t.Fatalf("draft: %v", err)
	}
	if snap.Title != "" || snap.SessionID != sess.ID {
		t.Fatalf("unexpected draft: %+v", snap)
	}
}

func TestDiscardSession_RemovesDraft(t *testing.T) {
	m := newTestManager(t)
	sess, _ := m.StartSession(context.Background(), StartSessionRequest{ProjectID: "p", Runner: "claude-code"})
	if err := m.Discard(sess.ID); err != nil {
		t.Fatalf("discard: %v", err)
	}
	if _, err := m.GetDraft(sess.ID); err == nil {
		t.Fatalf("expected draft removed")
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/studio/ -v`
Expected: FAIL — `undefined: NewManager`

- [ ] **Step 3: Implement manager (lifecycle only — push to Task 8)**

Create `apps/backend/internal/studio/manager.go`:

```go
package studio

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
)

// RunnerSpawner abstracts the CLI agent spawn used by a studio session.
// Phase 1 uses a fake; Phase 2 wires real CLI runners.
type RunnerSpawner interface {
	Spawn(ctx context.Context, sess Session, onEvent func(Event)) error
	SendMessage(ctx context.Context, sessionID, message string) error
	Stop(sessionID string) error
}

type Manager struct {
	d       *sql.DB
	bus     *observability.PubSub
	spawner RunnerSpawner
}

func NewManager(d *sql.DB, bus *observability.PubSub, spawner RunnerSpawner) *Manager {
	return &Manager{d: d, bus: bus, spawner: spawner}
}

func (m *Manager) StartSession(ctx context.Context, req StartSessionRequest) (Session, error) {
	if req.Runner == "" {
		return Session{}, fmt.Errorf("studio: runner required")
	}
	id := "studio-" + uuid.NewString()
	row := db.StudioSession{ID: id, ProjectID: req.ProjectID, Runner: req.Runner}
	if err := db.CreateStudioSession(m.d, row); err != nil {
		return Session{}, fmt.Errorf("create session: %w", err)
	}
	if err := db.CreateDraft(m.d, id); err != nil {
		return Session{}, fmt.Errorf("create draft: %w", err)
	}
	sess := Session{ID: id, ProjectID: req.ProjectID, Runner: req.Runner, Status: StatusActive}
	if m.spawner != nil {
		if err := m.spawner.Spawn(ctx, sess, m.dispatch); err != nil {
			_ = db.EndStudioSession(m.d, id, string(StatusDiscarded))
			_ = db.DeleteDraft(m.d, id)
			return Session{}, fmt.Errorf("spawn runner: %w", err)
		}
	}
	return sess, nil
}

func (m *Manager) Discard(sessionID string) error {
	if m.spawner != nil {
		_ = m.spawner.Stop(sessionID)
	}
	if err := db.DeleteDraft(m.d, sessionID); err != nil {
		return err
	}
	return db.EndStudioSession(m.d, sessionID, string(StatusDiscarded))
}

func (m *Manager) GetDraft(sessionID string) (DraftSnapshot, error) {
	d2, err := db.GetDraft(m.d, sessionID)
	if err != nil {
		return DraftSnapshot{}, err
	}
	return toSnapshot(d2)
}

func (m *Manager) dispatch(ev Event) {
	if m.bus == nil {
		return
	}
	m.bus.Publish("studio."+ev.SessionID, ev)
}

func toSnapshot(d2 db.IssueDraft) (DraftSnapshot, error) {
	s := DraftSnapshot{
		SessionID:         d2.SessionID,
		Title:             d2.Title,
		Description:       d2.Description,
		SuggestedProvider: d2.SuggestedProvider,
		SuggestedModel:    d2.SuggestedModel,
		MaxTurns:          d2.MaxTurns,
		TemplateName:      d2.TemplateName,
		TemplateVars:      map[string]string{},
		AgentGuidance:     map[string]interface{}{},
	}
	if err := json.Unmarshal([]byte(d2.AcceptanceCriteria), &s.AcceptanceCriteria); err != nil {
		return s, fmt.Errorf("ac json: %w", err)
	}
	if err := json.Unmarshal([]byte(d2.Attachments), &s.Attachments); err != nil {
		return s, fmt.Errorf("attachments json: %w", err)
	}
	if d2.TemplateVars != "" {
		_ = json.Unmarshal([]byte(d2.TemplateVars), &s.TemplateVars)
	}
	if d2.AgentGuidance != "" {
		_ = json.Unmarshal([]byte(d2.AgentGuidance), &s.AgentGuidance)
	}
	return s, nil
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/backend && go test ./internal/studio/ -v`
Expected: PASS for `TestStartSession_CreatesDraft` and `TestDiscardSession_RemovesDraft`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/studio/manager.go apps/backend/internal/studio/manager_test.go
git commit -m "feat(studio): session manager with start and discard"
```

---

## Task 6: Draft mutations on the Manager

**Files:**
- Modify: `apps/backend/internal/studio/manager.go`
- Test: `apps/backend/internal/studio/manager_test.go`

- [ ] **Step 1: Write failing tests**

Append to `manager_test.go`:

```go
func TestSetTitle(t *testing.T) {
	m := newTestManager(t)
	sess, _ := m.StartSession(context.Background(), StartSessionRequest{ProjectID: "p", Runner: "claude-code"})
	if err := m.SetTitle(sess.ID, "Refactor auth"); err != nil {
		t.Fatalf("set: %v", err)
	}
	snap, _ := m.GetDraft(sess.ID)
	if snap.Title != "Refactor auth" {
		t.Fatalf("title=%q", snap.Title)
	}
}

func TestAddAcceptanceCriterion(t *testing.T) {
	m := newTestManager(t)
	sess, _ := m.StartSession(context.Background(), StartSessionRequest{ProjectID: "p", Runner: "claude-code"})
	if err := m.AddAcceptanceCriterion(sess.ID, "tests pass"); err != nil {
		t.Fatalf("add ac: %v", err)
	}
	if err := m.AddAcceptanceCriterion(sess.ID, "no regressions"); err != nil {
		t.Fatalf("add ac 2: %v", err)
	}
	snap, _ := m.GetDraft(sess.ID)
	if len(snap.AcceptanceCriteria) != 2 || snap.AcceptanceCriteria[0] != "tests pass" {
		t.Fatalf("ac=%v", snap.AcceptanceCriteria)
	}
}

func TestAttachFile(t *testing.T) {
	m := newTestManager(t)
	sess, _ := m.StartSession(context.Background(), StartSessionRequest{ProjectID: "p", Runner: "claude-code"})
	if err := m.AttachFile(sess.ID, "auth/middleware.go"); err != nil {
		t.Fatalf("attach: %v", err)
	}
	snap, _ := m.GetDraft(sess.ID)
	if len(snap.Attachments) != 1 || snap.Attachments[0].Path != "auth/middleware.go" {
		t.Fatalf("attachments=%v", snap.Attachments)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/studio/ -run 'SetTitle|Acceptance|Attach' -v`
Expected: FAIL — `m.SetTitle undefined`.

- [ ] **Step 3: Implement mutations**

Append to `apps/backend/internal/studio/manager.go`:

```go
func (m *Manager) SetTitle(sessionID, title string) error {
	if err := db.UpdateDraftField(m.d, sessionID, "title", title); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) SetDescription(sessionID, desc string) error {
	if err := db.UpdateDraftField(m.d, sessionID, "description", desc); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) AddAcceptanceCriterion(sessionID, criterion string) error {
	snap, err := m.GetDraft(sessionID)
	if err != nil {
		return err
	}
	snap.AcceptanceCriteria = append(snap.AcceptanceCriteria, criterion)
	raw, _ := json.Marshal(snap.AcceptanceCriteria)
	if err := db.UpdateDraftField(m.d, sessionID, "acceptance_criteria", string(raw)); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) RemoveAcceptanceCriterion(sessionID string, index int) error {
	snap, err := m.GetDraft(sessionID)
	if err != nil {
		return err
	}
	if index < 0 || index >= len(snap.AcceptanceCriteria) {
		return fmt.Errorf("studio: ac index out of range: %d", index)
	}
	snap.AcceptanceCriteria = append(snap.AcceptanceCriteria[:index], snap.AcceptanceCriteria[index+1:]...)
	raw, _ := json.Marshal(snap.AcceptanceCriteria)
	if err := db.UpdateDraftField(m.d, sessionID, "acceptance_criteria", string(raw)); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) AttachFile(sessionID, path string) error {
	return m.addAttachment(sessionID, Attachment{Kind: "file", Path: path})
}

func (m *Manager) AttachLink(sessionID, url, label string) error {
	return m.addAttachment(sessionID, Attachment{Kind: "link", URL: url, Label: label})
}

func (m *Manager) addAttachment(sessionID string, a Attachment) error {
	snap, err := m.GetDraft(sessionID)
	if err != nil {
		return err
	}
	snap.Attachments = append(snap.Attachments, a)
	raw, _ := json.Marshal(snap.Attachments)
	if err := db.UpdateDraftField(m.d, sessionID, "attachments", string(raw)); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) SetProvider(sessionID, provider string) error {
	if err := db.UpdateDraftField(m.d, sessionID, "suggested_provider", provider); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) SetModel(sessionID, model string) error {
	if err := db.UpdateDraftField(m.d, sessionID, "suggested_model", model); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) SetMaxTurns(sessionID string, turns int) error {
	if err := db.UpdateDraftField(m.d, sessionID, "max_turns", turns); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) publishDraftUpdate(sessionID string) {
	snap, err := m.GetDraft(sessionID)
	if err != nil {
		return
	}
	m.dispatch(Event{SessionID: sessionID, Kind: EventDraftUpdated, Payload: snap})
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/backend && go test ./internal/studio/ -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/studio/manager.go apps/backend/internal/studio/manager_test.go
git commit -m "feat(studio): draft mutation API on manager"
```

---

## Task 7: Race coverage on concurrent draft writes

**Files:**
- Modify: `apps/backend/internal/studio/manager_test.go`

- [ ] **Step 1: Add race test**

```go
func TestConcurrentDraftWrites(t *testing.T) {
	m := newTestManager(t)
	sess, _ := m.StartSession(context.Background(), StartSessionRequest{ProjectID: "p", Runner: "claude-code"})

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_ = m.AddAcceptanceCriterion(sess.ID, fmt.Sprintf("ac-%d", n))
		}(i)
	}
	wg.Wait()
	snap, _ := m.GetDraft(sess.ID)
	if len(snap.AcceptanceCriteria) == 0 {
		t.Fatalf("expected some ACs added")
	}
}
```

Add imports `"fmt"` and `"sync"` to `manager_test.go` if not present.

- [ ] **Step 2: Run under race**

Run: `cd apps/backend && go test -race ./internal/studio/ -run TestConcurrentDraftWrites -v`
Expected: PASS, no race warnings. If a race appears, add a `sync.Mutex` to `Manager` guarding read-modify-write sequences (`AddAcceptanceCriterion`, `addAttachment`) and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/internal/studio/manager_test.go apps/backend/internal/studio/manager.go
git commit -m "test(studio): cover concurrent draft writes"
```

---

## Task 8: Push to backlog — Manager.Push

**Files:**
- Modify: `apps/backend/internal/studio/manager.go`
- Test: `apps/backend/internal/studio/manager_test.go`

**Note:** The exact tracker `CreateIssue` signature lives in `internal/tracker/`. Inspect it before implementing this task; the plan below assumes a method `CreateIssue(ctx, projectID, issue) (id string, err error)` and adjusts shape if needed.

- [ ] **Step 1: Add failing test using a fake tracker**

```go
type fakeTracker struct {
	created []map[string]string
}

func (f *fakeTracker) CreateIssue(ctx context.Context, projectID string, fields map[string]string) (string, error) {
	f.created = append(f.created, fields)
	return fmt.Sprintf("ISS-%d", len(f.created)), nil
}

func TestPushPersistsIssueAndEndsSession(t *testing.T) {
	m := newTestManager(t)
	tr := &fakeTracker{}
	m.SetTracker(tr)

	sess, _ := m.StartSession(context.Background(), StartSessionRequest{ProjectID: "p", Runner: "claude-code"})
	_ = m.SetTitle(sess.ID, "Refactor auth")
	_ = m.SetDescription(sess.ID, "Body")
	_ = m.AddAcceptanceCriterion(sess.ID, "tests pass")

	id, err := m.Push(context.Background(), sess.ID)
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if id == "" || len(tr.created) != 1 {
		t.Fatalf("tracker not called: %+v", tr.created)
	}
	if _, err := m.GetDraft(sess.ID); err == nil {
		t.Fatalf("expected draft removed after push")
	}
}

func TestPushRejectsEmptyTitle(t *testing.T) {
	m := newTestManager(t)
	m.SetTracker(&fakeTracker{})
	sess, _ := m.StartSession(context.Background(), StartSessionRequest{ProjectID: "p", Runner: "claude-code"})
	if _, err := m.Push(context.Background(), sess.ID); err == nil {
		t.Fatalf("expected validation error")
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/studio/ -run Push -v`
Expected: FAIL — `m.SetTracker undefined`.

- [ ] **Step 3: Implement `SetTracker` and `Push`**

Append to `apps/backend/internal/studio/manager.go`:

```go
type Tracker interface {
	CreateIssue(ctx context.Context, projectID string, fields map[string]string) (string, error)
}

func (m *Manager) SetTracker(t Tracker) { m.tracker = t }

func (m *Manager) Push(ctx context.Context, sessionID string) (string, error) {
	snap, err := m.GetDraft(sessionID)
	if err != nil {
		return "", err
	}
	if snap.Title == "" {
		return "", fmt.Errorf("studio: title required")
	}
	if snap.Description == "" {
		return "", fmt.Errorf("studio: description required")
	}
	if m.tracker == nil {
		return "", fmt.Errorf("studio: tracker not configured")
	}

	sess, err := db.GetStudioSession(m.d, sessionID)
	if err != nil {
		return "", fmt.Errorf("get session: %w", err)
	}

	acJSON, _ := json.Marshal(snap.AcceptanceCriteria)
	attJSON, _ := json.Marshal(snap.Attachments)
	guidanceJSON, _ := json.Marshal(snap.AgentGuidance)

	fields := map[string]string{
		"title":                snap.Title,
		"description":          snap.Description,
		"acceptance_criteria":  string(acJSON),
		"attachments":          string(attJSON),
		"agent_guidance":       string(guidanceJSON),
		"source_template":      snap.TemplateName,
		"authoring_session_id": sessionID,
		"provider":             snap.SuggestedProvider,
	}
	id, err := m.tracker.CreateIssue(ctx, sess.ProjectID, fields)
	if err != nil {
		return "", fmt.Errorf("create issue: %w", err)
	}
	_ = db.DeleteDraft(m.d, sessionID)
	_ = db.EndStudioSession(m.d, sessionID, string(StatusPushed))
	if m.spawner != nil {
		_ = m.spawner.Stop(sessionID)
	}
	m.dispatch(Event{SessionID: sessionID, Kind: EventSessionStatus, Payload: map[string]string{"status": string(StatusPushed), "issue_id": id}})
	return id, nil
}
```

Add `tracker Tracker` field on `Manager`. Adjust the `map[string]string` shape if the real `tracker.CreateIssue` accepts a struct — match the existing signature.

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/backend && go test ./internal/studio/ -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/studio/manager.go apps/backend/internal/studio/manager_test.go
git commit -m "feat(studio): push draft to backlog via tracker"
```

---

## Task 9: MCP server — tool registry

**Files:**
- Create: `apps/backend/internal/mcp/studio/server.go`
- Create: `apps/backend/internal/mcp/studio/tools.go`
- Test: `apps/backend/internal/mcp/studio/server_test.go`

The existing `internal/mcp/client.go` is an MCP **client**. The studio server speaks JSON-RPC over a duplex stream (stdin/stdout when wired to a real CLI; in-memory channels in tests). Use the existing JSON-RPC patterns elsewhere in the repo if any; otherwise implement a minimal MCP server inline.

- [ ] **Step 1: Write the failing tool-call test**

```go
// apps/backend/internal/mcp/studio/server_test.go
package studio

import (
	"context"
	"encoding/json"
	"testing"

	studiopkg "github.com/orchestra/orchestra/apps/backend/internal/studio"
)

type recordingManager struct {
	titles []string
}

func (r *recordingManager) SetTitle(sessionID, title string) error {
	r.titles = append(r.titles, title)
	return nil
}
func (r *recordingManager) SetDescription(string, string) error          { return nil }
func (r *recordingManager) AddAcceptanceCriterion(string, string) error  { return nil }
func (r *recordingManager) RemoveAcceptanceCriterion(string, int) error  { return nil }
func (r *recordingManager) AttachFile(string, string) error              { return nil }
func (r *recordingManager) AttachLink(string, string, string) error      { return nil }
func (r *recordingManager) SetProvider(string, string) error             { return nil }
func (r *recordingManager) SetModel(string, string) error                { return nil }
func (r *recordingManager) SetMaxTurns(string, int) error                { return nil }
func (r *recordingManager) Push(context.Context, string) (string, error) { return "ISS-1", nil }

func TestSetTitleTool(t *testing.T) {
	rm := &recordingManager{}
	srv := New(rm, "sess1")
	resp, err := srv.Dispatch(context.Background(), "set_title", json.RawMessage(`{"text":"Refactor auth"}`))
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if len(rm.titles) != 1 || rm.titles[0] != "Refactor auth" {
		t.Fatalf("titles=%v", rm.titles)
	}
	if string(resp) == "" {
		t.Fatalf("empty response")
	}
}

func TestUnknownTool(t *testing.T) {
	srv := New(&recordingManager{}, "sess1")
	if _, err := srv.Dispatch(context.Background(), "no_such_tool", json.RawMessage(`{}`)); err == nil {
		t.Fatalf("expected error for unknown tool")
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/mcp/studio/ -v`
Expected: FAIL — `undefined: New`.

- [ ] **Step 3: Implement the server**

Create `apps/backend/internal/mcp/studio/server.go`:

```go
package studio

import (
	"context"
	"encoding/json"
	"fmt"
)

// ManagerAPI is the subset of studio.Manager the MCP server depends on.
// Defined as an interface for testability.
type ManagerAPI interface {
	SetTitle(sessionID, title string) error
	SetDescription(sessionID, desc string) error
	AddAcceptanceCriterion(sessionID, criterion string) error
	RemoveAcceptanceCriterion(sessionID string, index int) error
	AttachFile(sessionID, path string) error
	AttachLink(sessionID, url, label string) error
	SetProvider(sessionID, provider string) error
	SetModel(sessionID, model string) error
	SetMaxTurns(sessionID string, turns int) error
	Push(ctx context.Context, sessionID string) (string, error)
}

type Server struct {
	mgr       ManagerAPI
	sessionID string
	tools     map[string]toolHandler
}

type toolHandler func(ctx context.Context, args json.RawMessage) (json.RawMessage, error)

func New(mgr ManagerAPI, sessionID string) *Server {
	s := &Server{mgr: mgr, sessionID: sessionID}
	s.tools = map[string]toolHandler{
		"set_title":                    s.handleSetTitle,
		"set_description":              s.handleSetDescription,
		"add_acceptance_criterion":     s.handleAddAC,
		"remove_acceptance_criterion":  s.handleRemoveAC,
		"attach_file":                  s.handleAttachFile,
		"attach_link":                  s.handleAttachLink,
		"set_provider":                 s.handleSetProvider,
		"set_model":                    s.handleSetModel,
		"set_max_turns":                s.handleSetMaxTurns,
		"push_to_backlog":              s.handlePush,
	}
	return s
}

func (s *Server) Dispatch(ctx context.Context, tool string, args json.RawMessage) (json.RawMessage, error) {
	h, ok := s.tools[tool]
	if !ok {
		return nil, fmt.Errorf("unknown tool: %s", tool)
	}
	return h(ctx, args)
}

func ok() json.RawMessage { return json.RawMessage(`{"ok":true}`) }
```

Create `apps/backend/internal/mcp/studio/tools.go`:

```go
package studio

import (
	"context"
	"encoding/json"
	"fmt"
)

func (s *Server) handleSetTitle(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var a struct{ Text string `json:"text"` }
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, err
	}
	if a.Text == "" {
		return nil, fmt.Errorf("text required")
	}
	if err := s.mgr.SetTitle(s.sessionID, a.Text); err != nil {
		return nil, err
	}
	return ok(), nil
}

func (s *Server) handleSetDescription(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var a struct{ Markdown string `json:"markdown"` }
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, err
	}
	if err := s.mgr.SetDescription(s.sessionID, a.Markdown); err != nil {
		return nil, err
	}
	return ok(), nil
}

func (s *Server) handleAddAC(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var a struct{ Text string `json:"text"` }
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, err
	}
	if a.Text == "" {
		return nil, fmt.Errorf("text required")
	}
	if err := s.mgr.AddAcceptanceCriterion(s.sessionID, a.Text); err != nil {
		return nil, err
	}
	return ok(), nil
}

func (s *Server) handleRemoveAC(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var a struct{ Index int `json:"index"` }
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, err
	}
	if err := s.mgr.RemoveAcceptanceCriterion(s.sessionID, a.Index); err != nil {
		return nil, err
	}
	return ok(), nil
}

func (s *Server) handleAttachFile(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var a struct{ Path string `json:"path"` }
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, err
	}
	if a.Path == "" {
		return nil, fmt.Errorf("path required")
	}
	if err := s.mgr.AttachFile(s.sessionID, a.Path); err != nil {
		return nil, err
	}
	return ok(), nil
}

func (s *Server) handleAttachLink(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var a struct {
		URL   string `json:"url"`
		Label string `json:"label"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, err
	}
	if a.URL == "" {
		return nil, fmt.Errorf("url required")
	}
	if err := s.mgr.AttachLink(s.sessionID, a.URL, a.Label); err != nil {
		return nil, err
	}
	return ok(), nil
}

func (s *Server) handleSetProvider(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var a struct{ Name string `json:"name"` }
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, err
	}
	if err := s.mgr.SetProvider(s.sessionID, a.Name); err != nil {
		return nil, err
	}
	return ok(), nil
}

func (s *Server) handleSetModel(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var a struct{ Name string `json:"name"` }
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, err
	}
	if err := s.mgr.SetModel(s.sessionID, a.Name); err != nil {
		return nil, err
	}
	return ok(), nil
}

func (s *Server) handleSetMaxTurns(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var a struct{ N int `json:"n"` }
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, err
	}
	if a.N <= 0 {
		return nil, fmt.Errorf("n must be > 0")
	}
	if err := s.mgr.SetMaxTurns(s.sessionID, a.N); err != nil {
		return nil, err
	}
	return ok(), nil
}

func (s *Server) handlePush(ctx context.Context, _ json.RawMessage) (json.RawMessage, error) {
	id, err := s.mgr.Push(ctx, s.sessionID)
	if err != nil {
		return nil, err
	}
	out, _ := json.Marshal(map[string]string{"issue_id": id})
	return out, nil
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/backend && go test ./internal/mcp/studio/ -v`
Expected: all PASS.

- [ ] **Step 5: Add tests for each handler** (briefly — happy + error path for `add_acceptance_criterion`, `attach_file`, `push_to_backlog`).

Append to `server_test.go`:

```go
func TestAddACToolValidates(t *testing.T) {
	srv := New(&recordingManager{}, "sess1")
	if _, err := srv.Dispatch(context.Background(), "add_acceptance_criterion", json.RawMessage(`{"text":""}`)); err == nil {
		t.Fatalf("expected validation error")
	}
}

func TestPushToolReturnsID(t *testing.T) {
	srv := New(&recordingManager{}, "sess1")
	resp, err := srv.Dispatch(context.Background(), "push_to_backlog", json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	var out struct{ IssueID string `json:"issue_id"` }
	_ = json.Unmarshal(resp, &out)
	if out.IssueID != "ISS-1" {
		t.Fatalf("issue_id=%q", out.IssueID)
	}
}
```

Run: `cd apps/backend && go test ./internal/mcp/studio/ -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/internal/mcp/studio/
git commit -m "feat(mcp/studio): tool dispatch server with full tool set"
```

---

## Task 10: Fake runner for tests

**Files:**
- Create: `apps/backend/internal/studio/fake_runner.go`

- [ ] **Step 1: Implement a tiny in-process fake**

```go
// apps/backend/internal/studio/fake_runner.go
package studio

import (
	"context"
	"sync"
)

// FakeRunner is a test-only RunnerSpawner that records incoming messages and
// lets the test drive synthetic events to the manager's dispatch.
type FakeRunner struct {
	mu       sync.Mutex
	sessions map[string]func(Event)
	Messages map[string][]string
}

func NewFakeRunner() *FakeRunner {
	return &FakeRunner{sessions: map[string]func(Event){}, Messages: map[string][]string{}}
}

func (f *FakeRunner) Spawn(ctx context.Context, sess Session, onEvent func(Event)) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sessions[sess.ID] = onEvent
	return nil
}

func (f *FakeRunner) SendMessage(ctx context.Context, sessionID, message string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Messages[sessionID] = append(f.Messages[sessionID], message)
	return nil
}

func (f *FakeRunner) Stop(sessionID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.sessions, sessionID)
	return nil
}

// Emit pushes a synthetic event for the given session.
func (f *FakeRunner) Emit(sessionID string, ev Event) {
	f.mu.Lock()
	cb := f.sessions[sessionID]
	f.mu.Unlock()
	if cb != nil {
		cb(ev)
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/backend && go build ./internal/studio/`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/internal/studio/fake_runner.go
git commit -m "test(studio): in-process fake runner"
```

---

## Task 11: HTTP routes — session create, message, draft edit, push, discard

**Files:**
- Create: `apps/backend/internal/api/studio.go`
- Test: `apps/backend/internal/api/studio_test.go`
- Modify: `apps/backend/internal/api/router.go`

- [ ] **Step 1: Write failing test**

```go
// apps/backend/internal/api/studio_test.go
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStudioCreateSession(t *testing.T) {
	// helper from existing tests: spinUpAPI(t) returning *httptest.Server, *studio.Manager, etc.
	srv, _, _ := spinUpStudioAPI(t)
	defer srv.Close()

	body := bytes.NewBufferString(`{"project_id":"p","runner":"claude-code"}`)
	resp, err := http.Post(srv.URL+"/api/studio/sessions", "application/json", body)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status=%d", resp.StatusCode)
	}
	var out struct {
		SessionID string `json:"session_id"`
		SSEURL    string `json:"sse_url"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out.SessionID == "" {
		t.Fatalf("empty session id")
	}
}

func TestStudioPushFlow(t *testing.T) {
	srv, mgr, _ := spinUpStudioAPI(t)
	defer srv.Close()

	sess, _ := mgr.StartSession(context.Background(), studioStartReq("p", "claude-code"))
	_ = mgr.SetTitle(sess.ID, "T")
	_ = mgr.SetDescription(sess.ID, "D")

	resp, err := http.Post(srv.URL+"/api/studio/sessions/"+sess.ID+"/push", "application/json", nil)
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}
```

You will need to add a `spinUpStudioAPI` test helper that mirrors the test wiring used by other API tests in `apps/backend/internal/api/`. Look at `endpoints_test.go` or `state_test.go` for the established pattern.

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/api/ -run Studio -v`
Expected: FAIL — `undefined: spinUpStudioAPI` and route 404.

- [ ] **Step 3: Implement routes**

Create `apps/backend/internal/api/studio.go`:

```go
package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/studio"
)

type StudioHandler struct {
	mgr *studio.Manager
	bus *observability.PubSub
}

func NewStudioHandler(mgr *studio.Manager, bus *observability.PubSub) *StudioHandler {
	return &StudioHandler{mgr: mgr, bus: bus}
}

func (h *StudioHandler) Mount(r chi.Router) {
	r.Route("/studio", func(r chi.Router) {
		r.Post("/sessions", h.create)
		r.Get("/sessions/{id}/events", h.events)
		r.Post("/sessions/{id}/message", h.message)
		r.Post("/sessions/{id}/draft", h.editDraft)
		r.Post("/sessions/{id}/push", h.push)
		r.Delete("/sessions/{id}", h.discard)
		r.Get("/sessions/{id}/draft", h.getDraft)
	})
}

func (h *StudioHandler) create(w http.ResponseWriter, r *http.Request) {
	var req studio.StartSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	sess, err := h.mgr.StartSession(r.Context(), req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"session_id": sess.ID,
		"sse_url":    "/api/studio/sessions/" + sess.ID + "/events",
	})
}

func (h *StudioHandler) message(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct{ Message string `json:"message"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.mgr.SendMessage(r.Context(), id, req.Message); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (h *StudioHandler) editDraft(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.mgr.ApplyDraftPatch(id, req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *StudioHandler) push(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	issueID, err := h.mgr.Push(r.Context(), id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"issue_id": issueID})
}

func (h *StudioHandler) discard(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.mgr.Discard(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *StudioHandler) getDraft(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	snap, err := h.mgr.GetDraft(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(snap)
}

func (h *StudioHandler) events(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := h.bus.Subscribe("studio." + id)
	defer h.bus.Unsubscribe("studio."+id, ch)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case ev := <-ch:
			b, _ := json.Marshal(ev)
			_, _ = w.Write([]byte("data: "))
			_, _ = w.Write(b)
			_, _ = w.Write([]byte("\n\n"))
			flusher.Flush()
		}
	}
}

func studioPatchAllowed() {}

var _ = context.Background
```

You will need to add two methods on `studio.Manager` referenced here:

```go
// In apps/backend/internal/studio/manager.go
func (m *Manager) SendMessage(ctx context.Context, sessionID, msg string) error {
	if m.spawner == nil {
		return fmt.Errorf("studio: no runner attached")
	}
	return m.spawner.SendMessage(ctx, sessionID, msg)
}

func (m *Manager) ApplyDraftPatch(sessionID string, patch map[string]interface{}) error {
	for k, v := range patch {
		switch k {
		case "title":
			s, _ := v.(string)
			if err := m.SetTitle(sessionID, s); err != nil { return err }
		case "description":
			s, _ := v.(string)
			if err := m.SetDescription(sessionID, s); err != nil { return err }
		case "suggested_provider":
			s, _ := v.(string)
			if err := m.SetProvider(sessionID, s); err != nil { return err }
		case "suggested_model":
			s, _ := v.(string)
			if err := m.SetModel(sessionID, s); err != nil { return err }
		default:
			return fmt.Errorf("studio: field not patchable: %q", k)
		}
	}
	return nil
}
```

Adjust `internal/observability/pubsub.go` use to match its real API (look up `Subscribe`/`Unsubscribe` signatures before writing — they may differ).

- [ ] **Step 4: Mount in router**

Edit `apps/backend/internal/api/router.go` — find where other handlers are mounted under `/api`, add:

```go
studioHandler := NewStudioHandler(studioMgr, pubsub)
r.Route("/api", func(r chi.Router) {
    // ... existing
    studioHandler.Mount(r)
})
```

The `studioMgr` and `pubsub` references come from the `app/run.go` wiring done in Task 13.

- [ ] **Step 5: Run, verify pass**

Run: `cd apps/backend && go test ./internal/api/ -run Studio -v`
Expected: PASS for `TestStudioCreateSession` and `TestStudioPushFlow`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/internal/api/studio.go apps/backend/internal/api/studio_test.go apps/backend/internal/api/router.go apps/backend/internal/studio/manager.go
git commit -m "feat(api): /api/studio routes + SSE event stream"
```

---

## Task 12: End-to-end test using fake runner

**Files:**
- Modify: `apps/backend/internal/api/studio_test.go`

- [ ] **Step 1: Add e2e test**

```go
func TestStudioE2E_FakeRunnerEmitsToolCalls(t *testing.T) {
	srv, mgr, fake := spinUpStudioAPI(t)
	defer srv.Close()

	// Start session
	body := bytes.NewBufferString(`{"project_id":"p","runner":"fake"}`)
	resp, _ := http.Post(srv.URL+"/api/studio/sessions", "application/json", body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create status=%d", resp.StatusCode)
	}
	var out struct{ SessionID string `json:"session_id"` }
	_ = json.NewDecoder(resp.Body).Decode(&out)

	// Simulate the agent calling tools by driving the manager directly
	_ = mgr.SetTitle(out.SessionID, "Refactor auth")
	_ = mgr.SetDescription(out.SessionID, "auth/middleware.go cleanup")
	_ = mgr.AddAcceptanceCriterion(out.SessionID, "tests pass")

	// Push
	resp2, _ := http.Post(srv.URL+"/api/studio/sessions/"+out.SessionID+"/push", "application/json", nil)
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("push status=%d", resp2.StatusCode)
	}

	// Verify the in-test tracker saw the issue
	if len(fake.Tracker.Created) != 1 {
		t.Fatalf("expected 1 issue, got %d", len(fake.Tracker.Created))
	}
	if fake.Tracker.Created[0]["title"] != "Refactor auth" {
		t.Fatalf("title mismatch: %+v", fake.Tracker.Created[0])
	}
}
```

The `spinUpStudioAPI` helper needs to expose `fake` (with `Tracker` and the `FakeRunner`). Build that into the helper.

- [ ] **Step 2: Run, verify pass**

Run: `cd apps/backend && go test ./internal/api/ -run TestStudioE2E -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/internal/api/studio_test.go
git commit -m "test(api): studio e2e flow with fake runner and fake tracker"
```

---

## Task 13: Wire `studio.Manager` into the service graph

**Files:**
- Modify: `apps/backend/internal/app/run.go`

- [ ] **Step 1: Locate where services are constructed**

Open `apps/backend/internal/app/run.go`. Find the section where the existing handlers (tracker, projects, etc.) are constructed and passed to the router.

- [ ] **Step 2: Add manager construction**

Near the other service constructors, add:

```go
studioMgr := studio.NewManager(database, pubsub, nil) // spawner wired in Phase 2
studioMgr.SetTracker(trackerAdapter) // adapt the existing tracker to studio.Tracker if signature differs
```

If the existing tracker `CreateIssue` signature doesn't match `studio.Tracker`, write a small adapter in `apps/backend/internal/studio/tracker_adapter.go`:

```go
package studio

import (
	"context"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

type RealTrackerAdapter struct{ T tracker.Service } // adjust to real type

func (a *RealTrackerAdapter) CreateIssue(ctx context.Context, projectID string, fields map[string]string) (string, error) {
	// Translate the field map to the tracker's native shape; return new issue ID.
	// Inspect tracker.Service signature before writing this.
	return "", nil
}
```

- [ ] **Step 3: Pass to the router**

Where `api.NewRouter(...)` (or equivalent) is called, pass `studioMgr` and `pubsub` so the studio handler can be mounted.

- [ ] **Step 4: Build and run**

Run: `cd apps/backend && go build -o orchestrad ./cmd/orchestrad/`
Expected: success.

Run: `cd apps/backend && go vet ./... && go test ./...`
Expected: all green.

- [ ] **Step 5: Manual smoke**

```bash
ORCHESTRA_API_TOKEN=dev-token ORCHESTRA_WORKSPACE_ROOT=/tmp/orchestra ./apps/backend/orchestrad &
PID=$!
sleep 1
curl -s -X POST -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
  -d '{"project_id":"p1","runner":"fake"}' http://127.0.0.1:3284/api/studio/sessions
kill $PID
```

Expected: a JSON response with `session_id` and `sse_url`. (If the project doesn't exist, the call may still create a session — that's acceptable for this smoke; full project FK enforcement is out of scope here.)

- [ ] **Step 6: Commit**

```bash
git add apps/backend/internal/app/run.go apps/backend/internal/studio/tracker_adapter.go
git commit -m "feat(app): wire studio manager into service graph"
```

---

## Task 14: Format and final verification

- [ ] **Step 1: Format**

Run: `gofmt -l apps/backend/cmd apps/backend/internal`
Expected: empty output. If files are listed, run `gofmt -w` on them.

- [ ] **Step 2: Race detector pass**

Run: `cd apps/backend && go test -race ./internal/studio/ ./internal/mcp/studio/ ./internal/api/`
Expected: PASS.

- [ ] **Step 3: Full test suite**

Run: `cd apps/backend && go test ./...`
Expected: all PASS.

- [ ] **Step 4: Commit any cleanup**

```bash
git status
# if dirty:
git add -A
git commit -m "chore(studio): formatting and lint cleanup"
```

---

## Phase 1 Complete

Backend can:
- Create studio sessions with a placeholder runner
- Hold draft state across the full field set
- Accept tool calls from an MCP server interface to mutate drafts
- Stream events over SSE
- Push validated drafts to the backlog via the existing tracker

What's intentionally missing:
- Real CLI agents (Phase 2)
- Frontend (Phase 3)
- Templates (Phase 4)
