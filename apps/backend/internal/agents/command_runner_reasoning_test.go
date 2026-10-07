package agents

import "testing"

func TestWithReasoningStreamOnlyExtendsClaudeStreamJSON(t *testing.T) {
	base := "claude -p {{prompt}} --output-format stream-json --verbose"
	got := withReasoningStream(ProviderClaude, base)
	if got != base+` --include-partial-messages --settings '{"showThinkingSummaries":true}'` {
		t.Fatal(got)
	}
	if again := withReasoningStream(ProviderClaude, got); again != got {
		t.Fatal("flags duplicated", again)
	}
	for _, c := range []struct {
		provider Provider
		command  string
	}{
		{ProviderClaude, "claude -p {{prompt}} --output-format json"},
		{ProviderOpenCode, "opencode run --format json {{prompt}} stream-json"},
	} {
		if got := withReasoningStream(c.provider, c.command); got != c.command {
			t.Fatal(got)
		}
	}
}
