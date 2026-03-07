# Orchestra Electron Linear Clone Functional Spec

Status: Draft v1 (Spec-First)
Date: 2026-03-06

## 1. Purpose

Define the user-facing Electron product behavior for the Linear-clone phase, with explicit traceability to the legacy Elixir project and the now-stabilized Orchestra backend contracts.

## 2. Product Scope (MVP)

MVP includes:

1. Live operations dashboard (running/retrying/totals/rate-limits).
2. Issue list and issue detail views driven by tracker-backed data.
3. Read/inspect lifecycle states with live updates via SSE.
4. Operator actions: refresh and workspace migration controls.

MVP excludes:

- Full external Linear parity UX beyond Orchestra runtime workflows.
- Broad notification/reporting surface.
- Legacy Phoenix template replication beyond required behavior.

## 3. Personas

1. Runtime Operator: monitors runs, retries, failures, and limits.
2. Platform Engineer: diagnoses orchestration behavior and hooks.
3. Self-Host Admin: controls deployment, migration, and access token policy.

## 4. Functional Requirements

### FR-1 Dashboard Live Status

- Show counts (running/retrying), codex totals, and rate-limits.
- Render running issue cards and retry queue entries.
- Subscribe to `/api/v1/events` and process named `snapshot` plus lifecycle events.
- Recover from stream errors via fallback snapshot polling.

Acceptance:

- UI updates after event-driven snapshot refresh without manual reload.
- Retry lifecycle events (`run_failed`, `retry_scheduled`) are visible with cause fields.

### FR-2 Issue Runtime Detail

- Query `/api/v1/{issue_identifier}` for runtime status.
- Show running or retry payload with attempt/session/log metadata.
- Display normalized long messages (humanized/truncated values from presenter output).

Acceptance:

- Status reflects `running`, `retrying`, or `tracked` contract values.

### FR-3 Control Actions

- Provide refresh control mapped to `POST /api/v1/refresh`.
- Provide workspace migration controls using:
  - `GET /api/v1/workspace/migration/plan`
  - `POST /api/v1/workspace/migrate`
- Render structured errors from JSON envelopes for operator troubleshooting.

Acceptance:

- Action success and failure paths are displayed with operation context.

### FR-4 Security Behavior

- On non-loopback hosts, require bearer token for protected operational routes.
- On loopback hosts, maintain local-first dev/operator usability.

Acceptance:

- UI can operate locally without token, but prompts for token when remote protection is enabled.

## 5. Non-Functional Requirements

1. Deterministic rendering for sorted issue lists from backend payloads.
2. Graceful degradation when SSE disconnects.
3. No direct renderer access to filesystem or credentials.
4. Contract-compatible behavior with current backend parity gate outputs.

## 6. Traceability Matrix (Elixir -> Orchestra)

This matrix enforces 1:1 traceability at the feature/spec level.

| Elixir Source | Orchestra Backend Contract | Electron Functional Surface |
| --- | --- | --- |
| `symphony_elixir.ex` | `internal/app/run.go` lifecycle + refresh loop | Live orchestration console behavior |
| `agent_runner.ex` | `internal/agents/*` event normalization | Provider event stream status in UI |
| `orchestrator.ex` | `internal/orchestrator/*.go` state machine | Running/retry lifecycle visibility |
| `http_server.ex` | `internal/api/router.go` + auth/cors | Desktop API client behavior |
| `presenter.ex` | `internal/presenter/presenter.go` payload shaping | View-model contract for dashboard/detail |
| `observability_pubsub.ex` | `internal/observability/pubsub.go` | Live event subscription semantics |
| `status_dashboard.ex` + `live/dashboard_live.ex` | `internal/staticassets/assets.go` + `/events` | Electron dashboard module and widgets |
| `linear/adapter.ex` + `linear/client.ex` + `linear/issue.ex` | `internal/tracker/graphql/client.go` + `internal/tracker/types.go` | Issue list/detail data semantics |
| `tracker/memory.ex` | `internal/tracker/memory/client.go` | Local/dev tracker behavior parity |
| `workspace.ex` + `workspace.before_remove.ex` | `internal/workspace/*.go` + migration API | Workspace migration and lifecycle controls |
| `specs.check.ex` + `pr_body.check.ex` | CLI/spec checks in `cmd/orchestra` + `internal/specs/*` | Release/readiness checks surfaced in ops docs |
| `components/layouts.ex` | pending frontend-template parity | Electron shell layout replacement |

## 7. MVP Acceptance Gate

MVP functional gate passes when:

1. Dashboard, issue detail, and control actions satisfy FR-1..FR-4.
2. Live event/retry cause fields are visible and interpretable in UI.
3. Traceability matrix rows are either implemented or explicitly deferred with rationale.
4. `components/layouts.ex` replacement scope is planned in Electron shell workstream.
