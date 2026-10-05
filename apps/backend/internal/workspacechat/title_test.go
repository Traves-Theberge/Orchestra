package workspacechat

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

func TestTitlePersistScopeCompareAndReplay(t *testing.T) {
	s, database, pid, repo := fixture(t, &recordingRunner{})
	scopeGit(t, repo, "init", "-b", "main")
	scopeGit(t, repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture")
	child := filepath.Join(filepath.Dir(repo), "child")
	scopeGit(t, repo, "worktree", "add", "-b", "feature/inherited", child)
	rows, err := workspace.ListProjectGitWorktrees(t.Context(), pid, repo, []string{filepath.Dir(repo)})
	if err != nil {
		t.Fatal(err)
	}
	var childID string
	for _, row := range rows {
		if !row.Primary {
			childID = row.ID
		}
	}
	ctx := WithWorkspaceID(t.Context(), childID)
	req := CreateRequest{Provider: "codex", ClientSessionID: uuid.NewString()}
	v, err := s.CreateWithRequest(ctx, pid, req)
	if err != nil || v.Title != "feature/inherited" {
		t.Fatalf("inherit %+v %v", v, err)
	}
	original := v.Title
	unicodeTitle := strings.Repeat("界", 200)
	u, err := s.Create(ctx, pid, "codex", unicodeTitle)
	if err != nil || u.Title != unicodeTitle {
		t.Fatalf("unicode creation %+v %v", u, err)
	}
	if _, err := s.Rename(ctx, pid, u.ID, RenameRequest{Title: unicodeTitle, ExpectedTitle: &u.Title}); err != nil {
		t.Fatalf("unicode rename %v", err)
	}
	changed, err := s.Rename(ctx, pid, v.ID, RenameRequest{Title: "  Human name  ", ExpectedTitle: &original})
	if err != nil || changed.Title != "Human name" {
		t.Fatalf("rename %+v %v", changed, err)
	}
	if _, err := s.Rename(ctx, pid, v.ID, RenameRequest{Title: "Stale", ExpectedTitle: &original}); !errors.Is(err, ErrTitleConflict) {
		t.Fatalf("stale overwrite %v", err)
	}
	for _, title := range []string{" ", strings.Repeat("x", 201)} {
		if _, err := s.Rename(ctx, pid, v.ID, RenameRequest{Title: title, ExpectedTitle: &changed.Title}); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid %v", err)
		}
	}
	if _, err := s.Rename(t.Context(), pid, v.ID, RenameRequest{Title: "Wrong root", ExpectedTitle: &changed.Title}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("root scope %v", err)
	}
	if _, err := s.Rename(ctx, "wrong-project", v.ID, RenameRequest{Title: "Wrong project", ExpectedTitle: &changed.Title}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("project scope %v", err)
	}
	replay, err := s.CreateWithRequest(ctx, pid, req)
	if err != nil || replay.Title != "Human name" {
		t.Fatalf("creation replay undid title %+v %v", replay, err)
	}
	s.Close()
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	database, err = db.Connect(filepath.Join(filepath.Dir(repo), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	registry := agents.NewRegistry(nil)
	registry.SetRunner(agents.ProviderCodex, &recordingRunner{})
	reopened, err := New(database, registry, []string{filepath.Dir(repo)})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	detail, err := reopened.Detail(ctx, pid, v.ID)
	if err != nil || detail.Session.Title != "Human name" || len(detail.Messages) != 0 {
		t.Fatalf("reopen %+v %v", detail, err)
	}
	scopeGit(t, child, "branch", "--show-current")
	if detail.Session.ProviderThreadID != v.ProviderThreadID || detail.Session.Provider != v.Provider {
		t.Fatal("rename changed provider identity")
	}
}
