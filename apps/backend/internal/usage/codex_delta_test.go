package usage

import "testing"

func TestCodexDeltaMeasuredCompactionResetAndNextResponse(t *testing.T) {
	previous := &codexTokenSnapshot{InputTokens: 100, OutputTokens: 20, TotalTokens: 120}
	reset := &codexTokenSnapshot{InputTokens: 60, OutputTokens: 10, TotalTokens: 70}
	delta, baseline := codexDelta(reset, reset, previous)
	if delta == nil || *delta != *reset || baseline == nil || *baseline != *reset {
		t.Fatalf("measured 70-token reset lost: delta=%+v baseline=%+v", delta, baseline)
	}
	next := &codexTokenSnapshot{InputTokens: 80, OutputTokens: 15, TotalTokens: 95}
	delta, _ = codexDelta(next, nil, baseline)
	if delta == nil || delta.InputTokens != 20 || delta.OutputTokens != 5 {
		t.Fatalf("reset did not rebaseline next response: %+v", delta)
	}
}
