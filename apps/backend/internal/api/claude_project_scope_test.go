package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Tier 2 contract tests for the project-scope branch of /api/v1/agents/claude/*.
// The global-scope branch is covered by agent_config_e2e_test.go. The
// project-scope branch resolves the target directory via
// resolveProjectRoot — these tests pin that resolution and the on-disk
// layout (CLAUDE.md, .claude/settings.json, .claude/{rules,skills,agents}/).

// seedProject creates a temp project directory + DB row and returns its
// id and root. Tests pass project_id in the query string so the handlers
// can resolve to the temp root via s.db.GetProjectByID.
func seedProject(t *testing.T) (router http.Handler, projectID string, root string) {
	t.Helper()
	router, dbConn := newTestRouterWithDB(t)
	root = t.TempDir()
	id, err := dbConn.UpsertProject(t.Context(), root, "")
	if err != nil {
		t.Fatalf("seed project: %v", err)
	}
	return router, id, root
}

func TestClaudeProjectInstructionsRoundTrip(t *testing.T) {
	router, projectID, root := seedProject(t)

	// GET on empty project → 200 with exists=false
	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/agents/claude/instructions?scope=project&project_id="+projectID, nil)
	getRec := httptest.NewRecorder()
	router.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get-empty got %d, want 200; body=%s", getRec.Code, getRec.Body.String())
	}
	var initial struct {
		Content string `json:"content"`
		Path    string `json:"path"`
		Exists  bool   `json:"exists"`
	}
	_ = json.Unmarshal(getRec.Body.Bytes(), &initial)
	if initial.Exists {
		t.Errorf("exists should be false for empty project, got true")
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(initial.Path, canonicalRoot+string(filepath.Separator)) {
		t.Errorf("path %q should be inside project root %q", initial.Path, root)
	}

	// POST writes CLAUDE.md
	postReq := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/instructions?scope=project&project_id="+projectID, strings.NewReader(`{"content":"# Project rules\n"}`))
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	router.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusOK {
		t.Fatalf("post got %d; body=%s", postRec.Code, postRec.Body.String())
	}
	want := filepath.Join(root, "CLAUDE.md")
	if data, err := os.ReadFile(want); err != nil {
		t.Fatalf("CLAUDE.md not written at %s: %v", want, err)
	} else if string(data) != "# Project rules\n" {
		t.Errorf("content mismatch: got %q", string(data))
	}

	// GET returns the written content
	getRec2 := httptest.NewRecorder()
	router.ServeHTTP(getRec2, httptest.NewRequest(http.MethodGet, "/api/v1/agents/claude/instructions?scope=project&project_id="+projectID, nil))
	var second struct {
		Content string `json:"content"`
		Exists  bool   `json:"exists"`
	}
	_ = json.Unmarshal(getRec2.Body.Bytes(), &second)
	if !second.Exists || second.Content != "# Project rules\n" {
		t.Errorf("read-back failed: %+v", second)
	}

	// DELETE removes it
	delRec := httptest.NewRecorder()
	router.ServeHTTP(delRec, httptest.NewRequest(http.MethodDelete, "/api/v1/agents/claude/instructions?scope=project&project_id="+projectID, nil))
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete got %d", delRec.Code)
	}
	if _, err := os.Stat(want); !os.IsNotExist(err) {
		t.Errorf("CLAUDE.md still exists after delete: %v", err)
	}
}

func TestClaudeProjectSettingsMergesUnderProjectClaudeDir(t *testing.T) {
	router, projectID, root := seedProject(t)

	body := `{"settings":{"theme":"dark","autosave":true}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/settings?scope=project&project_id="+projectID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("post got %d; body=%s", rec.Code, rec.Body.String())
	}

	settingsPath := filepath.Join(root, ".claude", "settings.json")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("settings.json not written at %s: %v", settingsPath, err)
	}
	var stored map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("decode persisted: %v", err)
	}
	if stored["theme"] != "dark" || stored["autosave"] != true {
		t.Errorf("persisted settings missing fields: %+v", stored)
	}

	// Second POST should merge, not replace.
	merge := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/settings?scope=project&project_id="+projectID, strings.NewReader(`{"settings":{"font":"JetBrains"}}`))
	merge.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(httptest.NewRecorder(), merge)

	data2, _ := os.ReadFile(settingsPath)
	var merged map[string]any
	_ = json.Unmarshal(data2, &merged)
	if merged["theme"] != "dark" {
		t.Errorf("merge dropped existing theme: %+v", merged)
	}
	if merged["font"] != "JetBrains" {
		t.Errorf("merge missed new font: %+v", merged)
	}
}

func TestClaudeProjectRulesCRUD(t *testing.T) {
	router, projectID, root := seedProject(t)

	// List empty
	listRec := httptest.NewRecorder()
	router.ServeHTTP(listRec, httptest.NewRequest(http.MethodGet, "/api/v1/agents/claude/rules?scope=project&project_id="+projectID, nil))
	if listRec.Code != http.StatusOK {
		t.Fatalf("list empty got %d", listRec.Code)
	}

	// Create rule (handler appends .md if missing)
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/rules?scope=project&project_id="+projectID, strings.NewReader(`{"name":"never-mock","content":"Don't mock."}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	router.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("create got %d; body=%s", createRec.Code, createRec.Body.String())
	}

	rulePath := filepath.Join(root, ".claude", "rules", "never-mock.md")
	if data, err := os.ReadFile(rulePath); err != nil {
		t.Fatalf("rule file missing at %s: %v", rulePath, err)
	} else if string(data) != "Don't mock." {
		t.Errorf("rule content mismatch: got %q", string(data))
	}

	// Delete (handler also accepts name without .md suffix)
	delRec := httptest.NewRecorder()
	router.ServeHTTP(delRec, httptest.NewRequest(http.MethodDelete, "/api/v1/agents/claude/rules/never-mock?scope=project&project_id="+projectID, nil))
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete got %d", delRec.Code)
	}
	if _, err := os.Stat(rulePath); !os.IsNotExist(err) {
		t.Errorf("rule still exists after delete")
	}
}

func TestClaudeProjectSkillsCRUD(t *testing.T) {
	router, projectID, root := seedProject(t)

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/skills?scope=project&project_id="+projectID, strings.NewReader(`{"name":"refactor","content":"Refactor steps..."}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	router.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("create got %d; body=%s", createRec.Code, createRec.Body.String())
	}

	// Skills land under .claude/skills/<name>/SKILL.md per the agent runner
	// contract; just assert *some* file lives under the skills dir. Avoid
	// pinning the exact path so a future repackaging doesn't break this.
	skillsDir := filepath.Join(root, ".claude", "skills")
	entries, err := os.ReadDir(skillsDir)
	if err != nil || len(entries) == 0 {
		t.Fatalf("expected skill files under %s; readdir err=%v entries=%v", skillsDir, err, entries)
	}

	// Delete should succeed.
	delRec := httptest.NewRecorder()
	router.ServeHTTP(delRec, httptest.NewRequest(http.MethodDelete, "/api/v1/agents/claude/skills/refactor?scope=project&project_id="+projectID, nil))
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete got %d; body=%s", delRec.Code, delRec.Body.String())
	}
}

func TestClaudeProjectSubAgentsCRUD(t *testing.T) {
	router, projectID, root := seedProject(t)

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/agents/claude/subagents?scope=project&project_id="+projectID, strings.NewReader(`{"name":"reviewer","content":"You are a reviewer."}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	router.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("create got %d; body=%s", createRec.Code, createRec.Body.String())
	}

	// Subagents land under .claude/agents/ — assert *some* file exists.
	agentsDir := filepath.Join(root, ".claude", "agents")
	entries, err := os.ReadDir(agentsDir)
	if err != nil || len(entries) == 0 {
		t.Fatalf("expected subagent files under %s; readdir err=%v entries=%v", agentsDir, err, entries)
	}

	delRec := httptest.NewRecorder()
	router.ServeHTTP(delRec, httptest.NewRequest(http.MethodDelete, "/api/v1/agents/claude/subagents/reviewer?scope=project&project_id="+projectID, nil))
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete got %d; body=%s", delRec.Code, delRec.Body.String())
	}
}

func TestClaudeProjectScopeRequiresProjectID(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	cases := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/agents/claude/settings?scope=project"},
		{http.MethodGet, "/api/v1/agents/claude/instructions?scope=project"},
		{http.MethodGet, "/api/v1/agents/claude/rules?scope=project"},
		{http.MethodGet, "/api/v1/agents/claude/skills?scope=project"},
		{http.MethodGet, "/api/v1/agents/claude/subagents?scope=project"},
	}
	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("got %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}
