package workspacechat

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

func awaitScopedIdle(t *testing.T, s *Service, ctx context.Context, pid, id string) Detail {
	t.Helper()
	for range 600 {
		detail, err := s.Detail(ctx, pid, id)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Session.Status != "running" && detail.Session.Status != "stopping" {
			return detail
		}
		select {
		case <-time.After(5 * time.Millisecond):
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	t.Fatal("turn did not settle")
	return Detail{}
}

func TestArchiveSurvivesRemovedWorktreeAndDatabaseRestart(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_TERMINAL_PROMPT", "0")
	base := t.TempDir()
	repo, child, dbPath := filepath.Join(base, "repo"), filepath.Join(base, "child"), filepath.Join(base, "chat.db")
	if err := os.Mkdir(repo, 0700); err != nil {
		t.Fatal(err)
	}
	scopeGit(t, repo, "init")
	scopeGit(t, repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture")
	scopeGit(t, repo, "worktree", "add", "-b", "archive-child", child)
	database, err := db.Connect(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := database.UpsertProject(context.Background(), repo, "")
	if err != nil {
		t.Fatal(err)
	}
	rows, err := workspace.ListProjectGitWorktrees(context.Background(), pid, repo, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	var workspaceID string
	for _, row := range rows {
		if !row.Primary {
			workspaceID, child = row.ID, row.Path
		}
	}
	if workspaceID == "" {
		t.Fatal("child worktree not discovered")
	}
	registry := agents.NewRegistry(nil)
	registry.SetRunner(agents.ProviderCodex, &recordingRunner{output: "preserved response"})
	svc, err := New(database, registry, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	childCtx := WithWorkspaceID(context.Background(), workspaceID)
	session, err := svc.Create(childCtx, pid, "codex", "Archive me")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Send(childCtx, pid, session.ID, SendRequest{ClientMessageID: "first", Text: "retain this"}); err != nil {
		t.Fatal(err)
	}
	detail := awaitScopedIdle(t, svc, childCtx, pid, session.ID)
	if len(detail.Messages) != 2 {
		t.Fatalf("expected complete transcript before archive: %+v", detail.Messages)
	}
	archived, err := svc.Archive(childCtx, pid, session.ID, ArchiveRequest{WorkspaceID: workspaceID, CWD: child, ExpectedStatus: "idle", ExpectedVersion: 0})
	if err != nil || !archived.Archived || archived.LifecycleVersion != 1 {
		t.Fatalf("archive: %+v %v", archived, err)
	}
	if got, err := svc.List(childCtx, pid); err != nil || len(got) != 0 {
		t.Fatalf("default list exposed archived conversation: %+v %v", got, err)
	}
	if got, err := svc.ListWithArchived(childCtx, pid, true); err != nil || len(got) != 1 || !got[0].Archived {
		t.Fatalf("explicit list missed archive: %+v %v", got, err)
	}
	if _, err = svc.ArchivedDetailAfter(context.Background(), pid, session.ID, "wrong-workspace", child, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong workspace history scope: %v", err)
	}
	// Pending and uncertain provider state must not be archived.
	other, err := svc.Create(childCtx, pid, "codex", "Busy")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = database.Exec(`UPDATE workspace_chat_sessions SET status='running' WHERE id=?`, other.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Archive(childCtx, pid, other.ID, ArchiveRequest{WorkspaceID: workspaceID, CWD: child, ExpectedStatus: "running"}); !errors.Is(err, ErrBusy) {
		t.Fatalf("active session archived: %v", err)
	}
	if _, err = database.Exec(`UPDATE workspace_chat_sessions SET status='idle' WHERE id=?`, other.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = database.Exec(`INSERT INTO workspace_chat_messages(id,session_id,role,text,status,created_at) VALUES('unknown-message',?,'user','uncertain','unknown','now')`, other.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Archive(childCtx, pid, other.ID, ArchiveRequest{WorkspaceID: workspaceID, CWD: child, ExpectedStatus: "idle", ExpectedVersion: 0}); !errors.Is(err, ErrBusy) {
		t.Fatalf("uncertain delivery archived: %v", err)
	}
	if _, err = database.Exec(`DELETE FROM workspace_chat_messages WHERE id='unknown-message'`); err != nil {
		t.Fatal(err)
	}
	svc.Close()
	if err = database.Close(); err != nil {
		t.Fatal(err)
	}
	if err = os.RemoveAll(child); err != nil {
		t.Fatal(err)
	}
	scopeGit(t, repo, "worktree", "prune")
	database, err = db.Connect(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	registry = agents.NewRegistry(nil)
	registry.SetRunner(agents.ProviderCodex, &recordingRunner{})
	svc, err = New(database, registry, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	history, err := svc.ArchivedList(context.Background(), pid, workspaceID, child)
	if err != nil || len(history) != 1 || history[0].ID != session.ID || !history[0].Archived {
		t.Fatalf("history after deletion/reopen: %+v %v", history, err)
	}
	archivedDetail, err := svc.ArchivedDetailAfter(context.Background(), pid, session.ID, workspaceID, child, 0)
	if err != nil || len(archivedDetail.Messages) != 2 || archivedDetail.Messages[1].Text != "preserved response" {
		t.Fatalf("transcript after deletion/reopen: %+v %v", archivedDetail, err)
	}
	if _, err = svc.Unarchive(childCtx, pid, session.ID, ArchiveRequest{WorkspaceID: workspaceID, CWD: child, ExpectedStatus: "idle", ExpectedVersion: 1}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("restore succeeded after checkout removal: %v", err)
	}
	if err = os.Mkdir(child, 0700); err != nil {
		t.Fatal(err)
	}
	scopeGit(t, repo, "worktree", "add", "-B", "archive-child", child)
	// Worktree identity and path return; restore still requires a current, exact binding.
	rows, err = workspace.ListProjectGitWorktrees(context.Background(), pid, repo, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if !row.Primary && row.Path == child {
			workspaceID = row.ID
		}
	}
	childCtx = WithWorkspaceID(context.Background(), workspaceID)
	if _, err = svc.Unarchive(childCtx, pid, session.ID, ArchiveRequest{WorkspaceID: workspaceID, CWD: child, ExpectedStatus: "idle", ExpectedVersion: 1}); err != nil {
		t.Fatalf("restore after checkout returns: %v", err)
	}
	if got, err := svc.List(childCtx, pid); err != nil || len(got) != 2 {
		t.Fatalf("restored active list: %+v %v", got, err)
	}
}

func TestArchiveMaterializesLegacyBindingOnlyForPrimaryRoot(t *testing.T) {
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_TERMINAL_PROMPT", "0")
	base := t.TempDir()
	repo, child := filepath.Join(base, "repo"), filepath.Join(base, "child")
	if err := os.Mkdir(repo, 0700); err != nil {
		t.Fatal(err)
	}
	scopeGit(t, repo, "init")
	scopeGit(t, repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture")
	scopeGit(t, repo, "worktree", "add", "-b", "archive-child", child)
	database, err := db.Connect(filepath.Join(base, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	pid, err := database.UpsertProject(context.Background(), repo, "")
	if err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(nil)
	registry.SetRunner(agents.ProviderCodex, &recordingRunner{output: "retained root reply"})
	svc, err := New(database, registry, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	rootSession, err := svc.Create(context.Background(), pid, "codex", "Legacy root")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Send(context.Background(), pid, rootSession.ID, SendRequest{ClientMessageID: "archive-fixture", Text: "retain this history"}); err != nil {
		t.Fatal(err)
	}
	rootDetail := awaitScopedIdle(t, svc, context.Background(), pid, rootSession.ID)
	if len(rootDetail.Messages) != 2 || rootDetail.Messages[1].Text != "retained root reply" {
		t.Fatalf("root fixture did not settle: %+v", rootDetail.Messages)
	}
	if _, err = database.Exec(`DELETE FROM workspace_chat_workspaces WHERE session_id=?`, rootSession.ID); err != nil {
		t.Fatal(err)
	}
	worktrees, err := workspace.ListProjectGitWorktrees(context.Background(), pid, repo, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	var childID string
	for _, row := range worktrees {
		if !row.Primary {
			childID, child = row.ID, row.Path
		}
	}
	if childID == "" {
		t.Fatal("child worktree was not observed")
	}
	if _, err = svc.Archive(context.Background(), "wrong-project", rootSession.ID, ArchiveRequest{WorkspaceID: rootSession.WorkspaceID, CWD: repo, ExpectedStatus: "idle", ExpectedVersion: 0}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("legacy root conversation was visible to another project: %v", err)
	}
	if _, err = svc.Archive(WithWorkspaceID(context.Background(), childID), pid, rootSession.ID, ArchiveRequest{WorkspaceID: childID, CWD: child, ExpectedStatus: "idle", ExpectedVersion: 0}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("legacy root conversation was rebound to a child: %v", err)
	}
	var bindingCount int
	if err = database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_workspaces WHERE session_id=?`, rootSession.ID).Scan(&bindingCount); err != nil || bindingCount != 0 {
		t.Fatalf("foreign archive attempt wrote binding: count=%d err=%v", bindingCount, err)
	}
	archived, err := svc.Archive(context.Background(), pid, rootSession.ID, ArchiveRequest{WorkspaceID: rootSession.WorkspaceID, CWD: repo, ExpectedStatus: "idle", ExpectedVersion: 0})
	if err != nil || !archived.Archived {
		t.Fatalf("legacy root archive: %+v %v", archived, err)
	}
	var storedID, storedPath string
	if err = database.QueryRow(`SELECT workspace_id,cwd FROM workspace_chat_workspaces WHERE session_id=?`, rootSession.ID).Scan(&storedID, &storedPath); err != nil || storedID != rootSession.WorkspaceID || storedPath != repo {
		t.Fatalf("archive did not persist exact root binding: %q %q %v", storedID, storedPath, err)
	}
	archives, err := svc.ArchivedCatalog(context.Background(), pid)
	if err != nil || len(archives) != 1 || archives[0].ID != rootSession.ID {
		t.Fatalf("legacy archive missing from catalog: %+v %v", archives, err)
	}
	history, err := svc.ArchivedDetailAfter(context.Background(), pid, rootSession.ID, archived.WorkspaceID, archived.WorkspacePath, 0)
	if err != nil || len(history.Messages) != 2 || history.Messages[1].Text != "retained root reply" {
		t.Fatalf("legacy archive history missing: %+v %v", history.Messages, err)
	}
	svc.Close()
	if err = database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = db.Connect(filepath.Join(base, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	reopened, err := New(database, registry, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	reopenedArchives, err := reopened.ArchivedCatalog(context.Background(), pid)
	if err != nil || len(reopenedArchives) != 1 || reopenedArchives[0].WorkspaceID != archived.WorkspaceID || reopenedArchives[0].WorkspacePath != repo {
		t.Fatalf("archive binding did not survive database reopen: %+v %v", reopenedArchives, err)
	}
	if _, err = reopened.Unarchive(context.Background(), pid, rootSession.ID, ArchiveRequest{WorkspaceID: archived.WorkspaceID, CWD: repo, ExpectedStatus: "idle", ExpectedVersion: 1}); err != nil {
		t.Fatalf("restore after database reopen: %v", err)
	}
	active, err := reopened.List(context.Background(), pid)
	if err != nil || len(active) != 1 || active[0].ID != rootSession.ID {
		t.Fatalf("restored legacy conversation missing after database reopen: %+v %v", active, err)
	}
}

func TestArchiveRejectsPendingRemovalFence(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(base, "repo")
	if err := os.Mkdir(repo, 0700); err != nil {
		t.Fatal(err)
	}
	scopeGit(t, repo, "init")
	scopeGit(t, repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture")
	database, err := db.Connect(filepath.Join(base, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	pid, err := database.UpsertProject(context.Background(), repo, "")
	if err != nil {
		t.Fatal(err)
	}
	registry := agents.NewRegistry(nil)
	registry.SetRunner(agents.ProviderCodex, &recordingRunner{})
	svc, err := New(database, registry, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()
	session, err := svc.Create(context.Background(), pid, "codex", "Fence")
	if err != nil {
		t.Fatal(err)
	}
	var workspaceID string
	if err = database.QueryRow(`SELECT workspace_id FROM workspace_chat_workspaces WHERE session_id=?`, session.ID).Scan(&workspaceID); err != nil {
		t.Fatal(err)
	}
	receipt, _ := json.Marshal(map[string]any{"path": repo})
	if _, err = database.Exec(`INSERT INTO worktree_removal_requests(request_id,project_id,workspace_id,digest,receipt,status) VALUES('pending-1',?,?,?,?, 'pending')`, pid, workspaceID, "digest", string(receipt)); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.Archive(WithWorkspaceID(context.Background(), workspaceID), pid, session.ID, ArchiveRequest{WorkspaceID: workspaceID, CWD: repo, ExpectedStatus: "idle", ExpectedVersion: 0}); !errors.Is(err, ErrBusy) {
		t.Fatalf("archive crossed pending removal fence: %v", err)
	}
	workspaceCtx := WithWorkspaceID(context.Background(), workspaceID)
	if _, err = svc.Create(workspaceCtx, pid, "codex", "blocked create"); !errors.Is(err, ErrBusy) {
		t.Fatalf("create crossed pending removal fence: %v", err)
	}
	if _, err = svc.Send(workspaceCtx, pid, session.ID, SendRequest{ClientMessageID: "fenced", Text: "must not dispatch"}); !errors.Is(err, ErrBusy) {
		t.Fatalf("send crossed pending removal fence: %v", err)
	}
	if _, err = database.Exec(`UPDATE workspace_chat_sessions SET status='running' WHERE id=?`, session.ID); err != nil {
		t.Fatal(err)
	}
	svc.active[session.ID] = func() {}
	if _, err = svc.Stop(workspaceCtx, pid, session.ID); !errors.Is(err, ErrBusy) {
		t.Fatalf("stop crossed pending removal fence: %v", err)
	}
	delete(svc.active, session.ID)
}
