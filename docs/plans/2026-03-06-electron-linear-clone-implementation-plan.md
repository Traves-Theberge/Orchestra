# Implementation Plan: Electron Linear Clone (Spec-First)

Created: 2026-03-06
Status: Draft for execution
Related specs:

- `docs/specs/electron-linear-clone-spec.md`
- `docs/specs/electron-linear-functional-spec.md`
- `docs/specs/electron-linear-technical-spec.md`

## Purpose

Build the Electron (React + Vite + TypeScript + shadcn/ui) Linear-clone interface against stable Orchestra backend contracts with minimal rework risk.

### Problem Statement

Backend parity is complete for runtime/API surfaces, but the operator and Linear-clone workflows still require a production-grade desktop UI that maps 1:1 to legacy Elixir behavior while preserving Orchestra contract stability.

### Success Criteria

1. Desktop app delivers MVP workflows from functional spec (dashboard + issue detail + control actions).
2. UI consumes `/api/v1/*` + `/api/v1/events` contracts without backend contract drift.
3. All MVP acceptance criteria in `docs/specs/electron-linear-functional-spec.md` are test-verified.

### Scope

In scope:

- Electron shell and app architecture.
- React/Vite renderer with shadcn/ui components.
- Dashboard live state, issue runtime detail, refresh/migration actions.
- SSE + fallback polling behavior.

Out of scope:

- Non-MVP reporting/analytics and notifications.
- Full external Linear UX parity beyond Orchestra runtime workflows.
- General frontend redesign not required for mapped parity.

## Stakeholders

| Role | Owner | Responsibility |
| --- | --- | --- |
| Driver | platform-runtime | Execution and delivery coordination |
| Approver | platform-core lead | Scope and architecture approvals |
| Contributors | platform-core + platform-devex | UI/API integration, packaging, test automation |
| Informed | ops/on-call | Cutover readiness and operator UX feedback |

## Work Breakdown Structure

### Phase 1: Foundations and Contracts (2-3 days)

1.1 Electron app scaffold (main/preload/renderer, secure IPC).

1.2 API/SSE typed client package for:

- `/api/v1/state`
- `/api/v1/{issue_identifier}`
- `/api/v1/refresh`
- `/api/v1/events`
- workspace migration endpoints

1.3 Contract fixture harness in renderer tests (snapshot + lifecycle envelope parsing).

### Phase 2: MVP Screens and Flows (4-6 days)

2.1 Dashboard module using shadcn/ui cards/tables/badges:

- counts, codex totals, rate limits
- running/retry lists

2.2 Issue detail panel wired to `/api/v1/{issue_identifier}`.

2.3 Action controls:

- refresh action (`POST /api/v1/refresh`)
- migration plan/apply actions
- structured error rendering from JSON envelopes

### Phase 3: Resilience, UX polish, and hardening (3-4 days)

3.1 SSE reconnect and fallback polling behavior.

3.2 shadcn/ui shell layout implementation to replace legacy `components/layouts.ex` gap.

3.3 Accessibility/keyboard/empty-state/error-state pass.

3.4 End-to-end smoke and contract regression tests.

## Dependencies

1. Stable backend contract surfaces from parity-complete backend.
2. Electron packaging/signing conventions for target OS matrix.
3. Access to representative runtime data for UI validation.

## RAID Log

### Risks

| ID | Risk | Prob. | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | SSE envelope assumptions drift in renderer | M | H | Contract tests on real frames + fixture lock |
| R2 | Scope creep into full Linear clone | H | H | Enforce MVP boundaries from functional spec |
| R3 | Desktop packaging overhead delays UX delivery | M | M | Parallelize packaging tasks with Phase 2 UI work |

### Assumptions

| ID | Assumption | Confidence | Validation |
| --- | --- | --- | --- |
| A1 | Backend contracts remain stable during MVP | H | API fixture contract tests in CI |
| A2 | Operator workflows prioritize dashboard + issue detail | M | Early stakeholder demo at end of Phase 2 |
| A3 | shadcn/ui is acceptable for product UI velocity | H | Design review on initial UI slice |

### Issues

| ID | Issue | Status | Action |
| --- | --- | --- | --- |
| I1 | `components/layouts.ex` remains unmapped | Open | Implement Electron shell layout in Phase 3 |

### Dependencies

| ID | Dependency | Type | Status |
| --- | --- | --- | --- |
| D1 | Backend parity sign-off artifacts | Internal | Complete |
| D2 | Packaging/signing policy | Internal | Pending |
| D3 | Runtime dataset for demo | Internal | Pending |

## Pre-Mortem

If this fails, likely causes are:

1. We overbuild beyond MVP and miss critical workflows.
2. Event stream handling is brittle under reconnect conditions.
3. Renderer state model diverges from backend snapshot source-of-truth.

Early warning signals:

- UI bugs tied to event ordering/race behavior.
- Repeated backend API changes to support UI assumptions.
- Sprint spillover on non-MVP requests.

## Timeline and Milestones

M1 (end Phase 1):

- Electron shell compiles.
- typed API/SSE client complete.

M2 (end Phase 2):

- Dashboard + issue detail + actions demo working.

M3 (end Phase 3):

- Resilience tests pass.
- MVP sign-off ready for cutover planning.

## Test Plan

1. Unit tests for API/SSE parsing and state transforms.
2. Integration tests for reconnect/fallback polling behavior.
3. E2E smoke: launch -> dashboard live -> issue detail -> refresh/migrate action.
4. Contract tests against backend fixtures and live envelope shapes.

## ADR Decision Extraction

### Decision 1

- Title: Use Spec-First approach for Electron Linear-clone.
- Problem: Avoid rework while transitioning from backend parity to UI development.
- Chosen option: Spec-first sequencing.
- Alternatives discussed: Build-first, hybrid.
- Drivers: contract stability, lower churn risk.
- Confidence: high.

### Decision 2

- Title: Use Electron + React + Vite + TypeScript + shadcn/ui.
- Problem: Select desktop stack for MVP velocity and maintainability.
- Chosen option: Electron renderer stack with shadcn/ui.
- Alternatives discussed: not selected in this cycle.
- Drivers: component velocity, typed contracts, established tooling.
- Confidence: high.

## Critical Review (SCRAM)

### Structure

- Pass: plan includes purpose, scope, WBS, RAID, pre-mortem, milestones, and testing.

### Clarity

- Pass: MVP boundaries and out-of-scope lines are explicit.

### Rigor

- Major finding: packaging/signing dependency lacks assigned owner/date.
  - Action: assign platform-devex owner and target date before Phase 2 starts.

### Actionability

- Pass: phases and milestones are execution-ready.
- Minor finding: task estimates are phase-level rather than work-package-level.
  - Action: break Phase 2 into story-level estimates during sprint planning.

### Missing

- Major finding: no explicit UI telemetry acceptance criteria (renderer crash/error budget).
  - Action: add metrics thresholds (startup success rate, SSE reconnect success rate, action error rate) before implementation kickoff.
