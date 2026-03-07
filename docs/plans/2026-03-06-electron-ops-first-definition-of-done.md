# Electron Ops-First Definition of Done

## Purpose

Establish a clear finish line for the desktop work so implementation is goal-driven, not activity-driven.

Primary objective: deliver a production-safe Electron operator console that is contract-accurate with the Go backend, resilient in degraded runtime conditions, and explicit in operator-facing failure guidance.

## Scope

In scope:
- Desktop renderer behavior for core operator flows.
- Runtime synchronization reliability (SSE, reconnect, polling fallback).
- Backend contract parity validation for open and auth-required hosts.
- CI/reporting gates that block regressions.

Out of scope:
- New non-P0 product features unrelated to operator control-plane confidence.
- Visual redesign work beyond usability and state clarity.

## P0 Operator Workflows (Must Pass)

1. Dashboard state loads from backend snapshot.
2. Refresh action enqueues work and reports success/failure clearly.
3. Issue inspector lookup returns detail and normalized API errors.
4. Workspace migration plan/apply flow works, including failure messaging.
5. Backend profile create/switch/delete updates active config and runtime.
6. Unauthorized responses show token guidance for protected hosts.

## Reliability and Degraded-Path Requirements

1. Renderer never fails silently; fatal failures are visible through fallback UI.
2. SSE disconnect transitions to polling fallback with explicit operator status.
3. SSE reconnect restores connected status when stream recovers.
4. Repeated SSE errors do not create duplicate polling loops.
5. Pending reconnect work is canceled on runtime stop/unmount.
6. Active profile switch tears down prior stream before attaching new one.

## Release Gates (Required)

All checks in `apps/desktop/parity-requirements.json` must pass through `npm run parity:verify`:

- `desktop_tests`
- `renderer_boot_smoke`
- `desktop_typecheck`
- `desktop_build`
- `backend_tests`
- `smoke_go_open_host`
- `smoke_go_auth_host`

Marker-gated degraded assertions must also pass:
- Renderer degraded markers (including SSE reconnect lifecycle).
- Smoke degraded markers for not-found, method/media constraints, and unauthorized paths.

Operational verification commands:
- `npm run parity:verify`
- `npm run parity:verify:twice`
- `npm run release:readiness`
- `npm run release:gate`

## Success Criteria

The work is considered done when all criteria are true:

1. P0 workflows pass in tests and match current backend contracts.
2. Full parity gate passes on two consecutive runs without code changes.
3. No open Critical reliability findings in runtime sync lifecycle.
4. Operator-facing guidance exists for all known degraded/auth failure classes.
5. Latest parity report artifacts are green and timestamped for handoff.

## Stop Criteria

Stop implementing new reliability work when:

1. All release gates are green and stable.
2. Remaining gaps are Major/Minor and documented for follow-up.
3. Additional changes are no longer reducing material operator risk.

At that point, transition from reliability hardening to either:
- internal beta validation, or
- next prioritized feature tranche.

Related operational checklist: `docs/plans/2026-03-06-electron-ops-first-release-checklist.md`.

## RAID Log (Current)

### Risks

| ID | Risk | Probability | Impact | Mitigation | Status |
|---|---|---|---|---|---|
| R1 | Long-run runtime churn causes timer/stream resource drift not visible in short CI runs | Medium | High | Keep bounded-count reconnect tests; add periodic soak pass in pre-release cycle | Open |
| R2 | Backend contract drift introduces UI regression despite green historical tests | Medium | High | Keep marker-gated parity checks and rerun release gate on backend API changes | Open |
| R3 | Operator confusion during degraded auth/network states | Low | High | Maintain explicit status/error guidance and degraded-path smoke assertions | Mitigated |

### Assumptions

| ID | Assumption | Confidence | Validation Method | If Invalid |
|---|---|---|---|---|
| A1 | Two consecutive parity passes are a sufficient short-run reliability signal | Medium | `npm run release:gate` on each release candidate | Add longer soak and repeated scheduled verification |
| A2 | Current marker set captures critical degraded paths | Medium | Review marker list against incident history and backend error taxonomy | Expand marker requirements and smoke coverage |
| A3 | SSE polling fallback behavior is acceptable for protected-host token mode | High | Renderer smoke + operator validation | Revisit transport strategy for token-auth streaming |

### Issues

| ID | Issue | Status | Action |
|---|---|---|---|
| I1 | Release confidence lacked explicit stop criteria | Closed | Definition of Done + release gate established |
| I2 | Readiness was not machine-checkable from report history | Closed | `release-readiness.mjs` added and wired into `release:gate` |

### Dependencies

| ID | Dependency | Type | Status |
|---|---|---|---|
| D1 | Go backend API contract behavior for state/events/refresh/migration/auth | External (service boundary) | On track |
| D2 | CI environment support for Node/Go parity workflows | External (CI platform) | On track |

## Pre-Mortem (Focused)

If this release fails in production, likely causes are:

1. Runtime instability appears only under long-lived sessions not replicated in CI.
2. Backend introduces subtle response-shape drift outside covered paths.
3. Operators misinterpret status under mixed auth/network failures.

Early warning signals:

- Rising support tickets mentioning stale dashboard state after reconnect cycles.
- Increase in "works after restart" reports from operators.
- Auth-host environments showing repeated refresh failures without clear recovery.

Immediate response plan:

1. Re-run `npm run release:gate` against current main and release branch.
2. Compare latest timestamped parity artifacts for marker or workflow drift.
3. Prioritize fixes that restore operator trust (visibility and control) before feature work.

## Uncertainty Register

- I don't know whether 2-run parity gates are sufficient for all long-duration workloads because CI runtime is short.
- This is uncertain because real operator sessions may run for hours with network variability not represented in current tests.
- Mitigation: treat long-run soak verification as a pre-release operational check until automated soak coverage is added.

## ADR-Style Decision Log

### Decision 1: Prioritize parity and reliability over feature expansion

- Problem: Frequent regressions and white-screen risk create operator distrust.
- Chosen option: Invest first in parity gates and degraded-path reliability tests.
- Alternatives considered:
  - Build more features first.
  - Focus on UI polish first.
- Drivers:
  - Highest operational risk is correctness and resilience, not feature breadth.
  - Testable gates provide objective confidence and stop criteria.
- Confidence: High.

### Decision 2: Treat degraded paths as first-class release requirements

- Problem: Recovery and auth failures are common in real operator environments.
- Chosen option: Require explicit degraded-path assertions and marker checks.
- Alternatives considered:
  - Rely on happy-path unit tests only.
  - Manual QA for degraded behavior.
- Drivers:
  - Degraded paths are where silent failures and confusion occur.
  - Automated marker enforcement prevents accidental removal.
- Confidence: High.
