package sqlite

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

func TestRequestedConfigSurvivesReopenAndAllReads(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "requested.db")
	database := openFixture(t, path)
	client := NewClient(database, nil)
	created, err := client.CreateIssue(ctx, "Requested config", "Body", "Backlog", 0, "", "", "CODEX", nil)
	if err != nil {
		t.Fatal(err)
	}
	if created.RequestedModel != "" || created.RequestedMaxTurns != nil {
		t.Fatalf("unexpected defaults: %+v", created)
	}
	turns := 7
	if _, err := client.UpdateIssue(ctx, created.ID, map[string]any{"requested_model": "unverified-model", "requested_max_turns": &turns}); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	client = NewClient(openFixture(t, path), nil)
	reads := map[string]func() ([]tracker.Issue, error){
		"list":      func() ([]tracker.Issue, error) { return client.FetchIssues(ctx, tracker.IssueFilter{}) },
		"candidate": func() ([]tracker.Issue, error) { return client.FetchCandidateIssues(ctx, []string{"Backlog"}) },
		"states":    func() ([]tracker.Issue, error) { return client.FetchIssuesByStates(ctx, []string{"Backlog"}) },
		"ids":       func() ([]tracker.Issue, error) { return client.FetchIssuesByIDs(ctx, []string{created.ID}) },
		"search":    func() ([]tracker.Issue, error) { return client.SearchIssues(ctx, "Requested") },
	}
	for name, read := range reads {
		t.Run(name, func(t *testing.T) {
			items, err := read()
			if err != nil {
				t.Fatal(err)
			}
			if len(items) != 1 || items[0].RequestedModel != "unverified-model" || items[0].RequestedMaxTurns == nil || *items[0].RequestedMaxTurns != 7 {
				t.Fatalf("lost requested config: %+v", items)
			}
		})
	}
	for _, identity := range []string{created.ID, created.Identifier} {
		item, err := client.FetchIssueByIdentifier(ctx, identity)
		if err != nil {
			t.Fatal(err)
		}
		if item.RequestedModel != "unverified-model" || item.RequestedMaxTurns == nil || *item.RequestedMaxTurns != 7 {
			t.Fatalf("lost detail: %+v", item)
		}
	}
	// Omission preserves intent; explicit null clears it.
	item, err := client.UpdateIssue(ctx, created.ID, map[string]any{"title": "Retitled"})
	if err != nil {
		t.Fatal(err)
	}
	if item.RequestedMaxTurns == nil || *item.RequestedMaxTurns != 7 {
		t.Fatal("omission cleared turns")
	}
	item, err = client.UpdateIssue(ctx, created.ID, map[string]any{"requested_model": nil, "requested_max_turns": nil})
	if err != nil {
		t.Fatal(err)
	}
	if item.RequestedModel != "" || item.RequestedMaxTurns != nil {
		t.Fatalf("null did not clear: %+v", item)
	}
}

func TestRequestedConfigInvalidPatchIsAtomic(t *testing.T) {
	ctx := context.Background()
	client := NewClient(openFixture(t, filepath.Join(t.TempDir(), "requested.db")), nil)
	created, err := client.CreateIssue(ctx, "Original", "Body", "Backlog", 0, "", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []any{0, -1, 101, 1.5, "3", true, []int{3}, json.Number("1.000000000000000001"), json.Number("1e100")} {
		if _, err := client.UpdateIssue(ctx, created.ID, map[string]any{"title": "Changed", "requested_max_turns": invalid}); err == nil {
			t.Fatalf("accepted invalid turns %#v", invalid)
		}
		item, err := client.FetchIssueByIdentifier(ctx, created.ID)
		if err != nil {
			t.Fatal(err)
		}
		if item.Title != "Original" || item.RequestedMaxTurns != nil {
			t.Fatalf("partial write: %+v", item)
		}
	}
	if _, err := client.UpdateIssue(ctx, created.ID, map[string]any{"title": "Changed", "requested_model": 3}); err == nil {
		t.Fatal("accepted numeric model")
	}
	for _, valid := range []any{1, 100, 5.0, json.Number("0.5e1")} {
		if _, err := client.UpdateIssue(ctx, created.ID, map[string]any{"requested_max_turns": valid}); err != nil {
			t.Fatal(err)
		}
	}
}
