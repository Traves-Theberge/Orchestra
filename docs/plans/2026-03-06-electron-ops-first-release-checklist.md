# Electron Ops-First Release Checklist

Use this checklist when preparing a release candidate for the desktop operator console.

## 1) Preflight (Must Pass)

- [ ] `npm run release:gate` passes locally from `apps/desktop`.
- [ ] Latest two timestamped parity reports are fully green.
- [ ] No open Critical findings in runtime sync reliability.
- [ ] Degraded/auth guidance copy is present and unchanged in smoke assertions.

## 2) Contract and Behavior Validation

- [ ] Open-host smoke passes (`smoke_go_open_host`).
- [ ] Auth-host smoke passes (`smoke_go_auth_host`).
- [ ] Marker enforcement is green for renderer and smoke checks.
- [ ] P0 flows confirmed: state, refresh, issue lookup, migration plan/apply, profile switch.

## 3) Operational Readiness

- [ ] Crash/fatal fallback UI path remains intact.
- [ ] SSE fallback/reconnect behavior is validated in tests.
- [ ] Prior stream teardown on profile switch is covered and passing.
- [ ] Release notes include known Major/Minor deferred items.

## 4) Rollback Triggers

Rollback or hotfix immediately if any of the following occur:

- Operators report stale state after reconnect cycles.
- Unauthorized/auth guidance is missing or misleading in protected hosts.
- Runtime errors produce blank/white screens without fallback diagnostics.
- Migration flow returns unclear failure states that block operator action.

## 5) Post-Release Verification (First 24h)

- [ ] Re-run `npm run release:gate` against the release branch.
- [ ] Confirm no parity marker regressions in latest timestamped reports.
- [ ] Check issue channels for reconnect/auth degradation signals.
- [ ] If drift appears, prioritize reliability patch over feature work.

## 6) Signoff

- Release driver: ____________________
- Approver: _________________________
- Date/time: ________________________
- Release commit/tag: _______________
