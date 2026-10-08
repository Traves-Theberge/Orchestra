package workspacechat

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

func insertBranchMessage(t *testing.T, database *db.DB, id, sessionID, branchID, createdAt string) int64 {
	t.Helper()
	res, err := database.Exec(`INSERT INTO workspace_chat_messages(id,session_id,role,text,status,created_at,branch_id) VALUES(?,?,'user',?,'completed',?,?)`, id, sessionID, id, createdAt, branchID)
	if err != nil {
		t.Fatal(err)
	}
	ordinal, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return ordinal
}

func insertBranchEvent(t *testing.T, database *db.DB, sessionID, branchID, createdAt string) int64 {
	t.Helper()
	res, err := database.Exec(`INSERT INTO workspace_chat_events(session_id,event,created_at,branch_id) VALUES(?,'{"type":"item/agentMessage/delta"}',?,?)`, sessionID, createdAt, branchID)
	if err != nil {
		t.Fatal(err)
	}
	sequence, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return sequence
}

func newBranch(t *testing.T, s *Service, sessionID, parentID string, forkAfterOrdinal int64, forkAfterTime string) Branch {
	t.Helper()
	ctx := context.Background()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	b, err := s.createBranch(ctx, tx, sessionID, parentID, forkAfterOrdinal, forkAfterTime)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return b
}

func activate(t *testing.T, database *db.DB, sessionID, branchID string) {
	t.Helper()
	if _, err := database.Exec(`INSERT INTO workspace_chat_active_branch(session_id,branch_id) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET branch_id=excluded.branch_id`, sessionID, branchID); err != nil {
		t.Fatal(err)
	}
}

func messageIDs(d Detail) []string {
	ids := []string{}
	for _, m := range d.Messages {
		ids = append(ids, m.ID)
	}
	return ids
}

func TestExistingConversationsAreUnchangedByMigration(t *testing.T) {
	s, database, r, pid := nativeFixture(t)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"one", "two"} {
		if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: text, Text: text}); err != nil {
			t.Fatal(err)
		}
		awaitIdle(t, s, pid, sess.ID)
	}
	before, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Messages) != 4 || len(before.Events) == 0 {
		t.Fatalf("fixture: %d messages, %d events", len(before.Messages), len(before.Events))
	}
	s.Close()
	// Return the database to its pre-branch shape, then migrate again.
	for _, stmt := range []string{
		`ALTER TABLE workspace_chat_messages DROP COLUMN branch_id`,
		`ALTER TABLE workspace_chat_events DROP COLUMN branch_id`,
		`ALTER TABLE workspace_chat_requests DROP COLUMN branch_id`,
		`DROP TABLE workspace_chat_branches`,
		`DROP TABLE workspace_chat_active_branch`,
		`DROP TABLE workspace_chat_checkpoints`,
		`DROP TABLE workspace_chat_branch_seed`,
	} {
		if _, err = database.Exec(stmt); err != nil {
			t.Fatal(stmt, err)
		}
	}
	migrated, err := New(database, r, s.roots)
	if err != nil {
		t.Fatal(err)
	}
	defer migrated.Close()
	after, err := migrated.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before.Messages, after.Messages) || !reflect.DeepEqual(before.Events, after.Events) || before.Cursor != after.Cursor {
		t.Fatalf("migration changed history:\nbefore %#v\nafter  %#v", before, after)
	}
	if active, err := migrated.activeBranchID(ctx, sess.ID); err != nil || active != sess.ID {
		t.Fatalf("legacy active branch = %q, %v", active, err)
	}
}

func TestDetailShowsOnlyTheActiveBranch(t *testing.T) {
	s, database, _, pid := nativeFixture(t)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	insertBranchMessage(t, database, "m1", sess.ID, "", "2026-01-01T00:00:01Z")
	m2 := insertBranchMessage(t, database, "m2", sess.ID, "", "2026-01-01T00:00:02Z")
	insertBranchMessage(t, database, "m3", sess.ID, "", "2026-01-01T00:00:03Z")
	insertBranchMessage(t, database, "m4", sess.ID, "", "2026-01-01T00:00:04Z")
	b := newBranch(t, s, sess.ID, sess.ID, m2, "2026-01-01T00:00:02Z")
	insertBranchMessage(t, database, "b1", sess.ID, b.ID, "2026-01-01T00:00:05Z")
	insertBranchMessage(t, database, "b2", sess.ID, b.ID, "2026-01-01T00:00:06Z")
	activate(t, database, sess.ID, b.ID)
	d, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := messageIDs(d); !reflect.DeepEqual(got, []string{"m1", "m2", "b1", "b2"}) {
		t.Fatalf("branch view = %v", got)
	}
	activate(t, database, sess.ID, sess.ID)
	d, err = s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := messageIDs(d); !reflect.DeepEqual(got, []string{"m1", "m2", "m3", "m4"}) {
		t.Fatalf("main view = %v", got)
	}
	// A branch of a branch that forks inside inherited history sees only the
	// shared prefix, never the intermediate branch's own messages.
	m1Ordinal := int64(0)
	if err = database.QueryRow(`SELECT ordinal FROM workspace_chat_messages WHERE id='m1'`).Scan(&m1Ordinal); err != nil {
		t.Fatal(err)
	}
	c := newBranch(t, s, sess.ID, b.ID, m1Ordinal, "2026-01-01T00:00:01Z")
	insertBranchMessage(t, database, "c1", sess.ID, c.ID, "2026-01-01T00:00:07Z")
	activate(t, database, sess.ID, c.ID)
	d, err = s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := messageIDs(d); !reflect.DeepEqual(got, []string{"m1", "c1"}) {
		t.Fatalf("nested view = %v", got)
	}
}

func TestEventsFollowTheirBranch(t *testing.T) {
	s, database, _, pid := nativeFixture(t)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	insertBranchMessage(t, database, "m1", sess.ID, "", "2026-01-01T00:00:01Z")
	m2 := insertBranchMessage(t, database, "m2", sess.ID, "", "2026-01-01T00:00:03Z")
	before := insertBranchEvent(t, database, sess.ID, "", "2026-01-01T00:00:02Z")
	b := newBranch(t, s, sess.ID, sess.ID, m2, "2026-01-01T00:00:03Z")
	own := insertBranchEvent(t, database, sess.ID, b.ID, "2026-01-01T00:00:06Z")
	hidden := insertBranchEvent(t, database, sess.ID, "", "2026-01-01T00:00:05Z")
	activate(t, database, sess.ID, b.ID)
	d, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	var got []int64
	for _, e := range d.Events {
		got = append(got, e.Sequence)
	}
	if !reflect.DeepEqual(got, []int64{before, own}) {
		t.Fatalf("branch events = %v, want %v", got, []int64{before, own})
	}
	if d.Cursor != hidden {
		t.Fatalf("cursor = %d, want max sequence %d", d.Cursor, hidden)
	}
	poll, err := s.DetailAfter(ctx, pid, sess.ID, d.Cursor)
	if err != nil {
		t.Fatal(err)
	}
	if len(poll.Events) != 0 || poll.Cursor != hidden {
		t.Fatalf("poll after cursor: %d events, cursor %d", len(poll.Events), poll.Cursor)
	}
	activate(t, database, sess.ID, sess.ID)
	d, err = s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	got = nil
	for _, e := range d.Events {
		got = append(got, e.Sequence)
	}
	if !reflect.DeepEqual(got, []int64{before, hidden}) {
		t.Fatalf("main events = %v", got)
	}
}

func TestVersionsListedOnForkingMessages(t *testing.T) {
	s, database, _, pid := nativeFixture(t)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	insertBranchMessage(t, database, "m1", sess.ID, "", "2026-01-01T00:00:01Z")
	m2 := insertBranchMessage(t, database, "m2", sess.ID, "", "2026-01-01T00:00:02Z")
	insertBranchMessage(t, database, "m3", sess.ID, "", "2026-01-01T00:00:03Z")
	insertBranchMessage(t, database, "m4", sess.ID, "", "2026-01-01T00:00:04Z")
	b := newBranch(t, s, sess.ID, sess.ID, m2, "2026-01-01T00:00:02Z")
	insertBranchMessage(t, database, "b1", sess.ID, b.ID, "2026-01-01T00:00:05Z")
	insertBranchMessage(t, database, "b2", sess.ID, b.ID, "2026-01-01T00:00:06Z")
	if err = s.saveCheckpoint(ctx, Checkpoint{SessionID: sess.ID, BranchID: b.ID, MessageID: "b1", Kind: "before", TreeHash: "tree"}); err != nil {
		t.Fatal(err)
	}
	check := func(want map[string][]VersionRef) {
		t.Helper()
		d, err := s.Detail(ctx, pid, sess.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range d.Messages {
			if !reflect.DeepEqual(m.Versions, want[m.ID]) {
				t.Fatalf("%s versions = %#v, want %#v", m.ID, m.Versions, want[m.ID])
			}
			if m.HasCheckpoint != (m.ID == "b1") {
				t.Fatalf("%s has_checkpoint = %v", m.ID, m.HasCheckpoint)
			}
		}
	}
	check(map[string][]VersionRef{"m3": {{BranchID: sess.ID, Active: true}, {BranchID: b.ID}}})
	activate(t, database, sess.ID, b.ID)
	check(map[string][]VersionRef{"b1": {{BranchID: sess.ID}, {BranchID: b.ID, Active: true}}})
}

func TestDeleteRemovesBranchesCheckpointsAndSeed(t *testing.T) {
	s, database, _, pid := nativeFixture(t)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "a", Text: "hi"}); err != nil {
		t.Fatal(err)
	}
	d := awaitIdle(t, s, pid, sess.ID)
	b := newBranch(t, s, sess.ID, sess.ID, 0, "")
	activate(t, database, sess.ID, b.ID)
	want := Checkpoint{SessionID: sess.ID, BranchID: sess.ID, MessageID: d.Messages[0].ID, Kind: "before", TreeHash: "abc", Files: 3, Bytes: 42, Skipped: 1}
	if err = s.saveCheckpoint(ctx, want); err != nil {
		t.Fatal(err)
	}
	got, ok, err := s.checkpointFor(ctx, sess.ID, want.MessageID, "before")
	if err != nil || !ok || got.ID == "" || got.CreatedAt == "" || got.TreeHash != "abc" || got.Files != 3 || got.Bytes != 42 || got.Skipped != 1 || got.BranchID != sess.ID {
		t.Fatalf("checkpoint = %#v %v %v", got, ok, err)
	}
	if _, ok, err = s.checkpointFor(ctx, sess.ID, want.MessageID, "after"); err != nil || ok {
		t.Fatalf("missing checkpoint found: %v %v", ok, err)
	}
	if _, err = database.Exec(`INSERT INTO workspace_chat_branch_seed(session_id,created_at) VALUES(?,?)`, sess.ID, stamp()); err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(ctx, pid, sess.ID); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"workspace_chat_branches", "workspace_chat_active_branch", "workspace_chat_checkpoints", "workspace_chat_branch_seed"} {
		var n int
		if err = database.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE session_id=?`, sess.ID).Scan(&n); err != nil {
			t.Fatal(table, err)
		}
		if n != 0 {
			t.Fatalf("%s kept %d rows", table, n)
		}
	}
}

func TestSiblingViaBranchKeepsVersionsConsistentAcrossAllViews(t *testing.T) {
	s, database, _, pid := nativeFixture(t)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	insertBranchMessage(t, database, "m1", sess.ID, "", "2026-01-01T00:00:01Z")
	m2 := insertBranchMessage(t, database, "m2", sess.ID, "", "2026-01-01T00:00:02Z")
	insertBranchMessage(t, database, "m3", sess.ID, "", "2026-01-01T00:00:03Z")
	b := newBranch(t, s, sess.ID, sess.ID, m2, "2026-01-01T00:00:02Z")
	insertBranchMessage(t, database, "b1", sess.ID, b.ID, "2026-01-01T00:00:04Z")
	// Editing b1 again while viewing B forks B at a point B inherited from main.
	d := newBranch(t, s, sess.ID, b.ID, m2, "2026-01-01T00:00:02Z")
	insertBranchMessage(t, database, "d1", sess.ID, d.ID, "2026-01-01T00:00:05Z")
	views := []struct {
		active, first string
		ids           []string
	}{
		{sess.ID, "m3", []string{"m1", "m2", "m3"}},
		{b.ID, "b1", []string{"m1", "m2", "b1"}},
		{d.ID, "d1", []string{"m1", "m2", "d1"}},
	}
	for _, view := range views {
		activate(t, database, sess.ID, view.active)
		detail, err := s.Detail(ctx, pid, sess.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got := messageIDs(detail); !reflect.DeepEqual(got, view.ids) {
			t.Fatalf("view %s = %v", view.active, got)
		}
		want := []VersionRef{{BranchID: sess.ID}, {BranchID: b.ID}, {BranchID: d.ID}}
		for i := range want {
			want[i].Active = want[i].BranchID == view.active
		}
		for _, m := range detail.Messages {
			var expected []VersionRef
			if m.ID == view.first {
				expected = want
			}
			if !reflect.DeepEqual(m.Versions, expected) {
				t.Fatalf("view %s: %s versions = %#v, want %#v", view.active, m.ID, m.Versions, expected)
			}
		}
	}
}

func TestFirstMessageEditBranchShowsNoParentEventsOrMessages(t *testing.T) {
	s, database, _, pid := nativeFixture(t)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	insertBranchMessage(t, database, "m1", sess.ID, "", "2026-01-01T00:00:01Z")
	insertBranchEvent(t, database, sess.ID, "", "2026-01-01T00:00:02Z")
	insertBranchMessage(t, database, "m2", sess.ID, "", "2026-01-01T00:00:03Z")
	insertBranchEvent(t, database, sess.ID, "", "2026-01-01T00:00:04Z")
	c := newBranch(t, s, sess.ID, sess.ID, 0, "")
	insertBranchMessage(t, database, "c1", sess.ID, c.ID, "2026-01-01T00:00:05Z")
	own := insertBranchEvent(t, database, sess.ID, c.ID, "2026-01-01T00:00:06Z")
	activate(t, database, sess.ID, c.ID)
	d, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := messageIDs(d); !reflect.DeepEqual(got, []string{"c1"}) {
		t.Fatalf("messages = %v", got)
	}
	if len(d.Events) != 1 || d.Events[0].Sequence != own {
		t.Fatalf("events = %#v, want only %d", d.Events, own)
	}
}

func TestCreateBranchRejectsEmptyForkTimeWhenOrdinalPositive(t *testing.T) {
	s, _, _, pid := nativeFixture(t)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = s.createBranch(ctx, tx, sess.ID, sess.ID, 3, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty fork time accepted: %v", err)
	}
}

func TestResolvedRequestsAreScopedToTheirBranch(t *testing.T) {
	s, database, _, pid := nativeFixture(t)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	request := func(id string) {
		t.Helper()
		if err := s.recordEvent(sess.ID, agents.NativeEvent{Type: "server_request", TurnID: "turn", RequestID: id, Payload: json.RawMessage(`{"method":"item/commandExecution/requestApproval","params":{"command":"ls"}}`)}); err != nil {
			t.Fatal(err)
		}
	}
	m1 := insertBranchMessage(t, database, "m1", sess.ID, "", "2026-01-01T00:00:01Z")
	request("on-main")
	b := newBranch(t, s, sess.ID, sess.ID, m1, "2026-01-01T00:00:01Z")
	activate(t, database, sess.ID, b.ID)
	request("on-b")
	requestIDs := func() []string {
		t.Helper()
		d, err := s.Detail(ctx, pid, sess.ID)
		if err != nil {
			t.Fatal(err)
		}
		ids := []string{}
		for _, r := range d.Requests {
			ids = append(ids, r.ID)
		}
		return ids
	}
	if got := requestIDs(); !reflect.DeepEqual(got, []string{"on-b"}) {
		t.Fatalf("branch requests = %v", got)
	}
	activate(t, database, sess.ID, sess.ID)
	if got := requestIDs(); !reflect.DeepEqual(got, []string{"on-main"}) {
		t.Fatalf("main requests = %v", got)
	}
}

func TestTimeNotAfterWithDifferentFractionalDigits(t *testing.T) {
	// Lexically ".1Z" sorts after ".12Z"; as instants it is earlier.
	if !timeNotAfter("2026-01-01T00:00:05.1Z", "2026-01-01T00:00:05.12Z") {
		t.Fatal(".1 should not be after .12")
	}
	if timeNotAfter("2026-01-01T00:00:05.12Z", "2026-01-01T00:00:05.1Z") {
		t.Fatal(".12 should be after .1")
	}
	if !timeNotAfter("2026-01-01T00:00:05Z", "2026-01-01T00:00:05.000000001Z") || timeNotAfter("2026-01-01T00:00:05.5Z", "2026-01-01T00:00:05Z") {
		t.Fatal("whole-second stamps compare as instants")
	}
}

func TestDanglingActiveBranchWritesToMain(t *testing.T) {
	s, database, _, pid := nativeFixture(t)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	activate(t, database, sess.ID, "ghost")
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "a", Text: "hi"}); err != nil {
		t.Fatal(err)
	}
	d := awaitIdle(t, s, pid, sess.ID)
	if len(d.Messages) != 2 || len(d.Events) == 0 {
		t.Fatalf("turn hidden: %d messages, %d events", len(d.Messages), len(d.Events))
	}
	var dangling int
	if err = database.QueryRow(`SELECT (SELECT COUNT(*) FROM workspace_chat_messages WHERE session_id=? AND branch_id<>'')+(SELECT COUNT(*) FROM workspace_chat_events WHERE session_id=? AND branch_id<>'')`, sess.ID, sess.ID).Scan(&dangling); err != nil || dangling != 0 {
		t.Fatalf("rows tagged with a dangling branch: %d %v", dangling, err)
	}
}

func TestFinishAndSendTagTheActiveBranch(t *testing.T) {
	s, database, _, pid := nativeFixture(t)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "first", Text: "one"}); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, s, pid, sess.ID)
	var mainTagged int
	if err = database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_messages WHERE session_id=? AND branch_id=''`, sess.ID).Scan(&mainTagged); err != nil || mainTagged != 2 {
		t.Fatalf("main turn rows tagged '' = %d, %v", mainTagged, err)
	}
	var last int64
	if err = database.QueryRow(`SELECT MAX(ordinal) FROM workspace_chat_messages WHERE session_id=?`, sess.ID).Scan(&last); err != nil {
		t.Fatal(err)
	}
	b := newBranch(t, s, sess.ID, sess.ID, last, stamp())
	activate(t, database, sess.ID, b.ID)
	if _, err = database.Exec(`INSERT INTO workspace_chat_branch_seed(session_id,created_at) VALUES(?,?)`, sess.ID, stamp()); err != nil {
		t.Fatal(err)
	}
	accepted, err := s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "second", Text: "two"})
	if err != nil {
		t.Fatal(err)
	}
	d := awaitIdle(t, s, pid, sess.ID)
	if len(d.Messages) != 4 {
		t.Fatalf("branch view: %v", messageIDs(d))
	}
	rows, err := database.Query(`SELECT role,branch_id FROM workspace_chat_messages WHERE session_id=? AND ordinal>?`, sess.ID, last)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	roles := map[string]bool{}
	for rows.Next() {
		var role, branch string
		if err = rows.Scan(&role, &branch); err != nil {
			t.Fatal(err)
		}
		if branch != b.ID {
			t.Fatalf("%s row tagged %q, want %q", role, branch, b.ID)
		}
		roles[role] = true
	}
	if !roles["user"] || !roles["assistant"] {
		t.Fatalf("rows written: %v (accepted %s)", roles, accepted.Message.ID)
	}
	var untagged, seeds int
	if err = database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_events WHERE session_id=? AND sequence>(SELECT MIN(sequence) FROM workspace_chat_events WHERE session_id=? AND branch_id<>'') AND branch_id<>?`, sess.ID, sess.ID, b.ID).Scan(&untagged); err != nil {
		t.Fatal(err)
	}
	var tagged int
	if err = database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_events WHERE session_id=? AND branch_id=?`, sess.ID, b.ID).Scan(&tagged); err != nil {
		t.Fatal(err)
	}
	if tagged == 0 || untagged != 0 {
		t.Fatalf("branch turn events: %d tagged, %d not", tagged, untagged)
	}
	if err = database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_branch_seed WHERE session_id=?`, sess.ID).Scan(&seeds); err != nil || seeds != 0 {
		t.Fatalf("completed turn kept branch seed: %d %v", seeds, err)
	}
}
