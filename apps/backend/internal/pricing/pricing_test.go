package pricing

import (
	"testing"
)

func TestGetModelPricing_ExactMatch(t *testing.T) {
	tests := []struct {
		model string
		want  float64 // InputPerMTok as identity check
	}{
		{"claude-opus-4-6", 5.0},
		{"claude-sonnet-4-6", 3.0},
		{"claude-haiku-4-5", 1.0},
		{"claude-haiku-5-5", 0.10},
		{"gpt-5.4", 2.50},
		{"o3", 10.0},
		{"gemini-2.5-pro", 1.25},
		{"gemini-2.5-flash", 0.30},
		{"gpt-5.1-codex-mini", 0.25},
	}
	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			p := GetModelPricing(tt.model)
			if p.InputPerMTok != tt.want {
				t.Errorf("GetModelPricing(%q).InputPerMTok = %v, want %v", tt.model, p.InputPerMTok, tt.want)
			}
		})
	}
}

func TestGetModelPricing_PrefixMatch(t *testing.T) {
	// "claude-opus-4-6-20260315" should match "claude-opus-4-6"
	p := GetModelPricing("claude-opus-4-6-20260315")
	if p.InputPerMTok != 5.0 {
		t.Errorf("prefix match: got InputPerMTok=%v, want 5.0", p.InputPerMTok)
	}

	// "gpt-5.1-codex-mini-2026" should match "gpt-5.1-codex-mini" (longest prefix)
	p = GetModelPricing("gpt-5.1-codex-mini-2026")
	if p.InputPerMTok != 0.25 {
		t.Errorf("longest prefix match: got InputPerMTok=%v, want 0.25", p.InputPerMTok)
	}

	// "gemini-2.5-flash-lite-latest" should match "gemini-2.5-flash-lite"
	p = GetModelPricing("gemini-2.5-flash-lite-latest")
	if p.InputPerMTok != 0.10 {
		t.Errorf("flash-lite prefix match: got InputPerMTok=%v, want 0.10", p.InputPerMTok)
	}
}

func TestGetModelPricing_DefaultFallback(t *testing.T) {
	p := GetModelPricing("totally-unknown-model")
	if p.InputPerMTok != defaultPricing.InputPerMTok {
		t.Errorf("fallback: got InputPerMTok=%v, want %v", p.InputPerMTok, defaultPricing.InputPerMTok)
	}
	if p.OutputPerMTok != defaultPricing.OutputPerMTok {
		t.Errorf("fallback: got OutputPerMTok=%v, want %v", p.OutputPerMTok, defaultPricing.OutputPerMTok)
	}
}

func TestGetModelPricing_EmptyString(t *testing.T) {
	p := GetModelPricing("")
	if p.InputPerMTok != defaultPricing.InputPerMTok {
		t.Errorf("empty: got InputPerMTok=%v, want %v", p.InputPerMTok, defaultPricing.InputPerMTok)
	}
}

func TestGetModelPricing_CaseInsensitive(t *testing.T) {
	p := GetModelPricing("Claude-Opus-4-6")
	if p.InputPerMTok != 5.0 {
		t.Errorf("case insensitive: got InputPerMTok=%v, want 5.0", p.InputPerMTok)
	}
}

func TestCalculateSessionCost_Basic(t *testing.T) {
	// 1M input tokens at $5/MTok = $5 = 500 cents
	cost := CalculateSessionCost(1_000_000, 0, 0, 0, 0, "claude-opus-4-6")
	if cost != 500 {
		t.Errorf("1M input tokens: got %d cents, want 500", cost)
	}
}

func TestCalculateSessionCost_OutputTokens(t *testing.T) {
	// 1M output tokens at $25/MTok = $25 = 2500 cents
	cost := CalculateSessionCost(0, 1_000_000, 0, 0, 0, "claude-opus-4-6")
	if cost != 2500 {
		t.Errorf("1M output tokens: got %d cents, want 2500", cost)
	}
}

func TestCalculateSessionCost_CacheDiscount(t *testing.T) {
	// Cache read: 1M tokens at $0.50/MTok = $0.50 = 50 cents
	cost := CalculateSessionCost(0, 0, 1_000_000, 0, 0, "claude-opus-4-6")
	if cost != 50 {
		t.Errorf("1M cache read tokens: got %d cents, want 50", cost)
	}

	// Cache write: 1M tokens at $6.25/MTok = $6.25 = 625 cents
	cost = CalculateSessionCost(0, 0, 0, 1_000_000, 0, "claude-opus-4-6")
	if cost != 625 {
		t.Errorf("1M cache write tokens: got %d cents, want 625", cost)
	}
}

func TestCalculateSessionCost_ThinkingTokens(t *testing.T) {
	// 1M thinking tokens at $25/MTok (output rate) = $25 = 2500 cents
	cost := CalculateSessionCost(0, 0, 0, 0, 1_000_000, "claude-opus-4-6")
	if cost != 2500 {
		t.Errorf("1M thinking tokens: got %d cents, want 2500", cost)
	}
}

func TestCalculateSessionCost_Mixed(t *testing.T) {
	// 100k input (50c) + 50k output (125c) + 200k cache_read (10c) + 10k thinking (25c)
	// Total: 210c
	cost := CalculateSessionCost(100_000, 50_000, 200_000, 0, 10_000, "claude-opus-4-6")
	// input: 100000 * 5.0 / 10000 = 50
	// output: 50000 * 25.0 / 10000 = 125
	// cache_read: 200000 * 0.50 / 10000 = 10
	// thinking: 10000 * 25.0 / 10000 = 25
	// total = 210
	if cost != 210 {
		t.Errorf("mixed tokens: got %d cents, want 210", cost)
	}
}

func TestCalculateSessionCost_ZeroTokens(t *testing.T) {
	cost := CalculateSessionCost(0, 0, 0, 0, 0, "claude-opus-4-6")
	if cost != 0 {
		t.Errorf("zero tokens: got %d cents, want 0", cost)
	}
}

func TestCalculateSessionCost_UnknownModel(t *testing.T) {
	// Uses default pricing
	cost := CalculateSessionCost(1_000_000, 0, 0, 0, 0, "unknown-model")
	// 1M * 2.0 / 10000 = 200 cents
	if cost != 200 {
		t.Errorf("unknown model: got %d cents, want 200", cost)
	}
}

func TestCalculateCostOptimization(t *testing.T) {
	rows := []MetricsRow{
		{
			Provider:     "claude",
			Model:        "claude-opus-4-6",
			InputTokens:  500_000,
			OutputTokens: 100_000,
			CacheRead:    300_000,
			CacheWrite:   50_000,
			Thinking:     80_000,
			CostCents:    1500,
		},
		{
			Provider:     "codex",
			Model:        "gpt-5.1-codex",
			InputTokens:  400_000,
			OutputTokens: 200_000,
			CacheRead:    100_000,
			CacheWrite:   0,
			Thinking:     0,
			CostCents:    800,
		},
	}

	opt := CalculateCostOptimization(rows, 7)

	if opt.TotalSpendCents != 2300 {
		t.Errorf("total spend: got %d, want 2300", opt.TotalSpendCents)
	}

	// Claude cache hit rate: 300000 / (500000 + 300000 + 50000) = 300000/850000 ~ 0.353
	if rate, ok := opt.CacheHitRate["claude"]; !ok {
		t.Error("missing cache_hit_rate for claude")
	} else if rate < 0.35 || rate > 0.36 {
		t.Errorf("claude cache hit rate: got %v, want ~0.353", rate)
	}

	// Claude-opus thinking ratio: 80000 / (100000 + 80000) = 0.444
	if ratio, ok := opt.ThinkingRatio["claude-opus-4-6"]; !ok {
		t.Error("missing thinking_ratio for claude-opus-4-6")
	} else if ratio < 0.44 || ratio > 0.45 {
		t.Errorf("claude-opus thinking ratio: got %v, want ~0.444", ratio)
	}

	// Codex thinking ratio should be 0 (no thinking tokens)
	if ratio, ok := opt.ThinkingRatio["gpt-5.1-codex"]; !ok {
		t.Error("missing thinking_ratio for gpt-5.1-codex")
	} else if ratio != 0 {
		t.Errorf("codex thinking ratio: got %v, want 0", ratio)
	}

	// Projected monthly: 2300/7 * 30 ~ 9857
	if opt.ProjectedMonthlyCents < 9800 || opt.ProjectedMonthlyCents > 9900 {
		t.Errorf("projected monthly: got %d, want ~9857", opt.ProjectedMonthlyCents)
	}
}

func TestCalculateCostOptimization_Empty(t *testing.T) {
	opt := CalculateCostOptimization(nil, 0)
	if opt.TotalSpendCents != 0 {
		t.Errorf("empty: got %d, want 0", opt.TotalSpendCents)
	}
	if opt.ProjectedMonthlyCents != 0 {
		t.Errorf("empty projected: got %d, want 0", opt.ProjectedMonthlyCents)
	}
}
