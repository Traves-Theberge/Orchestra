package workspacechat

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

func TestSwitchProviderKeepsConversationAndReplaysOnce(t *testing.T) {
	s, _, r, pid := nativeFixture(t)
	r.provider = agents.ProviderClaude
	ctx := context.Background()
	sess, e := s.Create(ctx, pid, "codex", "")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "first", Text: "one"}); e != nil {
		t.Fatal(e)
	}
	awaitIdle(t, s, pid, sess.ID)
	if _, e = s.SwitchProvider(ctx, pid, sess.ID, SwitchProviderRequest{Provider: "claude", ExpectedProvider: "claude"}); !errors.Is(e, ErrConflict) {
		t.Fatal("stale expected provider accepted", e)
	}
	switched, e := s.SwitchProvider(ctx, pid, sess.ID, SwitchProviderRequest{Provider: "claude", ExpectedProvider: "codex"})
	if e != nil {
		t.Fatal(e)
	}
	if switched.ID != sess.ID || switched.Provider != string(agents.ProviderClaude) || switched.ProviderThreadID != "" || switched.ConversationMode != "native_session" {
		t.Fatal(switched)
	}
	d, e := s.Detail(ctx, pid, sess.ID)
	if e != nil {
		t.Fatal(e)
	}
	if len(d.Messages) != 2 || d.Messages[0].Provider != string(agents.ProviderCodex) || d.Messages[1].Provider != string(agents.ProviderCodex) {
		t.Fatal(d.Messages)
	}
	if _, e = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "second", Text: "two"}); e != nil {
		t.Fatal(e)
	}
	awaitIdle(t, s, pid, sess.ID)
	if _, e = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "third", Text: "three"}); e != nil {
		t.Fatal(e)
	}
	d = awaitIdle(t, s, pid, sess.ID)
	r.mu.Lock()
	starts, n := append([]string(nil), r.starts...), r.native
	r.mu.Unlock()
	if len(starts) != 2 || starts[1] != "" {
		t.Fatal("switch must start a fresh native thread", starts)
	}
	n.mu.Lock()
	texts := append([]string(nil), n.texts...)
	n.mu.Unlock()
	if len(texts) != 2 || !strings.Contains(texts[0], "continued from the CODEX harness") || !strings.Contains(texts[0], "[user]\none") || !strings.Contains(texts[0], "[assistant]\nhello") || !strings.HasSuffix(texts[0], "[user]\ntwo") {
		t.Fatal(texts)
	}
	if texts[1] != "three" {
		t.Fatal("handoff replayed more than once", texts[1])
	}
	if len(d.Messages) != 6 || d.Messages[2].Provider != string(agents.ProviderClaude) || d.Messages[5].Provider != string(agents.ProviderClaude) {
		t.Fatal(d.Messages)
	}
}

func TestHandoffTranscriptDropsOldestWithinBudget(t *testing.T) {
	messages := []Message{
		{Role: "user", Text: strings.Repeat("a", 400), Status: "completed"},
		{Role: "assistant", Text: "recent", Status: "completed"},
	}
	got := handoffTranscript(messages, "CODEX", "CLAUDE", "next", 400)
	if len(got) > 400 || strings.Contains(got, "aaaa") || !strings.Contains(got, "omitted") || !strings.Contains(got, "[assistant]\nrecent") {
		t.Fatal(got)
	}
}

func TestReplayTranscriptStripsInlineImagesAndFitsBudget(t *testing.T) {
	image := "look ![shot.png](data:image/png;base64," + strings.Repeat("A", 50_000) + ")"
	messages := []Message{
		{Role: "user", Text: strings.Repeat("old ", 10_000), Status: "completed"},
		{Role: "user", Text: image, Status: "completed"},
		{Role: "assistant", Text: "seen", Status: "completed"},
	}
	got := replayTranscript("header\n", messages, "next", replayBudget)
	if len(got) > replayBudget || strings.Contains(got, "base64") || !strings.Contains(got, "look [image: shot.png]") || strings.Contains(got, "old old") || !strings.Contains(got, "omitted") || !strings.HasSuffix(got, "[user]\nnext") {
		t.Fatal(len(got), got[:200])
	}
}
