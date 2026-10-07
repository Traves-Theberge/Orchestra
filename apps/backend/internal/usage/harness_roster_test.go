package usage

import "testing"

func TestQuotaRosterKeepsUnsupportedHarnessesExplicit(t *testing.T) {
	state := (&Service{}).unavailableState("not observed")
	if state.Antigravity == nil || state.Antigravity.Status != RateLimitUnavailable || state.Eightgent == nil || state.Eightgent.Status != RateLimitUnavailable {
		t.Fatalf("active harness quota status absent: %+v", state)
	}
}
