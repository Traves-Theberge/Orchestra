package orchestrator

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
)

func TestCreateIssueRuntimeTargetPersistsAfterReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "target.db")
	database, err := db.Connect(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	svc := NewService()
	svc.SetTrackerClient(trackersqlite.NewClient(database, nil))
	issue, err := svc.CreateIssue(ctx, "Remote task", "Body", "Backlog", 0, "", "", "CODEX", "TAILSCALE", nil)
	if err != nil {
		t.Fatal(err)
	}
	if issue.RuntimeTarget != "TAILSCALE" {
		t.Fatalf("target missing on return: %+v", issue)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := db.Connect(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	stored, err := trackersqlite.NewClient(reopened, nil).FetchIssueByIdentifier(ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored == nil || stored.RuntimeTarget != "TAILSCALE" {
		t.Fatalf("target lost on reopen: %+v", stored)
	}
}

type targetUpdateTracker struct {
	tracker.Client
	fail bool
}

func (c targetUpdateTracker) UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*tracker.Issue, error) {
	if c.fail {
		return nil, fmt.Errorf("injected storage failure")
	}
	// Simulate a tracker that silently ignores the unsupported field.
	return c.Client.FetchIssueByIdentifier(ctx, identifier)
}

func TestCreateIssueDoesNotClaimUnpersistedRuntimeTarget(t *testing.T) {
	for _, fail := range []bool{true, false} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			ctx := context.Background()
			database, err := db.Connect(filepath.Join(t.TempDir(), "target.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			client := trackersqlite.NewClient(database, nil)
			svc := NewService()
			svc.SetTrackerClient(targetUpdateTracker{Client: client, fail: fail})
			issue, err := svc.CreateIssue(ctx, "Remote task", "Body", "Backlog", 0, "", "", "CODEX", "TAILSCALE", nil)
			if issue != nil || err == nil || !strings.Contains(err.Error(), "runtime target") {
				t.Fatalf("claimed unpersisted target: issue=%+v err=%v", issue, err)
			}
			// Creation and metadata update are separate effects today. Retain the
			// partially created task and report the failure; do not pretend rollback.
			stored, err := client.FetchIssues(ctx, tracker.IssueFilter{})
			if err != nil {
				t.Fatal(err)
			}
			if len(stored) != 1 || stored[0].RuntimeTarget != "" {
				t.Fatalf("unexpected partial effect: %+v", stored)
			}
		})
	}
}
