# Orchestra Desktop

Electron desktop operator console for Orchestra.

## Current Goal

Ship a production-safe operator console that is:
- contract-accurate with the Go backend,
- resilient in degraded runtime conditions (SSE disconnect/reconnect, polling fallback, auth failures), and
- explicit in operator-facing error guidance (no silent renderer failures).

Done criteria and stop criteria are tracked in `docs/plans/2026-03-06-electron-ops-first-definition-of-done.md`.
Release execution checklist is tracked in `docs/plans/2026-03-06-electron-ops-first-release-checklist.md`.

## Stack

- Electron
- React + Vite + TypeScript
- shadcn/ui primitives

## Development

Run from `apps/desktop`:

- Install deps: `npm install`
- Start dev mode: `npm run dev`
- Build renderer: `npm run build`
- Run unit/integration tests: `npm run test`
- Run renderer boot smoke test: `npm run test:smoke-renderer`
- Run Go-backed smoke flow (open host): `npm run smoke:ops:go`
- Run Go-backed smoke flow (auth host): `npm run smoke:ops:go:auth`
- Run full parity suite + report: `npm run parity:verify`
- Run stability parity gate twice: `npm run parity:verify:twice`
- Check readiness from latest two parity history reports: `npm run release:readiness`
- Run full release gate (two parity runs + readiness check): `npm run release:gate`

Parity reports are generated at `apps/desktop/reports/parity-latest.json` and `apps/desktop/reports/parity-latest.md`.
Timestamped history artifacts are also written as `apps/desktop/reports/parity-<timestamp>.json` and `apps/desktop/reports/parity-<timestamp>.md`.
Workflow gates for parity are defined in `apps/desktop/parity-requirements.json`.

Current status:

- P0-01 foundation complete (secure Electron shell + preload bridge)
- P0-02 layout foundation complete (shadcn/ui base components + ops-first shell)
- Reliability/parity hardening in progress with marker-gated degraded-path checks
