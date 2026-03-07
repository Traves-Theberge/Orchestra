# Orchestra Linear Clone Spec (Electron)

Status: Draft v1

Purpose: Define a parity-oriented, self-hosted Linear-compatible clone that will be delivered in the Electron (React/Vite) interface phase.

Companion specs:

- Functional: `docs/specs/electron-linear-functional-spec.md`
- Technical: `docs/specs/electron-linear-technical-spec.md`

## 1. Scope and Positioning

The Linear clone is part of Orchestra's product scope, but it is an interface-layer deliverable and must be implemented in the Electron app phase.

Current migration rule:

1. Complete backend parity with the existing orchestration runtime first.
2. Freeze interface replacement work until Electron React/Vite implementation phase starts.
3. Build the Linear clone in Electron against a versioned contract, not ad-hoc local state.

Out of scope for this phase:

- Shipping full Electron UI now.
- Replacing current backend HTTP/SSE surfaces before parity sign-off.

## 2. Product Goals

The Linear clone must provide:

1. Functional parity for Orchestra orchestration use-cases (issue lifecycle, state changes, assignments, project scoping).
2. API compatibility sufficient for Orchestra tracker adapter usage.
3. Self-hosted single-tenant operation by default.
4. Upgrade-safe data model and migration path.

## 3. Compatibility Target

Compatibility is prioritized in this order:

1. Orchestra backend tracker requirements (hard requirement).
2. Core issue/project/team workflows from Linear-like UX/API.
3. Extended UX parity features.

Version strategy:

- `orchestra.linear.v1` contract namespace.
- Backward-compatible additions only within minor versions.
- Breaking changes require version bump and migration plan.

## 4. Required Domain Model

Minimum entities required for v1:

1. `Organization`
2. `User`
3. `Team`
4. `Project`
5. `Issue`
6. `IssueState`
7. `IssueComment`
8. `Label`
9. `IssueHistory`

Issue fields required:

- `id` (stable opaque id)
- `identifier` (human id, ex: `ORC-123`)
- `title`
- `description`
- `state`
- `assignee_id`
- `project_id`
- `team_id`
- `labels[]`
- `created_at`
- `updated_at`

## 5. Required Behavior

Issue lifecycle requirements:

1. Create/update/archive issues.
2. Move across configured states.
3. Query by active/terminal states for orchestration polling.
4. Resolve current state by issue IDs for reconciliation.

State model requirements:

- Team-scoped states.
- Terminal marker on states.
- Stable state IDs plus display names.

## 6. API Requirements (Backend Contract)

The clone must expose a tracker API that supports Orchestra backend parity operations.

Required operations:

1. `fetch_candidate_issues(active_states, project_slug, assignee)`
2. `fetch_issue_states_by_ids(issue_ids)`
3. `fetch_issues_by_states(states)`

Transport options:

- Primary: GraphQL-compatible endpoint to mirror current adapter assumptions.
- Optional: REST facade mapped to same service layer.

Pagination requirements:

- Cursor-based pagination.
- Deterministic ordering.
- Full retrieval support for >50 issue state refreshes.

## 7. Electron Architecture Requirements

UI stack (locked for interface phase):

- Electron + React + Vite + TypeScript.

Architecture boundaries:

1. Renderer owns presentation and user workflows.
2. Main process owns secure local integration and credential handling.
3. Data access via typed API client package generated from `orchestra.linear.v1` contracts.

No direct DB access from renderer.

## 8. Security and Self-Hosted Constraints

1. Local-first auth with explicit admin bootstrap.
2. Token/session validation for non-loopback access.
3. Audit log for issue state changes and destructive operations.
4. Export/backup and restore flows for self-hosted operators.

## 9. Observability Requirements

Minimum metrics:

1. Issues queried per poll cycle.
2. API latency and error rate per operation.
3. State transition counts.
4. Failed reconciliation lookups.

Minimum logs:

- Structured logs with request id and team/project context.

## 10. Testing and Parity Gates

Required test layers:

1. Contract tests for tracker adapter operations.
2. Golden fixtures for issue/state payloads.
3. End-to-end orchestration tests against Linear clone backend.
4. Electron integration tests for issue workflows.

Parity gate to enable cutover:

1. All current tracker integration scenarios pass against clone.
2. Reconciliation behavior matches expected semantics at scale.
3. No regression in orchestration dispatch/retry flows.

## 11. Phased Delivery Plan

Phase A (now):

- Finalize and version this spec.
- Keep backend parity work as priority.

Phase B (backend clone service):

- Implement clone domain + API contract.
- Run backend orchestration against clone in test harness.

Phase C (Electron implementation):

- Build Linear clone interface and management flows in Electron React/Vite.
- Connect to clone service using typed contracts.

Phase D (cutover):

- Enable clone as default tracker in Orchestra deployments.
- Keep migration/import tooling for existing external tracker users.

## 12. Open Questions

1. Single-team-only v1 or multi-team v1?
2. Required import path from external tracker at launch?
3. Notification model (email/webhook) in v1 or deferred?
4. Reporting/analytics scope for initial release?
