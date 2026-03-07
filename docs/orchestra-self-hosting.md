# Orchestra Self-Hosting (Single Node)

This document covers the Orchestra backend daemon for trusted self-hosted environments.

## Runtime

- Go daemon binary: `orchestrad`
- CLI wrapper: `orchestra start`

## Configuration

Primary env vars:

- `ORCHESTRA_SERVER_HOST` (default `127.0.0.1`)
- `ORCHESTRA_SERVER_PORT` (default `4000`)
- `ORCHESTRA_WORKSPACE_ROOT` (default `/tmp/orchestra_workspaces`)
- `ORCHESTRA_API_TOKEN` (required when binding non-loopback host)
- `ORCHESTRA_WORKFLOW_FILE` (default `WORKFLOW.md`, falls back to `ORCHESTRA.md`)
- `ORCHESTRA_AGENT_PROVIDER` (`codex`, `claude`, `opencode`; default `codex`)
- `ORCHESTRA_AGENT_COMMAND_CODEX` (optional override)
- `ORCHESTRA_AGENT_COMMAND_CLAUDE` (optional override)
- `ORCHESTRA_AGENT_COMMAND_OPENCODE` (optional override)

## Local Run

From repository root:

```bash
cd apps/backend
go run ./cmd/orchestra start
```

Or run daemon directly:

```bash
cd apps/backend
go run ./cmd/orchestrad
```

## API Endpoints

- `GET /healthz`
- `GET /api/v1/healthz`
- `GET /api/v1/state`
- `GET /api/v1/{issue_identifier}`
- `POST /api/v1/refresh` (auth required on non-loopback host)
- `GET /api/v1/events` (SSE snapshot stream)
- `GET /api/v1/workspace/migration/plan`
- `POST /api/v1/workspace/migrate` (auth required on non-loopback host)

## Workspace Migration

Dry run (safe default via API):

```bash
curl -sS -X POST http://127.0.0.1:4000/api/v1/workspace/migrate -d '{}'
```

Apply migration:

```bash
curl -sS -X POST http://127.0.0.1:4000/api/v1/workspace/migrate \
  -H 'Content-Type: application/json' \
  -d '{"dry_run":false}'
```

## Parity Gate

Do not perform destructive cleanup in legacy reference areas until parity evidence in
`docs/migration/parity-gate.md` is complete.
