package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
	gitutil "github.com/orchestra/orchestra/apps/backend/internal/utils/git"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"github.com/rs/zerolog"
)

func retainedWorkspaceGit(t *testing.T, root string, args ...string) string {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = root
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

func TestPersistedDoneWorkspaceSurvivesStartupObservation(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_TERMINAL_PROMPT", "0")
	root, projectID, warehouse := testProjectSetup(t)
	projectRoot := filepath.Join(root, "repo")
	if err := os.WriteFile(filepath.Join(projectRoot, ".gitignore"), []byte("ignored-work.txt\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	retainedWorkspaceGit(t, projectRoot, "add", ".gitignore")
	retainedWorkspaceGit(t, projectRoot, "commit", "-m", "fixture ignore rules")
	workspaces := workspace.Service{Root: filepath.Join(root, "worktrees")}
	branch := "retained-done-task"
	checkout := workspaces.WorktreePath(projectID, branch)
	if err := gitutil.WorktreeAdd(t.Context(), projectRoot, checkout, branch, true); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"unpublished.txt": "uncommitted task work", "ignored-work.txt": "valuable ignored output"} {
		if err := os.WriteFile(filepath.Join(checkout, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	client := sqlite.NewClient(warehouse, nil)
	issue, err := client.CreateIssue(t.Context(), "Retain after restart", "Fixture", "Review", 0, "", projectID, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.UpdateIssue(t.Context(), issue.Identifier, map[string]any{"branch_name": branch, "state": "Done"}); err != nil {
		t.Fatal(err)
	}
	head := retainedWorkspaceGit(t, checkout, "rev-parse", "HEAD")
	status := retainedWorkspaceGit(t, checkout, "status", "--porcelain")
	if err := warehouse.Close(); err != nil {
		t.Fatal(err)
	}
	for restart := 0; restart < 2; restart++ {
		reopened, err := db.Connect(filepath.Join(root, "warehouse.db"))
		if err != nil {
			t.Fatal(err)
		}
		defer reopened.Close()
		freshTracker := sqlite.NewClient(reopened, nil)
		persisted, err := freshTracker.FetchIssueByIdentifier(t.Context(), issue.Identifier)
		if err != nil || persisted == nil || persisted.State != "Done" || persisted.BranchName != branch {
			t.Fatalf("lost persisted Done identity: %+v %v", persisted, err)
		}
		freshService := orchestrator.NewService()
		freshService.SetTrackerClient(freshTracker)
		// This is the exact terminal-workspace boundary called by Run at startup.
		observeRetainedTerminalWorkspaces(freshService, freshTracker, zerolog.Nop())
		if retainedWorkspaceGit(t, checkout, "rev-parse", "HEAD") != head || retainedWorkspaceGit(t, checkout, "status", "--porcelain") != status {
			t.Fatal("startup changed or removed unpublished task work")
		}
		retainedWorkspaceGit(t, projectRoot, "show-ref", "--verify", "refs/heads/"+branch)
		for name, expected := range map[string]string{"unpublished.txt": "uncommitted task work", "ignored-work.txt": "valuable ignored output"} {
			content, err := os.ReadFile(filepath.Join(checkout, name))
			if err != nil || string(content) != expected {
				t.Fatalf("restart %d lost %s: %q %v", restart, name, content, err)
			}
		}
		if err := reopened.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
