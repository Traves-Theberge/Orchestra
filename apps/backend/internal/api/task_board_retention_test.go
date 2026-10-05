package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker/memory"
)

func TestBoardReviewAndDoneRetainGitWork(t *testing.T) {
	for _, ownedWorktree := range []bool{false, true} {
		name := "missing-worktree"
		if ownedWorktree {
			name = "owned-worktree"
		}
		t.Run(name, func(t *testing.T) {
			server, root, remote := newPRSafetyServer(t)
			prSafetyGit(t, root, "config", "user.name", "Retention Test")
			prSafetyGit(t, root, "config", "user.email", "retention@example.invalid")
			prSafetyGit(t, root, "config", "commit.gpgsign", "false")
			baseline := filepath.Join(root, "tracked.txt")
			if err := os.WriteFile(baseline, []byte("baseline\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("retained-ignored.txt\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			prSafetyGit(t, root, "add", "tracked.txt", ".gitignore")
			prSafetyCommit(t, root, "tracked baseline")
			projectID, err := server.db.UpsertProject(t.Context(), root, "")
			if err != nil {
				t.Fatal(err)
			}
			server.worktreeRoot = filepath.Join(filepath.Dir(root), "worktrees")
			checkout := filepath.Join(server.worktreeRoot, projectID, "task-retention")
			if ownedWorktree {
				prSafetyGit(t, root, "worktree", "add", "-b", "task-retention", checkout)
				if err := os.WriteFile(filepath.Join(checkout, "agent-work.txt"), []byte("unpublished task work\n"), 0o600); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(checkout, "retained-ignored.txt"), []byte("valuable ignored artifact\n"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(baseline, []byte("unrelated root changes\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "untracked.txt"), []byte("retain this too\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			server.orchestrator.SetTrackerClient(memory.NewClient([]tracker.Issue{{
				ID: "retention-task", Identifier: "RETAIN-1", Title: "Retain work",
				ProjectID: projectID, BranchName: "task-retention", State: "In Progress",
			}}))
			rootHead := prSafetyGit(t, root, "rev-parse", "HEAD")
			rootStatus := prSafetyGit(t, root, "status", "--porcelain")
			remoteHead := prSafetyGit(t, remote, "rev-parse", "refs/heads/task")
			var taskHead, taskStatus string
			if ownedWorktree {
				taskHead = prSafetyGit(t, checkout, "rev-parse", "HEAD")
				taskStatus = prSafetyGit(t, checkout, "status", "--porcelain")
			}
			router := chi.NewRouter()
			router.Patch("/api/v1/issues/{issue_identifier}", server.PatchIssue)
			host := httptest.NewServer(router)
			defer host.Close()
			for _, state := range []string{"Review", "Done", "Done"} {
				request, err := http.NewRequestWithContext(t.Context(), http.MethodPatch, host.URL+"/api/v1/issues/RETAIN-1", strings.NewReader(`{"state":"`+state+`"}`))
				if err != nil {
					t.Fatal(err)
				}
				response, err := host.Client().Do(request)
				if err != nil {
					t.Fatal(err)
				}
				body, readErr := io.ReadAll(response.Body)
				response.Body.Close()
				if readErr != nil || response.StatusCode != http.StatusOK {
					t.Fatalf("%s: status %d, read %v, body %s", state, response.StatusCode, readErr, body)
				}
				issue, err := server.orchestrator.FetchIssueByIdentifier(t.Context(), "RETAIN-1")
				if err != nil || issue.State != state {
					t.Fatalf("transition not persisted: %+v, %v", issue, err)
				}
				if prSafetyGit(t, root, "rev-parse", "HEAD") != rootHead || prSafetyGit(t, root, "status", "--porcelain") != rootStatus {
					t.Fatalf("%s changed shared project commits/index/work", state)
				}
				if prSafetyGit(t, remote, "rev-parse", "refs/heads/task") != remoteHead {
					t.Fatalf("%s published Git work", state)
				}
				if ownedWorktree {
					if prSafetyGit(t, checkout, "rev-parse", "HEAD") != taskHead || prSafetyGit(t, checkout, "status", "--porcelain") != taskStatus {
						t.Fatalf("%s changed or removed task checkout", state)
					}
					prSafetyGit(t, root, "show-ref", "--verify", "refs/heads/task-retention")
					content, err := os.ReadFile(filepath.Join(checkout, "agent-work.txt"))
					if err != nil || string(content) != "unpublished task work\n" {
						t.Fatalf("%s lost unpublished work: %q, %v", state, content, err)
					}
					ignored, err := os.ReadFile(filepath.Join(checkout, "retained-ignored.txt"))
					if err != nil || string(ignored) != "valuable ignored artifact\n" {
						t.Fatalf("%s lost ignored artifact: %q, %v", state, ignored, err)
					}
				}
			}
		})
	}
}
