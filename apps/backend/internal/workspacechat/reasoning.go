package workspacechat

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

// reasoningStream converts a command harness's stream into the reasoning
// events native Codex already records (item/started, summary deltas,
// item/completed with a string summary), so the UI renders one shape.
// Empty reasoning is never emitted.
type reasoningStream struct {
	mu       sync.Mutex // stdout and stderr parse on separate goroutines
	turnID   string
	message  string
	blocks   map[string]string // stream content-block index -> item id
	streamed map[string]int    // message id -> thinking blocks started by the stream
	snapshot map[string]int    // message id -> thinking blocks seen in full messages
	ordinal  int
}

func newReasoningStream(turnID string) *reasoningStream {
	return &reasoningStream{turnID: turnID, blocks: map[string]string{}, streamed: map[string]int{}, snapshot: map[string]int{}}
}

func (r *reasoningStream) events(e agents.Event) []agents.NativeEvent {
	if e.Raw == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	switch e.Provider {
	case agents.ProviderClaude, agents.Provider8gent:
		return r.claude(e.Raw)
	case agents.ProviderOpenCode:
		return r.opencode(e.Raw)
	}
	return nil
}

// claude reads Claude Code stream-json. With --include-partial-messages,
// thinking streams as content_block_start/thinking_delta; every run also
// emits full assistant messages, which are authoritative. Blocks are matched
// by their thinking ordinal within a message id because Claude Code splits one
// API message across several assistant lines. Subagent output is skipped.
func (r *reasoningStream) claude(raw map[string]any) []agents.NativeEvent {
	if parent, _ := raw["parent_tool_use_id"].(string); parent != "" {
		return nil
	}
	switch raw["type"] {
	case "stream_event":
		ev, _ := raw["event"].(map[string]any)
		index := fmt.Sprint(ev["index"])
		switch ev["type"] {
		case "message_start":
			msg, _ := ev["message"].(map[string]any)
			r.message, _ = msg["id"].(string)
			r.blocks = map[string]string{}
		case "content_block_start":
			block, _ := ev["content_block"].(map[string]any)
			if block["type"] != "thinking" || r.message == "" {
				return nil
			}
			id := fmt.Sprintf("%s:thinking:%d", r.message, r.streamed[r.message])
			r.streamed[r.message]++
			r.blocks[index] = id
			out := []agents.NativeEvent{r.item("item/started", id, nil)}
			if text, _ := block["thinking"].(string); text != "" {
				out = append(out, r.delta(id, text))
			}
			return out
		case "content_block_delta":
			delta, _ := ev["delta"].(map[string]any)
			id := r.blocks[index]
			text, _ := delta["thinking"].(string)
			if delta["type"] != "thinking_delta" || id == "" || text == "" {
				return nil
			}
			return []agents.NativeEvent{r.delta(id, text)}
		}
	case "assistant":
		msg, _ := raw["message"].(map[string]any)
		content, _ := msg["content"].([]any)
		messageID, _ := msg["id"].(string)
		var out []agents.NativeEvent
		for _, part := range content {
			block, _ := part.(map[string]any)
			if block["type"] != "thinking" {
				continue
			}
			var id string
			if messageID != "" {
				id = fmt.Sprintf("%s:thinking:%d", messageID, r.snapshot[messageID])
				r.snapshot[messageID]++
			} else {
				id = r.next()
			}
			text, _ := block["thinking"].(string)
			if strings.TrimSpace(text) == "" {
				// Keep whatever streamed; the UI drops it if nothing did.
				out = append(out, r.item("item/completed", id, nil))
				continue
			}
			out = append(out, r.item("item/completed", id, []string{text}))
		}
		return out
	}
	return nil
}

// opencode reads `opencode run --format json`, whose reasoning parts arrive
// as complete events.
func (r *reasoningStream) opencode(raw map[string]any) []agents.NativeEvent {
	if raw["type"] != "reasoning" {
		return nil
	}
	part, _ := raw["part"].(map[string]any)
	if part == nil {
		part = raw
	}
	text, _ := part["text"].(string)
	if strings.TrimSpace(text) == "" {
		return nil
	}
	id, _ := part["id"].(string)
	if id == "" {
		id = r.next()
	}
	return []agents.NativeEvent{r.item("item/completed", id, []string{text})}
}

func (r *reasoningStream) next() string {
	r.ordinal++
	return fmt.Sprintf("%s:reasoning:%d", r.turnID, r.ordinal)
}

func (r *reasoningStream) item(kind, id string, summary []string) agents.NativeEvent {
	if summary == nil {
		summary = []string{}
	}
	payload, _ := json.Marshal(map[string]any{"item": map[string]any{"id": id, "type": "reasoning", "summary": summary, "content": []string{}}})
	return agents.NativeEvent{Type: kind, TurnID: r.turnID, ItemID: id, Payload: payload}
}

func (r *reasoningStream) delta(id, text string) agents.NativeEvent {
	payload, _ := json.Marshal(map[string]any{"itemId": id, "delta": text, "summaryIndex": 0})
	return agents.NativeEvent{Type: "item/reasoning/summaryTextDelta", TurnID: r.turnID, ItemID: id, Delta: text, Payload: payload}
}
