package workspacechat

import (
	"context"
	"errors"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/harnessaccounts"
)

func TestConversationKeepsAccountAfterActiveSelectionChanges(t *testing.T) {
	runner := &recordingRunner{output: "done"}
	chat, _, projectID, _ := fixture(t, runner)
	accounts, err := harnessaccounts.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	first, _, _ := accounts.BeginCodex("first")
	_, _ = accounts.Complete(first.ID)
	second, _, _ := accounts.BeginCodex("second")
	_, _ = accounts.Complete(second.ID)
	registry := chat.registry.(*agents.Registry)
	registry.SetAccountStore(accounts)
	selection, err := accounts.Select("CODEX", first.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	old, err := chat.Create(ctx, projectID, "CODEX", "old")
	if err != nil {
		t.Fatal(err)
	}
	if old.AccountID != first.ID {
		t.Fatalf("old account = %q", old.AccountID)
	}
	if _, err := accounts.Select("CODEX", second.ID, selection.Version); err != nil {
		t.Fatal(err)
	}
	newer, err := chat.Create(ctx, projectID, "CODEX", "new")
	if err != nil {
		t.Fatal(err)
	}
	if newer.AccountID != second.ID {
		t.Fatalf("new account = %q", newer.AccountID)
	}
	if _, err := chat.Send(ctx, projectID, old.ID, SendRequest{ClientMessageID: "old-1", Text: "hello"}); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, chat, projectID, old.ID)
	if _, err := chat.Send(ctx, projectID, newer.ID, SendRequest{ClientMessageID: "new-1", Text: "hello"}); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, chat, projectID, newer.ID)
	runner.mu.Lock()
	defer runner.mu.Unlock()
	if len(runner.calls) != 2 || runner.calls[0].AccountID != first.ID || runner.calls[1].AccountID != second.ID {
		t.Fatalf("conversation account drifted: %+v", runner.calls)
	}
}

func TestRemovedAccountPreservesConversationButRejectsNewMessages(t *testing.T) {
	chat, _, projectID, _ := fixture(t, &recordingRunner{output: "done"})
	accounts, err := harnessaccounts.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	account, _, err := accounts.BeginCodex("temporary")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = accounts.Complete(account.ID); err != nil {
		t.Fatal(err)
	}
	chat.registry.(*agents.Registry).SetAccountStore(accounts)
	selected, err := accounts.Select("CODEX", account.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	session, err := chat.Create(ctx, projectID, "CODEX", "history")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = accounts.Select("CODEX", "", selected.Version); err != nil {
		t.Fatal(err)
	}
	if err = chat.RemoveIdleAccount(ctx, account.ID, func() error { return accounts.Remove(account.ID) }); err != nil {
		t.Fatal(err)
	}
	if _, err = chat.Detail(ctx, projectID, session.ID); err != nil {
		t.Fatalf("history unavailable: %v", err)
	}
	if _, err = chat.Send(ctx, projectID, session.ID, SendRequest{ClientMessageID: "after-removal", Text: "hello"}); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("send after removal = %v", err)
	}
}
