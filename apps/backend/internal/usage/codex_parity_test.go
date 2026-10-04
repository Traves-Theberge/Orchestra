package usage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCodexModernImportResumeCopiesAndResponseDeltas(t *testing.T) {
	home := t.TempDir()
	t.Setenv("CODEX_HOME", home)
	root := filepath.Join(home, "sessions")
	if err := os.Mkdir(root, 0755); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	tokens := func(input, output, cache, reason int64) *codexTokenSnapshot {
		return &codexTokenSnapshot{InputTokens: input, OutputTokens: output, CachedInputTokens: cache, ReasoningOutputTokens: reason, TotalTokens: input + output}
	}
	var events []map[string]any
	add := func(total, last *codexTokenSnapshot) {
		stamp = stamp.Add(time.Second)
		events = append(events, map[string]any{"type": "event_msg", "timestamp": stamp.Format(time.RFC3339Nano), "payload": map[string]any{"type": "token_count", "info": map[string]any{"total_token_usage": total, "last_token_usage": last}}})
	}
	add(tokens(1000, 100, 200, 50), tokens(100, 20, 20, 10))
	events = append(events, events[0])
	add(tokens(1150, 130, 230, 65), tokens(150, 30, 30, 15))
	add(tokens(1110, 129, 229, 64), tokens(20, 5, 2, 1))
	events[len(events)-1]["timestamp"] = stamp.Add(-2 * time.Second).Format(time.RFC3339Nano) // explicitly older record
	add(tokens(50, 10, 10, 4), tokens(50, 10, 10, 4))                                         // compaction reset
	add(tokens(40, 8, 8, 3), nil)                                                             // rebaseline without a measured response
	add(tokens(60, 12, 12, 5), nil)
	add(nil, tokens(10, 2, 2, 1))
	add(nil, tokens(10, 2, 2, 1)) // two equal independent responses both count
	write := func(name, id string, extra bool) {
		rows := []map[string]any{{"type": "session_meta", "timestamp": stamp.Format(time.RFC3339Nano), "payload": map[string]any{"id": id, "cwd": "/fixture"}}, {"type": "turn_context", "timestamp": stamp.Format(time.RFC3339Nano), "payload": map[string]any{"model": "gpt-5.4"}}}
		rows = append(rows, events...)
		if extra {
			rows = append(rows, map[string]any{"type": "event_msg", "timestamp": stamp.Add(time.Second).Format(time.RFC3339Nano), "payload": map[string]any{"type": "token_count", "info": map[string]any{"total_token_usage": tokens(100, 22, 20, 9), "last_token_usage": tokens(20, 6, 4, 2)}}})
		}
		var bytes []byte
		for _, row := range rows {
			raw, err := json.Marshal(row)
			if err != nil {
				t.Fatal(err)
			}
			bytes = append(append(bytes, raw...), '\n')
		}
		if err := os.WriteFile(filepath.Join(root, name), bytes, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("a-original.jsonl", "original", false)
	write("b-fork.jsonl", "fork", true)
	_, sessions, daily, exists, err := scanCodex(stamp, nil, nil, nil, newWorktreeIndex(nil))
	if err != nil || !exists || len(sessions) != 2 {
		t.Fatalf("sessions=%+v exists=%v err=%v", sessions, exists, err)
	}
	var input, output, reason, cached int64
	for _, d := range daily {
		input += d.InputTokens
		output += d.OutputTokens
		reason += d.ReasoningTokens
		cached += d.CachedInputTokens
	}
	if input != 360 || output != 74 || reason != 35 || cached != 72 {
		t.Fatalf("wrong accounting input=%d output=%d reasoning=%d cached=%d", input, output, reason, cached)
	}
	for _, s := range sessions {
		if s.SessionID == "fork" && (s.TurnCount != 1 || s.InputTokens != 20 || s.OutputTokens != 6) {
			t.Fatalf("copied history was billed again: %+v", s)
		}
	}
}

func TestCodexUnknownPricingAndReasoningSubset(t *testing.T) {
	for _, entry := range []struct {
		provider Provider
		model    string
	}{{ProviderClaude, "claude-opus-future"}, {ProviderClaude, "claude-opus-4-7-unknown-variant"}, {ProviderGemini, "gemini-3-pro-unpriced-preview"}} {
		if cost, _ := estimateCost(entry.provider, entry.model, 100, 0, 30, 0, 0, 10); cost != nil {
			t.Fatalf("guessed price for %s/%s", entry.provider, entry.model)
		}
	}
	for _, model := range []string{"", "unknown-model", "gpt-5.99", "gpt-5.4-unpriced-variant"} {
		if cost, _ := estimateCost(ProviderCodex, model, 100, 20, 30, 0, 0, 10); cost != nil {
			t.Fatalf("invented price for %q: %v", model, *cost)
		}
	}
	if total := usageTotal(ProviderCodex, 100, 30, 0, 0, 10); total != 130 {
		t.Fatalf("reasoning counted twice: %d", total)
	}
	a, _ := estimateCost(ProviderCodex, "gpt-5.4", 100, 20, 30, 0, 0, 0)
	b, _ := estimateCost(ProviderCodex, "gpt-5.4", 100, 20, 30, 0, 0, 10)
	if a == nil || b == nil || *a != *b {
		t.Fatal("reasoning changed billed output")
	}
}

func TestCodexScannerCountsMeasuredResetAndIgnoresLateOlderRecord(t *testing.T) {
	home := t.TempDir()
	t.Setenv("CODEX_HOME", home)
	root := filepath.Join(home, "sessions")
	if err := os.Mkdir(root, 0755); err != nil {
		t.Fatal(err)
	}
	data := `{"type":"session_meta","timestamp":"2026-10-04T12:00:00Z","payload":{"id":"reset-session"}}
{"type":"event_msg","timestamp":"2026-10-04T12:00:01Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":20}}}}
{"type":"event_msg","timestamp":"2026-10-04T12:00:02Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":60,"output_tokens":10},"last_token_usage":{"input_tokens":60,"output_tokens":10}}}}
{"type":"event_msg","timestamp":"2026-10-04T12:00:01.5Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":40,"output_tokens":8},"last_token_usage":{"input_tokens":40,"output_tokens":8}}}}
{"type":"event_msg","timestamp":"2026-10-04T12:00:03Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":80,"output_tokens":15}}}}
`
	if err := os.WriteFile(filepath.Join(root, "reset.jsonl"), []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	_, sessions, _, exists, err := scanCodex(time.Now(), nil, nil, nil, newWorktreeIndex(nil))
	if err != nil || !exists || len(sessions) != 1 || sessions[0].InputTokens != 180 || sessions[0].OutputTokens != 35 || sessions[0].TurnCount != 3 {
		t.Fatalf("reset/stale accounting: %+v exists=%v err=%v", sessions, exists, err)
	}
}

func TestUsageProjectCostsUseModelRowsAndUnknownCostsStayUnknown(t *testing.T) {
	s, err := NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	state, _ := s.store.load(ProviderCodex)
	state.DailyAggregates = []DailyAggregate{{Provider: ProviderCodex, Day: "2026-10-04", Model: "gpt-5.4", ProjectKey: "repo", InputTokens: 100, OutputTokens: 30, ReasoningTokens: 10}, {Provider: ProviderCodex, Day: "2026-10-04", Model: "gpt-5", ProjectKey: "repo", InputTokens: 200, OutputTokens: 40, ReasoningTokens: 20}}
	rows, err := s.Breakdown(ProviderCodex, ScopeAll, RangeAll, BreakdownByProject)
	a, _ := estimateCost(ProviderCodex, "gpt-5.4", 100, 0, 30, 0, 0, 10)
	b, _ := estimateCost(ProviderCodex, "gpt-5", 200, 0, 40, 0, 0, 20)
	if err != nil || len(rows) != 1 || rows[0].EstimatedCostUSD == nil || *rows[0].EstimatedCostUSD != *a+*b || rows[0].TotalTokens != 370 {
		t.Fatalf("wrong project cost: %+v %v", rows, err)
	}
	state.DailyAggregates = append(state.DailyAggregates, DailyAggregate{Provider: ProviderCodex, Day: "2026-10-04", Model: "unknown-model", ProjectKey: "repo", InputTokens: 1})
	summary, err := s.Summary(ProviderCodex, ScopeAll, RangeAll)
	if err != nil || summary.EstimatedCostUSD != nil {
		t.Fatalf("partial price represented as total: %+v %v", summary, err)
	}
	rows, _ = s.Breakdown(ProviderCodex, ScopeAll, RangeAll, BreakdownByProject)
	if rows[0].EstimatedCostUSD != nil {
		t.Fatal("project's partially known cost presented as complete")
	}
}

func TestUsageSourcesAndUnavailableOpenCodeAccounting(t *testing.T) {
	isolated := t.TempDir()
	t.Setenv("HOME", isolated)
	t.Setenv("USERPROFILE", isolated)
	claudeHome := filepath.Join(isolated, "claude-account")
	t.Setenv("CLAUDE_CONFIG_DIR", claudeHome)
	if actual := ClaudeSourceDir(); actual != filepath.Join(claudeHome, "projects") {
		t.Fatalf("wrong account root: %s", actual)
	}
	if err := os.MkdirAll(OpenCodeSourceDir(), 0755); err != nil {
		t.Fatal(err)
	}
	_, _, _, exists, err := scanOpenCode(time.Now(), nil, nil, nil, newWorktreeIndex(nil))
	if !exists || err == nil {
		t.Fatal("unimplemented telemetry represented as a successful zero scan")
	}
}
