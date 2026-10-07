package usage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Synthetic lines in omp 18.7 session-file shapes (no real session content).
const ompSessionFixture = `{"type":"title","v":1,"title":"fixture"}
{"type":"session","version":3,"id":"sess-1","timestamp":"2026-10-07T20:52:20.984Z","cwd":"/work/proj"}
{"type":"message","id":"a","timestamp":"2026-10-07T20:52:21.000Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}
{"type":"message","id":"b","timestamp":"2026-10-07T20:52:23.000Z","message":{"role":"assistant","provider":"openai-codex","model":"gpt-x","timestamp":1791406343210,"usage":{"input":700,"output":80,"cacheRead":0,"cacheWrite":0,"totalTokens":780,"reasoningTokens":15,"cost":{"total":0.0015}}}}
{"type":"message","id":"c","timestamp":"2026-10-07T20:52:24.000Z","message":{"role":"toolResult","content":[{"type":"text","text":"` + `big output"}]}}
{"type":"message","id":"d","timestamp":"2026-10-07T20:52:30.000Z","message":{"role":"assistant","provider":"openai-codex","model":"gpt-x","timestamp":1791406354105,"usage":{"input":30,"output":6,"cacheRead":6656,"cacheWrite":0,"totalTokens":6692,"cost":{"total":0.0003}}}}
`

func TestScanOMPAggregatesAssistantUsageAndRecordedCost(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "-work-proj", "2026-10-07_sess-1")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "-work-proj", "2026-10-07_sess-1.jsonl"), []byte(ompSessionFixture), 0o644); err != nil {
		t.Fatal(err)
	}
	// A subagent session without cost data is counted with inferred pricing.
	sub := `{"type":"session","id":"sub-1","timestamp":"2026-10-08T01:00:00Z","cwd":"/work/proj"}
{"type":"message","message":{"role":"assistant","provider":"google-antigravity","model":"gemini-y","timestamp":1791450000000,"usage":{"input":10,"output":2,"cacheRead":0,"cacheWrite":0}}}
`
	if err := os.WriteFile(filepath.Join(nested, "sub.jsonl"), []byte(sub), 0o644); err != nil {
		t.Fatal(err)
	}
	// Files without a session header or assistant usage are ignored.
	if err := os.WriteFile(filepath.Join(root, "empty.jsonl"), []byte("{\"type\":\"title\"}\nnot json\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	files, sessions, daily, exists, err := scanOMPRoot(root, newWorktreeIndex(nil))
	if err != nil || !exists || len(files) != 3 || len(sessions) != 2 {
		t.Fatalf("files=%d sessions=%d exists=%v err=%v", len(files), len(sessions), exists, err)
	}
	var main, child Session
	for _, s := range sessions {
		if s.SessionID == "sess-1" {
			main = s
		} else {
			child = s
		}
	}
	if main.TurnCount != 2 || main.InputTokens != 730 || main.OutputTokens != 86 || main.CacheReadTokens != 6656 || main.ReasoningTokens != 15 || main.PrimaryModel != "openai-codex/gpt-x" || main.HasMixedModels {
		t.Fatalf("main session %+v", main)
	}
	if main.RecordedCostUSD == nil || *main.RecordedCostUSD < 0.00179 || *main.RecordedCostUSD > 0.00181 {
		t.Fatalf("recorded cost %v", main.RecordedCostUSD)
	}
	if main.LastTimestamp.Before(main.FirstTimestamp) || main.FirstTimestamp.IsZero() {
		t.Fatalf("timestamps %v..%v", main.FirstTimestamp, main.LastTimestamp)
	}
	if child.RecordedCostUSD != nil || !child.HasInferredPricing || child.PrimaryModel != "google-antigravity/gemini-y" {
		t.Fatalf("child session %+v", child)
	}
	var codexDay *DailyAggregate
	for i := range daily {
		if daily[i].Model == "openai-codex/gpt-x" {
			codexDay = &daily[i]
		}
	}
	if codexDay == nil || codexDay.TurnCount != 2 || codexDay.ZeroCacheReadTurns != 1 || dailyCost(ProviderOMP, *codexDay) == nil {
		t.Fatalf("daily %+v", daily)
	}
	if usageTotal(ProviderOMP, 730, 86, 6656, 0, 15) != 730+86+6656 {
		t.Fatal("omp reasoning tokens are part of output and must not be double counted")
	}
}

func TestScanOMPSkipsOversizedLines(t *testing.T) {
	root := t.TempDir()
	huge := `{"type":"message","message":{"role":"toolResult","content":"` + strings.Repeat("x", 9<<20) + `"}}`
	content := `{"type":"session","id":"s","timestamp":"2026-10-07T00:00:00Z","cwd":"/w"}` + "\n" + huge + "\n" +
		`{"type":"message","message":{"role":"assistant","provider":"p","model":"m","timestamp":1791406343210,"usage":{"input":1,"output":1,"cost":{"total":0.1}}}}` + "\n"
	if err := os.WriteFile(filepath.Join(root, "s.jsonl"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	_, sessions, _, _, err := scanOMPRoot(root, newWorktreeIndex(nil))
	if err != nil || len(sessions) != 1 || sessions[0].TurnCount != 1 {
		t.Fatalf("sessions %+v, %v", sessions, err)
	}
}

func TestParseOMPUsageFoldsProviderWindows(t *testing.T) {
	raw := []byte(`{"reports":[
	 {"provider":"openai-codex","limits":[{"label":"7 days","window":{"id":"7d","label":"7 days","durationMs":604800000,"resetsAt":1791958779000},"amount":{"usedFraction":0.25}}]},
	 {"provider":"google-antigravity","limits":[
	  {"label":"5 hours","window":{"label":"5 hours","durationMs":18000000,"resetsAt":1791420000000},"amount":{"usedFraction":0.1}},
	  {"label":"5 hours pro","window":{"label":"5 hours","durationMs":18000000},"amount":{"usedFraction":0.4}}]}]}`)
	limits, err := parseOMPUsage(raw)
	if err != nil || limits.Status != RateLimitOK {
		t.Fatalf("limits %+v, %v", limits, err)
	}
	if limits.Weekly == nil || limits.Weekly.UsedPercent != 25 || limits.Weekly.WindowMinutes != 10080 || limits.Weekly.ResetsAt == nil || *limits.Weekly.ResetsAt != 1791958779 {
		t.Fatalf("weekly %+v", limits.Weekly)
	}
	if limits.Session == nil || limits.Session.UsedPercent != 40 || limits.Session.WindowMinutes != 300 || !strings.Contains(limits.Session.ResetDescription, "google-antigravity") {
		t.Fatalf("session %+v", limits.Session)
	}
	if empty, _ := parseOMPUsage([]byte(`{"reports":[]}`)); empty.Status != RateLimitUnavailable {
		t.Fatalf("no windows must be unavailable: %+v", empty)
	}
	if _, err = parseOMPUsage([]byte(`[]`)); err == nil {
		t.Fatal("malformed usage accepted")
	}
}
