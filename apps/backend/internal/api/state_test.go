package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func TestGetState(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), t.TempDir(), "127.0.0.1", "")
	request := httptest.NewRequest(http.MethodGet, "/api/v1/state", nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if _, ok := payload["generated_at"]; !ok {
		t.Fatalf("expected generated_at in response")
	}

	assertFixtureShape(t, payload, "state.response.json")
	assertResponseMatchesSchema(t, recorder.Body.Bytes(), "state.response.schema.json")
}

func TestHealthzEndpoints(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), t.TempDir(), "127.0.0.1", "")
	paths := []string{"/healthz", "/api/v1/healthz"}
	for _, path := range paths {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)

		if res.Code != http.StatusOK {
			t.Fatalf("expected 200 for %s, got %d", path, res.Code)
		}
		var payload map[string]any
		if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode healthz %s response: %v", path, err)
		}
		if payload["status"] != "ok" || payload["app"] != "orchestra" {
			t.Fatalf("unexpected healthz payload for %s: %+v", path, payload)
		}
	}
}

func TestPostRefresh(t *testing.T) {
	orch := orchestrator.NewService()
	router := NewRouter(zerolog.Nop(), orch, t.TempDir(), "127.0.0.1", "")

	reqOne := httptest.NewRequest(http.MethodPost, "/api/v1/refresh", nil)
	resOne := httptest.NewRecorder()
	router.ServeHTTP(resOne, reqOne)

	if resOne.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", resOne.Code)
	}

	var first map[string]any
	if err := json.Unmarshal(resOne.Body.Bytes(), &first); err != nil {
		t.Fatalf("decode first response: %v", err)
	}
	if first["coalesced"] != false {
		t.Fatalf("expected first refresh not coalesced, got %v", first["coalesced"])
	}

	reqTwo := httptest.NewRequest(http.MethodPost, "/api/v1/refresh", nil)
	resTwo := httptest.NewRecorder()
	router.ServeHTTP(resTwo, reqTwo)

	var second map[string]any
	if err := json.Unmarshal(resTwo.Body.Bytes(), &second); err != nil {
		t.Fatalf("decode second response: %v", err)
	}
	if second["coalesced"] != true {
		t.Fatalf("expected second refresh coalesced, got %v", second["coalesced"])
	}

	assertFixtureShape(t, first, "refresh.response.json")
	assertResponseMatchesSchema(t, resOne.Body.Bytes(), "refresh.response.schema.json")
}

func TestMethodNotAllowedReturnsJSONEnvelope(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), t.TempDir(), "127.0.0.1", "")
	request := httptest.NewRequest(http.MethodDelete, "/api/v1/state", nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", recorder.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	errorObj, ok := payload["error"].(map[string]any)
	if !ok || errorObj["code"] != "method_not_allowed" {
		t.Fatalf("expected method_not_allowed error envelope, got=%v", payload)
	}
}

func TestGetIssueReturnsRunningIssue(t *testing.T) {
	orch := orchestrator.NewService()
	orch.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         "issue-1",
		IssueIdentifier: "MT-649",
		State:           "In Progress",
		SessionID:       "thread-1-turn-1",
	}})

	root := t.TempDir()
	router := NewRouter(zerolog.Nop(), orch, root, "127.0.0.1", "")
	request := httptest.NewRequest(http.MethodGet, "/api/v1/MT-649", nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload["status"] != "running" {
		t.Fatalf("expected running status, got %v", payload["status"])
	}
	if payload["issue_identifier"] != "MT-649" {
		t.Fatalf("expected MT-649, got %v", payload["issue_identifier"])
	}

	assertFixtureShape(t, payload, "issue.response.json")
	assertResponseMatchesSchema(t, recorder.Body.Bytes(), "issue.response.schema.json")
}

func TestGetIssueReturnsNotFoundEnvelope(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), t.TempDir(), "127.0.0.1", "")
	request := httptest.NewRequest(http.MethodGet, "/api/v1/UNKNOWN-1", nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", recorder.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	errorObj, ok := payload["error"].(map[string]any)
	if !ok || errorObj["code"] != "issue_not_found" {
		t.Fatalf("expected issue_not_found envelope, got=%v", payload)
	}

	assertFixtureShape(t, payload, "error.issue_not_found.json")
}

func assertFixtureShape(t *testing.T, actual map[string]any, fixtureFile string) {
	t.Helper()
	fixture := loadFixture(t, fixtureFile)
	assertShape(t, actual, fixture)
}

func loadFixture(t *testing.T, fixtureFile string) map[string]any {
	t.Helper()
	return decodeFixtureMap(t, fixtureFile)
}

func assertShape(t *testing.T, actual any, expected any) {
	t.Helper()

	switch expectedTyped := expected.(type) {
	case map[string]any:
		actualMap, ok := actual.(map[string]any)
		if !ok {
			t.Fatalf("shape mismatch: expected object, got %T", actual)
		}
		for key, expectedValue := range expectedTyped {
			actualValue, exists := actualMap[key]
			if !exists {
				t.Fatalf("shape mismatch: missing key %q", key)
			}
			assertShape(t, actualValue, expectedValue)
		}
	case []any:
		actualSlice, ok := actual.([]any)
		if !ok {
			t.Fatalf("shape mismatch: expected array, got %T", actual)
		}
		if len(expectedTyped) > 0 && len(actualSlice) > 0 {
			assertShape(t, actualSlice[0], expectedTyped[0])
		}
	case string:
		if _, ok := actual.(string); !ok {
			t.Fatalf("shape mismatch: expected string, got %T", actual)
		}
	case float64:
		switch actual.(type) {
		case float64:
		default:
			t.Fatalf("shape mismatch: expected number, got %T", actual)
		}
	case bool:
		if _, ok := actual.(bool); !ok {
			t.Fatalf("shape mismatch: expected bool, got %T", actual)
		}
	case nil:
		// nil in fixture means key should exist; any actual type accepted.
	default:
		t.Fatalf("unsupported expected shape type %T", expected)
	}
}
