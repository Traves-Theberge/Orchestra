package api

import (
	"encoding/json"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestGitWorkspaceScopeUsesLinkedCheckoutAndRejectsStaleIdentity(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	router, pid := newTestRouterWithGitProject(t)
	request := func(method, suffix, body string) *httptest.ResponseRecorder {
		t.Helper()
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(method, "/api/v1/projects/"+pid+suffix, strings.NewReader(body)))
		return recorder
	}
	catalog := httptest.NewRecorder()
	router.ServeHTTP(catalog, httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil))
	var projects []db.Project
	if err := json.Unmarshal(catalog.Body.Bytes(), &projects); err != nil || len(projects) != 1 {
		t.Fatalf("catalog: %s %v", catalog.Body, err)
	}
	primary := projects[0].RootPath
	linked := filepath.Join(filepath.Dir(primary), "linked-workspace")
	git := func(dir string, args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %s %v", args, out, err)
		}
		return strings.TrimSpace(string(out))
	}
	git(primary, "worktree", "add", "-b", "linked-feature", linked)
	git(primary, "update-ref", "refs/remotes/origin/main", "HEAD")
	git(primary, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
	branchResponse := request("GET", "/git/branches", "")
	var branchListing struct {
		Branches []string `json:"branches"`
		Remotes  []string `json:"remotes"`
	}
	if err := json.Unmarshal(branchResponse.Body.Bytes(), &branchListing); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(branchResponse.Body.String(), `"linked-feature"`) || strings.Contains(branchResponse.Body.String(), "+ linked-feature") || strings.Contains(branchResponse.Body.String(), "origin/HEAD") {
		t.Fatalf("display decorations leaked into base refs: %s", branchResponse.Body)
	}
	listing := request("GET", "/git/worktrees", "")
	var payload struct {
		Worktrees []workspace.GitWorktree `json:"worktrees"`
	}
	if err := json.Unmarshal(listing.Body.Bytes(), &payload); err != nil || len(payload.Worktrees) != 2 {
		t.Fatalf("registry: %s %v", listing.Body, err)
	}
	var identity string
	for _, row := range payload.Worktrees {
		if !row.Primary {
			identity = row.ID
		}
	}
	if identity == "" {
		t.Fatal("linked workspace lacks stable identity")
	}
	if err := os.WriteFile(filepath.Join(linked, "README.md"), []byte("linked-only edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if response := request("POST", "/git/stage?workspace_id="+identity, `{"files":["README.md"]}`); response.Code != 200 {
		t.Fatalf("stage: %d %s", response.Code, response.Body)
	}
	if staged := git(linked, "diff", "--cached", "--name-only"); staged != "README.md" {
		t.Fatalf("linked index unchanged: %s", staged)
	}
	if staged := git(primary, "diff", "--cached", "--name-only"); staged != "" {
		t.Fatalf("primary index changed: %s", staged)
	}
	git(linked, "commit", "-m", "linked scope commit")
	if response := request("GET", "/git?workspace_id="+identity, ""); response.Code != 200 || !strings.Contains(response.Body.String(), "linked scope commit") {
		t.Fatalf("stats not scoped: %s", response.Body)
	}
	if response := request("POST", "/git/checkout?workspace_id="+workspace.IDForGitWorktree("other", linked), `{"branch":"main"}`); response.Code != 404 {
		t.Fatalf("cross-project scope accepted: %d", response.Code)
	}
	// Only this disposable fixture's exact registered child is removed.
	git(primary, "worktree", "remove", "--force", linked)
	if response := request("GET", "/git/status?workspace_id="+identity, ""); response.Code != 404 || !strings.Contains(response.Body.String(), "workspace_unavailable") {
		t.Fatalf("stale scope fell back: %d %s", response.Code, response.Body)
	}
	if response := request("GET", "/git/status", ""); response.Code != 200 {
		t.Fatalf("legacy registered context lost: %d", response.Code)
	}
}
