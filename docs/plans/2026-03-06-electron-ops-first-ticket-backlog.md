# Electron Ops-First Ticket Backlog (Orchestra-Mapped)

Status: Ready for execution
Date: 2026-03-06
Stack: Electron + React + Vite + TypeScript + shadcn/ui

## Scope Lock

In scope:

1. Live operations dashboard mapped to Orchestra backend contracts.
2. SSE live updates + reconnect + fallback polling.
3. Operator actions: refresh + workspace migration plan/apply.

Out of scope:

1. Issue create/edit UX.
2. Team/project admin workflows.
3. Notification/reporting subsystems.

## Contract Mapping (Source of Truth)

- `GET /api/v1/state`
- `GET /api/v1/events`
- `POST /api/v1/refresh`
- `GET /api/v1/workspace/migration/plan`
- `POST /api/v1/workspace/migrate`
- `GET /api/v1/{issue_identifier}`

State rules:

1. Snapshot payload is canonical state.
2. Lifecycle events are timeline/diagnostics overlays.
3. On stream failure, fallback polling restores freshness.

## P0 Tickets (Must-Have)

### P0-01 Electron Shell and Secure Bridge

Status: In progress (scaffold completed)

Deliverables:

- Electron main process setup.
- Preload bridge with typed API (no raw Node exposure in renderer).
- Renderer bootstrapped with React + Vite + TS.

Acceptance criteria:

- App launches and renders shell window.
- Renderer cannot access unrestricted Node APIs.

### P0-02 Design System and Layout Foundation (shadcn/ui)

Status: In progress (base components and shell layout completed)

Deliverables:

- shadcn/ui configured.
- Core shell layout (header/nav/content panes) replacing legacy `components/layouts.ex` role.

Acceptance criteria:

- Shell renders with responsive desktop layout.
- Core components available: Card, Table, Badge, Dialog, Toast, Button, Skeleton.

### P0-03 Typed Orchestra API Client

Status: In progress (implemented base client for state/refresh/workspace migration endpoints)

Deliverables:

- Typed methods for all mapped endpoints.
- Uniform error parser for JSON envelope errors.

Acceptance criteria:

- API client returns typed success payloads.
- API failures produce normalized UI-safe errors.

### P0-04 SSE Client with Reconnect + Fallback Polling

Status: In progress (implemented named event handling, reconnect path, and polling fallback)

Deliverables:

- Named event support (`snapshot`, lifecycle events).
- Envelope parsing (`type`, `timestamp`, `data`).
- Reconnect strategy and polling fallback loop.

Acceptance criteria:

- Stream interruption recovers without app restart.
- Snapshot freshness restored automatically after disconnect.

### P0-05 Runtime Snapshot Store and Event Timeline Store

Status: In progress (store semantics extracted and tested for idempotent snapshot updates and bounded timeline append)

Deliverables:

- Snapshot store for counts/running/retrying/totals/rate-limits.
- Bounded lifecycle event timeline store.

Acceptance criteria:

- Snapshot updates are deterministic and idempotent.
- Timeline shows latest events with cause/attempt/due metadata when present.

### P0-06 Dashboard View (Ops)

Status: In progress (live cards/lists/timeline backed by state + events contracts)

Note: issue inspector panel added for direct issue contract lookup (`/api/v1/{issue_identifier}`) and error envelope visibility.
Note: running and retry lists are rendered in deterministic sorted order for stable operator scanning.

Deliverables:

- Metric cards: counts, codex totals, rate limits.
- Running list and retry queue tables.
- Event timeline panel.

Acceptance criteria:

- Dashboard fully driven by backend contracts.
- Empty/loading/error states are present for each panel.

### P0-07 Refresh Action Flow

Status: In progress (refresh action wired with pending/success/failure UX; covered in Go-backed smoke)

Deliverables:

- Manual refresh control wired to `POST /api/v1/refresh`.
- Action state UX (pending/success/failure).

Acceptance criteria:

- Refresh trigger updates UI status and handles failures cleanly.

### P0-08 Workspace Migration Plan/Apply Flow

Status: In progress (plan/apply wired with confirmation UX and covered in Go-backed smoke, including auth-host mode)

Deliverables:

- Plan view (`GET /api/v1/workspace/migration/plan`).
- Apply action with confirmation dialog (`POST /api/v1/workspace/migrate`).

Acceptance criteria:

- User can preview and apply migration from UI.
- Errors and partial outcomes are visible with context.

### P0-09 Issue Inspector Flow

Status: In progress (issue inspector panel wired and row-click drilldown from running/retry views implemented)

Deliverables:

- Issue detail lookup view wired to `GET /api/v1/{issue_identifier}`.
- Running/retry entries can open issue inspector directly.
- Not-found and contract error envelopes are visible to operators.

Acceptance criteria:

- Operator can fetch issue detail by identifier from inspector or list row action.
- Missing issue displays normalized `issue_not_found` error context.

## P1 Tickets (Hardening)

### P1-01 Contract and Parser Tests

Deliverables:

- Snapshot schema tests.
- Lifecycle envelope tests (`run_failed`, `retry_scheduled`, etc.).

Acceptance criteria:

- Contract drift fails CI test checks.

### P1-02 Reconnect Resilience Tests

Status: In progress (unit tests cover reconnect backoff/reset; Go-backed smoke now validates SSE snapshot path and protected-host auth behavior)

Deliverables:

- Forced SSE disconnect tests.
- Backoff + fallback polling verification.

Acceptance criteria:

- Freshness SLA maintained after reconnect scenarios.

### P1-03 Accessibility and Operator UX Pass

Status: In progress (keyboard and live-region semantics in place; renderer smoke suite now verifies key status/error strip operator messages)

Note: renderer smoke now also verifies sidebar keyboard traversal and theme toggle root-class persistence behavior.
Note: unauthorized action paths now show explicit protected-host token guidance and are covered by renderer smoke.

Deliverables:

- Keyboard navigation for controls.
- Announced status changes for critical actions.

Acceptance criteria:

- Core flows are keyboard-usable and readable in degraded states.

## Execution Order

1. P0-01 -> P0-02 -> P0-03 -> P0-04
2. P0-05 -> P0-06
3. P0-07 + P0-08
4. P1-01 -> P1-02 -> P1-03

## Definition of Done (Ops-First Milestone)

All P0 tickets complete, plus:

1. Smoke flow passes: launch -> live dashboard -> refresh -> migration plan/apply.
2. SSE reconnect behavior validated.
3. No backend contract shape violations in parser tests.
