package agents

import (
	"strings"
	"time"
)

// ompEvent classifies one `omp --mode json` line. Text, thinking and tool-call
// deltas arrive as message_update; complete assistant messages (with usage)
// as message_end. Usage is counted only from assistant message_end lines,
// because turn_end/agent_end repeat the same messages.
func ompEvent(payload map[string]any, rawLine string, now time.Time) Event {
	kind := firstString(payload, "type")
	if kind == "" {
		kind = "stdout"
	}
	event := Event{Provider: ProviderOMP, Kind: kind, Raw: payload, Timestamp: now, RawLine: rawLine}
	switch kind {
	case "message_update":
		if update := nestedMap(payload, "assistantMessageEvent"); update != nil {
			if sub := firstString(update, "type"); sub != "" {
				event.Kind = "message_update/" + sub
			}
			if update["type"] == "text_delta" {
				event.Message, _ = update["delta"].(string)
			}
		}
	case "message_end":
		message := nestedMap(payload, "message")
		if message == nil || message["role"] != "assistant" {
			return event
		}
		event.Message = ompMessageText(message)
		event.Usage = ompUsage(nestedMap(message, "usage"))
		if stop := firstString(message, "stopReason"); stop != "" {
			event.Kind = "message_end/" + stop
		}
	case "tool_execution_start", "tool_execution_end":
		event.Message = firstString(payload, "toolName")
	}
	return event
}

// ompMessageText joins an assistant message's text parts (not thinking).
func ompMessageText(message map[string]any) string {
	parts, _ := message["content"].([]any)
	var text []string
	for _, part := range parts {
		block, _ := part.(map[string]any)
		if block["type"] != "text" {
			continue
		}
		if value, _ := block["text"].(string); strings.TrimSpace(value) != "" {
			text = append(text, value)
		}
	}
	return strings.Join(text, "\n\n")
}

// ompUsage reads omp's per-message usage {input, output, cacheRead,
// cacheWrite, totalTokens, reasoningTokens}.
func ompUsage(usage map[string]any) TokenUsage {
	if usage == nil {
		return TokenUsage{}
	}
	out := TokenUsage{
		InputTokens:      firstInt64(usage, "input"),
		OutputTokens:     firstInt64(usage, "output"),
		TotalTokens:      firstInt64(usage, "totalTokens"),
		CacheReadTokens:  firstInt64(usage, "cacheRead"),
		CacheWriteTokens: firstInt64(usage, "cacheWrite"),
		ThinkingTokens:   firstInt64(usage, "reasoningTokens"),
	}
	if out.TotalTokens == 0 {
		out.TotalTokens = out.InputTokens + out.OutputTokens + out.CacheReadTokens + out.CacheWriteTokens
	}
	return out
}
