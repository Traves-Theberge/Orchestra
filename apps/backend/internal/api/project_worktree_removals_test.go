package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func TestProjectWorktreeRemovalHTTPKeepsBranchAndRejectsDirtyCheckout(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	if err := os.Mkdir(repo, 0700); err != nil {
		t.Fatal(err)
	}
	runGit := func(dir string, args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
		return string(output)
	}
	_ = runGit(repo, "init", "--initial-branch=main")
	_ = runGit(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "initial")
	cleanPath := filepath.Join(root, "clean checkout")
	_ = runGit(repo, "worktree", "add", "-b", "keep-me", cleanPath)
	dirtyPath := filepath.Join(root, "dirty checkout")
	_ = runGit(repo, "worktree", "add", "-b", "dirty-branch", dirtyPath)
	if err := os.WriteFile(filepath.Join(dirtyPath, "untracked important.txt"), []byte("preserve me"), 0600); err != nil {
		t.Fatal(err)
	}

	warehouse, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer warehouse.Close()
	projectID, err := warehouse.UpsertProject(context.Background(), repo, "")
	if err != nil {
		t.Fatal(err)
	}
	config := &config.Config{WorkspaceRoot: root, ProjectRoots: []string{root}}
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), config, nil, warehouse, nil, nil, nil, nil, nil)

	list := func() []projectWorktree {
		t.Helper()
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/git/worktrees", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("list worktrees: %d %s", rec.Code, rec.Body.String())
		}
		var response struct {
			Worktrees []projectWorktree `json:"worktrees"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response.Worktrees
	}
	remove := func(workspaceID, requestID string) *httptest.ResponseRecorder {
		t.Helper()
		body := `{"request_id":"` + requestID + `"}`
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/projects/"+projectID+"/git/worktrees/"+workspaceID, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	var cleanID, dirtyID, primaryID string
	for _, row := range list() {
		switch row.Path {
		case cleanPath:
			cleanID = row.ID
		case dirtyPath:
			dirtyID = row.ID
		default:
			if row.Primary {
				primaryID = row.ID
			}
		}
	}
	if cleanID == "" || dirtyID == "" || primaryID == "" {
		t.Fatalf("fixture worktrees not observed: %+v", list())
	}
	if rec := remove(primaryID, "b1724820-8a09-4986-ab24-612901c89b73"); rec.Code != http.StatusConflict {
		t.Fatalf("primary removal should be protected, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := remove(dirtyID, "b1724820-8a09-4986-ab24-612901c89b74"); rec.Code != http.StatusConflict {
		t.Fatalf("dirty removal should be refused, got %d %s", rec.Code, rec.Body.String())
	}
	if data, err := os.ReadFile(filepath.Join(dirtyPath, "untracked important.txt")); err != nil || string(data) != "preserve me" {
		t.Fatalf("dirty fixture was not preserved: %q %v", data, err)
	}
	requestID := "b1724820-8a09-4986-ab24-612901c89b75"
	rec := remove(cleanID, requestID)
	if rec.Code != http.StatusOK {
		t.Fatalf("clean removal: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(cleanPath); !os.IsNotExist(err) {
		t.Fatalf("checkout remains after success: %v", err)
	}
	showRef := exec.Command("git", "show-ref", "--verify", "refs/heads/keep-me")
	showRef.Dir = repo
	if output, err := showRef.Output(); err != nil || len(output) == 0 {
		t.Fatalf("local branch was not retained: %v", err)
	}
	replay := remove(cleanID, requestID)
	if replay.Code != http.StatusOK || replay.Body.String() != rec.Body.String() {
		t.Fatalf("same request should return durable receipt: %d %s", replay.Code, replay.Body.String())
	}
	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/worktree-removals/"+requestID, nil))
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), `"status":"completed"`) {
		t.Fatalf("receipt lookup: %d %s", get.Code, get.Body.String())
	}
}
