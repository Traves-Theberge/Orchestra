package workspacechat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

func claudeLine(t *testing.T, line string) agents.Event {
	t.Helper()
	var raw map[string]any
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		t.Fatal(err)
	}
	return agents.Event{Provider: agents.ProviderClaude, Raw: raw}
}

func TestClaudeReasoningStreamsThenCompletesFromSnapshot(t *testing.T) {
	r := newReasoningStream("turn")
	var got []agents.NativeEvent
	for _, line := range []string{
		`{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_1"}}}`,
		`{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Count "}}}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"tilings"}}}`,
		`{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"34"}}}`,
		`{"type":"assistant","message":{"id":"msg_1","content":[{"type":"thinking","thinking":"Count tilings","signature":"sig"}]}}`,
		`{"type":"assistant","message":{"id":"msg_1","content":[{"type":"text","text":"34"}]}}`,
		`{"type":"assistant","parent_tool_use_id":"tool_9","message":{"id":"msg_sub","content":[{"type":"thinking","thinking":"subagent"}]}}`,
		`{"type":"assistant","message":{"id":"msg_2","content":[{"type":"redacted_thinking","data":"x"},{"type":"thinking","thinking":"  "}]}}`,
	} {
		got = append(got, r.events(claudeLine(t, line))...)
	}
	want := []struct{ kind, id, delta string }{
		{"item/started", "msg_1:thinking:0", ""},
		{"item/reasoning/summaryTextDelta", "msg_1:thinking:0", "Count "},
		{"item/reasoning/summaryTextDelta", "msg_1:thinking:0", "tilings"},
		{"item/completed", "msg_1:thinking:0", ""},
		{"item/completed", "msg_2:thinking:0", ""},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d events: %+v", len(got), got)
	}
	for i, w := range want {
		if got[i].Type != w.kind || got[i].ItemID != w.id || got[i].Delta != w.delta || got[i].TurnID != "turn" {
			t.Fatalf("event %d = %+v, want %+v", i, got[i], w)
		}
	}
	var completed struct {
		Item struct {
			Type    string   `json:"type"`
			Summary []string `json:"summary"`
		} `json:"item"`
	}
	if err := json.Unmarshal(got[3].Payload, &completed); err != nil || completed.Item.Type != "reasoning" || len(completed.Item.Summary) != 1 || completed.Item.Summary[0] != "Count tilings" {
		t.Fatal(string(got[3].Payload), err)
	}
	if err := json.Unmarshal(got[4].Payload, &completed); err != nil || len(completed.Item.Summary) != 0 {
		t.Fatal("blank thinking must complete without text", string(got[4].Payload))
	}
}

func TestOpenCodeReasoningAndOtherProvidersIgnored(t *testing.T) {
	r := newReasoningStream("turn")
	got := r.events(agents.Event{Provider: agents.ProviderOpenCode, Raw: map[string]any{"type": "reasoning", "part": map[string]any{"id": "prt_1", "text": "Plan the fix"}}})
	if len(got) != 1 || got[0].Type != "item/completed" || got[0].ItemID != "prt_1" {
		t.Fatal(got)
	}
	if got := r.events(agents.Event{Provider: agents.ProviderOpenCode, Raw: map[string]any{"type": "reasoning", "part": map[string]any{"text": ""}}}); len(got) != 0 {
		t.Fatal("empty reasoning emitted", got)
	}
	if got := r.events(agents.Event{Provider: agents.ProviderGemini, Raw: map[string]any{"type": "assistant"}}); len(got) != 0 {
		t.Fatal(got)
	}
}

func TestCommandTurnPersistsHarnessReasoning(t *testing.T) {
	thinking := claudeLine(t, `{"type":"assistant","message":{"id":"msg_1","content":[{"type":"thinking","thinking":"Weigh both options"}]}}`)
	r := &recordingRunner{output: `{"type":"result","result":"Done"}`, events: []agents.Event{thinking}}
	s, _, pid, _ := fixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "a", Text: "decide"}); err != nil {
		t.Fatal(err)
	}
	d := awaitIdle(t, s, pid, sess.ID)
	r.mu.Lock()
	streamed := len(r.calls) == 1 && r.calls[0].StreamReasoning
	r.mu.Unlock()
	if !streamed {
		t.Fatal("chat turn did not request reasoning stream")
	}
	if len(d.Events) != 1 || d.Events[0].Type != "item/completed" || d.Events[0].ItemID != "msg_1:thinking:0" || !strings.Contains(string(d.Events[0].Payload), "Weigh both options") {
		t.Fatal(d.Events)
	}
}

func TestProjectChatSendsVisualInstructions(t *testing.T) {
	r := &recordingRunner{output: `{"type":"result","result":"ok"}`}
	s, _, pid, _ := fixture(t, r)
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "a", Text: "mock it"}); err != nil {
		t.Fatal(err)
	}
	awaitIdle(t, s, pid, sess.ID)
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.calls) != 1 || !strings.Contains(r.calls[0].DeveloperInstructions, "```orchestra-html") {
		t.Fatal(r.calls)
	}
}

func TestLegacyHtmlFencesAreRewritten(t *testing.T) {
	r := &recordingRunner{}
	s, database, _, _ := fixture(t, r)
	if _, err := database.Exec("INSERT INTO workspace_chat_messages(id,session_id,role,text,status,created_at) VALUES('m','s','assistant','see\n```t3-html\n<p>x</p>\n```','completed','')"); err != nil {
		t.Fatal(err)
	}
	s.Close()
	if _, err := New(database, s.registry, s.roots); err != nil {
		t.Fatal(err)
	}
	var text string
	if err := database.QueryRow("SELECT text FROM workspace_chat_messages WHERE id='m'").Scan(&text); err != nil || !strings.Contains(text, "```orchestra-html") || strings.Contains(text, "t3-html") {
		t.Fatal(text, err)
	}
}

func TestAssistantTextReadsOpenCodeJSONEvents(t *testing.T) {
	raw := `{"type":"step_start","part":{"type":"step-start"}}
{"type":"text","part":{"type":"text","text":"oc json ok"}}
{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}`
	if got := assistantText(raw); got != "oc json ok" {
		t.Fatalf("got %q", got)
	}
}
