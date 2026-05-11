# Task Authoring Studio — Phase 4: Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable, parameterized task templates. Templates live as markdown files under `.orchestra/studio/templates/` in the active project, each with YAML front-matter for metadata and variable declarations. The studio can browse/edit templates, start a session from a template (prefilling the draft and injecting the rendered body as the first agent message), and the agent can apply additional templates mid-session via an MCP tool.

**Architecture:** Backend gains a `internal/studio/templates/` package for loading/parsing/rendering templates, a CRUD HTTP surface under `/api/studio/templates`, and the `apply_template` MCP tool wired through to the manager. The `StartSessionRequest`'s existing `template` + `template_vars` fields finally do something. Frontend gets a `TemplateLibrary` modal and upgrades the previously-stubbed `TemplatePicker`.

**Tech Stack:** Go (`gopkg.in/yaml.v3` if not already in use — check `go.mod`; otherwise use `sigs.k8s.io/yaml` or the existing YAML dependency). React/TypeScript.

**Prerequisite:** Phases 1, 2, and 3 merged.

---

## File Structure

**New backend files:**
- `apps/backend/internal/studio/templates/loader.go` — read + parse templates from disk
- `apps/backend/internal/studio/templates/loader_test.go`
- `apps/backend/internal/studio/templates/render.go` — variable substitution
- `apps/backend/internal/studio/templates/render_test.go`
- `apps/backend/internal/studio/templates/store.go` — CRUD helpers
- `apps/backend/internal/studio/templates/store_test.go`
- `apps/backend/internal/api/studio_templates.go` — HTTP routes
- `apps/backend/internal/api/studio_templates_test.go`

**New frontend files:**
- `apps/desktop/src/features/studio/templates/TemplateLibrary.tsx`
- `apps/desktop/src/features/studio/templates/useTemplates.ts`

**Modified files:**
- `apps/backend/internal/studio/manager.go` — `StartSession` applies the template if requested; `ApplyTemplate` mutator
- `apps/backend/internal/mcp/studio/server.go` + `tools.go` — `apply_template` tool
- `apps/backend/internal/api/studio.go` — mount template routes
- `apps/desktop/src/lib/orchestra-client.ts` — template CRUD methods
- `apps/desktop/src/features/studio/draft/fields/TemplatePicker.tsx` — enable the "Browse" button
- `apps/desktop/src/features/studio/StudioSection.tsx` — show the library modal

---

## Task 1: Template loader — parse markdown + YAML front-matter

**Files:**
- Create: `apps/backend/internal/studio/templates/loader.go`
- Create: `apps/backend/internal/studio/templates/loader_test.go`

- [ ] **Step 1: Write failing test**

```go
// apps/backend/internal/studio/templates/loader_test.go
package templates

import (
	"os"
	"path/filepath"
	"testing"
)

const exampleTemplate = `---
name: add-tests
description: Add unit tests
variables:
  - name: file
    required: true
  - name: framework
suggested_provider: claude-code
suggested_max_turns: 8
---
Add unit tests to ` + "`{{file}}`" + ` using {{framework}}.
`

func TestLoadTemplate(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "add-tests.md")
	if err := os.WriteFile(path, []byte(exampleTemplate), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	tpl, err := LoadTemplate(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if tpl.Meta.Name != "add-tests" {
		t.Fatalf("name=%q", tpl.Meta.Name)
	}
	if len(tpl.Meta.Variables) != 2 || !tpl.Meta.Variables[0].Required {
		t.Fatalf("vars=%+v", tpl.Meta.Variables)
	}
	if tpl.Meta.SuggestedProvider != "claude-code" {
		t.Fatalf("provider=%q", tpl.Meta.SuggestedProvider)
	}
}

func TestLoadTemplateRejectsMissingFrontMatter(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.md")
	_ = os.WriteFile(path, []byte("just a body"), 0644)
	if _, err := LoadTemplate(path); err == nil {
		t.Fatalf("expected error")
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/studio/templates/ -v`
Expected: FAIL — `undefined: LoadTemplate`.

- [ ] **Step 3: Check YAML dependency**

Run: `cd apps/backend && grep -r "gopkg.in/yaml" go.mod`
- If present, use `gopkg.in/yaml.v3`.
- Else `cd apps/backend && go get gopkg.in/yaml.v3`.

- [ ] **Step 4: Implement**

```go
// apps/backend/internal/studio/templates/loader.go
package templates

import (
	"bytes"
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Variable struct {
	Name     string `yaml:"name" json:"name"`
	Required bool   `yaml:"required" json:"required"`
	Default  string `yaml:"default" json:"default,omitempty"`
}

type Meta struct {
	Name              string     `yaml:"name" json:"name"`
	Description       string     `yaml:"description" json:"description"`
	Variables         []Variable `yaml:"variables" json:"variables"`
	SuggestedProvider string     `yaml:"suggested_provider" json:"suggested_provider,omitempty"`
	SuggestedModel    string     `yaml:"suggested_model" json:"suggested_model,omitempty"`
	SuggestedMaxTurns int        `yaml:"suggested_max_turns" json:"suggested_max_turns,omitempty"`
}

type Template struct {
	Path string `json:"path"`
	Meta Meta   `json:"meta"`
	Body string `json:"body"`
}

var fmDelim = []byte("---\n")

func LoadTemplate(path string) (Template, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Template{}, fmt.Errorf("read: %w", err)
	}
	if !bytes.HasPrefix(raw, fmDelim) {
		return Template{}, fmt.Errorf("template missing front-matter: %s", path)
	}
	rest := raw[len(fmDelim):]
	end := bytes.Index(rest, fmDelim)
	if end < 0 {
		return Template{}, fmt.Errorf("template front-matter not closed: %s", path)
	}
	var meta Meta
	if err := yaml.Unmarshal(rest[:end], &meta); err != nil {
		return Template{}, fmt.Errorf("parse front-matter: %w", err)
	}
	body := string(rest[end+len(fmDelim):])
	return Template{Path: path, Meta: meta, Body: body}, nil
}
```

- [ ] **Step 5: Run, verify pass**

Run: `cd apps/backend && go test ./internal/studio/templates/ -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/internal/studio/templates/loader.go apps/backend/internal/studio/templates/loader_test.go apps/backend/go.mod apps/backend/go.sum
git commit -m "feat(studio/templates): markdown+YAML loader"
```

---

## Task 2: Renderer — variable substitution

**Files:**
- Create: `apps/backend/internal/studio/templates/render.go`
- Create: `apps/backend/internal/studio/templates/render_test.go`

Supports `{{name}}` and `{{name | default("fallback")}}`. No control flow, no loops — kept deliberately minimal.

- [ ] **Step 1: Write failing test**

```go
// apps/backend/internal/studio/templates/render_test.go
package templates

import "testing"

func TestRenderSubstitutes(t *testing.T) {
	out, err := Render("Hello {{name}}", map[string]string{"name": "world"})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if out != "Hello world" {
		t.Fatalf("got %q", out)
	}
}

func TestRenderUsesDefault(t *testing.T) {
	out, err := Render(`{{name | default("anon")}}`, map[string]string{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if out != "anon" {
		t.Fatalf("got %q", out)
	}
}

func TestRenderMissingNoDefault(t *testing.T) {
	if _, err := Render("{{missing}}", map[string]string{}); err == nil {
		t.Fatalf("expected error")
	}
}

func TestValidateMissingRequired(t *testing.T) {
	tpl := Template{Meta: Meta{Variables: []Variable{{Name: "file", Required: true}}}}
	if err := Validate(tpl, map[string]string{}); err == nil {
		t.Fatalf("expected error for missing required var")
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/studio/templates/ -run 'Render|Validate' -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```go
// apps/backend/internal/studio/templates/render.go
package templates

import (
	"fmt"
	"regexp"
	"strings"
)

var placeholderRE = regexp.MustCompile(`\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|\s*default\(\s*"([^"]*)"\s*\)\s*)?\}\}`)

func Render(body string, vars map[string]string) (string, error) {
	var rerr error
	out := placeholderRE.ReplaceAllStringFunc(body, func(match string) string {
		m := placeholderRE.FindStringSubmatch(match)
		name := m[1]
		def := m[2]
		if v, ok := vars[name]; ok && v != "" {
			return v
		}
		if def != "" {
			return def
		}
		if rerr == nil {
			rerr = fmt.Errorf("template: variable %q has no value and no default", name)
		}
		return ""
	})
	return strings.TrimRight(out, "\n") + "\n", rerr
}

func Validate(tpl Template, vars map[string]string) error {
	for _, v := range tpl.Meta.Variables {
		if v.Required {
			val, ok := vars[v.Name]
			if !ok || val == "" {
				return fmt.Errorf("template %q: missing required variable %q", tpl.Meta.Name, v.Name)
			}
		}
	}
	return nil
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/backend && go test ./internal/studio/templates/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/studio/templates/render.go apps/backend/internal/studio/templates/render_test.go
git commit -m "feat(studio/templates): variable rendering with defaults"
```

---

## Task 3: Store — list/read/write/delete under `.orchestra/studio/templates/`

**Files:**
- Create: `apps/backend/internal/studio/templates/store.go`
- Create: `apps/backend/internal/studio/templates/store_test.go`

- [ ] **Step 1: Write failing test**

```go
// apps/backend/internal/studio/templates/store_test.go
package templates

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreListsTemplates(t *testing.T) {
	dir := t.TempDir()
	templatesDir := filepath.Join(dir, ".orchestra", "studio", "templates")
	_ = os.MkdirAll(templatesDir, 0755)
	_ = os.WriteFile(filepath.Join(templatesDir, "a.md"), []byte("---\nname: a\n---\nbody"), 0644)
	_ = os.WriteFile(filepath.Join(templatesDir, "b.md"), []byte("---\nname: b\n---\nbody"), 0644)

	s := NewStore(dir)
	tpls, err := s.List()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(tpls) != 2 {
		t.Fatalf("expected 2, got %d", len(tpls))
	}
}

func TestStoreWriteAndGet(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(dir)
	body := "---\nname: x\ndescription: X\n---\nhello"
	if err := s.Write("x", []byte(body)); err != nil {
		t.Fatalf("write: %v", err)
	}
	tpl, err := s.Get("x")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if tpl.Meta.Name != "x" {
		t.Fatalf("name=%q", tpl.Meta.Name)
	}
}

func TestStoreRejectsBadName(t *testing.T) {
	s := NewStore(t.TempDir())
	if err := s.Write("../escape", []byte("---\nname: e\n---\n")); err == nil {
		t.Fatalf("expected rejection of traversal")
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/studio/templates/ -run Store -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

```go
// apps/backend/internal/studio/templates/store.go
package templates

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type Store struct {
	root string
}

func NewStore(projectRoot string) *Store {
	return &Store{root: filepath.Join(projectRoot, ".orchestra", "studio", "templates")}
}

var nameRE = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func (s *Store) ensureDir() error {
	return os.MkdirAll(s.root, 0755)
}

func (s *Store) pathFor(name string) (string, error) {
	if !nameRE.MatchString(name) {
		return "", fmt.Errorf("template name must match [a-zA-Z0-9_-]+, got %q", name)
	}
	return filepath.Join(s.root, name+".md"), nil
}

func (s *Store) List() ([]Template, error) {
	if err := s.ensureDir(); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return nil, err
	}
	var out []Template
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		tpl, err := LoadTemplate(filepath.Join(s.root, e.Name()))
		if err != nil {
			continue
		}
		out = append(out, tpl)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Meta.Name < out[j].Meta.Name })
	return out, nil
}

func (s *Store) Get(name string) (Template, error) {
	p, err := s.pathFor(name)
	if err != nil {
		return Template{}, err
	}
	return LoadTemplate(p)
}

func (s *Store) Write(name string, content []byte) error {
	if err := s.ensureDir(); err != nil {
		return err
	}
	p, err := s.pathFor(name)
	if err != nil {
		return err
	}
	return os.WriteFile(p, content, 0644)
}

func (s *Store) Delete(name string) error {
	p, err := s.pathFor(name)
	if err != nil {
		return err
	}
	return os.Remove(p)
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/backend && go test ./internal/studio/templates/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/studio/templates/store.go apps/backend/internal/studio/templates/store_test.go
git commit -m "feat(studio/templates): file-backed CRUD store with safe naming"
```

---

## Task 4: Manager — `ApplyTemplate` mutator + `StartSession` template hook

**Files:**
- Modify: `apps/backend/internal/studio/manager.go`
- Test: `apps/backend/internal/studio/manager_test.go`

- [ ] **Step 1: Failing test**

```go
func TestStartSessionWithTemplatePrefillsDraft(t *testing.T) {
	m := newTestManager(t)
	store := writeTemplateForTest(t, m, "add-tests", `---
name: add-tests
description: Add tests
variables:
  - name: file
    required: true
suggested_provider: claude-code
suggested_max_turns: 8
---
Add tests to {{file}}.
`)
	m.SetTemplateStore(store)

	sess, err := m.StartSession(context.Background(), StartSessionRequest{
		ProjectID:    "p",
		Runner:       "claude-code",
		Template:     "add-tests",
		TemplateVars: map[string]string{"file": "auth.go"},
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	snap, _ := m.GetDraft(sess.ID)
	if snap.SuggestedProvider != "claude-code" {
		t.Fatalf("provider=%q", snap.SuggestedProvider)
	}
	if snap.MaxTurns == nil || *snap.MaxTurns != 8 {
		t.Fatalf("max_turns=%v", snap.MaxTurns)
	}
	if snap.TemplateName != "add-tests" {
		t.Fatalf("template_name=%q", snap.TemplateName)
	}
}

func TestApplyTemplateMidSession(t *testing.T) {
	m := newTestManager(t)
	store := writeTemplateForTest(t, m, "refactor", `---
name: refactor
variables:
  - name: target
    required: true
---
Refactor {{target}}.
`)
	m.SetTemplateStore(store)

	sess, _ := m.StartSession(context.Background(), StartSessionRequest{ProjectID: "p", Runner: "claude-code"})
	if err := m.ApplyTemplate(sess.ID, "refactor", map[string]string{"target": "auth.go"}); err != nil {
		t.Fatalf("apply: %v", err)
	}
	snap, _ := m.GetDraft(sess.ID)
	if snap.TemplateName != "refactor" {
		t.Fatalf("template_name=%q", snap.TemplateName)
	}
	if !strings.Contains(snap.Description, "auth.go") {
		t.Fatalf("description missing rendered body: %q", snap.Description)
	}
}
```

Add a `writeTemplateForTest` helper that creates a temp directory and writes the template there, returning a `*templates.Store`. Adjust the test wiring to give `Manager` access to the store.

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/studio/ -run Template -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `apps/backend/internal/studio/manager.go`:

```go
import (
	"github.com/orchestra/orchestra/apps/backend/internal/studio/templates"
)

// (struct gets:)
//   templateStore *templates.Store

func (m *Manager) SetTemplateStore(s *templates.Store) { m.templateStore = s }

func (m *Manager) ApplyTemplate(sessionID, name string, vars map[string]string) error {
	if m.templateStore == nil {
		return fmt.Errorf("studio: template store not configured")
	}
	tpl, err := m.templateStore.Get(name)
	if err != nil {
		return fmt.Errorf("get template: %w", err)
	}
	if err := templates.Validate(tpl, vars); err != nil {
		return err
	}
	rendered, err := templates.Render(tpl.Body, vars)
	if err != nil {
		return err
	}

	if tpl.Meta.SuggestedProvider != "" {
		_ = m.SetProvider(sessionID, tpl.Meta.SuggestedProvider)
	}
	if tpl.Meta.SuggestedModel != "" {
		_ = m.SetModel(sessionID, tpl.Meta.SuggestedModel)
	}
	if tpl.Meta.SuggestedMaxTurns > 0 {
		_ = m.SetMaxTurns(sessionID, tpl.Meta.SuggestedMaxTurns)
	}
	if err := db.UpdateDraftField(m.d, sessionID, "template_name", name); err != nil {
		return err
	}
	varsJSON, _ := json.Marshal(vars)
	if err := db.UpdateDraftField(m.d, sessionID, "template_vars", string(varsJSON)); err != nil {
		return err
	}
	if err := m.SetDescription(sessionID, rendered); err != nil {
		return err
	}
	return nil
}
```

Modify `StartSession` to call `ApplyTemplate` after creating the draft if `req.Template != ""`:

```go
if req.Template != "" {
	if err := m.ApplyTemplate(id, req.Template, req.TemplateVars); err != nil {
		_ = db.DeleteDraft(m.d, id)
		_ = db.EndStudioSession(m.d, id, string(StatusDiscarded))
		return Session{}, fmt.Errorf("apply template: %w", err)
	}
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd apps/backend && go test ./internal/studio/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/internal/studio/manager.go apps/backend/internal/studio/manager_test.go
git commit -m "feat(studio): templates apply on session start and mid-session"
```

---

## Task 5: `apply_template` MCP tool

**Files:**
- Modify: `apps/backend/internal/mcp/studio/server.go`
- Modify: `apps/backend/internal/mcp/studio/tools.go`
- Test: `apps/backend/internal/mcp/studio/server_test.go`

- [ ] **Step 1: Failing test**

```go
type recordingManagerWithTemplate struct {
	recordingManager
	templateCalls []struct {
		Name string
		Vars map[string]string
	}
}

func (r *recordingManagerWithTemplate) ApplyTemplate(_ string, name string, vars map[string]string) error {
	r.templateCalls = append(r.templateCalls, struct {
		Name string
		Vars map[string]string
	}{name, vars})
	return nil
}

func TestApplyTemplateTool(t *testing.T) {
	rm := &recordingManagerWithTemplate{}
	srv := New(rm, "sess1")
	_, err := srv.Dispatch(context.Background(), "apply_template",
		json.RawMessage(`{"name":"add-tests","vars":{"file":"a.go"}}`))
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	if len(rm.templateCalls) != 1 || rm.templateCalls[0].Name != "add-tests" {
		t.Fatalf("calls=%+v", rm.templateCalls)
	}
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd apps/backend && go test ./internal/mcp/studio/ -run ApplyTemplate -v`
Expected: FAIL.

- [ ] **Step 3: Extend `ManagerAPI` and add the handler**

In `server.go`, add to `ManagerAPI`:

```go
ApplyTemplate(sessionID, name string, vars map[string]string) error
```

Add to the tool map in `New`:

```go
"apply_template": s.handleApplyTemplate,
```

In `tools.go`:

```go
func (s *Server) handleApplyTemplate(_ context.Context, raw json.RawMessage) (json.RawMessage, error) {
	var a struct {
		Name string            `json:"name"`
		Vars map[string]string `json:"vars"`
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, err
	}
	if a.Name == "" {
		return nil, fmt.Errorf("name required")
	}
	if err := s.mgr.ApplyTemplate(s.sessionID, a.Name, a.Vars); err != nil {
		return nil, err
	}
	return ok(), nil
}
```

- [ ] **Step 4: Update other test stubs**

Every `*recordingManager`-style stub in tests must now implement `ApplyTemplate`. Add the no-op method.

- [ ] **Step 5: Run, verify pass**

Run: `cd apps/backend && go test ./internal/mcp/studio/ -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/internal/mcp/studio/
git commit -m "feat(mcp/studio): apply_template tool"
```

---

## Task 6: HTTP routes for templates

**Files:**
- Create: `apps/backend/internal/api/studio_templates.go`
- Create: `apps/backend/internal/api/studio_templates_test.go`
- Modify: `apps/backend/internal/api/studio.go`

- [ ] **Step 1: Failing test**

```go
// apps/backend/internal/api/studio_templates_test.go
package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func TestStudioTemplatesList(t *testing.T) {
	srv, _, _ := spinUpStudioAPI(t)
	defer srv.Close()

	req, _ := http.NewRequest("POST", srv.URL+"/api/studio/templates", bytes.NewBufferString(
		`{"name":"add-tests","content":"---\nname: add-tests\n---\nbody"}`,
	))
	req.Header.Set("Content-Type", "application/json")
	resp, _ := http.DefaultClient.Do(req)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create status=%d", resp.StatusCode)
	}

	resp2, _ := http.Get(srv.URL + "/api/studio/templates")
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("list status=%d", resp2.StatusCode)
	}
	var out []map[string]interface{}
	_ = json.NewDecoder(resp2.Body).Decode(&out)
	if len(out) != 1 {
		t.Fatalf("expected 1 template, got %d: %+v", len(out), out)
	}
}
```

- [ ] **Step 2: Implement handler**

```go
// apps/backend/internal/api/studio_templates.go
package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/studio/templates"
)

type StudioTemplatesHandler struct {
	store *templates.Store
}

func NewStudioTemplatesHandler(store *templates.Store) *StudioTemplatesHandler {
	return &StudioTemplatesHandler{store: store}
}

func (h *StudioTemplatesHandler) Mount(r chi.Router) {
	r.Route("/studio/templates", func(r chi.Router) {
		r.Get("/", h.list)
		r.Post("/", h.create)
		r.Get("/{name}", h.get)
		r.Put("/{name}", h.update)
		r.Delete("/{name}", h.delete)
	})
}

func (h *StudioTemplatesHandler) list(w http.ResponseWriter, _ *http.Request) {
	tpls, err := h.store.List()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(tpls)
}

type tplBody struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

func (h *StudioTemplatesHandler) create(w http.ResponseWriter, r *http.Request) {
	var b tplBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.store.Write(b.Name, []byte(b.Content)); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *StudioTemplatesHandler) get(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	tpl, err := h.store.Get(name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	_ = json.NewEncoder(w).Encode(tpl)
}

func (h *StudioTemplatesHandler) update(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var b tplBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.store.Write(name, []byte(b.Content)); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *StudioTemplatesHandler) delete(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.store.Delete(name); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
```

- [ ] **Step 3: Mount in router**

In `apps/backend/internal/api/studio.go`'s `Mount` (or wherever studio routes are mounted), also mount the templates handler:

```go
if h.templates != nil {
	h.templates.Mount(r)
}
```

Add `templates *StudioTemplatesHandler` to `StudioHandler`, and a setter or constructor variant.

- [ ] **Step 4: Wire in `app/run.go`**

```go
templateStore := templates.NewStore(workspaceRoot)
studioMgr.SetTemplateStore(templateStore)
studioHandler := api.NewStudioHandler(studioMgr, pubsub)
studioHandler.SetTemplatesHandler(api.NewStudioTemplatesHandler(templateStore))
```

- [ ] **Step 5: Run, verify pass**

Run: `cd apps/backend && go test ./internal/api/ -run Templates -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/internal/api/ apps/backend/internal/app/run.go
git commit -m "feat(api): /api/studio/templates CRUD"
```

---

## Task 7: Frontend — `useTemplates` hook

**Files:**
- Create: `apps/desktop/src/features/studio/templates/useTemplates.ts`
- Modify: `apps/desktop/src/lib/orchestra-client.ts`

- [ ] **Step 1: Add client methods**

```ts
// apps/desktop/src/lib/orchestra-client.ts (append)
export interface StudioTemplate {
  path: string;
  meta: {
    name: string;
    description: string;
    variables: Array<{ name: string; required: boolean; default?: string }>;
    suggested_provider?: string;
    suggested_model?: string;
    suggested_max_turns?: number;
  };
  body: string;
}

async listStudioTemplates(): Promise<StudioTemplate[]> {
  return this.request("GET", "/api/studio/templates");
}
async getStudioTemplate(name: string): Promise<StudioTemplate> {
  return this.request("GET", `/api/studio/templates/${name}`);
}
async createStudioTemplate(name: string, content: string): Promise<void> {
  await this.request("POST", "/api/studio/templates", { name, content });
}
async updateStudioTemplate(name: string, content: string): Promise<void> {
  await this.request("PUT", `/api/studio/templates/${name}`, { name, content });
}
async deleteStudioTemplate(name: string): Promise<void> {
  await this.request("DELETE", `/api/studio/templates/${name}`);
}
```

- [ ] **Step 2: Implement hook**

```ts
// apps/desktop/src/features/studio/templates/useTemplates.ts
import { useCallback, useEffect, useState } from "react";
import type { OrchestraClient, StudioTemplate } from "@/lib/orchestra-client";

export function useTemplates(client: OrchestraClient) {
  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await client.listStudioTemplates();
      setTemplates(list);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async (name: string, content: string) => {
    await client.createStudioTemplate(name, content).catch(() => client.updateStudioTemplate(name, content));
    await refresh();
  }, [client, refresh]);

  const remove = useCallback(async (name: string) => {
    await client.deleteStudioTemplate(name);
    await refresh();
  }, [client, refresh]);

  return { templates, loading, refresh, save, remove };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/lib/orchestra-client.ts apps/desktop/src/features/studio/templates/useTemplates.ts
git commit -m "feat(studio): template client + useTemplates hook"
```

---

## Task 8: `TemplateLibrary.tsx` modal

**Files:**
- Create: `apps/desktop/src/features/studio/templates/TemplateLibrary.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/desktop/src/features/studio/templates/TemplateLibrary.tsx
import { useState } from "react";
import type { StudioTemplate } from "@/lib/orchestra-client";

export interface TemplateLibraryProps {
  templates: StudioTemplate[];
  onApply: (name: string, vars: Record<string, string>) => void;
  onSave: (name: string, content: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  onClose: () => void;
}

export function TemplateLibrary({ templates, onApply, onSave, onDelete, onClose }: TemplateLibraryProps) {
  const [selected, setSelected] = useState<StudioTemplate | null>(templates[0] ?? null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-neutral-900 border border-white/10 rounded w-[800px] h-[560px] flex" onClick={(e) => e.stopPropagation()}>
        <aside className="w-56 border-r border-white/10 flex flex-col">
          <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
            <h3 className="text-sm font-medium">Templates</h3>
            <button onClick={() => { setEditing(true); setEditName(""); setEditContent("---\nname: \n---\n"); }} className="text-xs opacity-60 hover:opacity-100">+ new</button>
          </div>
          <ul className="flex-1 overflow-y-auto">
            {templates.map((t) => (
              <li key={t.meta.name}>
                <button
                  onClick={() => { setSelected(t); setEditing(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-white/5 ${selected?.meta.name === t.meta.name ? "bg-white/10" : ""}`}
                >
                  <div>{t.meta.name}</div>
                  <div className="text-xs opacity-50 truncate">{t.meta.description}</div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="flex-1 flex flex-col">
          {editing ? (
            <div className="flex-1 flex flex-col p-3 gap-2">
              <input
                className="bg-transparent border border-white/20 rounded px-2 py-1 text-sm"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="template-name"
              />
              <textarea
                className="flex-1 bg-transparent border border-white/20 rounded p-2 text-sm font-mono"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditing(false)} className="px-3 py-1 text-sm">Cancel</button>
                <button
                  onClick={async () => { await onSave(editName, editContent); setEditing(false); }}
                  className="px-3 py-1 text-sm bg-sky-500 text-black rounded"
                >
                  Save
                </button>
              </div>
            </div>
          ) : selected ? (
            <div className="flex-1 flex flex-col p-3 gap-3">
              <div>
                <h2 className="text-base font-medium">{selected.meta.name}</h2>
                <p className="text-sm opacity-60">{selected.meta.description}</p>
              </div>
              {selected.meta.variables?.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="text-xs uppercase opacity-60">Variables</div>
                  {selected.meta.variables.map((v) => (
                    <label key={v.name} className="flex items-center gap-2 text-sm">
                      <span className="w-32">{v.name}{v.required && <span className="text-red-400">*</span>}</span>
                      <input
                        className="flex-1 bg-transparent border border-white/20 rounded px-2 py-1"
                        value={vars[v.name] ?? ""}
                        onChange={(e) => setVars({ ...vars, [v.name]: e.target.value })}
                        placeholder={v.default ?? ""}
                      />
                    </label>
                  ))}
                </div>
              )}
              <pre className="flex-1 overflow-auto text-xs bg-black/30 p-2 rounded whitespace-pre-wrap">{selected.body}</pre>
              <div className="flex gap-2 justify-end">
                <button onClick={() => onDelete(selected.meta.name)} className="px-3 py-1 text-sm text-red-400">Delete</button>
                <button onClick={() => { setEditing(true); setEditName(selected.meta.name); setEditContent(`---\n${yamlOf(selected.meta)}---\n${selected.body}`); }} className="px-3 py-1 text-sm">Edit</button>
                <button onClick={() => onApply(selected.meta.name, vars)} className="px-3 py-1 text-sm bg-sky-500 text-black rounded">Apply</button>
              </div>
            </div>
          ) : (
            <div className="p-6 text-sm opacity-60">No templates yet.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function yamlOf(meta: StudioTemplate["meta"]): string {
  const lines = [`name: ${meta.name}`];
  if (meta.description) lines.push(`description: ${meta.description}`);
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/features/studio/templates/TemplateLibrary.tsx
git commit -m "feat(studio): TemplateLibrary modal"
```

---

## Task 9: Wire templates into `StudioSection` + upgrade `TemplatePicker`

**Files:**
- Modify: `apps/desktop/src/features/studio/draft/fields/TemplatePicker.tsx`
- Modify: `apps/desktop/src/features/studio/StudioSection.tsx`

- [ ] **Step 1: Upgrade `TemplatePicker`**

```tsx
import type { StudioDraft } from "@/lib/orchestra-client";

export function TemplatePicker({
  draft,
  onBrowse,
}: {
  draft: StudioDraft;
  onChange: (patch: Partial<StudioDraft>) => void;
  onBrowse: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="opacity-60">Template:</span>
      <span>{draft.template_name || "—"}</span>
      <button onClick={onBrowse} className="ml-auto text-xs opacity-70 hover:opacity-100">Browse</button>
    </div>
  );
}
```

Update `DraftPanel.tsx` to pass `onBrowse` through:

```tsx
<TemplatePicker draft={draft} onChange={onChange} onBrowse={onBrowseTemplates} />
```

Add `onBrowseTemplates: () => void` to `DraftPanelProps` and thread it from `StudioSection`.

- [ ] **Step 2: Show the library in `StudioSection`**

```tsx
import { TemplateLibrary } from "./templates/TemplateLibrary";
import { useTemplates } from "./templates/useTemplates";

// inside StudioBody, after destructuring useStudioSession:
const { templates, save, remove } = useTemplates(client);
const [libraryOpen, setLibraryOpen] = useState(false);

const applyTemplate = async (name: string, vars: Record<string, string>) => {
  // Backend mid-session apply via the manager — there's no dedicated REST endpoint yet,
  // so route through patchStudioDraft is wrong. Add a dedicated route or call apply_template
  // via the message channel. The MVP path: discard the session and start a new one with the template.
  await discard();
  // The parent will create a fresh session; for an explicit template-start we'd need to surface
  // a "restart with template" callback. Simplest: instruct the user to start a new session.
  setLibraryOpen(false);
};
```

> **Note:** Mid-session template application via REST requires a small additional endpoint
> `POST /api/studio/sessions/:id/apply-template` that calls `studio.Manager.ApplyTemplate`.
> Add that endpoint analogous to `editDraft` if you want true mid-session apply; otherwise
> the MVP behavior is to start a fresh session pre-applied with the chosen template.

Render the modal:

```tsx
{libraryOpen && (
  <TemplateLibrary
    templates={templates}
    onApply={applyTemplate}
    onSave={save}
    onDelete={remove}
    onClose={() => setLibraryOpen(false)}
  />
)}
```

Pass `() => setLibraryOpen(true)` as the `onBrowseTemplates` prop on `DraftPanel`.

- [ ] **Step 3: (Recommended) Add the mid-session apply endpoint**

In `apps/backend/internal/api/studio.go`:

```go
r.Post("/sessions/{id}/apply-template", h.applyTemplate)

func (h *StudioHandler) applyTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Name string            `json:"name"`
		Vars map[string]string `json:"vars"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.mgr.ApplyTemplate(id, req.Name, req.Vars); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
```

Frontend client:

```ts
async applyStudioTemplate(sessionId: string, name: string, vars: Record<string, string>): Promise<void> {
  await this.request("POST", `/api/studio/sessions/${sessionId}/apply-template`, { name, vars });
}
```

Then in `StudioBody`:

```ts
const applyTemplate = async (name: string, vars: Record<string, string>) => {
  await client.applyStudioTemplate(sessionId, name, vars);
  setLibraryOpen(false);
};
```

- [ ] **Step 4: Typecheck and tests**

Run: `cd apps/desktop && npx tsc --noEmit && npx vitest run`
Run: `cd apps/backend && go test ./...`
Expected: all clean.

- [ ] **Step 5: Smoke (manual)**

Start backend + desktop, open Studio, click "Browse" in the draft panel. Verify a new template can be saved, an existing one applied, and applying updates the description / provider / model on the right pane.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/features/studio/ apps/backend/internal/api/studio.go apps/desktop/src/lib/orchestra-client.ts
git commit -m "feat(studio): wire template library into session and add mid-session apply"
```

---

## Phase 4 Complete

The studio now supports template-driven authoring with reusable, parameterized templates stored per-project. Templates can be created, edited, deleted, and applied from the UI, and the agent can apply them via the `apply_template` MCP tool.

All four phases of the Task Authoring Studio spec are now implemented.
