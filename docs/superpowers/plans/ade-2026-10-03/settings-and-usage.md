# Settings and usage adaptation: executable packages

Preserve Kanban, native CLI sessions and a shared control/observation service. Every package follows [both pinned references](reference-patterns.md), records revisions/adaptations/deviations and earns independent Orchestra evidence. A settings value is requested intent; provider observation establishes effective configuration. A usage estimate is not an invoice or subscription charge.

## S1 Configuration reads and ownership

Implemented first slice: [settings handoff](../../../testing/ade-settings-native-scope-2026-10-04.md). Failed reads block editors; target/sequence fences prevent delayed reads from replacing another scope; Claude scoped writes align with reads; unsupported project MCP mutation cannot target global files.

Next steps:
1. Inventory read/write destinations for every native resource and expose backend, provider, project/worktree, absolute file path and scope above each editor.
2. Add per-resource availability and prior-snapshot version, allowing successfully read resources while withholding failed ones.
3. Retain dirty drafts separately from fetched snapshots and fence mutation completion by target/version.
4. Add explicit reset-to-inherited operations with backend-owned scope validation; preserve unknown native fields.

Acceptance: isolated fixture tests inject missing files separately from 401/403/timeout/500, switch scopes during reads/saves, and prove project changes never affect account configuration. Failed save preserves edits; reset clears only the selected override.

## S2 Provider/runtime capability settings

1. Separate CLI executable discovery, supported transport, configured account, observed login and successful canary into distinct states.
2. Expose native launch command and runtime placement without sharing dangerous batch flags. Codex safe app-server default is implemented; other providers need individual native adapters.
3. Present runtime-reported model catalog and reasoning options. Keep requested model separate from effective model and invalidate observations when provider/profile changes.
4. Mark Gemini controls as historical configuration; represent Antigravity independently when its transport is implemented and verified.

Acceptance: unsupported or absent transport cannot appear Ready; catalog access does not imply model entitlement. No catalog refresh creates a provider thread or inference. A model change affects the next admitted turn only, with both requested and observed values retained.

## S3 Scoped defaults and admitted-run provenance

1. Define defaults through backend/environment, repository/project, linked worktree, task and admitted run. Make conversation-level overrides explicit.
2. Persist requested provider/model/permissions/runtime with task identity and immutable admission snapshot. Show inherited source and reset at each supported tier.
3. Detect repository-local provider overrides including linked worktrees; distinguish detection from effective model observation.
4. Add a run configuration inspector shared by Kanban, workspace chat and CLI observations.

Acceptance: global A/project B/task C resolves to C with source shown; active runs keep admitted settings after defaults change. Restart preserves intent. Unsupported budgets/policies fail before workspace effects.

## S4 Usage observations and history

Implemented first slice: [usage UI handoff](../../../testing/ade-usage-ui-2026-10-04.md) and native session usage events. Unknown differs from measured zero; imported log statistics and live conversation counters stay distinct; backend/range fences prevent stale usage/quota responses. Costs are labeled API-equivalent estimates.

Next steps:
1. Define durable usage record keys with provider account/runtime/thread/turn/session and task/run/worktree attribution. Record source, capture time, completeness and coverage (main agent/subagents).
2. Normalize cumulative versus last-response counters per provider. Codex cache/reasoning values are subsets, not additive totals. Handle duplicated events, resume/compaction regressions and copied rollout history.
3. Reconcile native events with imported logs using shared event provenance so the same inference is counted once. Unmapped logs remain unattributed rather than assigned to the selected workspace.
4. Aggregate workspace/task/project/model/provider/range totals from deduplicated records. Keep context-window occupancy separate from cumulative billed usage.

Acceptance: two native turns and imported copies count once; restart/reconnect never doubles totals; compaction/resume does not create negative deltas or count prior history again; subagent coverage is visible; missing telemetry stays unknown. A context reset/model switch invalidates old occupancy until re-observed.

## S5 Limits, costs and orchestration budgets

1. Observe account quota windows and reset times with freshness, disabled/sign-out/error/unavailable/backoff states. Preserve the last observation as explicitly cached on refresh failure.
2. Version pricing sources and allow clearly scoped overrides only for estimates. Unknown model pricing stays unknown; long-context tiers are evaluated per request, not a monthly aggregate threshold.
3. Keep subscription quota, API-equivalent estimate and invoice charges separate. Do not call a local log estimate money spent.
4. Define orchestration cost/token budget admission and stop/ask behavior before exposing budget controls. Reserve capacity per run; include retries/subagents and reconcile partial/unknown usage without inventing spend.

Acceptance: 429 has visible retry/backoff rather than indefinite loading; stale limits carry age/source; unknown-priced models do not show zero cost. A budget gate prevents new effects before admission and cannot be bypassed by simultaneous UI/CLI requests.

## S6 Settings navigation and workspace integration

1. Split Connections, Agents, Workspace/Worktrees, Orchestration, Usage/Limits, Review, Terminal and Appearance into focused searchable groups.
2. Add searchable labels/descriptions/synonyms and deep links that open the containing group and focus the setting. Preserve previous collapse state after clearing search.
3. Keep project/worktree/task/run context visible across settings, chat, files, terminal and PR review; coordinate existing project-selection state.
4. Reuse theme tokens, readable typography and accessible names. Hide or explicitly label unsupported platform/runtime controls.

Acceptance: model, approval, worktree, quota and terminal searches find the correct scope; keyboard navigation works; project switches cannot show another project's conversation/configuration/review; density/font/reduced-motion settings work without clipped controls.

## Source receipt for usage additions

T3 `737993303d36e10674c54b95e5bd3826682c99c7`: `apps/web/src/components/settings/UsageProviderSettings.tsx` scopes usage-source settings to environment and read-only access; `apps/web/src/components/chat/ComposerUsageLimits.tsx` presents account limits alongside composer; `apps/server/src/provider/CodexTurnTokenUsage.ts` and `TurnTokenUsage.test.ts` distinguish cumulative baseline/response increments, resumed history, duplicates, compaction, late turns and partial/unavailable accounting.

Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: `src/main/codex-usage/codex-usage-token-delta.ts` deduplicates copied records and treats mutable totals as baselines; `codex-usage-cost-estimate.test.ts` verifies request-based long-context tiers and unknown pricing; `src/shared/agent-session-context-usage.ts` distinguishes provider context reports, estimates and unknown states; `usage-roster-row-state.ts` separates confirmed sign-out from network/auth refresh errors.

Deliberate deviations: Orchestra retains Go/SQLite ownership, local usage import and Kanban. No copied pricing figures, account-key extraction, proxy hub integration or unsupported limit probe is introduced. Source/tests describe reference patterns; S3-S6 acceptance scenarios are still work to execute, not passing capabilities.
