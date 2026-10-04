package studio

import (
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

func TestDraftPatchSurvivesDatabaseReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "studio.db")
	d, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if _, err := d.Exec(db.Schema); err != nil {
		t.Fatal(err)
	}
	m := NewManager(d, nil, nil)
	sess, err := m.StartSession(context.Background(), StartSessionRequest{Runner: "fake"})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.ApplyDraftPatch(sess.ID, map[string]any{"suggested_model": "requested", "max_turns": 3, "acceptance_criteria": []string{"passes"}, "attachments": []Attachment{{Kind: "file", Path: "x.go"}}}); err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	d, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	m = NewManager(d, nil, nil)
	snap, err := m.GetDraft(sess.ID)
	if err != nil || snap.SuggestedModel != "requested" || snap.MaxTurns == nil || *snap.MaxTurns != 3 || len(snap.AcceptanceCriteria) != 1 || len(snap.Attachments) != 1 {
		t.Fatalf("database reopen lost draft: %+v %v", snap, err)
	}
	if err := m.ApplyDraftPatch(sess.ID, map[string]any{"max_turns": nil}); err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	d, err = sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	snap, err = NewManager(d, nil, nil).GetDraft(sess.ID)
	if err != nil || snap.MaxTurns != nil || snap.SuggestedModel != "requested" {
		t.Fatalf("database reopen lost inherited limit: %+v %v", snap, err)
	}
}

func TestDraftPatchInvalidChangesNothing(t *testing.T) {
	invalid := []any{0, -1, 101, 1.5, math.Inf(1), math.NaN(), "2", true, json.Number("999999999999999999999"), json.Number("1.0000000000000000001")}
	for _, value := range invalid {
		m := newTestManager(t)
		sess, err := m.StartSession(context.Background(), StartSessionRequest{Runner: "fake"})
		if err != nil {
			t.Fatal(err)
		}
		if err := m.SetTitle(sess.ID, "original"); err != nil {
			t.Fatal(err)
		}
		before, _ := m.GetDraft(sess.ID)
		if err := m.ApplyDraftPatch(sess.ID, map[string]any{"title": "changed", "max_turns": value}); err == nil {
			t.Fatalf("accepted %v", value)
		}
		after, _ := m.GetDraft(sess.ID)
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("invalid patch persisted: %+v", after)
		}
	}
}

func TestDraftPatchClearAndListsReload(t *testing.T) {
	m := newTestManager(t)
	sess, _ := m.StartSession(context.Background(), StartSessionRequest{Runner: "fake"})
	patch := map[string]any{"title": "task", "suggested_provider": "ANTIGRAVITY", "suggested_model": "requested", "max_turns": json.Number("4"), "acceptance_criteria": []string{"test passes"}, "attachments": []Attachment{{Kind: "file", Path: "src/main.go"}, {Kind: "link", URL: "https://example.com", Label: "reference"}}}
	if err := m.ApplyDraftPatch(sess.ID, patch); err != nil {
		t.Fatal(err)
	}
	// A fresh Manager reads storage; no in-memory draft cache can satisfy this.
	reloaded := NewManager(m.d, nil, nil)
	snap, err := reloaded.GetDraft(sess.ID)
	if err != nil || snap.MaxTurns == nil || *snap.MaxTurns != 4 || len(snap.AcceptanceCriteria) != 1 || len(snap.Attachments) != 2 || snap.SuggestedModel != "requested" {
		t.Fatalf("reload: %+v %v", snap, err)
	}
	if err := m.ApplyDraftPatch(sess.ID, map[string]any{"max_turns": nil, "attachments": []Attachment{}, "acceptance_criteria": []string{}}); err != nil {
		t.Fatal(err)
	}
	snap, err = reloaded.GetDraft(sess.ID)
	if err != nil || snap.MaxTurns != nil || len(snap.Attachments) != 0 || len(snap.AcceptanceCriteria) != 0 || snap.Title != "task" {
		t.Fatalf("clear reload: %+v %v", snap, err)
	}
	raw, _ := json.Marshal(snap)
	var output map[string]any
	_ = json.Unmarshal(raw, &output)
	value, exists := output["max_turns"]
	if !exists || value != nil {
		t.Fatalf("canonical null missing: %s", raw)
	}
}

func TestDraftPatchTypeAndStorageFailuresAreAtomic(t *testing.T) {
	m := newTestManager(t)
	sess, _ := m.StartSession(context.Background(), StartSessionRequest{Runner: "fake"})
	for _, patch := range []map[string]any{
		{"title": 42}, {"title": "changed", "unknown": true}, {"acceptance_criteria": []any{nil}}, {"acceptance_criteria": nil},
		{"attachments": []any{map[string]any{"kind": "file", "path": "x", "unknown": true}}}, {"attachments": []Attachment{{Kind: "link"}}},
	} {
		if err := m.ApplyDraftPatch(sess.ID, patch); err == nil {
			t.Fatalf("accepted %+v", patch)
		}
	}
	if _, err := m.d.Exec(`CREATE TRIGGER reject_patch BEFORE UPDATE ON issue_drafts WHEN NEW.description='reject' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`); err != nil {
		t.Fatal(err)
	}
	if err := m.ApplyDraftPatch(sess.ID, map[string]any{"title": "changed", "description": "reject", "max_turns": 2}); err == nil {
		t.Fatal("expected storage failure")
	}
	snap, _ := m.GetDraft(sess.ID)
	if snap.Title != "" || snap.Description != "" || snap.MaxTurns != nil {
		t.Fatalf("partial storage update: %+v", snap)
	}
	if err := m.ApplyDraftPatch("missing", map[string]any{"title": "x"}); err == nil {
		t.Fatal("missing draft accepted")
	}
	for _, turns := range []int{0, -1, 101} {
		if err := m.SetMaxTurns(sess.ID, turns); err == nil {
			t.Fatalf("direct setter accepted %d", turns)
		}
	}
}
