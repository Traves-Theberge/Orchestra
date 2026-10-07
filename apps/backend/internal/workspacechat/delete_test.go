package workspacechat

import (
	"context"
	"errors"
	"testing"
)

func TestDeleteRemovesConversationAndRefusesWhileRunning(t *testing.T) {
	r := &recordingRunner{output: `{"type":"result","result":"done"}`}
	s, database, pid, _ := fixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "a", Text: "hi"}); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, s, pid, sess.ID)
	if err = s.Delete(ctx, pid, sess.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Detail(ctx, pid, sess.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted conversation still readable: %v", err)
	}
	for _, table := range append([]string{"workspace_chat_messages", "workspace_chat_sessions"}, chatSessionTables...) {
		column := "session_id"
		if table == "workspace_chat_sessions" {
			column = "id"
		}
		var n int
		if err := database.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE `+column+`=?`, sess.ID).Scan(&n); err != nil && !missingTable(err) {
			t.Fatal(table, err)
		}
		if n != 0 {
			t.Fatalf("%s kept %d rows", table, n)
		}
	}
	if err = s.Delete(ctx, pid, sess.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}

	block := make(chan struct{})
	r.block = block
	busy, _ := s.Create(ctx, pid, "codex", "")
	if _, err = s.Send(ctx, pid, busy.ID, SendRequest{ClientMessageID: "b", Text: "wait"}); err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(ctx, pid, busy.ID); !errors.Is(err, ErrBusy) {
		t.Fatalf("running conversation deleted: %v", err)
	}
	close(block)
	awaitIdle(t, s, pid, busy.ID)
}
