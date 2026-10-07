package usage

import (
	"context"
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/harnessaccounts"
	"os"
	"sort"
	"sync"
	"time"
)

// scanFn is the per-provider scan function signature.
type scanFn func(
	now time.Time,
	prevFiles map[string]ProcessedFile,
	prevSessions []Session,
	prevDaily []DailyAggregate,
	wt worktreeIndex,
) (
	files []ProcessedFile,
	sessions []Session,
	daily []DailyAggregate,
	sourceExists bool,
	err error,
)

// WorktreeProvider is the small interface Service depends on for
// project-aware attribution. Implementations live in the orchestrator.
type WorktreeProvider interface {
	WorktreeEntries() []WorktreeEntry
}

// WorktreeEntry is the public, package-stable shape used by callers.
type WorktreeEntry struct {
	Path       string
	ProjectKey string
	Label      string
	WorktreeID string
	RepoID     string
}

// Service is the entry point for everything usage-related.
type Service struct {
	accounts     *harnessaccounts.Store
	store        *store
	worktreesFn  func() []WorktreeEntry
	mu           sync.Mutex
	inflight     map[Provider]chan struct{}
	scanners     map[Provider]scanFn
	sourceCache  map[Provider]string // last known source path
	sourceExists map[Provider]bool

	// Rate-limit cache: probes are slow (HTTP / subprocess) and the windows
	// move on the order of minutes, so we cache for rateLimitTTL and only
	// refresh on demand or when force=true.
	rateLimitMu         sync.Mutex
	rateLimitCache      *RateLimitState
	rateLimitFetched    time.Time
	rateLimitInflight   chan struct{}
	rateLimitAccountKey string
	rateLimitEpoch      int64
}

func (s *Service) SetAccountStore(store *harnessaccounts.Store) {
	s.rateLimitMu.Lock()
	s.accounts = store
	s.rateLimitCache = nil
	s.rateLimitEpoch++
	s.rateLimitMu.Unlock()
}
func (s *Service) InvalidateRateLimits() {
	s.rateLimitMu.Lock()
	s.rateLimitCache = nil
	s.rateLimitEpoch++
	s.rateLimitMu.Unlock()
}

// Anthropic and Codex windows tick on the order of minutes; polling more
// often than this just burns 429s when other clients (Orca, the CLI) share
// the same per-account quota.
const rateLimitTTL = 5 * time.Minute

// NewService constructs a Service rooted at storageDir. worktrees may be nil
// (sessions then attribute by cwd's last two segments only).
func NewService(storageDir string, worktrees func() []WorktreeEntry) (*Service, error) {
	st, err := newStore(storageDir)
	if err != nil {
		return nil, err
	}
	return &Service{
		store:        st,
		worktreesFn:  worktrees,
		inflight:     map[Provider]chan struct{}{},
		sourceCache:  map[Provider]string{},
		sourceExists: map[Provider]bool{},
		scanners: map[Provider]scanFn{
			ProviderClaude:   scanClaude,
			ProviderCodex:    scanCodex,
			ProviderGemini:   scanGemini,
			ProviderOpenCode: scanOpenCode,
			ProviderOMP:      scanOMP,
		},
	}, nil
}

func (s *Service) buildIndex() worktreeIndex {
	if s.worktreesFn == nil {
		return newWorktreeIndex(nil)
	}
	pub := s.worktreesFn()
	wts := make([]worktreeEntry, 0, len(pub))
	for _, e := range pub {
		wts = append(wts, worktreeEntry{
			Path:       e.Path,
			ProjectKey: e.ProjectKey,
			Label:      e.Label,
			WorktreeID: e.WorktreeID,
			RepoID:     e.RepoID,
		})
	}
	return newWorktreeIndex(wts)
}

// SourcePath returns the local filesystem root we'd scan for a provider.
func (s *Service) SourcePath(p Provider) string {
	switch p {
	case ProviderClaude:
		return ClaudeSourceDir()
	case ProviderCodex:
		return CodexSourceDir()
	case ProviderGemini:
		return GeminiSourceDir()
	case ProviderOpenCode:
		return OpenCodeSourceDir()
	case ProviderOMP:
		return OMPSourceDir()
	}
	return ""
}

// SetEnabled toggles scanning for a provider. When enabling, runs a refresh.
func (s *Service) SetEnabled(ctx context.Context, p Provider, enabled bool) (ScanState, error) {
	state, err := s.store.load(p)
	if err != nil {
		return ScanState{}, err
	}
	state.ScanState.Enabled = enabled
	if !enabled {
		state.ScanState.LastScanError = ""
	}
	if err := s.store.save(p, state); err != nil {
		return ScanState{}, err
	}
	if enabled {
		return s.Refresh(ctx, p, false)
	}
	return s.scanState(p, state), nil
}

// ScanState returns current scanner state without triggering a refresh.
func (s *Service) ScanState(p Provider) (ScanState, error) {
	state, err := s.store.load(p)
	if err != nil {
		return ScanState{}, err
	}
	return s.scanState(p, state), nil
}

func (s *Service) scanState(p Provider, state *PersistedState) ScanState {
	src := s.SourcePath(p)
	exists, known := s.sourceExists[p]
	if !known && src != "" {
		// Cheap stat so the UI can decide whether to allow enabling without
		// having to first run a scan.
		if info, err := os.Stat(src); err == nil && info.IsDir() {
			exists = true
		}
		s.sourceExists[p] = exists
	}
	out := ScanState{
		Provider:         p,
		Enabled:          state.ScanState.Enabled,
		HasAnyData:       len(state.Sessions) > 0 || len(state.DailyAggregates) > 0,
		SourcePath:       src,
		SourcePathExists: exists,
		LastScanError:    state.ScanState.LastScanError,
	}
	if state.ScanState.LastScanStartedAt > 0 {
		v := state.ScanState.LastScanStartedAt
		out.LastScanStartedAt = &v
	}
	if state.ScanState.LastScanCompletedAt > 0 {
		v := state.ScanState.LastScanCompletedAt
		out.LastScanCompletedAt = &v
	}
	return out
}

const refreshStaleThreshold = 5 * time.Minute

// Refresh runs the provider's scanner if data is stale (>5min since last
// completion) or if force=true. Concurrent calls coalesce.
func (s *Service) Refresh(ctx context.Context, p Provider, force bool) (ScanState, error) {
	state, err := s.store.load(p)
	if err != nil {
		return ScanState{}, err
	}
	if !state.ScanState.Enabled {
		return s.scanState(p, state), nil
	}

	// Coalesce concurrent calls.
	s.mu.Lock()
	if ch, ok := s.inflight[p]; ok {
		s.mu.Unlock()
		<-ch
		state2, _ := s.store.load(p)
		return s.scanState(p, state2), nil
	}
	if !force && state.ScanState.LastScanCompletedAt > 0 {
		age := time.Now().UnixMilli() - state.ScanState.LastScanCompletedAt
		if time.Duration(age)*time.Millisecond < refreshStaleThreshold {
			s.mu.Unlock()
			return s.scanState(p, state), nil
		}
	}
	done := make(chan struct{})
	s.inflight[p] = done
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.inflight, p)
		s.mu.Unlock()
		close(done)
	}()

	scanner, ok := s.scanners[p]
	if !ok {
		return ScanState{}, fmt.Errorf("usage: unknown provider %q", p)
	}

	startedAt := time.Now().UnixMilli()
	state.ScanState.LastScanStartedAt = startedAt

	prevFiles := map[string]ProcessedFile{}
	for _, f := range state.ProcessedFiles {
		prevFiles[f.Path] = f
	}

	files, sessions, daily, sourceExists, scanErr := scanner(time.Now(), prevFiles, state.Sessions, state.DailyAggregates, s.buildIndex())
	s.sourceExists[p] = sourceExists
	if scanErr != nil {
		state.ScanState.LastScanError = scanErr.Error()
		_ = s.store.save(p, state)
		return s.scanState(p, state), scanErr
	}
	state.ProcessedFiles = files
	state.Sessions = sessions
	state.DailyAggregates = daily
	state.ScanState.LastScanCompletedAt = time.Now().UnixMilli()
	state.ScanState.LastScanError = ""
	state.WorktreeFingerprint = s.buildIndex().fingerprint()

	if err := s.store.save(p, state); err != nil {
		return ScanState{}, err
	}
	return s.scanState(p, state), nil
}

// ===== Query helpers =====

func filterDaily(daily []DailyAggregate, scope Scope, cutoff time.Time) []DailyAggregate {
	out := make([]DailyAggregate, 0, len(daily))
	cutoffDay := ""
	if !cutoff.IsZero() {
		cutoffDay = cutoff.UTC().Format("2006-01-02")
	}
	for _, d := range daily {
		if scope == ScopeOrchestra && d.WorktreeID == "" {
			continue
		}
		if cutoffDay != "" && d.Day < cutoffDay {
			continue
		}
		out = append(out, d)
	}
	return out
}

func filterSessions(sessions []Session, scope Scope, cutoff time.Time) []Session {
	out := make([]Session, 0, len(sessions))
	for _, s := range sessions {
		if scope == ScopeOrchestra && s.WorktreeID == "" {
			continue
		}
		if !cutoff.IsZero() && s.LastTimestamp.Before(cutoff) {
			continue
		}
		out = append(out, s)
	}
	return out
}

// Summary aggregates filtered daily entries and computes derived KPIs.
func (s *Service) Summary(p Provider, scope Scope, r Range) (Summary, error) {
	state, err := s.store.load(p)
	if err != nil {
		return Summary{}, err
	}
	now := time.Now().UTC()
	cutoff := r.Cutoff(now)
	daily := filterDaily(state.DailyAggregates, scope, cutoff)
	sessions := filterSessions(state.Sessions, scope, cutoff)

	out := Summary{
		Provider:   p,
		Scope:      scope,
		Range:      r,
		Sessions:   len(sessions),
		HasAnyData: len(state.DailyAggregates) > 0,
	}
	byModel := map[string]int64{}
	byProject := map[string]int64{}
	var totalCost float64
	var costKnown bool
	var costMissing bool
	for _, d := range daily {
		out.Turns += d.TurnCount
		out.ZeroCacheReadTurns += d.ZeroCacheReadTurns
		out.InputTokens += d.InputTokens
		out.CachedInputTokens += d.CachedInputTokens
		out.OutputTokens += d.OutputTokens
		out.CacheReadTokens += d.CacheReadTokens
		out.CacheWriteTokens += d.CacheWriteTokens
		out.ReasoningTokens += d.ReasoningTokens
		if d.HasInferredPricing {
			out.HasInferredPricing = true
		}
		modelTokens := usageTotal(p, d.InputTokens, d.OutputTokens, d.CacheReadTokens, d.CacheWriteTokens, d.ReasoningTokens)
		byModel[d.Model] += modelTokens
		byProject[d.ProjectLabel] += modelTokens

		if cost := dailyCost(p, d); cost != nil {
			totalCost += *cost
			costKnown = true
		} else {
			costMissing = true
		}
	}
	out.TotalTokens = usageTotal(p, out.InputTokens, out.OutputTokens, out.CacheReadTokens, out.CacheWriteTokens, out.ReasoningTokens)
	if out.InputTokens+out.CacheReadTokens > 0 {
		v := float64(out.CacheReadTokens) / float64(out.InputTokens+out.CacheReadTokens)
		out.CacheReuseRate = &v
	}
	if p == ProviderCodex && out.InputTokens > 0 {
		v := float64(out.CachedInputTokens) / float64(out.InputTokens)
		out.CacheReuseRate = &v
	}
	if costKnown && !costMissing {
		out.EstimatedCostUSD = &totalCost
	}
	out.TopModel = topKey(byModel)
	out.TopProject = topKey(byProject)
	return out, nil
}

// Daily returns time-series points for the stacked chart.
func (s *Service) Daily(p Provider, scope Scope, r Range) ([]DailyPoint, error) {
	state, err := s.store.load(p)
	if err != nil {
		return nil, err
	}
	cutoff := r.Cutoff(time.Now().UTC())
	daily := filterDaily(state.DailyAggregates, scope, cutoff)
	byDay := map[string]*DailyPoint{}
	for _, d := range daily {
		pt, ok := byDay[d.Day]
		if !ok {
			pt = &DailyPoint{Day: d.Day}
			byDay[d.Day] = pt
		}
		pt.InputTokens += d.InputTokens
		pt.CachedInputTokens += d.CachedInputTokens
		pt.OutputTokens += d.OutputTokens
		pt.CacheReadTokens += d.CacheReadTokens
		pt.CacheWriteTokens += d.CacheWriteTokens
		pt.ReasoningTokens += d.ReasoningTokens
	}
	out := make([]DailyPoint, 0, len(byDay))
	for _, pt := range byDay {
		out = append(out, *pt)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Day < out[j].Day })
	return out, nil
}

// Breakdown pivots filtered daily by model or project.
func (s *Service) Breakdown(p Provider, scope Scope, r Range, kind BreakdownKind) ([]BreakdownRow, error) {
	state, err := s.store.load(p)
	if err != nil {
		return nil, err
	}
	cutoff := r.Cutoff(time.Now().UTC())
	daily := filterDaily(state.DailyAggregates, scope, cutoff)
	sessions := filterSessions(state.Sessions, scope, cutoff)

	type bucket struct {
		BreakdownRow
		sessionIDs  map[string]struct{}
		cost        float64
		costKnown   bool
		costMissing bool
	}
	keyer := func(d DailyAggregate) (string, string) {
		if kind == BreakdownByModel {
			label := d.Model
			if label == "" {
				label = "(unknown)"
			}
			return d.Model, label
		}
		return d.ProjectKey, d.ProjectLabel
	}
	sessionKeyer := func(sess Session) string {
		if kind == BreakdownByModel {
			return normalizeModel(p, sess.PrimaryModel)
		}
		return sess.ProjectKey
	}

	buckets := map[string]*bucket{}
	for _, d := range daily {
		k, label := keyer(d)
		b, ok := buckets[k]
		if !ok {
			b = &bucket{sessionIDs: map[string]struct{}{}}
			b.Key = k
			b.Label = label
			buckets[k] = b
		}
		b.Turns += d.TurnCount
		b.InputTokens += d.InputTokens
		b.CachedInputTokens += d.CachedInputTokens
		b.OutputTokens += d.OutputTokens
		b.CacheReadTokens += d.CacheReadTokens
		b.CacheWriteTokens += d.CacheWriteTokens
		b.ReasoningTokens += d.ReasoningTokens
		if cost := dailyCost(p, d); cost != nil {
			b.cost += *cost
			b.costKnown = true
		} else {
			b.costMissing = true
		}
		if d.HasInferredPricing {
			b.HasInferredPricing = true
		}
	}
	for _, sess := range sessions {
		k := sessionKeyer(sess)
		b, ok := buckets[k]
		if !ok {
			continue
		}
		b.sessionIDs[sess.SessionID] = struct{}{}
	}

	out := make([]BreakdownRow, 0, len(buckets))
	for _, b := range buckets {
		b.Sessions = len(b.sessionIDs)
		b.TotalTokens = usageTotal(p, b.InputTokens, b.OutputTokens, b.CacheReadTokens, b.CacheWriteTokens, b.ReasoningTokens)
		if b.costKnown && !b.costMissing {
			b.EstimatedCostUSD = &b.cost
		}
		out = append(out, b.BreakdownRow)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TotalTokens > out[j].TotalTokens })
	return out, nil
}

// Sessions returns the most recent sessions, newest first.
func (s *Service) Sessions(p Provider, scope Scope, r Range, limit int) ([]SessionRow, error) {
	state, err := s.store.load(p)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 25
	}
	cutoff := r.Cutoff(time.Now().UTC())
	filtered := filterSessions(state.Sessions, scope, cutoff)
	sort.Slice(filtered, func(i, j int) bool { return filtered[i].LastTimestamp.After(filtered[j].LastTimestamp) })
	if len(filtered) > limit {
		filtered = filtered[:limit]
	}
	out := make([]SessionRow, 0, len(filtered))
	for _, sess := range filtered {
		dur := int(sess.LastTimestamp.Sub(sess.FirstTimestamp).Minutes())
		if dur < 0 {
			dur = 0
		}
		row := SessionRow{
			Provider:           sess.Provider,
			SessionID:          sess.SessionID,
			LastActiveAt:       sess.LastTimestamp,
			DurationMinutes:    dur,
			ProjectLabel:       sess.ProjectLabel,
			Branch:             sess.Branch,
			Model:              sess.PrimaryModel,
			Turns:              sess.TurnCount,
			InputTokens:        sess.InputTokens,
			CachedInputTokens:  sess.CachedInputTokens,
			OutputTokens:       sess.OutputTokens,
			CacheReadTokens:    sess.CacheReadTokens,
			CacheWriteTokens:   sess.CacheWriteTokens,
			ReasoningTokens:    sess.ReasoningTokens,
			HasInferredPricing: sess.HasInferredPricing,
		}
		if sess.RecordedCostUSD != nil {
			row.EstimatedCostUSD = sess.RecordedCostUSD
		} else if cost, _ := estimateCost(p, sess.PrimaryModel, sess.InputTokens, sess.CachedInputTokens, sess.OutputTokens, sess.CacheReadTokens, sess.CacheWriteTokens, sess.ReasoningTokens); cost != nil && !sess.HasMixedModels {
			row.EstimatedCostUSD = cost
		}
		out = append(out, row)
	}
	return out, nil
}

// dailyCost prefers the harness-recorded cost over a pricing-table estimate.
func dailyCost(p Provider, d DailyAggregate) *float64 {
	if d.RecordedCostUSD != nil {
		return d.RecordedCostUSD
	}
	cost, _ := estimateCost(p, d.Model, d.InputTokens, d.CachedInputTokens, d.OutputTokens, d.CacheReadTokens, d.CacheWriteTokens, d.ReasoningTokens)
	return cost
}

func usageTotal(p Provider, input, output, cacheRead, cacheWrite, reasoning int64) int64 {
	// Codex and omp report reasoning tokens inside output.
	if p == ProviderCodex || p == ProviderOMP {
		reasoning = 0
	}
	return input + output + cacheRead + cacheWrite + reasoning
}

// RateLimits returns live quota data for each provider.
// - Claude: Anthropic OAuth /api/oauth/usage with the local credentials file.
// - Codex: codex app-server JSON-RPC.
// - Gemini / OpenCode: no public window concept — always Unavailable.
//
// Results are cached for rateLimitTTL; force=true refreshes immediately.
// Concurrent callers coalesce on the inflight refresh.
func (s *Service) RateLimits(ctx context.Context, force bool) RateLimitState {
	accountID, home, accountKey, accountLabel := "", "", "system_default", "Host default"
	if s.accounts != nil {
		selection := s.accounts.Active("CODEX")
		accountID = selection.AccountID
		accountKey = fmt.Sprintf("%s:%d", accountID, selection.Version)
		if accountID != "" {
			if account, err := s.accounts.Get(accountID); err == nil {
				accountLabel = account.Label
			}
			var err error
			home, err = s.accounts.Home("CODEX", accountID)
			if err != nil {
				state := s.unavailableState("selected account is unavailable")
				state.Claude = fetchClaudeRateLimits(ctx)
				state.Codex.AccountID = accountID
				return state
			}
		}
	}
	s.rateLimitMu.Lock()
	if !force && s.rateLimitCache != nil && s.rateLimitAccountKey == accountKey && time.Since(s.rateLimitFetched) < rateLimitTTL {
		out := *s.rateLimitCache
		s.rateLimitMu.Unlock()
		return out
	}
	if s.rateLimitInflight != nil {
		ch := s.rateLimitInflight
		s.rateLimitMu.Unlock()
		<-ch
		s.rateLimitMu.Lock()
		if s.rateLimitCache != nil && s.rateLimitAccountKey == accountKey {
			out := *s.rateLimitCache
			s.rateLimitMu.Unlock()
			return out
		}
		s.rateLimitMu.Unlock()
		return s.RateLimits(ctx, force)
	}
	done := make(chan struct{})
	s.rateLimitInflight = done
	epoch := s.rateLimitEpoch
	s.rateLimitMu.Unlock()

	defer func() {
		s.rateLimitMu.Lock()
		s.rateLimitInflight = nil
		close(done)
		s.rateLimitMu.Unlock()
	}()

	now := time.Now().UnixMilli()
	state := RateLimitState{
		Gemini:      &ProviderRateLimits{Provider: ProviderGemini, Status: RateLimitUnavailable, UpdatedAt: now, Error: "Gemini does not expose plan windows"},
		OpenCode:    &ProviderRateLimits{Provider: ProviderOpenCode, Status: RateLimitUnavailable, UpdatedAt: now, Error: "OpenCode does not expose plan windows"},
		Antigravity: &ProviderRateLimits{Provider: ProviderAntigravity, Status: RateLimitUnavailable, UpdatedAt: now, Error: "No verified Antigravity quota source"},
		Eightgent:   &ProviderRateLimits{Provider: Provider8gent, Status: RateLimitUnavailable, UpdatedAt: now, Error: "8gent has no unified subscription quota"},
	}
	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		state.OMP = fetchOMPRateLimits(ctx)
	}()
	go func() {
		defer wg.Done()
		state.Claude = fetchClaudeRateLimits(ctx)
	}()
	go func() {
		defer wg.Done()
		state.Codex = fetchCodexRateLimitsInHome(ctx, home)
		state.Codex.AccountID = accountID
		state.Codex.AccountLabel = accountLabel
		state.Codex.Source = "codex_app_server"
	}()
	wg.Wait()

	s.rateLimitMu.Lock()
	cached := state
	stale := epoch != s.rateLimitEpoch
	if !stale {
		s.rateLimitCache = &cached
		s.rateLimitAccountKey = accountKey
		s.rateLimitFetched = time.Now()
	}
	s.rateLimitMu.Unlock()
	if stale {
		return s.unavailableState("account selection changed; refresh usage")
	}
	return state
}

func (s *Service) unavailableState(reason string) RateLimitState {
	now := time.Now().UnixMilli()
	mk := func(p Provider) *ProviderRateLimits {
		return &ProviderRateLimits{Provider: p, Status: RateLimitUnavailable, UpdatedAt: now, Error: reason}
	}
	return RateLimitState{
		Claude:      mk(ProviderClaude),
		Codex:       mk(ProviderCodex),
		Gemini:      mk(ProviderGemini),
		OpenCode:    mk(ProviderOpenCode),
		Antigravity: mk(ProviderAntigravity),
		Eightgent:   mk(Provider8gent),
		OMP:         mk(ProviderOMP),
	}
}

func topKey(m map[string]int64) string {
	var best string
	var bestVal int64
	for k, v := range m {
		if v > bestVal {
			best = k
			bestVal = v
		}
	}
	return best
}
