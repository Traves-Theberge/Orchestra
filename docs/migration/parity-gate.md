# Orchestra Parity Gate

Orchestra will not remove legacy reference areas until parity criteria are met.

## Parity-First Rules

1. Keep additive implementation mode active while parity gaps remain.
2. New Orchestra behavior must be covered by tests and protocol schemas.
3. Any rename-only cleanup is blocked until parity gate is approved.

## Required Evidence Before Decommission

- Backend test suite passes (`go test ./...` in `apps/backend`).
- Race checks pass (`go test -race ./...` in CI).
- API contracts validated against versioned schemas in `packages/protocol/schemas/v1`.
- Workspace migration plan/apply behavior validated by tests.
- Parity fixtures and schema contract tests remain green across backend changes.

## Decommission Decision Checklist

- Compatibility bridge window completed.
- Upgrade tests pass for supported deployment profiles.
- Cutover runbook approved.
- Backend parity sign-off reviewed (`docs/migration/backend-parity-signoff.md`).
- Explicit sign-off recorded in `docs/migration/name-migration-checklist.md`.

## Current Gate Status

- Backend/runtime parity criteria are met and recorded in `docs/migration/elixir-to-go-file-audit.md` (all mapped backend items implemented; only web-template `components/layouts.ex` remains missing and is outside backend-first scope).
- Latest verification command remains `go test ./...` in `apps/backend` with green suite before status updates.
- Decommission/cleanup remains blocked until frontend/template parity decision is made and explicit cutover sign-off is recorded.
- Formal backend parity sign-off is recorded in `docs/migration/backend-parity-signoff.md`.
