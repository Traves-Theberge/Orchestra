package usage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// Anthropic OAuth usage endpoint — same one Claude Code's `/usage` reads.
// Returns five_hour and seven_day windows for Max/Pro subscription users.
const (
	claudeOAuthUsageURL     = "https://api.anthropic.com/api/oauth/usage"
	claudeOAuthBeta         = "oauth-2025-04-20"
	claudeFetchTimeout      = 10 * time.Second
	claudeDefault429Backoff = 10 * time.Minute
	claudeMax429Backoff     = 60 * time.Minute
)

// Module-level state for honoring 429 backoffs across coalesced callers.
// When the OAuth usage endpoint returns 429 we park further requests until
// `claude429Until`, returning the cached snapshot (if any) instead of
// hammering the API. Other Anthropic clients on the same machine (Orca,
// claude CLI, etc.) share the same per-account quota, so this avoids the
// runaway "request → 429 → error toast → retry → 429" loop.
var (
	claudeBackoffMu  sync.Mutex
	claude429Until   time.Time
	claudeLastResult *ProviderRateLimits
)

type claudeCredsFile struct {
	ClaudeAIOAuth struct {
		AccessToken      string `json:"accessToken"`
		ExpiresAt        int64  `json:"expiresAt"`
		RateLimitTier    string `json:"rateLimitTier,omitempty"`
		SubscriptionType string `json:"subscriptionType,omitempty"`
	} `json:"claudeAiOauth"`
}

type claudeOAuthWindow struct {
	Utilization *float64 `json:"utilization"`
	ResetsAt    string   `json:"resets_at"`
}

type claudeOAuthUsageResponse struct {
	FiveHour *claudeOAuthWindow `json:"five_hour"`
	SevenDay *claudeOAuthWindow `json:"seven_day"`
}

// readClaudeOAuthToken returns a usable bearer token from the local Claude
// credentials file, or ("", nil) if the user is on API-key billing (no
// subscription windows to fetch). Errors are returned only for malformed
// state we can't reason about.
func readClaudeOAuthToken() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(home, ".claude", ".credentials.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	var creds claudeCredsFile
	if err := json.Unmarshal(raw, &creds); err != nil {
		return "", err
	}
	tok := creds.ClaudeAIOAuth.AccessToken
	if tok == "" {
		return "", nil
	}
	if creds.ClaudeAIOAuth.ExpiresAt > 0 && creds.ClaudeAIOAuth.ExpiresAt < time.Now().UnixMilli() {
		return "", nil
	}
	return tok, nil
}

func mapClaudeWindow(w *claudeOAuthWindow, windowMinutes int) *RateLimitWindow {
	if w == nil || w.Utilization == nil {
		return nil
	}
	pct := *w.Utilization
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	out := &RateLimitWindow{
		UsedPercent:   pct,
		WindowMinutes: windowMinutes,
	}
	if w.ResetsAt != "" {
		if t, err := time.Parse(time.RFC3339, w.ResetsAt); err == nil {
			ms := t.UnixMilli()
			out.ResetsAt = &ms
			out.ResetDescription = formatResetDescription(t)
		}
	}
	return out
}

func formatResetDescription(t time.Time) string {
	now := time.Now()
	if t.Year() == now.Year() && t.YearDay() == now.YearDay() {
		return t.Local().Format("3:04 PM")
	}
	return t.Local().Format("Mon 3:04 PM")
}

// parseRetryAfter accepts seconds-as-int or HTTP-date (RFC1123). Returns
// zero if neither form parses.
func parseRetryAfter(h string) time.Duration {
	if h == "" {
		return 0
	}
	if secs, err := strconv.Atoi(h); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	if t, err := http.ParseTime(h); err == nil {
		d := time.Until(t)
		if d > 0 {
			return d
		}
	}
	return 0
}

// fetchClaudeRateLimits returns live session/weekly windows from the
// Anthropic OAuth usage endpoint. Honors 429 with a Retry-After backoff so
// we don't hammer Anthropic when other clients (Orca, the CLI) are sharing
// the same per-account quota.
func fetchClaudeRateLimits(ctx context.Context) *ProviderRateLimits {
	now := time.Now()
	nowMs := now.UnixMilli()

	// Park if we're inside an active 429 window — keep the user's UI quiet:
	// when we have a recent snapshot, return it as-is (Status=OK, no error)
	// so the bar/popover just keep showing real numbers. When we have nothing
	// cached yet, fall through to a `fetching` state so the UI shows a loader
	// instead of an alarming red banner.
	claudeBackoffMu.Lock()
	if !claude429Until.IsZero() && now.Before(claude429Until) {
		last := claudeLastResult
		claudeBackoffMu.Unlock()
		if last != nil && (last.Session != nil || last.Weekly != nil) {
			out := *last
			// Do not bump UpdatedAt — leaving it on the original successful
			// fetch keeps the "updated Xm ago" badge honest.
			out.Status = RateLimitOK
			out.Error = ""
			return &out
		}
		return &ProviderRateLimits{
			Provider:  ProviderClaude,
			Status:    RateLimitFetching,
			UpdatedAt: nowMs,
		}
	}
	claudeBackoffMu.Unlock()

	token, err := readClaudeOAuthToken()
	if err != nil {
		return &ProviderRateLimits{
			Provider:  ProviderClaude,
			Status:    RateLimitErrored,
			UpdatedAt: nowMs,
			Error:     fmt.Sprintf("read credentials: %v", err),
		}
	}
	if token == "" {
		res := &ProviderRateLimits{
			Provider:  ProviderClaude,
			Status:    RateLimitUnavailable,
			UpdatedAt: nowMs,
			Error:     "No Claude OAuth token found — API-key billing has no plan windows",
		}
		claudeBackoffMu.Lock()
		claudeLastResult = res
		claudeBackoffMu.Unlock()
		return res
	}

	reqCtx, cancel := context.WithTimeout(ctx, claudeFetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, claudeOAuthUsageURL, nil)
	if err != nil {
		return &ProviderRateLimits{
			Provider: ProviderClaude, Status: RateLimitErrored, UpdatedAt: nowMs,
			Error: err.Error(),
		}
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("anthropic-beta", claudeOAuthBeta)

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return &ProviderRateLimits{
			Provider: ProviderClaude, Status: RateLimitErrored, UpdatedAt: nowMs,
			Error: err.Error(),
		}
	}
	defer res.Body.Close()

	// 429 — engage backoff silently. Keep showing cached numbers as OK so the
	// user's UI doesn't yell about something they can't act on. If we have no
	// cache yet, return fetching (loader) instead of an error banner.
	if res.StatusCode == http.StatusTooManyRequests {
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 512))
		retryAfter := parseRetryAfter(res.Header.Get("Retry-After"))
		if retryAfter <= 0 {
			retryAfter = claudeDefault429Backoff
		}
		if retryAfter > claudeMax429Backoff {
			retryAfter = claudeMax429Backoff
		}
		claudeBackoffMu.Lock()
		claude429Until = time.Now().Add(retryAfter)
		last := claudeLastResult
		claudeBackoffMu.Unlock()
		if last != nil && (last.Session != nil || last.Weekly != nil) {
			out := *last
			out.Status = RateLimitOK
			out.Error = ""
			return &out
		}
		return &ProviderRateLimits{
			Provider:  ProviderClaude,
			Status:    RateLimitFetching,
			UpdatedAt: nowMs,
		}
	}

	if res.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 512))
		return &ProviderRateLimits{
			Provider: ProviderClaude, Status: RateLimitErrored, UpdatedAt: nowMs,
			Error: fmt.Sprintf("Usage API returned %d", res.StatusCode),
		}
	}
	var data claudeOAuthUsageResponse
	if err := json.NewDecoder(res.Body).Decode(&data); err != nil {
		return &ProviderRateLimits{
			Provider: ProviderClaude, Status: RateLimitErrored, UpdatedAt: nowMs,
			Error: err.Error(),
		}
	}
	out := &ProviderRateLimits{
		Provider:  ProviderClaude,
		Session:   mapClaudeWindow(data.FiveHour, 300),
		Weekly:    mapClaudeWindow(data.SevenDay, 10080),
		UpdatedAt: time.Now().UnixMilli(),
		Status:    RateLimitOK,
	}
	claudeBackoffMu.Lock()
	claude429Until = time.Time{} // clear on success
	claudeLastResult = out
	claudeBackoffMu.Unlock()
	return out
}
