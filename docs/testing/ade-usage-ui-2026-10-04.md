# Usage UI handoff, 2026-10-04

## Reference patterns

Inspected pinned T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`, `apps/server/src/provider/CodexTurnTokenUsage.ts` and `TurnTokenUsage.test.ts`. Native turn accounting distinguishes unavailable/partial/complete and main-agent scope; it baselines resumed thread totals, avoids duplicate cumulative updates, handles compaction resets and excludes late prior-turn observations. Cache and reasoning tokens are subsets, not extra additive billable buckets. A zero crash result is not a measured zero-cost turn.

Inspected pinned Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, `src/main/codex-usage/codex-usage-token-delta.ts` and `codex-usage-cost-estimate.test.ts`. Log deltas separate baseline from billable events, exclude duplicate/stale cumulative snapshots, key copied fork/resume records by raw usage tuples, and avoid counting reasoning twice. Cost tests distinguish per-request long-context rates from a large sum of short requests; unknown model pricing returns null.

Root-provided source inspection cache: `%LOCALAPPDATA%/Orchestra/diagnostics/settings-usage-reference`. The [pinned registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md) provides reference URLs. These source findings establish patterns only; no reference app runtime or actual provider billing was tested in this package.

## Orchestra changes

The local-log analytics page and provider-reported rate-limit windows remain distinct surfaces. Unknown scan state is now visibly unknown rather than an unchecked analytics toggle. Missing or invalid counters and pricing remain Unknown; actual measured zero is still zero. All session-table cost headers state estimated API-equivalent cost, and the page states these are not subscription charges or invoices. Gemini is labeled legacy CLI logs; no Antigravity telemetry is invented.

`use-usage.ts` fences usage loads, enable-toggle replies and rate-limit observations by selected backend/token, scope, range and generation, in addition to each provider's request token. Old rate-limit reads can no longer start old-profile scans after a profile switch. New selection hides the previous selection's totals immediately. Disconnect clears observations. Failures stay visible, including rate-limit backoff errors, and local usage can load after a failed quota read.

`UsageStatusBar.tsx` independently fences old profile and superseded responses, marks failed observations Unknown, and keeps cached values labeled with their error instead of suppressing 429/backoff messages. Account logs were not removed, provider account settings were not edited, and tests used only mocked API boundaries.

Deliberate scope: this package changes renderer evidence presentation and ownership fences. It does not rewrite the backend log parser, introduce provider pricing tables, assume native-thread totals are per-turn increments, or merge the new workspace-chat usage event stream into imported log analytics.

## Verification and remaining gaps

`npx vitest run src/features/usage`: 9 tests passed across hook, formatter, page and status bar. They cover stale range summaries, old-profile rate limits and toggles, disconnect clearing, visible 429 errors, absent-versus-zero measurements, estimated-cost labels, historical-provider labels and cached status-bar data. `npm run typecheck` passed. `npx eslint src/features/usage` completed with zero errors and six existing component-export warnings.

The UI checks do not establish parser deduplication or billing correctness. Remaining work: durable per-turn native usage with explicit completeness/scope, imports versus native-stream deduplication, task/run/worktree attribution, child-agent accounting boundaries, unknown-field provenance, and pricing-source/version receipts. Real account quotas and provider log ingestion require independent read-only canaries before reliability claims.
