# Orchestra Production Cutover Checklist

Use this checklist when moving from backend parity validation to production cutover.

## 1) Pre-Cutover Validation

- [ ] Backend parity sign-off reviewed (`docs/migration/backend-parity-signoff.md`).
- [ ] `go test ./...` passes in `apps/backend`.
- [ ] `go test -race ./...` passes in `apps/backend`.
- [ ] Soak test run completed with `ORCHESTRA_RUN_SOAK=1 go test ./internal/orchestrator -run Soak -count=1`.
- [ ] API contract fixtures under `packages/test-fixtures/api/v1` match current responses.
- [ ] Naming guard passes (`.github/scripts/check-orchestra-naming.sh`).

## 2) Environment Readiness

- [ ] Production `ORCHESTRA_*` env vars are configured and reviewed.
- [ ] Tracker endpoint/token/project/worker-assignee routing values are verified.
- [ ] Workspace root has expected permissions and capacity.
- [ ] Workspace hooks (`after_create`, `before_remove`, `before_run`, `after_run`) are reviewed for safety.

## 3) Runtime Readiness

- [ ] `orchestrad` service unit is installed and enabled.
- [ ] Health endpoints return success from target host.
- [ ] `/api/v1/state` and `/api/v1/events` verified from dashboard/browser.
- [ ] Retry queue and rate-limit visibility verified in dashboard.

## 4) Rollout Plan

- [ ] Define maintenance window and rollback owner.
- [ ] Take snapshot/backup of runtime state and workspace root.
- [ ] Roll out with additive mode preserved (no legacy decommission yet).
- [ ] Monitor running/retrying counts and error-rate for first hour.

## 5) Rollback Criteria

- [ ] Clear trigger thresholds agreed (error spikes, retry saturation, API instability).
- [ ] Rollback command path tested in staging.
- [ ] Legacy runtime fallback path documented and on-call confirmed.

## 6) Sign-Off

- [ ] Platform-core sign-off.
- [ ] Platform-runtime sign-off.
- [ ] Platform-devex sign-off.
- [ ] Parity-gate status confirmed in `docs/migration/parity-gate.md`.
- [ ] Cutover decision recorded in `docs/migration/name-migration-checklist.md`.
