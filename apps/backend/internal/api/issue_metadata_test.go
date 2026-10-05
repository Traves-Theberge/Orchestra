package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	sqlitetracker "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
	"github.com/rs/zerolog"
)

func TestIssueAuthoringMetadataHTTPRoundTrip(t *testing.T) {
	database, err := db.Connect(filepath.Join(t.TempDir(), "issues.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	orch := orchestrator.NewService()
	orch.SetTrackerClient(sqlitetracker.NewClient(database, nil))
	orch.SetDB(database)
	router := NewRouter(zerolog.Nop(), orch, &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1"})
	request := func(method, path string, body any, want int) map[string]any {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(method, path, bytes.NewReader(raw)))
		if response.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, response.Code, response.Body.String())
		}
		var result map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	collision := request(http.MethodPost, "/api/v1/issues", map[string]any{"title": "earlier task", "state": "Backlog"}, http.StatusCreated)
	created := request(http.MethodPost, "/api/v1/issues", map[string]any{"title": "metadata target", "state": "Backlog", "description": "requested authoring data"}, http.StatusCreated)
	identifier := created["identifier"].(string)
	id := created["id"].(string)
	// An earlier fuzzy-search match must never substitute for requested identity.
	request(http.MethodPatch, "/api/v1/issues/"+collision["identifier"].(string), map[string]any{"title": "mentions " + identifier}, http.StatusOK)
	request(http.MethodGet, "/api/v1/issues/OPS", nil, http.StatusNotFound)
	metadata := map[string]any{
		"runtime_target":       "LOCAL",
		"requested_model":      "selected-model",
		"requested_max_turns":  7,
		"acceptance_criteria":  []string{"tests pass", "retains Kanban"},
		"attachments":          []tracker.Attachment{{Kind: "file", Path: "src/main.go"}, {Kind: "link", URL: "https://example.com", Label: "reference"}},
		"agent_guidance":       map[string]any{"requested": "review carefully"},
		"source_template":      "feature",
		"authoring_session_id": "studio-metadata-test",
	}
	raw, _ := json.Marshal(metadata)
	var canonical map[string]any
	_ = json.Unmarshal(raw, &canonical)
	assertMetadata := func(result map[string]any) {
		t.Helper()
		for key, value := range canonical {
			if !reflect.DeepEqual(result[key], value) {
				t.Fatalf("metadata %s: got %#v want %#v", key, result[key], value)
			}
		}
	}
	assertMetadata(request(http.MethodPatch, "/api/v1/issues/"+identifier, metadata, http.StatusOK))
	prURL := "https://github.com/example/project/pull/17"
	if _, err := sqlitetracker.NewClient(database, nil).UpdateIssue(t.Context(), id, map[string]any{"pr_url": prURL}); err != nil {
		t.Fatal(err)
	}
	assertMetadata(request(http.MethodGet, "/api/v1/issues/"+identifier, nil, http.StatusOK))
	list := request(http.MethodGet, "/api/v1/issues", nil, http.StatusOK)
	found := false
	for _, value := range list["issues"].([]any) {
		issue := value.(map[string]any)
		if issue["identifier"] == identifier {
			assertMetadata(issue)
			if issue["pr_url"] != prURL {
				t.Fatalf("task list lost exact PR linkage: %+v", issue)
			}
			found = true
		}
	}
	if !found {
		t.Fatal("created task absent from list")
	}
	assigned := request(http.MethodPost, "/api/v1/issues", map[string]any{"title": "assigned task", "state": "Backlog", "description": "already assigned", "assignee_id": "worker-7", "provider": "CODEX"}, http.StatusCreated)
	unassigned := request(http.MethodGet, "/api/v1/issues?unassigned=true", nil, http.StatusOK)
	for _, value := range unassigned["issues"].([]any) {
		issue := value.(map[string]any)
		assignee, _ := issue["assignee_id"].(string)
		if strings.TrimSpace(assignee) != "" || issue["id"] == assigned["id"] {
			t.Fatalf("unassigned view returned assigned task: %+v", issue)
		}
	}
	filtered := request(http.MethodGet, "/api/v1/issues?assignee_id=worker-7", nil, http.StatusOK)
	if rows := filtered["issues"].([]any); len(rows) != 1 || rows[0].(map[string]any)["id"] != assigned["id"] {
		t.Fatalf("assignee filter mismatch: %+v", filtered)
	}
	request(http.MethodGet, "/api/v1/issues?unassigned=true&assignee_id=worker-7", nil, http.StatusBadRequest)
	orch.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: id, IssueIdentifier: identifier, SessionID: "fixture-session", State: "In Progress", Provider: "CLAUDE"}})
	active := request(http.MethodGet, "/api/v1/issues/"+identifier, nil, http.StatusOK)
	assertMetadata(active)
	if active["issue_id"] != id || active["title"] != "metadata target" || active["running"] == nil {
		t.Fatalf("active detail lost identity/runtime: %+v", active)
	}
	// The patch response itself is insufficient: verify an independent DAO read.
	stored, err := sqlitetracker.NewClient(database, nil).FetchIssueByIdentifier(t.Context(), identifier)
	if err != nil || stored.RuntimeTarget != "LOCAL" || stored.AuthoringSessionID != "studio-metadata-test" || len(stored.AcceptanceCriteria) != 2 || len(stored.Attachments) != 2 {
		t.Fatalf("independent database read: %+v %v", stored, err)
	}
	if stored.RequestedModel != "selected-model" || stored.RequestedMaxTurns == nil || *stored.RequestedMaxTurns != 7 {
		t.Fatalf("requested configuration lost: %+v", stored)
	}
	request(http.MethodPatch, "/api/v1/issues/"+identifier, map[string]any{"requested_max_turns": json.Number("1.000000000000000001"), "title": "must not save"}, http.StatusInternalServerError)
	afterInvalid := request(http.MethodGet, "/api/v1/issues/"+identifier, nil, http.StatusOK)
	if afterInvalid["title"] != "metadata target" || afterInvalid["requested_max_turns"] != float64(7) {
		t.Fatalf("invalid combined configuration patch mutated task: %+v", afterInvalid)
	}
	cleared := request(http.MethodPatch, "/api/v1/issues/"+identifier, map[string]any{"requested_model": nil, "requested_max_turns": nil}, http.StatusOK)
	if value, exists := cleared["requested_max_turns"]; exists && value != nil {
		t.Fatalf("limit not cleared: %+v", cleared)
	}
	detail := request(http.MethodGet, "/api/v1/issues/"+identifier, nil, http.StatusOK)
	if detail["requested_model"] != "" || detail["requested_max_turns"] != nil {
		t.Fatalf("cleared requested config not reloaded: %+v", detail)
	}
}

func TestPatchIssueRequiresDurableReplanForTaskReopening(t *testing.T) {
	ctx := t.Context()
	database, err := db.Connect(filepath.Join(t.TempDir(), "state-gates.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	projectID, err := database.UpsertProject(ctx, filepath.Join(t.TempDir(), "project"), "")
	if err != nil {
		t.Fatal(err)
	}
	client := sqlitetracker.NewClient(database, nil)
	service := orchestrator.NewService()
	service.SetTrackerClient(client)
	service.SetDB(database)
	router := NewRouter(zerolog.Nop(), service, &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1"})
	patchState := func(issue *tracker.Issue, state string, feedback string) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(map[string]any{"state": state, "feedback": feedback})
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPatch, "/api/v1/issues/"+issue.Identifier, bytes.NewReader(body)))
		return response
	}

	for _, state := range []string{"Todo", "Backlog"} {
		t.Run("review to "+state, func(t *testing.T) {
			review, err := client.CreateIssue(ctx, "Review task", "Review context", "Review", 0, "worker-1", projectID, "CODEX", nil)
			if err != nil {
				t.Fatal(err)
			}
			response := patchState(review, state, "please revise")
			if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"code":"replan_required"`) {
				t.Fatalf("Review→%s bypass response: %d %s", state, response.Code, response.Body.String())
			}
			stored, err := client.FetchIssueByIdentifier(ctx, review.ID)
			if err != nil || stored.State != "Review" {
				t.Fatalf("blocked reopening mutated state: %+v %v", stored, err)
			}
		})
	}

	backlog, err := client.CreateIssue(ctx, "Ready intake", "Has required context", "Backlog", 0, "worker-1", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	if response := patchState(backlog, "Todo", ""); response.Code != http.StatusOK {
		t.Fatalf("ordinary Backlog→Todo admission was blocked: %d %s", response.Code, response.Body.String())
	}
	todo, err := client.FetchIssueByIdentifier(ctx, backlog.ID)
	if err != nil {
		t.Fatal(err)
	}
	if response := patchState(todo, "Backlog", ""); response.Code != http.StatusOK {
		t.Fatalf("ordinary Todo→Backlog transition was blocked: %d %s", response.Code, response.Body.String())
	}
}
