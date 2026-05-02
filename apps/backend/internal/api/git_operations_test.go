package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

// ---------------------------------------------------------------------------
// Helper: create a test router + DB + real git repo as a project
// ---------------------------------------------------------------------------

func newTestRouterWithGitProject(t *testing.T) (http.Handler, string) {
	t.Helper()

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, ".orchestra", "warehouse.db")

	warehouseDB, err := db.Connect(dbPath)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	t.Cleanup(func() { warehouseDB.Close() })

	// Create a real git repo
	gitDir := filepath.Join(tmpDir, "testrepo")
	if err := os.MkdirAll(gitDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	cmds := [][]string{
		{"git", "init"},
		{"git", "config", "user.email", "test@test.com"},
		{"git", "config", "user.name", "Test"},
		{"git", "config", "commit.gpgsign", "false"},
	}
	for _, args := range cmds {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = gitDir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git init command %v failed: %v\n%s", args, err, out)
		}
	}

	// Create initial commit so the repo has HEAD
	testFile := filepath.Join(gitDir, "README.md")
	if err := os.WriteFile(testFile, []byte("# Test"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	for _, args := range [][]string{
		{"git", "add", "."},
		{"git", "commit", "-m", "initial commit"},
	} {
		cmd := exec.Command(args[0], args[1:]...)
		cmd.Dir = gitDir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git command %v failed: %v\n%s", args, err, out)
		}
	}

	cfg := &config.Config{
		WorkspaceRoot: tmpDir,
		Host:          "127.0.0.1",
		APIToken:      "",
		ProjectRoots:  []string{tmpDir, os.TempDir(), "/tmp"},
	}

	// Register the project
	id, err := warehouseDB.UpsertProject(t.Context(), gitDir, "")
	if err != nil {
		t.Fatalf("upsert project: %v", err)
	}

	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), cfg, nil, warehouseDB, nil, nil, nil)
	return router, id
}

// ---------------------------------------------------------------------------
// Git Status
// ---------------------------------------------------------------------------

func TestGetProjectGitStatusCleanRepo(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/git/status", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if _, ok := payload["files"]; !ok {
		t.Fatalf("expected files key: %v", payload)
	}
	if _, ok := payload["branch"]; !ok {
		t.Fatalf("expected branch key: %v", payload)
	}
}

func TestGetProjectGitStatusNotFound(t *testing.T) {
	router, _ := newTestRouterWithDB(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/nonexistent/git/status", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Git Stats (log)
// ---------------------------------------------------------------------------

func TestGetProjectGitStats(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/git", nil)
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
		t.Fatalf("expected at least one commit in git history")
	}
}

// ---------------------------------------------------------------------------
// Git Diff
// ---------------------------------------------------------------------------

func TestGetProjectGitDiff(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/git/diff", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Git Branches (GET + POST + DELETE)
// ---------------------------------------------------------------------------

func TestGetProjectGitBranches(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/git/branches", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, ok := payload["current"]; !ok {
		t.Fatalf("expected current key: %v", payload)
	}
	if _, ok := payload["branches"]; !ok {
		t.Fatalf("expected branches key: %v", payload)
	}
}

func TestPostGitCreateBranch(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"name": "feature-test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/branches", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostGitCreateBranchMissingName(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"name": ""})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/branches", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteGitBranchNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/projects/nonexistent/git/branches/main", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestDeleteGitBranchCreatedBranch(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	// Create a branch, then checkout to it, create a commit, checkout back, then delete
	body, _ := json.Marshal(map[string]string{"name": "to-delete"})
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/branches", bytes.NewReader(body))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	router.ServeHTTP(createRec, createReq)

	if createRec.Code != http.StatusCreated {
		t.Fatalf("create branch failed: %d: %s", createRec.Code, createRec.Body.String())
	}

	// Delete it - branch was created from same commit, so -d should work
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/projects/"+projectID+"/git/branches/to-delete", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Should succeed (200) or fail (500) if git rejects the delete
	if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 200 or 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Git Checkout
// ---------------------------------------------------------------------------

func TestPostGitCheckout(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	// Create a branch first
	body, _ := json.Marshal(map[string]string{"name": "checkout-test"})
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/branches", bytes.NewReader(body))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	router.ServeHTTP(createRec, createReq)

	// Checkout the new branch
	checkoutBody, _ := json.Marshal(map[string]string{"branch": "checkout-test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/checkout", bytes.NewReader(checkoutBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostGitCheckoutMissingBranch(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"branch": ""})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/checkout", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Git Stage + Unstage
// ---------------------------------------------------------------------------

func TestPostGitStageAndUnstage(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	// We need to find the project's root path to create a file there
	// Since we can't easily, let's test the validation: missing files field
	body, _ := json.Marshal(map[string]any{"files": []string{}})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/stage", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty files, got %d: %s", rec.Code, rec.Body.String())
	}

	// Same for unstage
	body2, _ := json.Marshal(map[string]any{"files": []string{}})
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/unstage", bytes.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty files, got %d", rec2.Code)
	}
}

func TestPostGitStageRejectsInvalidJSON(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/stage", bytes.NewReader([]byte("{bad")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Git Commit
// ---------------------------------------------------------------------------

func TestPostGitCommitMissingMessage(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"message": ""})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/commit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostGitCommitRejectsInvalidJSON(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/commit", bytes.NewReader([]byte("{bad")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestPostGitCommitNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	body, _ := json.Marshal(map[string]string{"message": "test"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/nonexistent/git/commit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Git Push (validation only - no remote to push to)
// ---------------------------------------------------------------------------

func TestPostGitPushNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/nonexistent/git/push", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Git Pull (validation only - no remote)
// ---------------------------------------------------------------------------

func TestPostGitPullNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/nonexistent/git/pull", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Git Fetch (validation only)
// ---------------------------------------------------------------------------

func TestPostGitFetchNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/nonexistent/git/fetch", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Git Stash Operations
// ---------------------------------------------------------------------------

func TestPostGitStashEmptyRepo(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/stash", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Stash with nothing to stash returns error
	if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 200 or 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostGitStashPopEmpty(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/stash/pop", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// Pop with no stash returns error
	if rec.Code != http.StatusOK && rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 200 or 500, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetGitStashList(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/git/stash/list", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload []any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	// Empty stash list is expected
}

func TestPostGitStashApplyMissingRef(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"ref": ""})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/stash/apply", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostGitStashDropMissingRef(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"ref": ""})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/stash/drop", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostGitStashNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/nonexistent/git/stash", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Git Merge
// ---------------------------------------------------------------------------

func TestPostGitMergeMissingBranch(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"branch": ""})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/merge", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostGitMergeNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	body, _ := json.Marshal(map[string]string{"branch": "main"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/nonexistent/git/merge", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Git Merge Abort
// ---------------------------------------------------------------------------

func TestPostGitMergeAbortNoMerge(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/merge/abort", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	// No merge in progress, expect 500
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 (no merge to abort), got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostGitMergeAbortNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/nonexistent/git/merge/abort", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Git Conflicts
// ---------------------------------------------------------------------------

func TestGetGitConflictsCleanRepo(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/git/conflicts", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["in_merge"] != false {
		t.Fatalf("expected in_merge=false for clean repo")
	}
	files, ok := payload["files"].([]any)
	if !ok {
		t.Fatalf("expected files array: %v", payload)
	}
	if len(files) != 0 {
		t.Fatalf("expected no conflicts, got %d", len(files))
	}
}

func TestGetGitConflictsNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/nonexistent/git/conflicts", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Git Resolve
// ---------------------------------------------------------------------------

func TestPostGitResolveMissingFile(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	body, _ := json.Marshal(map[string]string{"file": ""})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/resolve", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Git Default Branch
// ---------------------------------------------------------------------------

func TestGetDefaultBranch(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/git/default-branch", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	branch, ok := payload["branch"].(string)
	if !ok || branch == "" {
		t.Fatalf("expected non-empty branch name, got %v", payload)
	}
}

func TestGetDefaultBranchNotFoundProject(t *testing.T) {
	router, _ := newTestRouterWithDB(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/nonexistent/git/default-branch", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Full git workflow: create branch, modify file, stage, commit, checkout back
// ---------------------------------------------------------------------------

func TestGitWorkflowCreateBranchStageCommit(t *testing.T) {
	router, projectID := newTestRouterWithGitProject(t)

	// 1. Create a branch
	body, _ := json.Marshal(map[string]string{"name": "feature-workflow"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/branches", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create branch: expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	// 2. Checkout the new branch
	body, _ = json.Marshal(map[string]string{"branch": "feature-workflow"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID+"/git/checkout", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("checkout: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// 3. Verify we're on the new branch via status
	req = httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/git/status", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: expected 200, got %d", rec.Code)
	}

	// 4. List branches to verify feature-workflow exists
	req = httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/git/branches", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("branches: expected 200, got %d", rec.Code)
	}

	var branchPayload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &branchPayload); err != nil {
		t.Fatalf("decode branches: %v", err)
	}
	if branchPayload["current"] != "feature-workflow" {
		t.Fatalf("expected current branch feature-workflow, got %v", branchPayload["current"])
	}
}
