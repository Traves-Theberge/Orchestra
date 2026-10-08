// Package pricing provides model-specific token pricing, cost calculation,
// and optimization analysis for multi-provider LLM usage tracking.
package pricing

import (
	"strings"
)

// ModelPricing holds per-million-token pricing for a specific model.
type ModelPricing struct {
	InputPerMTok      float64
	OutputPerMTok     float64
	CacheReadPerMTok  float64
	CacheWritePerMTok float64
	ThinkingPerMTok   float64
}

// MODEL_PRICING maps model ID prefixes to their pricing in dollars per million tokens.
var MODEL_PRICING = map[string]ModelPricing{
	// Anthropic
	"claude-opus-4-6":   {InputPerMTok: 5.0, OutputPerMTok: 25.0, CacheReadPerMTok: 0.50, CacheWritePerMTok: 6.25, ThinkingPerMTok: 25.0},
	"claude-sonnet-4-6": {InputPerMTok: 3.0, OutputPerMTok: 15.0, CacheReadPerMTok: 0.30, CacheWritePerMTok: 3.75, ThinkingPerMTok: 15.0},
	"claude-haiku-5-5":  {InputPerMTok: 0.10, OutputPerMTok: 0.50, CacheReadPerMTok: 0.01, CacheWritePerMTok: 0.125, ThinkingPerMTok: 0.50},
	"claude-haiku-4-5":  {InputPerMTok: 1.0, OutputPerMTok: 5.0, CacheReadPerMTok: 0.10, CacheWritePerMTok: 1.25, ThinkingPerMTok: 5.0},
	"claude-sonnet-4-5": {InputPerMTok: 3.0, OutputPerMTok: 15.0, CacheReadPerMTok: 0.30, CacheWritePerMTok: 3.75, ThinkingPerMTok: 15.0},
	"claude-opus-4-5":   {InputPerMTok: 5.0, OutputPerMTok: 25.0, CacheReadPerMTok: 0.50, CacheWritePerMTok: 6.25, ThinkingPerMTok: 25.0},
	// OpenAI
	"gpt-5.4":            {InputPerMTok: 2.50, OutputPerMTok: 15.0, CacheReadPerMTok: 1.25, CacheWritePerMTok: 2.50, ThinkingPerMTok: 15.0},
	"gpt-5.1-codex":      {InputPerMTok: 1.25, OutputPerMTok: 10.0, CacheReadPerMTok: 0.625, CacheWritePerMTok: 1.25, ThinkingPerMTok: 10.0},
	"gpt-5.1-codex-mini": {InputPerMTok: 0.25, OutputPerMTok: 2.0, CacheReadPerMTok: 0.125, CacheWritePerMTok: 0.25, ThinkingPerMTok: 2.0},
	"o3":                 {InputPerMTok: 10.0, OutputPerMTok: 40.0, CacheReadPerMTok: 5.0, CacheWritePerMTok: 10.0, ThinkingPerMTok: 40.0},
	"gpt-4o":             {InputPerMTok: 2.50, OutputPerMTok: 10.0, CacheReadPerMTok: 1.25, CacheWritePerMTok: 2.50, ThinkingPerMTok: 10.0},
	// Google
	"gemini-2.5-pro":        {InputPerMTok: 1.25, OutputPerMTok: 10.0, CacheReadPerMTok: 0.125, CacheWritePerMTok: 1.25, ThinkingPerMTok: 10.0},
	"gemini-2.5-flash":      {InputPerMTok: 0.30, OutputPerMTok: 2.50, CacheReadPerMTok: 0.03, CacheWritePerMTok: 0.30, ThinkingPerMTok: 2.50},
	"gemini-2.5-flash-lite": {InputPerMTok: 0.10, OutputPerMTok: 0.40, CacheReadPerMTok: 0.01, CacheWritePerMTok: 0.10, ThinkingPerMTok: 0.40},
}

// defaultPricing is used when no model match is found.
var defaultPricing = ModelPricing{
	InputPerMTok:      2.0,
	OutputPerMTok:     10.0,
	CacheReadPerMTok:  0.20,
	CacheWritePerMTok: 2.50,
	ThinkingPerMTok:   10.0,
}

// GetModelPricing returns pricing for the given model string. It tries exact
// match first, then longest prefix match, then returns a sensible default.
func GetModelPricing(model string) ModelPricing {
	model = strings.ToLower(strings.TrimSpace(model))
	if model == "" {
		return defaultPricing
	}

	// Exact match
	if p, ok := MODEL_PRICING[model]; ok {
		return p
	}

	// Longest prefix match
	bestKey := ""
	for key := range MODEL_PRICING {
		if strings.HasPrefix(model, key) && len(key) > len(bestKey) {
			bestKey = key
		}
	}
	if bestKey != "" {
		return MODEL_PRICING[bestKey]
	}

	return defaultPricing
}

// CalculateSessionCost computes the total cost in integer cents for a session
// given token counts and model identifier.
func CalculateSessionCost(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, thinkingTokens int64, model string) int64 {
	p := GetModelPricing(model)

	// Cost = tokens * (price_per_MTok / 1_000_000), then convert dollars to cents (*100)
	// Simplified: tokens * price_per_MTok / 10_000
	inputCost := float64(inputTokens) * p.InputPerMTok / 10_000.0
	outputCost := float64(outputTokens) * p.OutputPerMTok / 10_000.0
	cacheReadCost := float64(cacheReadTokens) * p.CacheReadPerMTok / 10_000.0
	cacheWriteCost := float64(cacheWriteTokens) * p.CacheWritePerMTok / 10_000.0
	thinkingCost := float64(thinkingTokens) * p.ThinkingPerMTok / 10_000.0

	totalCents := inputCost + outputCost + cacheReadCost + cacheWriteCost + thinkingCost

	// Round to nearest cent
	return int64(totalCents + 0.5)
}

// CostOptimization holds optimization metrics across providers/models.
type CostOptimization struct {
	CacheHitRate          map[string]float64 `json:"cache_hit_rate"`
	ThinkingRatio         map[string]float64 `json:"thinking_ratio"`
	EffectiveTokenPrice   map[string]float64 `json:"effective_token_price"`
	TotalSpendCents       int64              `json:"total_spend_cents"`
	ProjectedMonthlyCents int64              `json:"projected_monthly_cents"`
}

// MetricsRow represents a single row from the daily_metrics table used for
// cost optimization calculations.
type MetricsRow struct {
	Provider     string
	Model        string
	InputTokens  int64
	OutputTokens int64
	CacheRead    int64
	CacheWrite   int64
	Thinking     int64
	CostCents    int64
	DayCount     int // number of distinct days this row spans
}

// CalculateCostOptimization computes cache hit rates, thinking ratios, effective
// token prices, total spend, and projected monthly spend from aggregated metrics.
func CalculateCostOptimization(rows []MetricsRow, daysCovered int) CostOptimization {
	opt := CostOptimization{
		CacheHitRate:        make(map[string]float64),
		ThinkingRatio:       make(map[string]float64),
		EffectiveTokenPrice: make(map[string]float64),
	}

	// Aggregate by provider for cache hit rate and effective price
	type providerAgg struct {
		totalInput  int64
		cacheRead   int64
		totalTokens int64
		totalCost   int64
	}
	byProvider := make(map[string]*providerAgg)

	// Aggregate by model for thinking ratio
	type modelAgg struct {
		output   int64
		thinking int64
	}
	byModel := make(map[string]*modelAgg)

	for _, r := range rows {
		// Provider aggregation
		prov := r.Provider
		if prov == "" {
			prov = "unknown"
		}
		pa, ok := byProvider[prov]
		if !ok {
			pa = &providerAgg{}
			byProvider[prov] = pa
		}
		pa.totalInput += r.InputTokens + r.CacheRead + r.CacheWrite
		pa.cacheRead += r.CacheRead
		pa.totalTokens += r.InputTokens + r.OutputTokens + r.CacheRead + r.CacheWrite + r.Thinking
		pa.totalCost += r.CostCents

		// Model aggregation
		model := r.Model
		if model == "" {
			model = "unknown"
		}
		ma, ok := byModel[model]
		if !ok {
			ma = &modelAgg{}
			byModel[model] = ma
		}
		ma.output += r.OutputTokens
		ma.thinking += r.Thinking

		opt.TotalSpendCents += r.CostCents
	}

	// Calculate per-provider metrics
	for prov, pa := range byProvider {
		if pa.totalInput > 0 {
			opt.CacheHitRate[prov] = float64(pa.cacheRead) / float64(pa.totalInput)
		}
		if pa.totalTokens > 0 {
			// Effective price per token in dollars
			opt.EffectiveTokenPrice[prov] = float64(pa.totalCost) / 100.0 / float64(pa.totalTokens)
		}
	}

	// Calculate per-model thinking ratio
	for model, ma := range byModel {
		totalOutput := ma.output + ma.thinking
		if totalOutput > 0 {
			opt.ThinkingRatio[model] = float64(ma.thinking) / float64(totalOutput)
		}
	}

	// Project monthly spend
	if daysCovered > 0 {
		dailyAvg := float64(opt.TotalSpendCents) / float64(daysCovered)
		opt.ProjectedMonthlyCents = int64(dailyAvg*30.0 + 0.5)
	}

	return opt
}
