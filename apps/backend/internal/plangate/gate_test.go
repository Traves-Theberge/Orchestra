package plangate

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	trackersqlite "github.com/orchestra/orchestra/apps/backend/internal/tracker/sqlite"
)

func TestLatestInvalidationEventWinsEvenWhenFingerprintReturns(t *testing.T) {
	ctx := context.Background()
	database, err := db.Connect(filepath.Join(t.TempDir(), "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	projectID, err := database.UpsertProject(ctx, filepath.Join(t.TempDir(), "project"), "")
	if err != nil {
		t.Fatal(err)
	}
	client := trackersqlite.NewClient(database, nil)
	task, err := client.CreateIssue(ctx, "Approval", "Exact context", "Todo", 0, "worker-1", projectID, "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.UpdateIssue(ctx, task.ID, map[string]any{"plan": "- [ ] work"}); err != nil {
		t.Fatal(err)
	}
	current, err := client.FetchIssueByIdentifier(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	fingerprint := Fingerprint(*current)
	insertEvent := func(id, action, value string) {
		t.Helper()
		if _, err := database.ExecContext(ctx, `INSERT INTO issue_history(id,issue_id,user_id,action,new_value) VALUES(?,?,?,?,?)`, id, task.ID, "User", action, value); err != nil {
			t.Fatal(err)
		}
	}
	insertEvent("approved-before-replan", "plan_approved", fingerprint)
	if gate, err := Status(ctx, database, *current); err != nil || gate.Status != "approved" {
		t.Fatalf("initial matching approval: gate=%+v err=%v", gate, err)
	}
	// A same-feedback replan can legitimately produce the same fingerprint.
	// Its newer lifecycle event must still invalidate the older approval.
	insertEvent("same-hash-replan", "replan_requested", fingerprint)
	if gate, err := Status(ctx, database, *current); err != nil || gate.Status != "stale" {
		t.Fatalf("same-hash replan revived an old approval: gate=%+v err=%v", gate, err)
	}
	// Restoring an old fingerprint after a later context invalidation must not
	// make its historical approval authoritative again.
	insertEvent("new-plan-ready", "plan_ready", fingerprint)
	if gate, err := Status(ctx, database, *current); err != nil || gate.Status != "awaiting_approval" {
		t.Fatalf("new plan should require fresh approval: gate=%+v err=%v", gate, err)
	}
	insertEvent("new-plan-approved", "plan_approved", fingerprint)
	insertEvent("review-feedback", "review_findings", "please revise")
	if gate, err := Status(ctx, database, *current); err != nil || gate.Status != "stale" {
		t.Fatalf("review findings revived an older approval: gate=%+v err=%v", gate, err)
	}
}
