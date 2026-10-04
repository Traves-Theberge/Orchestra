package studio

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
)

func TestPushRequestedConfigPersistsAfterDatabaseReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "studio requested.db")
	database, err := db.Connect(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if _, err := database.ExecContext(ctx, "INSERT INTO projects (id, name, root_path, remote_url) VALUES (?, ?, ?, ?)", "fixture-project", "Fixture", t.TempDir(), ""); err != nil {
		t.Fatal(err)
	}
	m := NewManager(database.DB, observability.NewPubSub(), nil)
	m.SetTracker(trackersqlite.NewClient(database, nil))
	sess, err := m.StartSession(ctx, StartSessionRequest{ProjectID: "fixture-project", Runner: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.ApplyDraftPatch(sess.ID, map[string]any{"title": "Requested model task", "description": "Body", "suggested_model": "fixture-model", "max_turns": 8}); err != nil {
		t.Fatal(err)
	}
	identifier, err := m.Push(ctx, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := db.Connect(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	issue, err := trackersqlite.NewClient(reopened, nil).FetchIssueByIdentifier(ctx, identifier)
	if err != nil {
		t.Fatal(err)
	}
	if issue == nil || issue.RequestedModel != "fixture-model" || issue.RequestedMaxTurns == nil || *issue.RequestedMaxTurns != 8 || issue.AuthoringSessionID != sess.ID || issue.State != "Backlog" {
		t.Fatalf("lost requested config: %+v", issue)
	}
}
