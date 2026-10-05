package workspacelifecycle

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

type fixture struct {
	database *db.DB
	root     string
	repo     string
	linked   string
	project  string
	id       string
	head     string
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	root := t.TempDir()
	repo := filepath.Join(root, "registered")
	if err := os.MkdirAll(repo, 0o700); err != nil {
		t.Fatal(err)
	}
	git(t, repo, "init", "--initial-branch=main")
	git(t, repo, "config", "user.name", "Fixture")
	git(t, repo, "config", "user.email", "fixture@example.invalid")
	if err := os.WriteFile(filepath.Join(repo, ".gitignore"), []byte("*.local\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "tracked.txt"), []byte("original\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git(t, repo, "add", ".")
	git(t, repo, "commit", "-m", "initial")
	head := strings.TrimSpace(git(t, repo, "rev-parse", "HEAD"))
	linked := filepath.Join(root, "separate", "checkout with spaces")
	if err := os.MkdirAll(filepath.Dir(linked), 0o700); err != nil {
		t.Fatal(err)
	}
	git(t, repo, "worktree", "add", "-b", "topic/keep-me", linked)
	database, err := db.Connect(filepath.Join(root, "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	project, err := database.UpsertProject(context.Background(), repo, "")
	if err != nil {
		t.Fatal(err)
	}
	return fixture{database: database, root: root, repo: repo, linked: linked, project: project, head: head, id: workspace.IDForGitWorktree(project, linked)}
}

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v in %s: %v\n%s", args, dir, err, output)
	}
	return string(output)
}

func TestRemoveCleanCheckoutRetainsBranchAndReplaysReceipt(t *testing.T) {
	f := newFixture(t)
	service, err := New(f.database, []string{f.root})
	if err != nil {
		t.Fatal(err)
	}
	requestID := uuid.NewString()
	receipt, err := service.Remove(context.Background(), f.project, f.id, requestID, nil)
	if err != nil || receipt.Status != "completed" {
		t.Fatalf("Remove() = %+v, %v", receipt, err)
	}
	if _, err = os.Stat(f.linked); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("checkout directory remains or stat failed: %v", err)
	}
	if got := strings.TrimSpace(git(t, f.repo, "rev-parse", "refs/heads/topic/keep-me")); got != f.head {
		t.Fatalf("branch was not retained at its original commit: %s", got)
	}
	if _, err = os.Stat(f.repo); err != nil {
		t.Fatalf("registered checkout was removed: %v", err)
	}
	replay, err := service.Remove(context.Background(), f.project, f.id, requestID, func(context.Context, string, workspace.GitWorktree) error {
		t.Fatal("a replay must not recheck or run an effect")
		return nil
	})
	if err != nil || replay.Status != "completed" || replay.RequestID != requestID {
		t.Fatalf("replay = %+v, %v", replay, err)
	}
	if _, err = service.Remove(context.Background(), f.project, "wt_other", requestID, nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("reused request identity with different arguments: %v", err)
	}
}

func TestRemoveRejectsTrackedUntrackedAndIgnoredContent(t *testing.T) {
	for _, kind := range []string{"tracked", "untracked", "ignored"} {
		t.Run(kind, func(t *testing.T) {
			f := newFixture(t)
			path := filepath.Join(f.linked, "new-file.txt")
			switch kind {
			case "tracked":
				path = filepath.Join(f.linked, "tracked.txt")
				if err := os.WriteFile(path, []byte("changed\n"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "untracked":
				if err := os.WriteFile(path, []byte("untracked\n"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "ignored":
				path = filepath.Join(f.linked, "credentials.local")
				if err := os.WriteFile(path, []byte("fixture-only\n"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			service, err := New(f.database, []string{f.root})
			if err != nil {
				t.Fatal(err)
			}
			_, err = service.Remove(context.Background(), f.project, f.id, uuid.NewString(), nil)
			if !errors.Is(err, ErrDirty) {
				t.Fatalf("Remove() error = %v, want ErrDirty", err)
			}
			if _, err = os.Stat(path); err != nil {
				t.Fatalf("user file was removed: %v", err)
			}
			if _, err = os.Stat(f.linked); err != nil {
				t.Fatalf("worktree was removed: %v", err)
			}
		})
	}
}

func TestRemoveProtectsRegisteredAndMainWorktreeAndHonorsBusyCheck(t *testing.T) {
	f := newFixture(t)
	service, err := New(f.database, []string{f.root})
	if err != nil {
		t.Fatal(err)
	}
	primaryID := workspace.IDForGitWorktree(f.project, f.repo)
	if _, err = service.Remove(context.Background(), f.project, primaryID, uuid.NewString(), nil); !errors.Is(err, ErrProtected) {
		t.Fatalf("registered checkout removal error = %v", err)
	}
	calls := 0
	busy := func(context.Context, string, workspace.GitWorktree) error {
		calls++
		if calls == 2 {
			return ErrBusy
		}
		return nil
	}
	_, err = service.Remove(context.Background(), f.project, f.id, uuid.NewString(), busy)
	if !errors.Is(err, ErrBusy) || calls != 2 {
		t.Fatalf("busy removal = %v, calls=%d", err, calls)
	}
	if _, err = os.Stat(f.linked); err != nil {
		t.Fatalf("busy worktree was removed: %v", err)
	}
}

func TestRemovalReceiptPersistsUnknownWithoutReplayingEffect(t *testing.T) {
	f := newFixture(t)
	service, err := New(f.database, []string{f.root})
	if err != nil {
		t.Fatal(err)
	}
	requestID := uuid.NewString()
	rows, err := workspace.ListProjectGitWorktrees(context.Background(), f.project, f.repo, []string{f.root})
	if err != nil {
		t.Fatal(err)
	}
	var target workspace.GitWorktree
	for _, row := range rows {
		if row.ID == f.id {
			target = row
		}
	}
	receipt := Receipt{RequestID: requestID, ProjectID: f.project, WorkspaceID: f.id, Status: "pending", Path: target.Path, Branch: target.Branch, Head: target.Head}
	if err = service.insert(context.Background(), digestRequest(f.project, f.id), receipt); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(f.database, []string{f.root})
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := restarted.Remove(context.Background(), f.project, f.id, requestID, func(context.Context, string, workspace.GitWorktree) error {
		t.Fatal("unknown receipt must not replay the Git effect")
		return nil
	})
	if err != nil || replayed.Status != "unknown" {
		t.Fatalf("unknown replay = %+v, %v", replayed, err)
	}
	competing, err := restarted.Remove(context.Background(), f.project, f.id, uuid.NewString(), func(context.Context, string, workspace.GitWorktree) error {
		t.Fatal("another request must observe the unresolved receipt without retrying Git")
		return nil
	})
	if err != nil || competing.RequestID != requestID || competing.Status != "unknown" {
		t.Fatalf("competing request should receive the durable prior receipt: %+v, %v", competing, err)
	}
	observed, err := restarted.Get(context.Background(), f.project, requestID)
	if err != nil || observed.Status != "rejected" {
		t.Fatalf("receipt reconciliation = %+v, %v", observed, err)
	}
	if _, err = os.Stat(f.linked); err != nil {
		t.Fatalf("unknown receipt reconciliation changed checkout: %v", err)
	}
}

func TestRemovalRechecksHeadAfterAdmissionFence(t *testing.T) {
	f := newFixture(t)
	service, err := New(f.database, []string{f.root})
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	busy := func(_ context.Context, _ string, target workspace.GitWorktree) error {
		calls++
		if calls == 2 {
			git(t, target.Path, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "concurrent change")
		}
		return nil
	}
	_, err = service.Remove(context.Background(), f.project, f.id, uuid.NewString(), busy)
	if !errors.Is(err, ErrConflict) || calls != 2 {
		t.Fatalf("identity recheck = %v, calls=%d", err, calls)
	}
	if _, err = os.Stat(f.linked); err != nil {
		t.Fatalf("checkout changed during validation: %v", err)
	}
}
