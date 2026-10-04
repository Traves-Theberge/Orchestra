package usage

// Codex totals describe a mutable thread snapshot. Last describes the newest
// billable response. Reasoning is a subset of output, not an extra token bucket.
func codexDelta(total, last, previous *codexTokenSnapshot) (*codexTokenSnapshot, *codexTokenSnapshot) {
	if total != nil {
		if previous != nil && *total == *previous {
			return nil, previous
		}
		if last != nil {
			// Measured responses remain billable when compaction resets totals.
			// The scanner rejects stale records by time, not token magnitude.
			return last, total
		}
		if previous == nil {
			return total, total
		}
		if !codexMonotonic(*total, *previous) {
			return nil, total
		}
		delta := codexTokenSnapshot{InputTokens: total.InputTokens - previous.InputTokens, CachedInputTokens: total.CachedInputTokens - previous.CachedInputTokens, OutputTokens: total.OutputTokens - previous.OutputTokens, ReasoningOutputTokens: total.ReasoningOutputTokens - previous.ReasoningOutputTokens, TotalTokens: total.TotalTokens - previous.TotalTokens}
		return &delta, total
	}
	if last != nil && previous != nil {
		next := codexTokenSnapshot{InputTokens: previous.InputTokens + last.InputTokens, CachedInputTokens: previous.CachedInputTokens + last.CachedInputTokens, OutputTokens: previous.OutputTokens + last.OutputTokens, ReasoningOutputTokens: previous.ReasoningOutputTokens + last.ReasoningOutputTokens, TotalTokens: previous.TotalTokens + last.TotalTokens}
		return last, &next
	}
	return last, previous
}

func codexMonotonic(a, b codexTokenSnapshot) bool {
	return a.InputTokens >= b.InputTokens && a.CachedInputTokens >= b.CachedInputTokens && a.OutputTokens >= b.OutputTokens && a.ReasoningOutputTokens >= b.ReasoningOutputTokens
}
func normalizeCodexSnapshot(v *codexTokenSnapshot) *codexTokenSnapshot {
	if v == nil {
		return nil
	}
	copy := *v
	copy.InputTokens = max64(0, copy.InputTokens)
	copy.CachedInputTokens = max64(0, copy.CachedInputTokens)
	copy.OutputTokens = max64(0, copy.OutputTokens)
	copy.ReasoningOutputTokens = max64(0, copy.ReasoningOutputTokens)
	if copy.TotalTokens <= 0 {
		copy.TotalTokens = copy.InputTokens + copy.OutputTokens
	}
	return &copy
}
