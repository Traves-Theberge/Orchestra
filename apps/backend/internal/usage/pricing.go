package usage

import (
	"strings"
)

// modelPricing extends the shared pricing.ModelPricing with the
// usage-specific fields Orca tracks: cached-input (Codex/Gemini) and a flag
// for providers without authoritative rates.
type modelPricing struct {
	Input       float64 // USD per million tokens
	CachedInput float64
	Output      float64
	CacheRead   float64
	CacheWrite  float64
	Reasoning   float64
}

// providerPricing holds a provider's model→price map plus a default fallback
// price (zero if cost should be reported as nil/unknown).
type providerPricing struct {
	models          map[string]modelPricing
	hasInferredFlag bool // true means models not in `models` produce hasInferredPricing=true
}

var pricingByProvider = map[Provider]providerPricing{
	ProviderClaude: {
		models: map[string]modelPricing{
			// Per Orca claude-usage/store.ts (USD per MTok)
			"claude-opus-4-7":   {Input: 6.15, Output: 30.75, CacheRead: 0.61, CacheWrite: 7.69},
			"claude-opus-4-6":   {Input: 6.15, Output: 30.75, CacheRead: 0.61, CacheWrite: 7.69},
			"claude-opus-4-5":   {Input: 6.15, Output: 30.75, CacheRead: 0.61, CacheWrite: 7.69},
			"claude-sonnet-4-6": {Input: 3.69, Output: 18.45, CacheRead: 0.37, CacheWrite: 4.61},
			"claude-sonnet-4-5": {Input: 3.69, Output: 18.45, CacheRead: 0.37, CacheWrite: 4.61},
			"claude-haiku-4-5":  {Input: 1.23, Output: 6.15, CacheRead: 0.12, CacheWrite: 1.54},
		},
	},
	ProviderCodex: {
		models: map[string]modelPricing{
			"gpt-5":         {Input: 1.25, CachedInput: 0.125, Output: 10},
			"gpt-5.2-codex": {Input: 1.75, CachedInput: 0.175, Output: 14},
			"gpt-5.3-codex": {Input: 1.9, CachedInput: 0.19, Output: 15},
			"gpt-5.4":       {Input: 2.50, CachedInput: 0.25, Output: 15},
		},
		hasInferredFlag: true,
	},
	ProviderGemini: {
		models: map[string]modelPricing{
			// Per Google AI public pricing (USD per MTok)
			"gemini-2.5-pro":        {Input: 1.25, CachedInput: 0.125, Output: 10, Reasoning: 10},
			"gemini-2.5-flash":      {Input: 0.30, CachedInput: 0.03, Output: 2.50, Reasoning: 2.50},
			"gemini-2.5-flash-lite": {Input: 0.10, CachedInput: 0.01, Output: 0.40, Reasoning: 0.40},
			"gemini-3-pro":          {Input: 1.25, CachedInput: 0.125, Output: 10, Reasoning: 10},
			"gemini-3-flash":        {Input: 0.30, CachedInput: 0.03, Output: 2.50, Reasoning: 2.50},
		},
		hasInferredFlag: true,
	},
	ProviderOpenCode: {
		// OpenCode is provider-agnostic; without per-call model pricing we
		// don't compute cost — flag everything as inferred.
		models:          map[string]modelPricing{},
		hasInferredFlag: true,
	},
}

// normalizeClaudeModel folds API/OAuth model strings into our pricing keys.
// e.g. "claude-opus-4-7-20250101" → "claude-opus-4-7", "claude-3-5-sonnet" →
// best-effort match. Mirrors Orca's normalization pass.
func normalizeClaudeModel(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	if m == "" {
		return ""
	}
	for _, key := range []string{
		"claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5",
		"claude-sonnet-4-6", "claude-sonnet-4-5",
		"claude-haiku-4-5",
	} {
		if strings.Contains(m, key) {
			return key
		}
	}
	// Family-only fallback so partial matches still get sensible Opus/Sonnet/Haiku rates.
	switch {
	case strings.Contains(m, "opus"):
		return "claude-opus-4-7"
	case strings.Contains(m, "sonnet"):
		return "claude-sonnet-4-6"
	case strings.Contains(m, "haiku"):
		return "claude-haiku-4-5"
	}
	return m
}

func normalizeCodexModel(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	if m == "" {
		return "gpt-5"
	}
	for _, key := range []string{"gpt-5.4", "gpt-5.3-codex", "gpt-5.2-codex", "gpt-5"} {
		if strings.Contains(m, key) {
			return key
		}
	}
	return m
}

func normalizeGeminiModel(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	if m == "" {
		return ""
	}
	for _, key := range []string{
		"gemini-3-pro", "gemini-3-flash",
		"gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.5-flash",
	} {
		if strings.Contains(m, key) {
			return key
		}
	}
	return m
}

// normalizeModel applies the provider-specific normalizer.
func normalizeModel(provider Provider, model string) string {
	switch provider {
	case ProviderClaude:
		return normalizeClaudeModel(model)
	case ProviderCodex:
		return normalizeCodexModel(model)
	case ProviderGemini:
		return normalizeGeminiModel(model)
	}
	return strings.ToLower(strings.TrimSpace(model))
}

// estimateCost computes USD cost for the given token tallies using the
// provider's pricing table. Returns (cost, hasInferredPricing). cost is nil
// if the model is unknown for a provider that does NOT carry an inferred
// flag (Claude — we'd rather show "unknown" than guess).
func estimateCost(
	provider Provider,
	model string,
	inputTokens, cachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens int64,
) (*float64, bool) {
	pp, ok := pricingByProvider[provider]
	if !ok {
		return nil, true
	}
	key := normalizeModel(provider, model)
	pricing, found := pp.models[key]
	if !found {
		if !pp.hasInferredFlag {
			return nil, false
		}
		// Use the cheapest model in the table as a conservative fallback so
		// we still surface a number for OpenCode/Codex/Gemini.
		for _, p := range pp.models {
			if pricing.Input == 0 || p.Input < pricing.Input {
				pricing = p
			}
		}
		if pricing.Input == 0 {
			return nil, true
		}
	}

	// For providers that distinguish cached vs uncached input, the input
	// bucket already excludes cached. For Claude we keep them in separate
	// buckets (cacheRead/cacheWrite) so input is uncached by definition.
	uncachedInput := inputTokens
	if cachedInputTokens > 0 && uncachedInput >= cachedInputTokens {
		uncachedInput = inputTokens - cachedInputTokens
	}

	cost := (float64(uncachedInput)*pricing.Input +
		float64(cachedInputTokens)*pricing.CachedInput +
		float64(outputTokens)*pricing.Output +
		float64(cacheReadTokens)*pricing.CacheRead +
		float64(cacheWriteTokens)*pricing.CacheWrite +
		float64(reasoningTokens)*pricing.Reasoning) / 1_000_000.0

	return &cost, !found && pp.hasInferredFlag
}
