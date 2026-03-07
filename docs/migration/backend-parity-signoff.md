# Backend Parity Sign-Off

Date: 2026-03-06
Scope: Orchestra backend/runtime parity against mapped Elixir sources.

## Decision

Backend parity gate is approved for runtime/API/orchestrator/tracker/adapter surfaces.

## Evidence

- Elixir-to-Go file audit status in `docs/migration/elixir-to-go-file-audit.md`:
  - implemented: 33
  - partial: 0
  - missing: 1
- Remaining missing mapping is `components/layouts.ex`, which is a frontend template surface outside backend-first parity scope.
- Full backend suite verification command:
  - `go test ./...` (run in `apps/backend`) -> passing

## Included Areas

- Runtime loop + refresh/reconcile + lifecycle event propagation.
- Orchestrator dispatch/retry/state-machine semantics.
- Tracker adapters (GraphQL + memory) including pagination/order/error edge handling.
- Agent adapters (Codex app-server + generic runners for Claude/OpenCode event envelopes).
- API/SSE/dashboard backend surfaces and observability propagation.
- Workspace hooks/migration/path guardrails.
- CLI/spec checks (`orchestra check`, `orchestra check-pr-body`).

## Explicit Exclusion

- Frontend template parity for `components/layouts.ex` remains open and should be handled in frontend parity scope before final decommission of all legacy references.

## Follow-up Conditions

- Keep parity evidence green in CI (`go test ./...`, race checks, contract tests).
- Use `docs/migration/parity-gate.md` and `docs/migration/production-cutover-checklist.md` for cutover and decommission sequencing.
