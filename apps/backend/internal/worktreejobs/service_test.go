package worktreejobs

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

func jobFixture(t *testing.T) (*Service, string, string, string) {
	t.Helper()
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	if err := os.Mkdir(repo, 0700); err != nil {
		t.Fatal(err)
	}
	jobGit(t, repo, "init", "-b", "main")
	jobGit(t, repo, "config", "user.name", "Fixture")
	jobGit(t, repo, "config", "user.email", "fixture@example.invalid")
	if err := os.WriteFile(filepath.Join(repo, "file.txt"), []byte("base"), 0600); err != nil {
		t.Fatal(err)
	}
	jobGit(t, repo, "add", "file.txt")
	jobGit(t, repo, "commit", "-m", "base")
	base := jobGit(t, repo, "rev-parse", "HEAD")
	jobGit(t, repo, "commit", "--allow-empty", "-m", "later")
	database, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	pid, err := database.UpsertProject(context.Background(), repo, "")
	if err != nil {
		t.Fatal(err)
	}
	service, err := New(database, filepath.Join(root, "children"), []string{root}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return service, pid, repo, base
}
func jobGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}
func awaitJob(t *testing.T, s *Service, pid, rid string) Job {
	t.Helper()
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		j, err := s.Get(context.Background(), pid, rid)
		if err != nil {
			t.Fatal(err)
		}
		if j.Status == "completed" || j.Status == "failed" || j.Status == "unknown" {
			return j
		}
		time.Sleep(15 * time.Millisecond)
	}
	t.Fatal("job did not settle")
	return Job{}
}
func TestCreatesExactBaseWithoutTaskOrPrimaryMutationAndReplaysReceipt(t *testing.T) {
	s, pid, repo, base := jobFixture(t)
	before := jobGit(t, repo, "rev-parse", "HEAD")
	request := Request{RequestID: uuid.NewString(), Name: "new-agent", Branch: "agent/feature", BaseRef: base}
	accepted, err := s.Submit(context.Background(), pid, request)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Status != "queued" {
		t.Fatalf("not asynchronous: %+v", accepted)
	}
	finished := awaitJob(t, s, pid, request.RequestID)
	if finished.Status != "completed" || finished.Workspace == nil {
		t.Fatalf("not created: %+v", finished)
	}
	if finished.Workspace.Head != base || finished.Workspace.Branch != request.Branch || finished.Workspace.ID == "" {
		t.Fatalf("incorrect workspace: %+v", finished.Workspace)
	}
	if jobGit(t, repo, "rev-parse", "HEAD") != before || jobGit(t, repo, "branch", "--show-current") != "main" {
		t.Fatal("primary changed")
	}
	if jobGit(t, finished.Path, "rev-parse", "HEAD") != base {
		t.Fatal("base not honored")
	}
	for _, table := range []string{"issues", "sessions"} {
		var count int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("unexpected %s side effect count=%d error=%v", table, count, err)
		}
	}
	replay, err := s.Submit(context.Background(), pid, request)
	if err != nil || replay.Workspace == nil || replay.Workspace.ID != finished.Workspace.ID {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	request.Name = "other"
	if _, err := s.Submit(context.Background(), pid, request); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed request accepted: %v", err)
	}
	if _, err := s.Get(context.Background(), "other-project", request.RequestID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-project receipt: %v", err)
	}
	restarted, err := New(s.db, s.root, s.roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := restarted.Get(context.Background(), pid, request.RequestID)
	if err != nil || persisted.Workspace == nil || persisted.Workspace.ID != finished.Workspace.ID {
		t.Fatalf("durable receipt: %+v %v", persisted, err)
	}
}
func TestExistingDestinationAndBranchAreNotOverwritten(t *testing.T) {
	s, pid, repo, base := jobFixture(t)
	folder := filepath.Join(s.root, pid, "precious")
	if err := os.MkdirAll(folder, 0700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(folder, "keep.txt")
	os.WriteFile(sentinel, []byte("keep"), 0600)
	for _, req := range []Request{{uuid.NewString(), "precious", "new", base, "", "", ""}, {uuid.NewString(), "other", "main", base, "", "", ""}, {uuid.NewString(), "invalid-base", "new2", "missing-ref", "", "", ""}} {
		if _, err := s.Submit(context.Background(), pid, req); err != nil {
			t.Fatal(err)
		}
		if result := awaitJob(t, s, pid, req.RequestID); result.Status != "failed" {
			t.Fatalf("unsafe request not rejected: %+v", result)
		}
	}
	data, err := os.ReadFile(sentinel)
	if err != nil || string(data) != "keep" {
		t.Fatal("existing folder changed")
	}
	if jobGit(t, repo, "branch", "--show-current") != "main" {
		t.Fatal("primary changed")
	}
}
func TestRestartReconcilesOnlyOwnedCleanGitWitness(t *testing.T) {
	s, pid, repo, base := jobFixture(t)
	for _, owned := range []bool{true, false} {
		req := Request{RequestID: uuid.NewString(), Name: uuid.NewString(), Branch: "branch-" + uuid.NewString(), BaseRef: base}
		job := Job{Request: req, ProjectID: pid, Root: repo, Path: filepath.Join(s.root, pid, req.Name), BaseSHA: base, Status: "checking_out", Phase: "checking_out"}
		os.MkdirAll(filepath.Dir(job.Path), 0700)
		reason := "someone-else"
		if owned {
			reason = "orchestra-create:" + req.RequestID
		}
		jobGit(t, repo, "worktree", "add", "--lock", "--reason", reason, "-b", req.Branch, job.Path, base)
		encoded, _ := encode(job)
		if _, err := s.db.Exec(`INSERT INTO worktree_creation_jobs(request_id,project_id,digest,job,status) VALUES(?,?,?,?,?)`, req.RequestID, pid, "test", encoded, job.Status); err != nil {
			t.Fatal(err)
		}
		recovered, err := New(s.db, s.root, s.roots, nil)
		if err != nil {
			t.Fatal(err)
		}
		result, err := recovered.Get(context.Background(), pid, req.RequestID)
		if err != nil {
			t.Fatal(err)
		}
		expected := "unknown"
		if owned {
			expected = "completed"
		}
		if result.Status != expected {
			t.Fatalf("ownership recovery: %+v", result)
		}
	}
}
func TestExplicitTaskRequiresValidationWithoutCreatingAnything(t *testing.T) {
	s, pid, _, base := jobFixture(t)
	req := Request{RequestID: uuid.NewString(), Name: "task-linked", Branch: "task-linked", BaseRef: base, TaskID: "existing"}
	if _, err := s.Submit(context.Background(), pid, req); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unvalidated task accepted: %v", err)
	}
	called := false
	s.validateTask = func(_ context.Context, p, tID string) error { called = p == pid && tID == "existing"; return nil }
	if _, err := s.Submit(context.Background(), pid, req); err != nil {
		t.Fatal(err)
	}
	if result := awaitJob(t, s, pid, req.RequestID); !called || result.Status != "completed" {
		t.Fatalf("explicit link: %+v", result)
	}
}
