# Orchestra Electron Linear Clone Technical Spec

Status: Draft v1 (Spec-First)
Date: 2026-03-06

## 1. Purpose

Define technical architecture and implementation constraints for the Electron Linear-clone phase, mapped to backend parity contracts and legacy Elixir traceability.

## 2. Architecture

## 2.1 Process Model

- Main process:
  - window lifecycle
  - secure config/token handling
  - native integrations (filesystem/open external links)
- Preload bridge:
  - strict typed IPC surface
  - no raw Node API exposure to renderer
- Renderer (React + TypeScript):
  - screens, state, and data presentation
  - API/SSE client consumption only through typed services

## 2.2 Data Plane

- HTTP base: Orchestra backend (`/api/v1/*`).
- Live plane: SSE from `/api/v1/events`.
- Payload contracts:
  - snapshot payload includes `generated_at`, `counts`, `running`, `retrying`, `codex_totals`, `rate_limits`
  - non-snapshot event envelope includes `type`, `timestamp`, `data`

## 3. Contract Integration

## 3.1 Required Endpoints

- `GET /api/v1/state`
- `GET /api/v1/{issue_identifier}`
- `POST /api/v1/refresh`
- `GET /api/v1/events`
- `GET /api/v1/workspace/migration/plan`
- `POST /api/v1/workspace/migrate`

## 3.2 Event Types Consumed

- `snapshot`
- `run_event`
- `run_started`
- `run_failed`
- `run_continues`
- `run_succeeded`
- `retry_scheduled`

## 4. Renderer State Model

Suggested stores:

1. `runtimeSnapshotStore`: latest snapshot + freshness timestamp.
2. `lifecycleEventStore`: recent lifecycle events (bounded ring buffer).
3. `issueDetailStore`: selected issue runtime payload cache.
4. `opsActionStore`: refresh/migration request status.

Conflict policy:

- snapshot is source-of-truth for aggregate state.
- lifecycle events are supplemental diagnostics between snapshot ticks.

## 5. Resilience and Reconnect

1. On SSE error, trigger immediate state refetch and restart stream.
2. Keep periodic fallback poll when stream unavailable.
3. Deduplicate retry lifecycle events by `(issue_id, attempt, error)` identity when rendering timeline views.

## 6. Security and Access

1. Token support in client config for non-loopback protected routes.
2. No token persistence in renderer localStorage by default.
3. IPC allows only explicit operations; deny arbitrary command execution.

## 7. Packaging and Runtime Ops

1. Target desktop: Linux/macOS/Windows (packaging matrix to be finalized).
2. Configurable backend base URL and token via secure settings panel.
3. Diagnostic export includes:
   - latest snapshot
   - recent lifecycle events
   - client version/build metadata

## 8. Test Strategy

1. Contract tests:
   - endpoint response schema checks against known fixtures
   - SSE frame parsing tests for envelope stability
2. Integration tests:
   - reconnect semantics under forced stream interruption
   - action flows (refresh/migrate) success and failure paths
3. E2E smoke:
   - app launch -> dashboard live -> issue detail -> refresh action

## 9. Elixir 1:1 Technical Mapping

| Elixir Module | Orchestra Technical Counterpart | Electron Technical Task |
| --- | --- | --- |
| `symphony_elixir.ex` | `internal/app/run.go` | wire lifecycle actions/telemetry views |
| `agent_runner.ex` | `internal/agents/*` | provider event interpretation layer |
| `orchestrator.ex` | `internal/orchestrator/*.go` | state projection and retry timeline UI |
| `http_server.ex` | `internal/api/router.go` | HTTP/SSE client + auth/cors handling |
| `presenter.ex` | `internal/presenter/presenter.go` | typed presenter DTOs in renderer |
| `observability_pubsub.ex` | `internal/observability/pubsub.go` | event buffering and diagnostics panel |
| `status_dashboard.ex`/`dashboard_live.ex` | static assets + events API | React dashboard module architecture |
| `linear/*` | tracker graphql client/types | issue/query client adapter for UI |
| `workspace.ex` | workspace/migration services | migration controls + confirmations |
| `components/layouts.ex` | missing | Electron shell layout system (app frame, nav, panes) |

## 10. Open Technical Decisions

1. UI component system choice (custom vs library) for shell/layout parity.
2. State library choice (Redux Toolkit vs Zustand vs React Query + context).
3. Packaging/signing pipeline ownership and release cadence.
