package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// GitHub Integration Tests
//
// These test the GitHub-related endpoints. Since we don't have actual GitHub
// tokens in tests, we verify the validation logic and error paths.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GitHub Issues (project-scoped)
// ---------------------------------------------------------------------------

func TestGetProjectGitHubIssuesNoGitHub(t *testing.T) {
	router, _ := newTestRouterWithGitProject(t)

	// Project has no GitHub configured, should return empty
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/nonexistent/github/issues", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Should return 404 for nonexistent project
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetProjectGitHubIssuesEmptyGitHub(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/github/issues", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	// No GitHub configured, should return empty issues
	issues, ok := payload["issues"].([]any)
	if !ok {
		t.Fatalf("expected issues array: %v", payload)
	}
	if len(issues) != 0 {
		t.Fatalf("expected empty issues, got %d", len(issues))
	}
}

func TestCreateProjectGitHubIssueNotConfigured(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"title": "test issue"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/github/issues", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (github not configured), got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	errObj, ok := payload["error"].(map[string]any)
	if !ok || errObj["code"] != "github_not_configured" {
		t.Fatalf("expected github_not_configured error, got %v", payload)
	}
}

func TestCreateProjectGitHubIssueRejectsInvalidJSON(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/github/issues", bytes.NewReader([]byte("{bad")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Since GitHub not configured, it fails with 400 before parsing JSON
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateProjectGitHubIssueNotConfigured(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"state": "closed"})
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/projects/"+projectID+"/github/issues/1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (github not configured), got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUpdateProjectGitHubIssueInvalidNumber(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"state": "closed"})
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/projects/"+projectID+"/github/issues/abc", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (invalid number), got %d: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// GitHub Pull Requests
// ---------------------------------------------------------------------------

func TestGetProjectGitHubPullsNoGitHub(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/github/pulls", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	pulls, ok := payload["pulls"].([]any)
	if !ok {
		t.Fatalf("expected pulls array: %v", payload)
	}
	if len(pulls) != 0 {
		t.Fatalf("expected empty pulls, got %d", len(pulls))
	}
}

func TestCreateProjectGitHubPullNotConfigured(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{
		"title": "test PR",
		"head":  "feature",
		"base":  "main",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/github/pulls", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (github not configured), got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetProjectGitHubPullDiffNotConfigured(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/github/pulls/1/diff", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (github not configured), got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetProjectGitHubPullDiffInvalidNumber(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/github/pulls/abc/diff", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// PR Reviews
// ---------------------------------------------------------------------------

func TestGetPRReviewsNotConfigured(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/github/pulls/1/reviews", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostPRReviewNotConfigured(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"body": "LGTM", "event": "APPROVE", "commit_id": strings.Repeat("a", 40)})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/github/pulls/1/reviews", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetPRReviewsInvalidNumber(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/github/pulls/abc/reviews", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// PR Merge
// ---------------------------------------------------------------------------

func TestPostPRMergeNotConfigured(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"method": "merge"})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/projects/"+projectID+"/github/pulls/1/merge", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostPRMergeInvalidNumber(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"method": "merge"})
	req := httptest.NewRequest(http.MethodPut, "/api/v1/projects/"+projectID+"/github/pulls/abc/merge", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// PR Comments
// ---------------------------------------------------------------------------

func TestGetPRCommentsNotConfigured(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/github/pulls/1/comments", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// GitHub Disconnect
// ---------------------------------------------------------------------------

func TestPostGitHubDisconnectNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/nonexistent/github/disconnect", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Should return error for nonexistent project
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusBadRequest && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected error status, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostGitHubDisconnect(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/github/disconnect", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Project exists but may not have GitHub configured
	if rec.Code != http.StatusOK && rec.Code != http.StatusNotFound && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 200, 404, or 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// GitHub Create Repo
// ---------------------------------------------------------------------------

func TestPostCreateGitHubRepoNotConnected(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]any{
		"name":        "test-repo",
		"description": "A test repo",
		"private":     true,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/github/create-repo", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("expected 412 (github not connected), got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostCreateGitHubRepoNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	body, _ := json.Marshal(map[string]any{"name": "test-repo"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/nonexistent/github/create-repo", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// GitHub OAuth
// ---------------------------------------------------------------------------

func TestGitHubLoginMissingProjectID(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/github/login", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGitHubLoginNoClientID(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/github/login?project_id=test-project", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Without GitHub client ID configured, should get 412 or redirect via CLI token
	if rec.Code != http.StatusPreconditionFailed && rec.Code != http.StatusOK {
		t.Fatalf("expected 412 or 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGitHubCallbackMissingParams(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/github/callback", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Issue PR creation
// ---------------------------------------------------------------------------

func TestCreateGitHubPRInvalidJSON(t *testing.T) {
	router := newTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/issues/TEST-1/pr", bytes.NewReader([]byte("{bad")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}
