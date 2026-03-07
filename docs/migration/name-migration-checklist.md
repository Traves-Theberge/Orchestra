# Orchestra Parity Checklist

Status legend: `[ ] pending`, `[-] in progress`, `[x] complete`

## Operating Rules

- [x] Build in place; keep implementation additive until parity gate approval.
- [x] Keep API routes stable under `/api/v1/*`.
- [x] Require tests and schemas for all new endpoint contracts.

## 1) Repository and Module Identity

- [x] Monorepo folders in place: `apps/`, `packages/`, `docs/`, `ops/`.
- [x] Canonical Go module path set in `apps/backend/go.mod`.
- [x] TS package namespace set as `@orchestra/*` (`packages/protocol/package.json`).

## 2) Runtime and Process Identity

- [x] Standard runtime IDs defined (`orchestra.orchestrator`, `orchestra.dashboard`).
- [x] Backend binary is `orchestrad`.
- [x] CLI wrapper is `orchestra start`.

## 3) Configuration and Workflow

- [x] Config loader supports canonical Orchestra env vars only.
- [x] Workflow front matter parser supports canonical keys.
- [x] Fallback from `WORKFLOW.md` to `ORCHESTRA.md` is supported.

## 4) API and Protocol Surface

- [x] Implemented endpoints:
  - `GET /api/v1/state`
  - `GET /api/v1/{issue_identifier}`
  - `POST /api/v1/refresh`
  - `GET /api/v1/events` (SSE)
  - `GET /api/v1/workspace/migration/plan`
  - `POST /api/v1/workspace/migrate`
- [x] Operational endpoints protected by bearer token on non-loopback host.
- [x] JSON error envelopes and `405` behavior are tested.

## 5) Workspace and Migration

- [x] Workspace guardrails implemented and tested.
- [x] Workspace lifecycle hooks implemented and tested.
- [x] Workspace migration plan/apply with dry-run support implemented.

## 6) Contracts and Fixtures

- [x] Versioned protocol schemas in `packages/protocol/schemas/v1`.
- [x] Type stubs in TS and Go under `packages/protocol/types`.
- [x] API fixtures under `packages/test-fixtures/api/v1`.
- [x] Backend tests validate response shape and schema contracts.

## 7) CI and Quality Gates

- [x] Backend CI workflow with format, vet, and race tests.
- [x] Naming guard script to prevent forbidden legacy symbols in Orchestra modules.

## 8) Self-Hosted Operations

- [x] Docker assets in `ops/docker`.
- [x] Systemd service unit in `ops/systemd/orchestrad.service`.
- [x] Self-hosting runbook in `docs/orchestra-self-hosting.md`.

## 9) Remaining Work to Reach Full Feature Parity

- [x] Implement full tracker client parity (candidate queries, state refresh, pagination).
- [x] Implement orchestrator dispatch/retry/reconciliation state machine parity.
- [x] Implement agent adapter parity for OpenCode and Claude Code runtime events.
- [x] Implement parity-grade observability totals and rate-limit propagation.
- [x] Add long-run soak tests and production cutover checklist.
- [x] Define Electron Linear clone product/API spec in `docs/specs/electron-linear-clone-spec.md`.
- [x] Define backend tracker contract spec in `docs/specs/orchestra-tracker-contract-v1.md`.

## Owners and Milestones

- [x] Owner: platform-core (modules + config + API surface)
- [x] Owner: platform-runtime (orchestrator + tracker + adapters)
- [x] Owner: platform-devex (CI + packaging + runbooks)

## Blockers

- None on scaffolding track.
- Remaining audit gap is web-layer `components/layouts.ex` (frontend template surface), which is out of current backend-first parity scope.

## Latest Progress

- Updated desktop shell UX scaffolding with a collapsible icon-driven sidebar and light/dark theme toggle in `apps/desktop/src/App.tsx` + `apps/desktop/src/index.css` while continuing Ops-first contract wiring.
- Wired Electron renderer to real Orchestra backend contracts in `apps/desktop/src/lib/orchestra-client.ts` and live `/api/v1/events` stream handling in `apps/desktop/src/App.tsx` with reconnect + fallback polling semantics (P0-03/P0-04 in progress).
- Started Electron Ops-first implementation in `apps/desktop` with secure Electron shell/preload bridge and shadcn/ui layout foundation (P0-01/P0-02 scaffold), including Vite build verification.
- Added ticket-level Ops-first Electron execution backlog in `docs/plans/2026-03-06-electron-ops-first-ticket-backlog.md` with P0/P1 sequencing, acceptance criteria, and strict backend contract mapping.
- Added Spec-First execution plan for Electron Linear clone in `docs/plans/2026-03-06-electron-linear-clone-implementation-plan.md` (WBS, RAID, pre-mortem, milestones, ADR decisions, and SCRAM critical review findings).
- Added Spec-First Electron planning artifacts: `docs/specs/electron-linear-functional-spec.md` (functional scope + traceability) and `docs/specs/electron-linear-technical-spec.md` (architecture/contracts/testing), with links from `docs/specs/electron-linear-clone-spec.md`.
- Aligned migration sign-off documents so `docs/migration/production-cutover-checklist.md` and `docs/migration/parity-gate.md` both reference `docs/migration/backend-parity-signoff.md` as required pre-cutover evidence.
- Added formal backend parity sign-off record in `docs/migration/backend-parity-signoff.md` (scope, evidence, exclusion, follow-up conditions).
- Closed backend parity audit down to a single frontend-template gap (`components/layouts.ex`), with runtime/adapter/orchestrator/tracker mappings promoted to implemented in `docs/migration/elixir-to-go-file-audit.md`.
- Updated parity-gate documentation status in `docs/migration/parity-gate.md` to reflect backend criteria completion and remaining frontend-scope decommission dependency.
- Added tracker abstraction in `apps/backend/internal/tracker/types.go`.
- Added in-memory tracker implementation in `apps/backend/internal/tracker/memory/client.go`.
- Added orchestrator reconciliation and refresh logic:
  - `apps/backend/internal/orchestrator/reconcile.go`
  - `apps/backend/internal/orchestrator/refresh_test.go`
- Added background refresh worker in `apps/backend/internal/app/run.go`.
- Added execution worker claim/run/fail/retry loop in `apps/backend/internal/app/run.go`.
- Added retry policy controls and bounded jitter backoff in `apps/backend/internal/orchestrator/state.go`.
- Added tracker conformance-style tests for large state refresh sets and deterministic ordering in `apps/backend/internal/tracker/memory/client_test.go`.
- Added prompt template builder scaffold in `apps/backend/internal/prompt/builder.go` and wired execution worker to use workflow prompt rendering.
- Added startup terminal-state workspace cleanup hook in `apps/backend/internal/app/run.go`.
- Added multi-turn continuation checks tied to tracker active states and max turn policy.
- Added event-driven run status updates from agent stream callbacks into orchestrator state.
- Added dynamic tool executor scaffold (`tracker_query` and `linear_graphql` alias) in `apps/backend/internal/tools/tracker_executor.go`.
- Added rate-limit event propagation and running-seconds accumulation in orchestrator snapshot state.
- Added codex app-server approval/input-required handling for non-interactive sessions with explicit errors when auto-approve is disabled.
- Added reconcile cleanup for stale claimed entries and tests to prevent claim leakage.
- Added dynamic tool payload compatibility (`success` + `contentItems`) and single-operation GraphQL guard in tracker tool executor.
- Added session log persistence module (`apps/backend/internal/logfile/logfile.go`) and issue API log-path propagation.
- Added `orchestra check` command with workflow/config validation scaffold (`apps/backend/internal/specs/check.go`).
- Added `orchestra check-pr-body` command and PR body lint scaffold (`apps/backend/internal/specs/pr_body.go`).
- Added presenter layer scaffold and wired API payload shaping through `apps/backend/internal/presenter/presenter.go`.
- Added observability pubsub scaffold and SSE integration in `apps/backend/internal/observability/pubsub.go` + `api/events.go`.
- Added static dashboard asset/controller scaffold in `apps/backend/internal/staticassets/assets.go` + `api/static.go`.
- Added structured Claude/OpenCode stream parsing improvements (SSE `data:` support, nested usage extraction, provider-aware event kind/message normalization) in `apps/backend/internal/agents/command_runner.go`.
- Added tracker GraphQL candidate pagination and cursor propagation tests for parity in `apps/backend/internal/tracker/graphql/client.go` + `client_test.go`.
- Added Codex app-server startup/turn error mapping improvements and policy-path tests in `apps/backend/internal/agents/codex_appserver.go` + `codex_appserver_test.go`.
- Added nested rate-limit extraction across provider event payload variants in `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Updated Codex app-server protocol handling to process JSON-RPC control messages from stdout only (stderr as diagnostics), with regression coverage in `apps/backend/internal/agents/codex_appserver_test.go`.
- Improved tracker GraphQL error mapping to include GraphQL/HTTP detail text for parity debugging in `apps/backend/internal/tracker/graphql/client.go` + `client_test.go`.
- Added stalled-running reconciliation path in orchestrator refresh loop (claimed runs older than timeout move to retry or drop after max attempts) in `apps/backend/internal/orchestrator/state.go` + `refresh_test.go`.
- Added stricter tracker GraphQL response-envelope validation (`data.issues` required) with regression tests in `apps/backend/internal/tracker/graphql/client.go` + `client_test.go`.
- Added dynamic tool advertisement on Codex `thread/start` using runtime tool specs (`tracker_query`, `linear_graphql`) wired from `apps/backend/internal/tools/tracker_executor.go` through `apps/backend/internal/app/run.go` into `apps/backend/internal/agents/codex_appserver.go`.
- Added structured blocking-event detection in generic agent adapters (Claude/OpenCode command runners now fail fast on approval/input-required stream events) in `apps/backend/internal/agents/command_runner.go` + `command_runner_test.go`.
- Added pagination support for tracker state-refresh by IDs (`after` cursor handling in `FetchIssueStatesByIDs`) with regression coverage in `apps/backend/internal/tracker/graphql/client.go` + `client_test.go`.
- Added orchestrator stall reconciliation guardrail test ensuring only claimed stale runs are moved to retry (unclaimed stale runs are preserved) in `apps/backend/internal/orchestrator/refresh_test.go`.
- Added `linear_graphql` argument-shape validation for `variables` (must be object when provided) with tests in `apps/backend/internal/tools/tracker_executor.go` + `tracker_executor_test.go`.
- Added Codex startup-stage error mapping regression tests for `thread/start` and `turn/start` failure paths in `apps/backend/internal/agents/codex_appserver_test.go`.
- Added orchestrator event-state preservation guardrail so empty provider events do not wipe `last_event`/`last_message` in `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Added token-usage parsing from protocol `params` envelopes (including Codex token update events) and live total-token derivation when totals are omitted, in `apps/backend/internal/agents/command_runner.go` + `command_runner_test.go` and `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Extended observability rate-limit extraction to nested protocol `params` envelopes in `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Added full config parity for runtime settings: tracker project slug, active/terminal state lists, max concurrent agents wired from env/workflow into orchestrator in `apps/backend/internal/config/types.go` + `load.go`, `apps/backend/internal/app/run.go`, and `apps/backend/internal/tracker/graphql/client.go`.
- Added workspace lifecycle hooks (`before_run`, `after_run`) wired from config into execution worker in `apps/backend/internal/workspace/service.go` + `apps/backend/internal/config/load.go` + `apps/backend/internal/app/run.go`.
- Added tracker Issue model parity fields (`assignee_id`, `blocked_by`) with GraphQL extraction in `apps/backend/internal/tracker/types.go` + `apps/backend/internal/tracker/graphql/client.go`.
- Added orchestrator dispatch parity for blocked Todo issues (skip Todo when blocked by non-terminal blockers; allow terminal-only blockers) with tests in `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Added per-state concurrency limit parity (`max_concurrent_by_state`) from config/workflow into orchestrator dispatch gating in `apps/backend/internal/config/load.go`, `apps/backend/internal/config/types.go`, `apps/backend/internal/app/run.go`, and `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Updated execution lifecycle hook parity so `after_run` executes on failure paths too (matching Elixir `try/after` behavior) in `apps/backend/internal/app/run.go`.
- Added config parity tests for tracker project/state lists/global+per-state concurrency overrides from env and workflow in `apps/backend/internal/config/load_test.go`.
- Added tracker GraphQL extraction tests for `assignee_id` and filtered `blocked_by` relations (with blocker state) in `apps/backend/internal/tracker/graphql/client_test.go`.
- Adjusted execution hook timing parity so `before_run` executes only on first turn of a run (`turn_count == 0`) while `after_run` remains run-finalization oriented in `apps/backend/internal/app/run.go`.
- Extended retry dispatch parity to carry issue state into retry entries and enforce per-state concurrency limits when releasing due retries in `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Added retry-state propagation regression coverage (run failure + stalled-run paths preserve issue state into retry metadata; due retries restore running state) in `apps/backend/internal/orchestrator/dispatch_test.go` + `refresh_test.go`.
- Matched workspace hook failure semantics to Elixir by keeping `before_run` fail-fast and making `after_run` best-effort (ignore failures) with regression tests in `apps/backend/internal/workspace/service.go` + `service_test.go`.
- Improved provider usage-observability parity by merging partial token usage updates across streamed events (without clobbering prior token fields) and added regression coverage in `apps/backend/internal/agents/command_runner.go` + `command_runner_test.go`.
- Added worker-routing parity for candidate issues: tracker supports `worker_assignee_ids` filtering and emits `assigned_to_worker`, orchestrator skips non-routable issues, with env/workflow parsing + tests in `apps/backend/internal/config/load.go`, `apps/backend/internal/tracker/graphql/client.go`, `apps/backend/internal/orchestrator/state.go`, and related tests.
- Added workflow list parsing parity for tracker fields (`worker_assignee_ids`, `active_states`, `terminal_states`) so YAML arrays are accepted alongside CSV strings in `apps/backend/internal/config/load.go` + `load_test.go`.
- Expanded generic adapter blocking-event parity for Claude/OpenCode stream variants (dot-style turn events and generic approval events) in shared detection logic (`apps/backend/internal/agents/codex_appserver.go`) with regression coverage in `apps/backend/internal/agents/command_runner_test.go`.
- Extended worker-routing parity to in-memory tracker mode by evaluating `worker_assignee_ids` against issue assignees (`AssignedToWorker`) and wiring those IDs through runtime fallback construction in `apps/backend/internal/tracker/memory/client.go`, `apps/backend/internal/app/run.go`, and `memory/client_test.go`.
- Added orchestrator dispatch guardrail to enforce active-state membership at enqueue time (skip out-of-band candidate states even if tracker adapter over-returns) with regression coverage in `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Expanded prompt-template parity context by exposing both PascalCase and lowercase issue/attempt keys plus richer issue fields (`assignee_id`, `assigned_to_worker`, `blocked_by`) in `apps/backend/internal/prompt/builder.go` with regression coverage in `builder_test.go`.
- Extended `tracker.Issue` parity fields (`description`, `priority`, `branch_name`, `url`, `labels`, `created_at`, `updated_at`) with GraphQL extraction + prompt template exposure updates in `apps/backend/internal/tracker/types.go`, `apps/backend/internal/tracker/graphql/client.go`, and `apps/backend/internal/prompt/builder.go` plus tests.
- Improved `linear_graphql` tool-argument parity by normalizing string/map argument payloads (including nested `arguments`) and aligning invalid-shape error paths in `apps/backend/internal/tools/tracker_executor.go` with added regression tests in `tracker_executor_test.go`.
- Tightened `linear_graphql` schema/runtime parity by requiring a non-empty `query` (while keeping candidate lookup on `tracker_query`) and matching input schema constraints (`required`, `additionalProperties`, nullable variables) in `apps/backend/internal/tools/tracker_executor.go` + `tracker_executor_test.go`.
- Added regression coverage for `linear_graphql` nested `arguments` object normalization path (`query` + `variables`) in `apps/backend/internal/tools/tracker_executor_test.go`.
- Upgraded dashboard parity from static placeholder to a live HTML status surface that renders `/api/v1/state` snapshots and subscribes to `/api/v1/events` (`EventSource`) in `apps/backend/internal/staticassets/assets.go` + `api/static_test.go`.
- Expanded presenter payload parity by including `session_log_path` on running entries and retry `state` metadata in both state/issue payloads, with regression coverage in `apps/backend/internal/presenter/presenter.go` + `presenter_test.go`.
- Added opt-in orchestrator soak suite (`ORCHESTRA_RUN_SOAK=1`) and production cutover runbook/checklist in `apps/backend/internal/orchestrator/soak_test.go` and `docs/migration/production-cutover-checklist.md`.
- Improved blocker/label parity by adding blocker `identifier` metadata and normalizing label names to lowercase in tracker decoding, with prompt-context exposure/tests updated in `apps/backend/internal/tracker/types.go`, `apps/backend/internal/tracker/graphql/client.go`, and `apps/backend/internal/prompt/builder_test.go`.
- Extended live dashboard observability parity to surface `rate_limits` snapshot data directly in the HTML status panel (`apps/backend/internal/staticassets/assets.go` + `api/static_test.go`).
- Expanded SSE adapter parity in generic command runners by handling `event:`/`id:`/`retry:` metadata lines explicitly (including blocking-event detection from SSE `event:` names) with coverage in `apps/backend/internal/agents/command_runner.go` + `command_runner_test.go`.
- Improved tracker blocker/label normalization parity by accepting case-insensitive blocker relation types and preserving blocker identifiers while normalizing labels to lowercase in `apps/backend/internal/tracker/graphql/client.go` + `client_test.go`.
- Added tracker assignee-routing parity for `worker_assignee_ids: ["me"]` by resolving viewer identity via GraphQL and applying it to candidate issue routing, with regression coverage in `apps/backend/internal/tracker/graphql/client.go` + `client_test.go`.
- Improved observability accounting parity on failure paths by rolling running-seconds and token usage into `codex_totals` during `RecordRunFailure`, with regression coverage in `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Improved tracker query parity by splitting candidate queries into project-filtered vs non-project variants (avoids unconditional project filter semantics) and added regression tests in `apps/backend/internal/tracker/graphql/client.go` + `client_test.go`.
- Enhanced SSE stream handling parity in generic adapters by applying `event:` names to subsequent `data:` payload events while ignoring `id:`/`retry:` metadata lines, with coverage in `apps/backend/internal/agents/command_runner.go` + `command_runner_test.go`.
- Improved orchestrator refresh state-machine robustness by always clearing `refresh_pending` via defer even on refresh errors, with regression coverage in `apps/backend/internal/orchestrator/state.go` + `refresh_test.go`.
- Added observability rollover parity when runs end outside normal success path (reconcile-out or stalled-to-retry/final-drop now accumulate seconds/tokens into totals) with tests in `apps/backend/internal/orchestrator/reconcile_test.go` + `refresh_test.go` + `dispatch_test.go`.
- Extended tracker assignee-routing parity for mixed `worker_assignee_ids` (`me` plus explicit IDs) with regression coverage in `apps/backend/internal/tracker/graphql/client_test.go`.
- Added retry-queue revalidation parity during refresh (terminal/inactive retries are pruned, active retries retained, missing issues preserved) in `apps/backend/internal/orchestrator/state.go` + `refresh_test.go`.
- Added stream-read error propagation parity in generic adapters so scanner failures become explicit run errors (`apps/backend/internal/agents/command_runner.go`).
- Added pre-dispatch issue revalidation parity in execution loop (`ClaimNextRunnable` -> tracker state recheck before run) so stale/terminal/inactive issues are skipped before workspace/agent execution in `apps/backend/internal/app/run.go` + `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Added API/not-found parity split (JSON envelope for unknown `/api/*` routes, HTML 404 page for non-API routes) in `apps/backend/internal/api/router.go` + `security_and_events_test.go` + `apps/backend/internal/staticassets/assets.go`.
- Expanded generic adapter parsing parity to support JSON-array stream envelopes and SSE keepalive comment lines in `apps/backend/internal/agents/command_runner.go` + `command_runner_test.go`.
- Added GraphQL pagination guard parity by requiring non-empty `endCursor` when `hasNextPage=true` (across candidate/state/by-states fetch paths) with regression coverage in `apps/backend/internal/tracker/graphql/client.go` + `client_test.go`.
- Extended tracker client contract parity with `FetchIssuesByIDs` and switched dispatch/retry revalidation paths to full-issue checks (assignment + blocker-aware gating) in `apps/backend/internal/tracker/types.go`, `apps/backend/internal/tracker/memory/client.go`, `apps/backend/internal/tracker/graphql/client.go`, and `apps/backend/internal/orchestrator/state.go` + tests.
- Enhanced SSE frame handling parity in generic adapters by buffering multi-line `data:` frames and flushing on blank/EOF (with `event:` association preserved) in `apps/backend/internal/agents/command_runner.go` + `command_runner_test.go`.
- Added additional tracker pagination parity coverage for `FetchIssuesByIDs` (pagination + missing cursor guards) in `apps/backend/internal/tracker/graphql/client_test.go`.
- Updated startup terminal workspace cleanup parity to honor configured workspace hooks (including `before_remove`) in `apps/backend/internal/app/run.go`.
- Added API content-type guard parity for POST `/api/*` routes (reject non-JSON with 415 JSON envelope) with regression coverage in `apps/backend/internal/api/router.go` + `security_and_events_test.go`.
- Extended observability rate-limit extraction parity to handle additional payload forms (`rate-limits`, nested arrays, JSON-encoded object strings) with regression coverage in `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Expanded input-required detection parity for generic adapters by recursively inspecting nested payload sections (`meta/result/data/params`) and `requires_input` variants in `apps/backend/internal/agents/codex_appserver.go` + `command_runner_test.go`.
- Added adapter runtime parity for timeout/cancellation semantics in generic command runners (distinct timeout error + parent context cancel propagation) with regression tests in `apps/backend/internal/agents/command_runner.go` + `command_runner_test.go`.
- Added tracker `me` assignee resolution caching to avoid repeated viewer lookups across refresh cycles with regression coverage in `apps/backend/internal/tracker/graphql/client.go` + `client_test.go`.
- Expanded tracker tool parity by adding `issues_by_ids` mode and query-aware `linear_graphql` routing for `issues(ids: ...)` / `issues(states: ...)` with variable extraction in `apps/backend/internal/tools/tracker_executor.go` + `tracker_executor_test.go`.
- Extended dispatch-continuation parity so running/claimed/retrying issue revalidation now enforces full dispatch constraints (`assigned_to_worker`, blocked-Todo checks) via full issue payload fetches, with regression coverage in `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go` + `refresh_test.go`.
- Improved tracker pagination resilience by de-duplicating issues across paged GraphQL responses for candidate/by-state/by-id fetches, with regression coverage in `apps/backend/internal/tracker/graphql/client.go` + `client_test.go`.
- Added deterministic tracker result ordering guarantees in GraphQL client parity paths (candidate/by-state sorted by identifier, by-id aligned to requested ID order) with regression coverage in `apps/backend/internal/tracker/graphql/client.go` + `client_test.go`.
- Enhanced generic adapter JSON-array event parity by merging usage across array entries and fail-fasting on blocking events (`approval`/`input_required`) that appear in non-first array items, with regression coverage in `apps/backend/internal/agents/command_runner.go` + `command_runner_test.go`.
- Improved runtime observability/event propagation by publishing structured `run_event` envelopes from live agent stream callbacks (issue/provider + raw event payload) and ensuring refresh worker seeds/maintains periodic refresh cycles without manual API triggering, with regression coverage for run-event publish shape in `apps/backend/internal/app/run.go` + `run_test.go`.
- Added lifecycle observability event parity by publishing typed pubsub/SSE events for execution milestones (`run_started`, `run_failed`, `run_continues`, `run_succeeded`) with structured issue/provider/attempt payloads from execution worker transitions, with regression coverage in `apps/backend/internal/app/run.go` + `run_test.go`.
- Extended lifecycle observability parity with explicit `retry_scheduled` event emission (including computed `due_at`) on failure paths that remain retryable, and added orchestrator retry-policy guard coverage via `ShouldRetryAttempt` in `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Added SSE parity coverage for lifecycle observability event streaming (`run_started`, `retry_scheduled`) and payload propagation through `/api/v1/events` in `apps/backend/internal/api/security_and_events_test.go`.
- Refactored execution worker tick handling into a testable single-iteration path (`processExecutionTick`) and added regression coverage for real transition emissions on success (`run_started` + `run_event` + `run_succeeded`) and failure (`run_started` + `run_failed` + `retry_scheduled`) in `apps/backend/internal/app/run.go` + `run_test.go`.
- Added retry-policy boundary parity coverage for lifecycle events so non-retryable failures (attempt exceeds max retry attempts) emit `run_failed` without `retry_scheduled` in `apps/backend/internal/app/run_test.go`.
- Added SSE relay boundary coverage ensuring `/api/v1/events` does not synthesize `retry_scheduled` events when only `run_failed` is published (preserves producer-driven lifecycle semantics) in `apps/backend/internal/api/security_and_events_test.go`.
- Improved refresh-cycle observability parity by emitting `retry_scheduled` lifecycle events for newly-added retry entries discovered during refresh/reconcile (with `source: refresh`) while suppressing duplicates for pre-existing retry queue entries, with regression coverage in `apps/backend/internal/app/run.go` + `run_test.go`.
- Extended refresh-cycle lifecycle parity to emit paired `run_failed` + `retry_scheduled` events for newly-added refresh/reconcile retry entries (stalled/reconciled timeout paths), preserving duplicate suppression for existing retry queue items, with regression coverage in `apps/backend/internal/app/run.go` + `run_test.go`.
- Added SSE end-to-end coverage for refresh-originated lifecycle pair propagation (`run_failed` + `retry_scheduled` with `source: refresh`) through `/api/v1/events` in `apps/backend/internal/api/security_and_events_test.go`.
- Hardened adapter blocking-event parity by broadening nested input-required detection across arbitrary JSON envelope keys and truthy string/number flags (`needsInput`/`requires_input` variants), with regression coverage in `apps/backend/internal/agents/codex_appserver.go` + `command_runner_test.go`.
- Added adapter false-positive guard coverage so falsey input-required signals (`needsInput: "false"`, `requires_input: "0"`/`0`) do not incorrectly trigger blocking errors in `apps/backend/internal/agents/command_runner_test.go`.
- Added Codex-specific parity regression coverage for nested truthy/falsey input-required signal handling in JSON-RPC payloads (`needsInputMethod` with `requires_input: "yes"` vs `needsInput: "false"`/`requires_input: 0`) in `apps/backend/internal/agents/codex_appserver_test.go`.
- Added blocking-reason precedence parity coverage so mixed approval+input payloads resolve to approval-required outcomes first (generic stream parser + Codex app-server runtime path), with regression tests in `apps/backend/internal/agents/command_runner_test.go` + `codex_appserver_test.go`.
- Added adapter false-positive parity coverage for method-name substring collisions so non-approval methods containing `approval` (e.g. `provider/approval_status`) do not trigger approval-required classification and correctly resolve to input-required only when explicit input-needed signals are present, with regression tests in `apps/backend/internal/agents/command_runner_test.go` + `codex_appserver_test.go`.
- Hardened command-runner stream robustness against expected pipe-close races by ignoring benign scanner close errors (e.g. `file already closed`) while preserving real stream failures, with helper coverage in `apps/backend/internal/agents/command_runner.go` + `command_runner_test.go`.
- Extended orchestrator retry/backoff parity coverage with explicit timing-edge assertions for attempt flooring (`attempt<=0` behaves like attempt 1) and quadratic attempt scaling before jitter (`attempt=2` with base delay squares to 8s + jitter window), in `apps/backend/internal/orchestrator/dispatch_test.go`.
- Refined retry jitter parity by extracting deterministic minute-bucket jitter calculation (`retryJitter`) and adding coverage for stability within the same minute per issue plus cross-issue bucket differentiation, in `apps/backend/internal/orchestrator/state.go` + `dispatch_test.go`.
- Tightened refresh lifecycle duplicate-suppression semantics so refresh-originated retry lifecycle events are keyed by logical retry identity (`issue_id` + `attempt` + `error`) rather than `due_at`, preventing duplicate `run_failed`/`retry_scheduled` emissions from due-time-only churn; added regression coverage in `apps/backend/internal/app/run.go` + `run_test.go`.
- Added lifecycle retry cause classification parity by including explicit `cause` fields on execution-path and refresh-path failure/retry events (`workspace_prepare_failed`, `before_run_hook_failed`, `agent_run_failed`, `continuation_check_failed`, `stalled_timeout`/`refresh_retry`), with regression coverage in `apps/backend/internal/app/run_test.go` and SSE propagation assertions in `apps/backend/internal/api/security_and_events_test.go`.
- Added execution-path observability parity coverage ensuring mixed nested provider envelopes still propagate `rate_limits` into orchestrator snapshots during real worker execution flow (`processExecutionTick`), with regression coverage in `apps/backend/internal/app/run_test.go`.
- Added SSE snapshot parity coverage asserting `/api/v1/events?once=1` includes propagated `rate_limits` payloads after mixed nested rate-limit events are recorded, in `apps/backend/internal/api/security_and_events_test.go`.
- Added live SSE streaming snapshot parity coverage proving subsequent `/api/v1/events` snapshot ticks reflect runtime-updated `rate_limits` after execution events, with regression coverage in `apps/backend/internal/api/security_and_events_test.go`.
- Improved SSE observability freshness parity by emitting an immediate snapshot frame after each pubsub event (`/api/v1/events`) so rate-limit/totals state updates are visible without waiting for the periodic snapshot tick; added regression coverage in `apps/backend/internal/api/events.go` + `security_and_events_test.go`.
- Hardened dashboard live-update parity for named SSE frames by handling `event: snapshot` explicitly (`addEventListener('snapshot', ...)`) while preserving compatibility with envelope-shaped and direct snapshot payloads, with regression coverage in `apps/backend/internal/staticassets/assets.go` + `apps/backend/internal/api/static_test.go`.
- Added SSE ordering/freshness regression coverage to assert pubsub events are immediately followed by a named `snapshot` frame in the stream (supporting snapshot-listener clients) in `apps/backend/internal/api/security_and_events_test.go`.
- Normalized non-snapshot SSE payload shape parity to always emit structured envelopes with stable top-level `type`/`timestamp`/`data` fields (while preserving pre-existing timestamps for pubsub events), with regression coverage in `apps/backend/internal/api/events.go` + `security_and_events_test.go`.
- Added contract-style SSE stream coverage validating non-snapshot event frames (`run_event`, `run_failed`, `retry_scheduled`) carry stable envelope shape with matching `type`, present `timestamp`, and `data` payload fields end-to-end through `/api/v1/events`, in `apps/backend/internal/api/security_and_events_test.go`.
- Added snapshot-frame contract parity coverage for `/api/v1/events?once=1` validating expected snapshot structure and key payload fields (`generated_at`, `counts`, `running`, `retrying`, `codex_totals`, `rate_limits`) with concrete count/rate-limit assertions in `apps/backend/internal/api/security_and_events_test.go`.
- Added lifecycle-envelope contract parity coverage for `/api/v1/events` validating `run_failed`/`retry_scheduled` frames carry expected nested `data` fields (`issue_id`, `attempt`, `cause`, plus `error` or `due_at`) under stable top-level event envelopes in `apps/backend/internal/api/security_and_events_test.go`.
- Added refresh retry lifecycle completeness coverage under state-churn entry creation, asserting emitted `run_failed`/`retry_scheduled` payloads contain full expected fields (`issue_id`, `issue_identifier`, `attempt`, `source`, `cause`, and `error`/`due_at`) in `apps/backend/internal/app/run_test.go`.
- Hardened observability pubsub parity with timestamp semantics coverage (auto-fill when missing, preserve when provided) in `apps/backend/internal/observability/pubsub_test.go`, and promoted `observability_pubsub.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Promoted web error-surface parity mappings `error_json.ex` and `error_html.ex` to `implemented` in `docs/migration/elixir-to-go-file-audit.md` based on validated API/HTML not-found and method-not-allowed behavior in `apps/backend/internal/api/router.go` + `security_and_events_test.go`.
- Strengthened error-envelope parity coverage by asserting explicit JSON error codes for API `405 method_not_allowed` and `415 unsupported_media_type` responses in `apps/backend/internal/api/security_and_events_test.go`.
- Added health-route parity coverage for both endpoint surfaces (`/healthz`, `/api/v1/healthz`) with payload assertions in `apps/backend/internal/api/state_test.go`, and promoted `endpoint.ex`, `router.ex`, `controllers/observability_api_controller.ex`, and `controllers/static_asset_controller.ex` mappings to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Expanded dashboard/static asset parity coverage to assert core live status sections and named snapshot SSE listener wiring in `apps/backend/internal/api/static_test.go`, and promoted `status_dashboard.ex` + `static_assets.ex` mappings to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Expanded presenter parity coverage for state payload totals/rate-limit propagation and message-humanization behavior (`running.last_message`, `retry.error`) in `apps/backend/internal/presenter/presenter_test.go`, and promoted `presenter.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Expanded dashboard live-surface parity coverage for SSE reconnect/polling fallback semantics (`source.onerror`, delayed reload, non-EventSource polling loop) in `apps/backend/internal/api/static_test.go`, and promoted `live/dashboard_live.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Expanded HTTP server parity coverage for loopback-vs-nonloopback auth behavior on protected routes and API CORS preflight handling (`Access-Control-Allow-Origin`/methods) in `apps/backend/internal/api/security_and_events_test.go`, and promoted `http_server.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Expanded workflow front-matter parity coverage for invalid YAML handling, non-map front-matter rejection, and empty-front-matter success paths in `apps/backend/internal/workflow/frontmatter_test.go`, and promoted `workflow.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Promoted `workspace.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md` based on comprehensive guardrail/hook/migration coverage already present across `apps/backend/internal/workspace/path_guard_test.go`, `hooks_test.go`, `service_test.go`, and `migration_test.go`.
- Expanded config-loader parity coverage for validation/fallback semantics (invalid port error, invalid `agent_max_turns` fallback, invalid `max_concurrent` fallback) in `apps/backend/internal/config/load_test.go`, and promoted `config.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Expanded workspace-removal parity coverage for no-op semantics (empty identifier and missing workspace paths) in `apps/backend/internal/workspace/service_test.go`, and promoted `workspace.before_remove.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Refactored CLI command dispatch into testable `runCLI` flow and added command-contract coverage (usage/unknown/check/check-pr-body success+failure paths) in `apps/backend/cmd/orchestra/main.go` + `main_test.go`, and promoted `cli.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Expanded quality-task parity coverage in `apps/backend/internal/specs/check_test.go` + `pr_body_test.go` with missing-provider-command validation and end-to-end PR template/body checks, and promoted `specs.check.ex` + `pr_body.check.ex` mappings to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Expanded prompt-builder parity coverage for error paths (missing workflow file, empty workflow prompt) in `apps/backend/internal/prompt/builder_test.go`, and promoted `prompt_builder.ex` + `specs_check.ex` mappings to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Expanded in-memory tracker parity coverage for deterministic by-state ordering and rich field preservation (`description`, `priority`, `branch_name`, `url`, labels, blockers, timestamps) in `apps/backend/internal/tracker/memory/client_test.go`, and promoted `tracker/memory.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md`.
- Promoted `codex/dynamic_tool.ex` and `linear/issue.ex` mappings to `implemented` in `docs/migration/elixir-to-go-file-audit.md` based on existing dynamic-tool execution coverage (`apps/backend/internal/tools/tracker_executor_test.go`) and rich issue-field parity coverage across tracker adapters (`apps/backend/internal/tracker/graphql/client_test.go` + `apps/backend/internal/tracker/memory/client_test.go`).
- Promoted `codex/app_server.ex` and `linear/client.ex` mappings to `implemented` in `docs/migration/elixir-to-go-file-audit.md` based on expanded stage/error/event parity coverage already exercised in `apps/backend/internal/agents/codex_appserver_test.go` and comprehensive GraphQL pagination/ordering/error-envelope coverage in `apps/backend/internal/tracker/graphql/client_test.go`.
- Promoted `linear/adapter.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md` based on complete runtime wiring from config/workflow into tracker GraphQL adapter plus parity coverage in `apps/backend/internal/app/run.go` and `apps/backend/internal/tracker/graphql/client_test.go`.
- Expanded execution-loop parity coverage for first-turn hook semantics and failure-cause propagation in `apps/backend/internal/app/run_test.go` (before_run skipped on non-zero turn counts; `before_run_hook_failed` lifecycle cause asserted on hook failure).
- Added agent-registry parity coverage in `apps/backend/internal/agents/registry_test.go` (provider-key normalization, Codex app-server runner selection, missing-provider run error), and promoted `agent_runner.ex` + `orchestrator.ex` mappings to `implemented` in `docs/migration/elixir-to-go-file-audit.md` based on comprehensive orchestrator state-machine test coverage already present in `apps/backend/internal/orchestrator/*_test.go`.
- Promoted `symphony_elixir.ex` mapping to `implemented` in `docs/migration/elixir-to-go-file-audit.md` to reflect completed runtime orchestration parity in `apps/backend/internal/app/run.go` (execution loop, refresh/reconcile loop, lifecycle events, tracker/adapter wiring) backed by expanded app/API/orchestrator regression coverage.
