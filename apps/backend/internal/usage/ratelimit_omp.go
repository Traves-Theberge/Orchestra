package usage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
)

// runOMPUsage is swapped in tests. `omp usage --json --redact` queries every
// account omp is signed into; --redact keeps emails/ids out of the payload.
var runOMPUsage = func(ctx context.Context) ([]byte, error) {
	path, err := exec.LookPath("omp")
	if err != nil {
		return nil, err
	}
	return backgroundcommand.CommandContext(ctx, path, "usage", "--json", "--redact").Output()
}

func fetchOMPRateLimits(ctx context.Context) *ProviderRateLimits {
	out := &ProviderRateLimits{Provider: ProviderOMP, Source: "omp_usage", UpdatedAt: time.Now().UnixMilli()}
	readCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	raw, err := runOMPUsage(readCtx)
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			out.Status, out.Error = RateLimitUnavailable, "omp is not installed"
			return out
		}
		out.Status, out.Error = RateLimitErrored, fmt.Sprintf("omp usage: %v", err)
		return out
	}
	limits, err := parseOMPUsage(raw)
	if err != nil {
		out.Status, out.Error = RateLimitErrored, err.Error()
		return out
	}
	limits.Source, limits.UpdatedAt = out.Source, out.UpdatedAt
	return limits
}

// parseOMPUsage folds omp's per-provider limit reports into the two windows
// the roster shows: the busiest window of a day or less ("session") and the
// busiest longer window ("weekly"). omp aggregates several provider accounts,
// so the label names the provider whose window is reported.
func parseOMPUsage(raw []byte) (*ProviderRateLimits, error) {
	var doc struct {
		Reports *[]struct {
			Provider string `json:"provider"`
			Limits   []struct {
				Label  string `json:"label"`
				Window struct {
					DurationMs int64  `json:"durationMs"`
					ResetsAt   *int64 `json:"resetsAt"`
					Label      string `json:"label"`
				} `json:"window"`
				Amount struct {
					UsedFraction *float64 `json:"usedFraction"`
				} `json:"amount"`
			} `json:"limits"`
		} `json:"reports"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil || doc.Reports == nil {
		return nil, errors.New("omp usage response is malformed")
	}
	out := &ProviderRateLimits{Provider: ProviderOMP, Status: RateLimitOK}
	var providers []string
	pick := func(current *RateLimitWindow, used float64, minutes int, resets *int64, label string) *RateLimitWindow {
		if current != nil && current.UsedPercent >= used*100 {
			return current
		}
		window := &RateLimitWindow{UsedPercent: used * 100, WindowMinutes: minutes, ResetDescription: label}
		if resets != nil {
			seconds := *resets / 1000
			window.ResetsAt = &seconds
		}
		return window
	}
	for _, report := range *doc.Reports {
		providers = append(providers, report.Provider)
		for _, limit := range report.Limits {
			if limit.Amount.UsedFraction == nil || limit.Window.DurationMs <= 0 {
				continue
			}
			minutes := int(limit.Window.DurationMs / 60000)
			label := report.Provider + " · " + firstNonEmptyString(limit.Window.Label, limit.Label)
			if limit.Window.DurationMs <= int64(24*time.Hour/time.Millisecond) {
				out.Session = pick(out.Session, *limit.Amount.UsedFraction, minutes, limit.Window.ResetsAt, label)
			} else {
				out.Weekly = pick(out.Weekly, *limit.Amount.UsedFraction, minutes, limit.Window.ResetsAt, label)
			}
		}
	}
	if out.Session == nil && out.Weekly == nil {
		out.Status, out.Error = RateLimitUnavailable, "omp reported no usage windows for its signed-in accounts"
	}
	out.AccountLabel = strings.Join(providers, ", ")
	return out, nil
}

func firstNonEmptyString(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
