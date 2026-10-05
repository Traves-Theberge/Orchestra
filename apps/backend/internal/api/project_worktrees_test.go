package api

import (
	"context"
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

func TestProjectWorktreesRealGitHTTP(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	if err := os.Mkdir(repo, 0700); err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) {
		t.Helper()
		command := exec.Command("git", args...)
		command.Dir = repo
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, output)
		}
	}
	git("init", "--initial-branch=main")
	git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "initial")
	linked := filepath.Join(root, "task checkout")
	git("worktree", "add", "-b", "task/one", linked)
	outside := filepath.Join(t.TempDir(), "outside")
	git("worktree", "add", "--detach", outside)
	warehouse, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer warehouse.Close()
	id, err := warehouse.UpsertProject(context.Background(), repo, "")
	if err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{WorkspaceRoot: root, ProjectRoots: []string{root}}
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), cfg, nil, warehouse, nil, nil, nil, nil, nil)
	get := func(projectID string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID+"/git/worktrees", nil))
		return rec
	}
	rec := get(id)
	if rec.Code != 200 {
		t.Fatalf("%d: %s", rec.Code, rec.Body.String())
	}
	var result struct {
		Worktrees []projectWorktree `json:"worktrees"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Worktrees) != 2 {
		t.Fatalf("unexpected worktrees: %+v", result.Worktrees)
	}
	if !result.Worktrees[0].Primary || result.Worktrees[0].Branch != "main" || result.Worktrees[1].Branch != "task/one" || result.Worktrees[1].Primary {
		t.Fatalf("unexpected ownership: %+v", result.Worktrees)
	}
	linkedID, err := warehouse.UpsertProject(context.Background(), linked, "")
	if err != nil {
		t.Fatal(err)
	}
	rec = get(linkedID)
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Worktrees[0].Primary || !result.Worktrees[1].Primary {
		t.Fatalf("registered linked checkout must own chat: %+v", result.Worktrees)
	}
	outsideID, err := warehouse.UpsertProject(context.Background(), outside, "")
	if err != nil {
		t.Fatal(err)
	}
	if rec := get(outsideID); rec.Code != 403 {
		t.Fatalf("outside project: %d %s", rec.Code, rec.Body.String())
	}
	if rec := get("missing"); rec.Code != 404 {
		t.Fatalf("missing project: %d", rec.Code)
	}
}

func TestParseProjectWorktreesDetachedLockedPrunable(t *testing.T) {
	rows := parseProjectWorktrees("worktree /repo\x00HEAD abc123\x00branch refs/heads/main\x00\x00worktree /task with space\x00HEAD def456\x00detached\x00locked reason\x00prunable missing\x00\x00")
	if len(rows) != 2 || rows[0].Branch != "main" || rows[1].Path != "/task with space" || !rows[1].Detached || !rows[1].Locked || !rows[1].Prunable {
		t.Fatalf("unexpected parse: %+v", rows)
	}
}
