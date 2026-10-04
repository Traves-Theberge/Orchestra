package sqlite

import (
	"context"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

func openFixture(t *testing.T, path string) *db.DB {
	t.Helper()
	database, err := db.Connect(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func TestAuthoringMetadataSurvivesEveryReadAndReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "task metadata.db")
	database := openFixture(t, path)
	client := NewClient(database, nil)
	created, err := client.CreateIssue(ctx, "Metadata task", "Body", "Backlog", 0, "", "", "CLAUDE", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(created.AcceptanceCriteria) != 0 || len(created.Attachments) != 0 || len(created.AgentGuidance) != 0 || created.RuntimeTarget != "" {
		t.Fatalf("unexpected create defaults: %+v", created)
	}
	updated, err := client.UpdateIssue(ctx, created.Identifier, map[string]any{
		"acceptance_criteria": []string{"tests pass", "reload preserves context"},
		"attachments":         []tracker.Attachment{{Kind: "file", Path: "src/main.go", Label: "entry"}, {Kind: "link", URL: "https://example.test/spec"}},
		"agent_guidance":      map[string]any{"model": "fixture-model", "nested": map[string]any{"allowed": true}},
		"source_template":     "feature", "authoring_session_id": "studio-fixture", "runtime_target": "TAILSCALE",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(updated.AcceptanceCriteria, []string{"tests pass", "reload preserves context"}) || len(updated.Attachments) != 2 || updated.Attachments[0].Path != "src/main.go" || updated.Attachments[1].URL != "https://example.test/spec" || updated.AgentGuidance["model"] != "fixture-model" {
		t.Fatalf("update did not return requested metadata: %+v", updated)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	client = NewClient(openFixture(t, path), nil)
	check := func(t *testing.T, actual *tracker.Issue) {
		t.Helper()
		if actual == nil || !reflect.DeepEqual(actual.AcceptanceCriteria, updated.AcceptanceCriteria) || !reflect.DeepEqual(actual.Attachments, updated.Attachments) || !reflect.DeepEqual(actual.AgentGuidance, updated.AgentGuidance) || actual.SourceTemplate != "feature" || actual.AuthoringSessionID != "studio-fixture" || actual.RuntimeTarget != "TAILSCALE" {
			t.Fatalf("metadata mismatch after reopen: %+v", actual)
		}
	}
	for _, identity := range []string{created.ID, created.Identifier} {
		t.Run("detail_"+identity, func(t *testing.T) {
			item, err := client.FetchIssueByIdentifier(ctx, identity)
			if err != nil {
				t.Fatal(err)
			}
			check(t, item)
		})
	}
	reads := map[string]func() ([]tracker.Issue, error){
		"list":      func() ([]tracker.Issue, error) { return client.FetchIssues(ctx, tracker.IssueFilter{}) },
		"candidate": func() ([]tracker.Issue, error) { return client.FetchCandidateIssues(ctx, []string{"Backlog"}) },
		"states":    func() ([]tracker.Issue, error) { return client.FetchIssuesByStates(ctx, []string{"Backlog"}) },
		"ids":       func() ([]tracker.Issue, error) { return client.FetchIssuesByIDs(ctx, []string{created.ID}) },
		"search":    func() ([]tracker.Issue, error) { return client.SearchIssues(ctx, "Metadata") },
	}
	for name, read := range reads {
		t.Run(name, func(t *testing.T) {
			items, err := read()
			if err != nil {
				t.Fatal(err)
			}
			if len(items) != 1 {
				t.Fatalf("got %d items", len(items))
			}
			check(t, &items[0])
		})
	}
	// The existing Studio Push payload uses JSON strings rather than typed values.
	legacy, err := client.UpdateIssue(ctx, created.ID, map[string]any{"acceptance_criteria": `["legacy"]`, "attachments": `[{"kind":"file","path":"README.md"}]`, "agent_guidance": `{"effort":"high"}`})
	if err != nil {
		t.Fatal(err)
	}
	if legacy.AcceptanceCriteria[0] != "legacy" || legacy.Attachments[0].Path != "README.md" || legacy.AgentGuidance["effort"] != "high" {
		t.Fatalf("legacy payload lost: %+v", legacy)
	}
}

func TestInvalidMetadataOrUnknownFieldsCannotPartlyUpdateIssue(t *testing.T) {
	ctx := context.Background()
	client := NewClient(openFixture(t, filepath.Join(t.TempDir(), "fixture.db")), nil)
	created, err := client.CreateIssue(ctx, "Original", "Body", "Backlog", 0, "", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	for name, patch := range map[string]map[string]any{
		"unknown":                  {"title": "Changed", "suggested_model": "unsupported"},
		"invalid criteria":         {"title": "Changed", "acceptance_criteria": `{}`},
		"invalid attachment":       {"title": "Changed", "attachments": `["invalid"]`},
		"invalid guidance":         {"title": "Changed", "agent_guidance": `[]`},
		"malformed JSON":           {"title": "Changed", "agent_guidance": `{`},
		"null criterion":           {"title": "Changed", "acceptance_criteria": `[null]`},
		"null attachment":          {"title": "Changed", "attachments": `[null]`},
		"missing kind":             {"title": "Changed", "attachments": `[{"path":"src/main.go"}]`},
		"invalid kind":             {"title": "Changed", "attachments": `[{"kind":"image","path":"src/main.go"}]`},
		"missing file path":        {"title": "Changed", "attachments": `[{"kind":"file"}]`},
		"invalid file path type":   {"title": "Changed", "attachments": `[{"kind":"file","path":42}]`},
		"blank file path":          {"title": "Changed", "attachments": []tracker.Attachment{{Kind: "file", Path: " "}}},
		"file with URL":            {"title": "Changed", "attachments": `[{"kind":"file","path":"src/main.go","url":"https://example.test"}]`},
		"missing link URL":         {"title": "Changed", "attachments": `[{"kind":"link"}]`},
		"invalid link URL type":    {"title": "Changed", "attachments": `[{"kind":"link","url":42}]`},
		"blank link URL":           {"title": "Changed", "attachments": []tracker.Attachment{{Kind: "link", URL: " "}}},
		"link with path":           {"title": "Changed", "attachments": `[{"kind":"link","url":"https://example.test","path":"src/main.go"}]`},
		"unknown attachment field": {"title": "Changed", "attachments": `[{"kind":"file","path":"src/main.go","secret":"ignored"}]`},
		"null attachment field":    {"title": "Changed", "attachments": `[{"kind":"link","url":"https://example.test","label":null}]`},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := client.UpdateIssue(ctx, created.ID, patch); err == nil {
				t.Fatal("invalid update succeeded")
			}
			stored, err := client.FetchIssueByIdentifier(ctx, created.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Title != "Original" {
				t.Fatalf("partial update: %+v", stored)
			}
		})
	}
	cleared, err := client.UpdateIssue(ctx, created.ID, map[string]any{"acceptance_criteria": nil, "attachments": "null", "agent_guidance": nil})
	if err != nil {
		t.Fatal(err)
	}
	if len(cleared.AcceptanceCriteria) != 0 || len(cleared.Attachments) != 0 || len(cleared.AgentGuidance) != 0 {
		t.Fatalf("clear failed: %+v", cleared)
	}
}

func TestCorruptStoredMetadataReturnsVisibleError(t *testing.T) {
	ctx := context.Background()
	database := openFixture(t, filepath.Join(t.TempDir(), "fixture.db"))
	client := NewClient(database, nil)
	created, err := client.CreateIssue(ctx, "Original", "Body", "Backlog", 0, "", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, "UPDATE issues SET agent_guidance = ? WHERE id = ?", "invalid JSON", created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := client.FetchIssueByIdentifier(ctx, created.ID); err == nil || !strings.Contains(err.Error(), "agent_guidance") {
		t.Fatalf("corruption hidden: %v", err)
	}
}
