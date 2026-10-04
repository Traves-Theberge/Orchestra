package workspacechat

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

func TestClientConversationIdentityCreateReceiptAndRecovery(t *testing.T) {
	s, database, native, pid := nativeFixture(t)
	ctx := context.Background()
	id := "789689db-2267-43df-a13c-656a011e9078"
	req := CreateRequest{Provider: "codex", Title: "First conversation", ClientSessionID: id}
	first, e := s.CreateWithRequest(ctx, pid, req)
	if e != nil || first.ID != id {
		t.Fatal(first, e)
	}
	req.Title = "Ignored retry title"
	req.Provider = " CODEX "
	req.ClientSessionID = strings.ToUpper(id)
	receipt, e := s.CreateWithRequest(ctx, pid, req)
	if e != nil || receipt != first {
		t.Fatal(receipt, e)
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v, e := s.CreateWithRequest(ctx, pid, req)
			if e != nil || v.ID != id {
				t.Errorf("receipt %v %v", v, e)
			}
		}()
	}
	wg.Wait()
	if _, e = s.CreateWithRequest(ctx, pid, CreateRequest{Provider: "claude", ClientSessionID: id}); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
	otherPath := t.TempDir()
	other, e := database.UpsertProject(ctx, otherPath, "")
	if e != nil {
		t.Fatal(e)
	}
	s.roots = append(s.roots, otherPath)
	if _, e = s.CreateWithRequest(ctx, other, CreateRequest{Provider: "codex", ClientSessionID: id}); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
	var count int
	if e = database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_sessions`).Scan(&count); e != nil || count != 1 || len(native.starts) != 0 {
		t.Fatal(count, e, native.starts)
	}
	s.Close()
	restored, e := New(database, native, s.roots)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.Close()
	receipt, e = restored.CreateWithRequest(ctx, pid, req)
	if e != nil || receipt != first {
		t.Fatal(receipt, e)
	}
	detail, e := restored.Detail(ctx, pid, id)
	if e != nil || detail.Session.ID != id || len(detail.Messages) != 0 {
		t.Fatal(detail, e)
	}
}

func TestClientConversationIdentityRejectsMalformedWithoutRows(t *testing.T) {
	s, database, _, pid := nativeFixture(t)
	for _, id := range []string{"not-a-uuid", "00000000-0000-0000-0000-000000000000", "{789689db-2267-43df-a13c-656a011e9078}", "789689db226743dfa13c656a011e9078"} {
		if _, e := s.CreateWithRequest(context.Background(), pid, CreateRequest{Provider: "codex", ClientSessionID: id}); !errors.Is(e, ErrInvalid) {
			t.Fatal(id, e)
		}
	}
	var count int
	if e := database.QueryRow(`SELECT COUNT(*) FROM workspace_chat_sessions`).Scan(&count); e != nil || count != 0 {
		t.Fatal(count, e)
	}
	first, e := s.Create(context.Background(), pid, "codex", "")
	if e != nil {
		t.Fatal(e)
	}
	second, e := s.Create(context.Background(), pid, "codex", "")
	if e != nil || first.ID == second.ID {
		t.Fatal(first, second, e)
	}
}
