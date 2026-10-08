# Local Diagnostics Implementation Plan

> For agentic workers: use subagent-driven-development for independent storage and renderer tasks, then integrate and review every capability. Track work with the checklist below.

**Goal:** Ship built-in local logs, metrics, usage, and waterfall traces accessible through Orchestra's navigation and task inspector, with independently verified persistence, privacy, and failure handling.

**Architecture:** A backend-owned diagnostics subsystem uses OpenTelemetry tracing and a bounded asynchronous processor to persist metadata to a dedicated SQLite file alongside the warehouse. The existing authenticated API exposes paginated reads and controls. The React desktop includes a lazy Diagnostics section, EvilCharts metric components, and a shared waterfall inspector; it requires no separately operated telemetry service.

**Tech stack:** Go, OpenTelemetry Go SDK, existing modernc SQLite, chi, React 19, existing Recharts/shadcn chart primitives, TanStack Virtual, Vitest, Go tests, and a real backend/renderer smoke test.

**Spec:** [Local telemetry design](../../plans/2026-10-07-local-telemetry-plan.md).

## Global constraints

- No external telemetry services, separately installed servers, outbound reporting, or runtime CDN assets.
- Preserve Kanban, native provider chat, shared control boundaries, existing provider log ingestion, and existing task/conversation records.
- Store only allowed operational metadata; never copy prompts, responses, credentials, tool inputs/results, commands, or raw paths into diagnostics.
- Detailed retention: 7 days. Metric retention: 30 days. Default telemetry budget: 250 MiB. Settings persist locally and validate bounds.
- Telemetry writes never block task execution. Bounded overflow and store failures increment health counters.
- Failures, interruptions, partial traces, missing provider usage, and estimated costs must be explicit; no inferred success.
- Exact storage interfaces and JSON contracts below are shared across independently implemented tasks. Integration changes are recorded as rulings in the execution ledger.
- Dependencies are built into the app. Downloading open-source build dependencies does not introduce an external runtime service.

## Discovery and reference receipt

Inspected Orchestra files: `internal/app/run.go` owns startup, worker dispatch and provider invocation; `internal/workspacechat/service.go` owns accepted conversation turns; `native.go` owns native events; `internal/api/router.go` owns protected routes; `internal/db/db.go` owns the single-connection WAL warehouse. `src/layout/sections.tsx` owns navigation; `App.tsx` lazily mounts heavy sections; `features/issue-detail/IssueDetailView.tsx` owns the live task inspector. Recharts 3.8 and TanStack Virtual already exist. Existing `internal/telemetry` imports provider logs; it does not prove operation durations.

Pinned reference registry: `docs/superpowers/plans/ade-2026-10-03/reference-patterns.md`.

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`, `apps/server/src/orchestration-v2/ProviderAdapter.ts`: observed distinct app/run/attempt/provider-turn/runtime-request identities and explicit completed/interrupted/cancelled/failed terminal events. Adapt by retaining task/run/session identities as span attributes, separate attempt spans, and honest terminal statuses. Deviation: Go SDK with local SQLite, no copied Effect implementation.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, `src/cli/handlers/orchestration/mutation-request.ts`: observed retries reuse request identity and preserve uncertain delivery evidence. `src/main/native-chat/agent-session-journal/journal-dispatch-observation.test.ts`: observed fence-specific pending/accepted/unknown observations. Adapt by recording retries separately, preserving correlation, and marking incomplete operations unknown after recovery. Deviation: telemetry observes existing control semantics and never becomes an execution authority.
- Neither reference runtime was run in this session. Associated T3 `CodexAdapterV2.ts` implementation/tests and Orca mutation/journal implementation/tests were also inspected, preserving queued-versus-started work, terminal identity, delivery uncertainty, and fence-specific observations. Independent Orchestra behavior and deviations are recorded in [the verification receipt](../../testing/local-diagnostics-2026-10-07.md).

## Shared interfaces and routes

Create `apps/backend/internal/diagnostics` with `Open(path string, Options) (*Service, error)`, `Close() error`, `Flush(context.Context) error`, and `Start(context.Context, string, Fields) (context.Context, *Span)`. A nil service returns no-op spans. `Span.End(status string)`, `Span.Event(name, severity string)`, and `Span.Usage(input, output int64)` record only defined metadata. Initial status is `running`; outcomes are `ok`, `error`, `cancelled`, `unknown`. Child spans inherit correlation fields. Use W3C context propagation for owned HTTP boundaries.

`Fields` carries ProjectID, TaskID, RunID, SessionID, Provider, Model, Attempt. Avoid raw arbitrary attributes. Operation names are constants at call sites. Each span/event has real observed timestamps and OTel trace/span IDs. Usage absence remains absent; do not turn unknown into zero.

Service queries: `ListTraces(ctx, Filter) (TracePage,error)`, `Trace(ctx,id) (TraceDetail,error)`, `Logs(ctx, Filter) (LogPage,error)`, `Overview(ctx, Filter) (Overview,error)`, `Settings(ctx) (Settings,error)`, `UpdateSettings(ctx, Settings) error`, `Clear(ctx) error`, and `Export(ctx, Filter) (Export,error)`.

Protected routes under `/api/v1/diagnostics`: GET `/traces`, GET `/traces/{trace_id}`, GET `/logs`, GET `/overview`, GET `/settings`, PUT `/settings`, DELETE `/history`, GET `/export`. List filters use `project_id`, `task_id`, `provider`, `status`, `q`, `since`, `until`, `limit`, `offset`; validate and bound all queries. Default page 100, maximum 500; sort deterministically. Export is bounded and identifies truncation. Pagination responses contain `items`, `total`, `limit`, `offset`.

JSON span fields: `trace_id`, `span_id`, `parent_span_id`, `name`, `start_time`, optional `end_time`, `duration_ms`, `status`, `project_id`, `task_id`, `run_id`, `session_id`, `provider`, `model`, `attempt`, optional `input_tokens`/`output_tokens`. Trace summary adds `span_count`; trace detail returns `trace`, `spans`, `logs`, `partial`. Logs contain `id`, `trace_id`, `span_id`, `timestamp`, `name`, `severity`, and correlation fields. Settings contain `enabled`, `retention_days`, `metrics_retention_days`, `max_storage_mb`.

Overview contains `total_traces`, `failed_traces`, `active_traces`, `dropped_records`, `storage_bytes`, `queue_depth`, `points`, `operations`, `usage`, `features`, `runtime`, and `settings`. Points contain `time`, `operations`, `errors`, `duration_ms`, `input_tokens`, `output_tokens`. Operations contain `name`, `count`, `errors`, `average_duration_ms`. Usage contains `provider`, `input_tokens`, `output_tokens`, `known_runs`. Features contain `name`, `count`. Runtime contains `goroutines`, `heap_bytes`. Use aggregate tables independent of detailed span retention; do not report percentiles without histogram evidence.

## Review focus

- A disabled or broken diagnostics store must not change task/provider results.
- Clearing diagnostics during an active run must not resurrect deleted history through delayed writes.
- Reused native sessions must correlate events to the current turn, never the turn that created the provider process.
- End events can arrive after cancellation or restart; preserve unknown state and reject incorrect duplicate completions.
- Large data, invalid query bounds, missing parents, and cycles must not freeze the renderer or trigger unbounded API reads.

## Tasks

### 1. Durable local recorder, queries and retention

Files: create `internal/diagnostics/{types,service,store,query}.go` and behavioral `*_test.go`; modify backend `go.mod`/`go.sum` for pinned OpenTelemetry.

- [x] Write tests for nested OTel spans, inherited identity, persistence/reopen, terminal idempotence, metadata privacy, and disabled/store-failure no-op behavior; observe failures before implementation.
- [x] Implement the shared interfaces with a bounded queue and dedicated SQLite database; preserve active start records and independently aggregate completed operations/usage.
- [x] Test query filters/paging, retention, eviction/storage health, settings persistence/validation, bounded export, and clear-during-active-run.
- [x] Run `go test ./internal/diagnostics`; record actual failures/passes and any interface ruling.

### 2. Authenticated API and application instrumentation

Files: create `internal/api/diagnostics.go`, `diagnostics_test.go`; modify `router.go`, `internal/app/run.go`, `internal/workspacechat/{service,native}.go`; add focused integration tests. Additional provider boundary files are changed only if required after inspecting actual event formats.

- [x] Write API tests for every route, authentication, invalid filters/settings, unknown traces, unavailable recorder, and exports excluding secrets; observe failures.
- [x] Start recorder beside warehouse and close after producers stop. Inject it through existing optional router extras and explicit service configuration; handle initialization failure without failing app startup.
- [x] Trace HTTP operations, asynchronous conversation turns, task worker attempts, provider startup/calls, tool execution, known native tool item lifetimes, and approvals where exact start/end evidence exists.
- [x] Transfer parent context without request cancellation terminating background runs. Reused native callbacks resolve current turn identity. Events exclude content and failed finalization must not appear successful.
- [x] Verify `go test ./internal/api ./internal/workspacechat ./internal/app`; extend auth route matrix and OpenAPI spec.

### 3. Diagnostics menu, metrics, logs and waterfall

Files: create `src/features/diagnostics/{api,DiagnosticsPage,TraceWaterfall,TaskTimeline}` and tests; modify `layout/sections.tsx`, `App.tsx`, and `features/issue-detail/IssueDetailView.tsx`. Adapt/install inspected EvilCharts components with license attribution in a dedicated chart file; use existing dependencies.

- [x] Write tests for menu registration, API loading/error/disabled states, filters, span selection, nested/concurrent/retry bars, partial traces, cycles/missing parents, and task-specific query; observe failures.
- [x] Implement Overview/Runs/Logs/Usage/Settings using shared contracts and existing visual styles. Auto-refresh only while mounted/visible, with pause and last update indicators; discard stale requests on profile/filter changes.
- [x] Render trace rows with bounded/virtualized data, collapse/expand and zoom. Clicking a span shows its metadata and linked log events. Preserve unknown usage, avoid invented costs, and support keyboard selection/reduced motion.
- [x] Add task Timeline using the same inspector and task/project filters. Settings validate retention/budget, clear only diagnostic history with deliberate confirmation, and export a local sanitized file.
- [x] Run focused Vitest tests, `npm run typecheck`, and `npm run build`; verify bundled UI has no external asset dependency.

### 4. Whole-system behavioral verification and handoff

Files: create `apps/desktop/scripts/diagnostics-smoke.mjs` and `docs/testing/local-diagnostics-2026-10-07.md`; update `docs/backend/telemetry.md` and the design/plan ledger with verified capabilities and limitations.

- [x] Run a spawned real backend and renderer against an isolated temporary workspace; exercise collection, navigation, waterfalls, errors, linked logs, settings, and export without a telemetry service.
- [x] Use controlled local provider fixtures for repeatable retries/concurrency/cancellation and a real installed provider path where available. Distinguish fixture evidence from actual provider evidence.
- [x] Restart/reopen storage, force ingestion/store failure and small storage limits, seed sensitive markers, and measure representative large-history rendering and collection overhead.
- [x] Run backend full tests/build, applicable race checks, desktop tests/typecheck/build, and relevant existing smoke flows. Record environmental limitations honestly.
- [x] Request task and final code review; resolve important findings and rerun affected checks. Capture UI screenshots and evidence. Only mark complete after every required component is integrated and verified.

## Execution notes

Feature branch: `feat/local-diagnostics`. Initial checkout was clean apart from this task's design draft. Work remains in the shared checkout to preserve the user's running app context; no separate checkout is created without a stated preference. User has explicitly requested planning, integration, and full verification, then said to continue; do not re-request authorization for those reversible steps. Do not merge, push, publish, or commit unrelated files.
