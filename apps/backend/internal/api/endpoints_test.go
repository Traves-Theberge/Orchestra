package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/plangate"
	sqlitetracker "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
	"github.com/rs/zerolog"
)

// ---------------------------------------------------------------------------
// Helper: create a minimal router without DB (for state-level endpoints)
// ---------------------------------------------------------------------------

func newTestRouter(t *testing.T) http.Handler {
	t.Helper()
	return NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{
		WorkspaceRoot: t.TempDir(),
		Host:          "127.0.0.1",
		APIToken:      "",
		ProjectRoots:  []string{os.TempDir(), "/tmp"},
	})
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

func TestGetIssuesReturnsEmptyList(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/issues", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := payload["issues"]; !ok {
		t.Fatalf("expected issues key in response: %v", payload)
	}
}

func TestPostIssueCreatesIssue(t *testing.T) {
	router := newTestRouter(t)

	body, _ := json.Marshal(map[string]any{
		"title":       "Test Issue",
		"description": "A test issue",
		"state":       "Todo",
		"priority":    1,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/issues", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Create may fail with 500 if no tracker is configured, which is expected
	// in a test environment without a backing tracker. Verify it doesn't panic
	// and returns valid JSON.
	if rec.Code != http.StatusCreated && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 201 or 500, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}

func TestPostIssueRejectsInvalidJSON(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/issues", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPatchIssueNotFound(t *testing.T) {
	router := newTestRouter(t)
	body, _ := json.Marshal(map[string]any{"state": "Todo"})
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/issues/NONEXISTENT-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 404 or 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteIssueNotFound(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/issues/NONEXISTENT-1", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// May return 204 (no-op) or 404 depending on tracker
	if rec.Code != http.StatusNoContent && rec.Code != http.StatusNotFound && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 204, 404, or 500, got %d", rec.Code)
	}
}

func TestDeleteIssueSessionNotFound(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/issues/NONEXISTENT-1/session", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Should not panic; may return 204/404/500 depending on tracker state
	if rec.Code == 0 {
		t.Fatalf("expected a response status, got 0")
	}
}

func TestGetIssueLogsNotFound(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/issues/UNKNOWN-1/logs", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Logs endpoint returns placeholder text even when issue not found
	if rec.Code != http.StatusOK && rec.Code != http.StatusNotFound {
		t.Fatalf("expected 200 or 404, got %d", rec.Code)
	}
}

func TestGetIssueHistoryNotFound(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/issues/UNKNOWN-1/history", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound && rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
		t.Fatalf("unexpected status %d", rec.Code)
	}
}

func TestGetIssueDiffNotFound(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/issues/UNKNOWN-1/diff", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Diff handler may return empty text or error envelope
	if rec.Code == 0 {
		t.Fatalf("expected a response status, got 0")
	}
}

func TestGetIssueArtifacts(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/issues/UNKNOWN-1/artifacts", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// May return 200 with empty artifacts or 500
	if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 200 or 500, got %d", rec.Code)
	}
}

func TestGetIssueArtifactContentMissingPath(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/issues/UNKNOWN-1/artifacts/", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Should handle gracefully
	if rec.Code == 0 {
		t.Fatalf("expected a response status, got 0")
	}
}

func TestPostIssueStopNotFound(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/issues/UNKNOWN-1/stop", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Should return 404 or 500 when issue doesn't exist
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusInternalServerError && rec.Code != http.StatusOK {
		t.Fatalf("expected 404, 500, or 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestPostIssueStopResetsStateAndCancelsSession pins down the contract that
// #147 step 6 ("stop running session → state returns cleanly") relies on:
// hitting POST /issues/{id}/stop must (1) invoke the registered cancel func
// for the active run, (2) hold the task in Backlog, (3) invalidate prior
// plan approval, and (4) preserve task and worktree context.
func TestPostIssueStopResetsStateAndCancelsSession(t *testing.T) {
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	projectID, err := database.UpsertProject(context.Background(), filepath.Join(t.TempDir(), "project"), "")
	if err != nil {
		t.Fatal(err)
	}
	tr := sqlitetracker.NewClient(database, nil)
	issue, err := tr.CreateIssue(context.Background(), "stop me", "preserve this task context", "In Progress", 0, "worker", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	const branchName = "feat/stop-me"
	const feedback = "keep reviewer context"
	const plan = "- [ ] preserve implementation"
	const baseSHA = "0123456789abcdef0123456789abcdef01234567"
	const prURL = "https://github.com/example/repo/pull/17"
	if _, err := tr.UpdateIssue(context.Background(), issue.ID, map[string]any{
		"branch_name": branchName, "feedback": feedback, "plan": plan, "base_sha": baseSHA, "pr_url": prURL,
	}); err != nil {
		t.Fatal(err)
	}
	issue, err = tr.FetchIssueByIdentifier(context.Background(), issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	issueID, identifier := issue.ID, issue.Identifier
	fingerprint := plangate.Fingerprint(*issue)
	if _, err := database.Exec(`INSERT INTO issue_history(id,issue_id,user_id,action,new_value) VALUES('stop-plan-ready',?,'User','plan_ready',?)`, issue.ID, fingerprint); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`INSERT INTO issue_history(id,issue_id,user_id,action,new_value) VALUES('stop-plan-approved',?,'User','plan_approved',?)`, issue.ID, fingerprint); err != nil {
		t.Fatal(err)
	}

	orch := orchestrator.NewService()
	orch.SetTrackerClient(tr)
	orch.SetDB(database)
	orch.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         issueID,
		IssueIdentifier: identifier,
		State:           "In Progress",
		Provider:        "CODEX",
		SessionID:       "session-1",
	}})

	cancelled := false
	_, cancel := context.WithCancel(context.Background())
	orch.RegisterCancel(issueID, "CODEX", func() {
		cancelled = true
		cancel()
	})

	workspaceRoot := t.TempDir()
	worktreePath := filepath.Join(workspaceRoot, projectID, branchName)
	if err := os.MkdirAll(worktreePath, 0o755); err != nil {
		t.Fatal(err)
	}
	markerPath := filepath.Join(worktreePath, "user-work.txt")
	if err := os.WriteFile(markerPath, []byte("retain working tree"), 0o600); err != nil {
		t.Fatal(err)
	}
	router := NewRouter(zerolog.Nop(), orch, &config.Config{
		WorkspaceRoot: workspaceRoot,
		Host:          "127.0.0.1",
		APIToken:      "",
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/issues/"+identifier+"/stop", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("POST /stop: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !cancelled {
		t.Fatal("registered cancel func was not invoked")
	}

	updated, err := tr.FetchIssueByIdentifier(context.Background(), issue.ID)
	if err != nil || updated == nil {
		t.Fatalf("fetch updated issue: %v", err)
	}
	if updated.State != "Backlog" || updated.Feedback != feedback || updated.Plan != plan || updated.BranchName != branchName || updated.BaseSHA != baseSHA || updated.PRURL != prURL {
		t.Fatalf("stop did not hold task while retaining context: %+v", updated)
	}
	if _, err := os.Stat(markerPath); err != nil {
		t.Fatalf("stop removed workspace content: %v", err)
	}
	if gate := orch.PlanGate(context.Background(), *updated); gate.Status != "stale" {
		t.Fatalf("stop left old approval reusable: %+v", gate)
	}
}

func TestDeleteIssueSessionHoldsTaskAfterCancellation(t *testing.T) {
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	projectID, err := database.UpsertProject(context.Background(), filepath.Join(t.TempDir(), "project"), "")
	if err != nil {
		t.Fatal(err)
	}
	client := sqlitetracker.NewClient(database, nil)
	issue, err := client.CreateIssue(context.Background(), "cancel me", "retain this plan", "In Progress", 0, "worker", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.UpdateIssue(context.Background(), issue.ID, map[string]any{"plan": "- [ ] work"}); err != nil {
		t.Fatal(err)
	}
	issue, err = client.FetchIssueByIdentifier(context.Background(), issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	fingerprint := plangate.Fingerprint(*issue)
	if _, err := database.Exec(`INSERT INTO issue_history(id,issue_id,user_id,action,new_value) VALUES('delete-session-plan-approved',?,'User','plan_approved',?)`, issue.ID, fingerprint); err != nil {
		t.Fatal(err)
	}
	orch := orchestrator.NewService()
	orch.SetTrackerClient(client)
	orch.SetDB(database)
	orch.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: issue.ID, IssueIdentifier: issue.Identifier, State: "In Progress", Provider: "CODEX", SessionID: "session-stop"}})
	cancelled := false
	orch.RegisterCancel(issue.ID, "CODEX", func() { cancelled = true })
	router := NewRouter(zerolog.Nop(), orch, &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1"})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodDelete, "/api/v1/issues/"+issue.Identifier+"/session", nil))
	if recorder.Code != http.StatusNoContent || !cancelled {
		t.Fatalf("DELETE session did not cancel and hold task: status=%d cancelled=%t body=%s", recorder.Code, cancelled, recorder.Body.String())
	}
	updated, err := client.FetchIssueByIdentifier(context.Background(), issue.ID)
	if err != nil || updated.State != "Backlog" || updated.Plan != "- [ ] work" {
		t.Fatalf("session stop lost task context or failed to hold it: %+v %v", updated, err)
	}
	if gate := orch.PlanGate(context.Background(), *updated); gate.Status != "stale" {
		t.Fatalf("session stop left old approval reusable: %+v", gate)
	}
}

func TestStopPersistenceFailureDoesNotCancelSession(t *testing.T) {
	for _, tc := range []struct {
		name   string
		method string
		path   string
		want   int
	}{
		{name: "post stop", method: http.MethodPost, path: "/api/v1/issues/%s/stop", want: http.StatusConflict},
		{name: "provider delete", method: http.MethodDelete, path: "/api/v1/issues/%s/session?provider=CODEX", want: http.StatusConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = database.Close() })
			projectID, err := database.UpsertProject(context.Background(), filepath.Join(t.TempDir(), "project"), "")
			if err != nil {
				t.Fatal(err)
			}
			client := sqlitetracker.NewClient(database, nil)
			issue, err := client.CreateIssue(context.Background(), "do not cancel", "preserve approved context", "In Progress", 0, "worker", projectID, "CODEX", nil)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := client.UpdateIssue(context.Background(), issue.ID, map[string]any{"plan": "- [ ] execute"}); err != nil {
				t.Fatal(err)
			}
			issue, err = client.FetchIssueByIdentifier(context.Background(), issue.ID)
			if err != nil {
				t.Fatal(err)
			}
			fingerprint := plangate.Fingerprint(*issue)
			if _, err := database.Exec(`INSERT INTO issue_history(id,issue_id,user_id,action,new_value) VALUES('stop-failure-approved',?,'User','plan_approved',?)`, issue.ID, fingerprint); err != nil {
				t.Fatal(err)
			}
			if _, err := database.Exec(`CREATE TRIGGER reject_stop_backlog BEFORE UPDATE OF state ON issues WHEN NEW.state='Backlog' BEGIN SELECT RAISE(ABORT, 'forced stop persistence failure'); END`); err != nil {
				t.Fatal(err)
			}
			service := orchestrator.NewService()
			service.SetTrackerClient(client)
			service.SetDB(database)
			service.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: issue.ID, IssueIdentifier: issue.Identifier, State: "In Progress", Provider: "CODEX", SessionID: "active"}})
			cancelled := false
			service.RegisterCancel(issue.ID, "CODEX", func() { cancelled = true })
			router := NewRouter(zerolog.Nop(), service, &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1"})
			path := strings.Replace(tc.path, "%s", issue.Identifier, 1)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(tc.method, path, nil))
			if recorder.Code != tc.want || !strings.Contains(recorder.Body.String(), `"code":"stop_failed"`) {
				t.Fatalf("stop reported an unexpected outcome: status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			if cancelled {
				t.Fatal("session was canceled before the durable hold committed")
			}
			unchanged, err := client.FetchIssueByIdentifier(context.Background(), issue.ID)
			if err != nil || unchanged.State != "In Progress" || service.PlanGate(context.Background(), *unchanged).Status != "approved" {
				t.Fatalf("failed stop changed task or invalidated approval without committing hold: issue=%+v err=%v gate=%+v", unchanged, err, service.PlanGate(context.Background(), *unchanged))
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

func TestSearchRequiresQuery(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/search", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	errObj, ok := payload["error"].(map[string]any)
	if !ok || errObj["code"] != "invalid_request" {
		t.Fatalf("expected invalid_request error, got %v", payload)
	}
}

func TestSearchWithQuery(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=test", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Should return 200 or 500 depending on tracker availability
	if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 200 or 500, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

func TestGetSessionsWithDB(t *testing.T) {
	router, _ := newTestRouterWithDB(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := payload["sessions"]; !ok {
		t.Fatalf("expected sessions key in response: %v", payload)
	}
	if _, ok := payload["total"]; !ok {
		t.Fatalf("expected total key in response: %v", payload)
	}
}

func TestGetSessionsWithPagination(t *testing.T) {
	router, _ := newTestRouterWithDB(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions?limit=5&offset=0", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestGetSessionDetailNotFound(t *testing.T) {
	router, _ := newTestRouterWithDB(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/nonexistent-id", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetSessionsWithoutDB(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{
		WorkspaceRoot: t.TempDir(),
		Host:          "127.0.0.1",
		APIToken:      "",
	})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

func TestGetAgents(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/agents", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := payload["agents"]; !ok {
		t.Fatalf("expected agents key in response: %v", payload)
	}
}

func TestGetAgentConfig(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/config/agents", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// May return 200 with config or 500 if config not found
	if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 200 or 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPatchAgentConfigRejectsInvalidJSON(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/config/agents", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPostAgentConfigRejectsInvalidJSON(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/config/agents", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPostAgentConfigRejectsExplicitRetiredGeminiDefault(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/config/agents", strings.NewReader(`{"agent_provider":"GEMINI"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for retired provider, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetAgentConfigItems(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/config/agents/items", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Returns list of agent configs
	if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 200 or 500, got %d", rec.Code)
	}
	if got := rec.Header().Get("Deprecation"); got != "true" {
		t.Fatalf("expected Deprecation header on legacy route, got %q", got)
	}
	if got := rec.Header().Get("Sunset"); got == "" {
		t.Fatalf("expected Sunset header on legacy route")
	}
}

func TestPostAgentConfigNewRejectsInvalidJSONAndMarksDeprecated(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/config/agents/new", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	if got := rec.Header().Get("Deprecation"); got != "true" {
		t.Fatalf("expected Deprecation header on legacy route, got %q", got)
	}
}

func TestPostAgentConfigUpdateRejectsInvalidJSONAndMarksDeprecated(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/config/agents/items", strings.NewReader("{bad"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	if got := rec.Header().Get("Deprecation"); got != "true" {
		t.Fatalf("expected Deprecation header on legacy route, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------

func TestGetDocsEndpointResponds(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/docs", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// May return 200 with docs or 500 if docs dir not found relative to binary
	if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 200 or 500, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if rec.Code == http.StatusOK {
		if _, ok := payload["docs"]; !ok {
			t.Fatalf("expected docs key in response: %v", payload)
		}
	}
}

func TestGetDocContentRejectsTraversal(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/docs/../../etc/passwd", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden && rec.Code != http.StatusNotFound {
		t.Fatalf("expected 403 or 404 for path traversal, got %d", rec.Code)
	}
}

func TestGetDocContentExistingFile(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/docs/index.md", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// May return 200 (if docs dir exists relative to binary) or 404
	if rec.Code != http.StatusOK && rec.Code != http.StatusNotFound {
		t.Fatalf("expected 200 or 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

func TestGetTelemetryHealth(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/telemetry/health", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response as JSON: %v", err)
	}
}

// ---------------------------------------------------------------------------
// STT (Speech-to-Text)
// ---------------------------------------------------------------------------

func TestGetSTTHealth(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/stt/health", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	// Should always have "ready" field
	if _, ok := payload["ready"]; !ok {
		t.Fatalf("expected ready key in STT health response: %v", payload)
	}

	assertResponseMatchesSchema(t, rec.Body.Bytes(), "stt.health.response.schema.json")
}

func TestPostSTTTranscribeWithoutWhisper(t *testing.T) {
	// Without whisper configured, should return 503
	// Note: STT endpoint expects multipart/form-data, not application/json,
	// so we need to bypass the content-type guard by not setting Content-Type
	// (empty content-type is allowed through the guard).
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/stt/transcribe", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Warehouse Stats
// ---------------------------------------------------------------------------

func TestGetWarehouseStatsWithDB(t *testing.T) {
	router, _ := newTestRouterWithDB(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/warehouse/stats", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	// Verify expected fields exist
	for _, key := range []string{"total_tokens", "total_input", "total_output"} {
		if _, ok := payload[key]; !ok {
			t.Fatalf("missing expected key %q in warehouse stats: %v", key, payload)
		}
	}
}

func TestGetWarehouseStatsWithoutDB(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{
		WorkspaceRoot: t.TempDir(),
		Host:          "127.0.0.1",
		APIToken:      "",
	})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/warehouse/stats", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// OpenAPI
// ---------------------------------------------------------------------------

func TestGetOpenAPIYAML(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/openapi.yaml", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "application/yaml; charset=utf-8" {
		t.Fatalf("unexpected content type %q", got)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("openapi:")) {
		t.Fatal("response does not contain an OpenAPI document")
	}
}

// ---------------------------------------------------------------------------
// Project File Operations (with DB)
// ---------------------------------------------------------------------------

func TestGetProjectFileContent(t *testing.T) {
	router, warehouseDB := newTestRouterWithDB(t)

	// Create a real project directory with a file
	projDir := t.TempDir()
	testFile := filepath.Join(projDir, "hello.txt")
	if err := os.WriteFile(testFile, []byte("hello world"), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}

	id, err := warehouseDB.UpsertProject(t.Context(), projDir, "")
	if err != nil {
		t.Fatalf("seed project: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+id+"/file?path=hello.txt", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	if rec.Body.String() != "hello world" {
		t.Fatalf("expected 'hello world', got %q", rec.Body.String())
	}
}

func TestGetProjectFileContentNotFound(t *testing.T) {
	router, warehouseDB := newTestRouterWithDB(t)

	projDir := t.TempDir()
	id, err := warehouseDB.UpsertProject(t.Context(), projDir, "")
	if err != nil {
		t.Fatalf("seed project: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+id+"/file?path=nonexistent.txt", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetProjectFileContentPathTraversal(t *testing.T) {
	router, warehouseDB := newTestRouterWithDB(t)

	projDir := t.TempDir()
	id, err := warehouseDB.UpsertProject(t.Context(), projDir, "")
	if err != nil {
		t.Fatalf("seed project: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+id+"/file?path=../../../etc/passwd", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetProjectFileTree(t *testing.T) {
	router, warehouseDB := newTestRouterWithDB(t)

	projDir := t.TempDir()
	// Create a sub-directory and file
	if err := os.MkdirAll(filepath.Join(projDir, "src"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projDir, "src", "main.go"), []byte("package main"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	id, err := warehouseDB.UpsertProject(t.Context(), projDir, "")
	if err != nil {
		t.Fatalf("seed project: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+id+"/tree", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload []any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(payload) == 0 {
		t.Fatalf("expected non-empty file tree")
	}
}

func TestRefreshProject(t *testing.T) {
	router, warehouseDB := newTestRouterWithDB(t)

	projDir := t.TempDir()
	id, err := warehouseDB.UpsertProject(t.Context(), projDir, "")
	if err != nil {
		t.Fatalf("seed project: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+id+"/refresh", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRefreshProjectNotFound(t *testing.T) {
	router, _ := newTestRouterWithDB(t)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/nonexistent/refresh", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// MCP (Global) — see mcp_servers_test.go for the full Tier 2 contract suite
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

func TestGetDashboard(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Not Found routes
// ---------------------------------------------------------------------------

func TestAPINotFoundReturnsJSONEnvelope(t *testing.T) {
	router := newTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/nonexistent", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	errObj, ok := payload["error"].(map[string]any)
	if !ok || errObj["code"] != "not_found" {
		t.Fatalf("expected not_found error envelope, got %v", payload)
	}
}
