# Backend Service Index

This directory is the backend control plane for Orchestra. It hosts daemon entrypoints, HTTP/SSE/WebSocket APIs, orchestration logic, tracker integrations, workspace services, telemetry ingestion, and supporting tooling.

## What This Backend Does
- Accepts API requests from desktop and CLI clients.
- Schedules and tracks issue execution through provider runners.
- Streams live runtime updates over SSE and terminal sessions over WebSocket.
- Persists project/session/event data in SQLite.
- Exposes workspace, git, docs, MCP, and analytics endpoints.

## Key Root Files
- `go.mod`: Go module manifest and direct dependency definitions.
- `go.sum`: Dependency checksum lockfile used by Go tooling.
- `LICENSE`: Apache 2.0 license text.
- `orchestrad`: Compiled daemon binary artifact.
- `orchestrad_new`: Alternate compiled daemon binary artifact.
- `orchestrad.log`: Local runtime log file artifact.

## Directory Map
- `cmd/`: Executable entrypoints (`orchestra`, `orchestrad`).
- `internal/`: Core implementation packages (api, orchestrator, tracker, workspace, agents, etc.).
- `scripts/`: Operational SQL and maintenance scripts.

## Suggested Reading Order (For New Contributors)
1. `cmd/orchestrad/main.go`
2. `internal/app/run.go`
3. `internal/api/router.go`
4. `internal/orchestrator/state.go`
5. `internal/db/schema.go`

## Indexing Note (AI/Tooling)
Use folder-level `README.md` files under `apps/backend/**` for package intent and file-level purpose summaries.
