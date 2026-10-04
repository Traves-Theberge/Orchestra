package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
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
	assertMetadata(request(http.MethodGet, "/api/v1/issues/"+identifier, nil, http.StatusOK))
	list := request(http.MethodGet, "/api/v1/issues", nil, http.StatusOK)
	found := false
	for _, value := range list["issues"].([]any) {
		issue := value.(map[string]any)
		if issue["identifier"] == identifier {
			assertMetadata(issue)
			found = true
		}
	}
	if !found {
		t.Fatal("created task absent from list")
	}
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
