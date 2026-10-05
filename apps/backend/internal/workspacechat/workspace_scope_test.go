package workspacechat

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

type worktreeNativeRegistry struct {
	*fakeNativeRegistry
	requests chan agents.TurnRequest
}

func (r *worktreeNativeRegistry) StartNativeSession(ctx context.Context, p agents.Provider, req agents.TurnRequest, id string, h agents.NativeEventHandler) (agents.NativeSession, error) {
	r.requests <- req
	return r.fakeNativeRegistry.StartNativeSession(ctx, p, req, id, h)
}

func scopeGit(t *testing.T, cwd string, args ...string) {
	t.Helper()
	c := exec.Command("git", args...)
	c.Dir = cwd
	if out, err := c.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %s %v", args, out, err)
	}
}

func TestNativeChatWorktreeScopePersistsAndRejectsStaleMembership(t *testing.T) {
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
	scopeGit(t, repo, "worktree", "add", "-b", "child", child)
	database, err := db.Connect(filepath.Join(base, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	pid, err := database.UpsertProject(t.Context(), repo, "")
	if err != nil {
		t.Fatal(err)
	}
	rows, err := workspace.ListProjectGitWorktrees(t.Context(), pid, repo, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	var primaryID, childID string
	for _, row := range rows {
		if row.Primary {
			primaryID = row.ID
		} else {
			childID = row.ID
			child = row.Path
		}
	}
	if primaryID == "" || childID == "" {
		t.Fatalf("missing observed worktrees: %+v", rows)
	}
	registry := &worktreeNativeRegistry{fakeNativeRegistry: &fakeNativeRegistry{}, requests: make(chan agents.TurnRequest, 4)}
	s, err := New(database, registry, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	rootChat, err := s.Create(t.Context(), pid, "codex", "root")
	if err != nil {
		t.Fatal(err)
	}
	// Simulate an old pre-binding conversation without modifying its messages.
	if _, err := database.Exec("DELETE FROM workspace_chat_workspaces WHERE session_id=?", rootChat.ID); err != nil {
		t.Fatal(err)
	}
	childCtx := WithWorkspaceID(t.Context(), childID)
	childChat, err := s.Create(childCtx, pid, "codex", "child")
	if err != nil {
		t.Fatal(err)
	}
	if childChat.WorkspaceID != childID || childChat.WorkspacePath != child {
		t.Fatalf("wrong durable target %+v", childChat)
	}
	list, err := s.List(childCtx, pid)
	if err != nil || len(list) != 1 || list[0].ID != childChat.ID {
		t.Fatalf("child leaked root chats %+v %v", list, err)
	}
	list, err = s.List(WithWorkspaceID(t.Context(), primaryID), pid)
	if err != nil || len(list) != 1 || list[0].ID != rootChat.ID || list[0].WorkspaceID != primaryID {
		t.Fatalf("legacy root list %+v %v", list, err)
	}
	if _, err = s.Detail(t.Context(), pid, childChat.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("root read child: %v", err)
	}
	if _, err = s.Stop(t.Context(), pid, childChat.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("root stopped child: %v", err)
	}
	if _, err = s.Reply(t.Context(), pid, childChat.ID, "foreign", ReplyRequest{ClientResponseID: "reply", Answer: []byte(`{}`)}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("root replied child: %v", err)
	}
	if _, err = s.CreateWithRequest(t.Context(), pid, CreateRequest{Provider: "codex", ClientSessionID: childChat.ID}); !errors.Is(err, ErrConflict) {
		t.Fatalf("root reused child identity: %v", err)
	}
	if _, err = database.Exec("UPDATE workspace_chat_workspaces SET cwd=? WHERE session_id=?", repo, childChat.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(childCtx, pid, childChat.ID, SendRequest{ClientMessageID: "drift", Text: "must not launch"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("cwd drift sent: %v", err)
	}
	if _, err = database.Exec("UPDATE workspace_chat_workspaces SET cwd=? WHERE session_id=?", child, childChat.ID); err != nil {
		t.Fatal(err)
	}
	otherChild, err := s.Create(childCtx, pid, "codex", "another child chat")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = database.Exec("UPDATE workspace_chat_sessions SET status='running' WHERE id=?", otherChild.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(childCtx, pid, childChat.ID, SendRequest{ClientMessageID: "busy", Text: "must not launch"}); !errors.Is(err, ErrBusy) {
		t.Fatalf("same checkout not serialized: %v", err)
	}
	if _, err = database.Exec("UPDATE workspace_chat_sessions SET status='idle' WHERE id=?", otherChild.ID); err != nil {
		t.Fatal(err)
	}
	// Persisted ownership of the root checkout does not occupy its child.
	if _, err = database.Exec("UPDATE workspace_chat_sessions SET status='running' WHERE id=?", rootChat.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(childCtx, pid, childChat.ID, SendRequest{ClientMessageID: "first", Text: "hello"}); err != nil {
		t.Fatal(err)
	}
	if _, err = database.Exec("UPDATE workspace_chat_sessions SET status='idle' WHERE id=?", rootChat.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case req := <-registry.requests:
		if req.Workspace != child || req.WorkspaceRoot != child {
			t.Fatalf("native harness wrong cwd %+v", req)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("native launch missing")
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		detail, err := s.Detail(childCtx, pid, childChat.ID)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Session.Status == "idle" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("native turn unsettled")
		}
		time.Sleep(5 * time.Millisecond)
	}
	s.Close()
	if err = database.Close(); err != nil {
		t.Fatal(err)
	}
	reopenedDB, err := db.Connect(filepath.Join(base, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer reopenedDB.Close()
	reopened, err := New(reopenedDB, registry, []string{base})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	detail, err := reopened.Detail(childCtx, pid, childChat.ID)
	if err != nil || detail.Session.WorkspaceID != childID || detail.Session.WorkspacePath != child || detail.Session.ProviderThreadID != "provider-thread" || len(detail.Messages) != 2 {
		t.Fatalf("restart lost binding/history %+v %v", detail, err)
	}
	scopeGit(t, repo, "worktree", "remove", child)
	if _, err = reopened.Send(childCtx, pid, childChat.ID, SendRequest{ClientMessageID: "second", Text: "must not launch"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("stale workspace sent: %v", err)
	}
	select {
	case req := <-registry.requests:
		t.Fatalf("stale native launch %+v", req)
	default:
	}
}
