# Orchestra

Orchestra is a multi-component orchestration platform for running and observing agent-driven engineering workflows. This monorepo contains a Go backend control plane, an Electron + React desktop operator console, a Go terminal dashboard (TUI), shared protocol contracts, and deployment/CI assets.

## Table of Contents

- [Introduction](#introduction)
- [Audience Profile](#audience-profile)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)
- [Evidence Map](#evidence-map)
- [Evidence Files](#evidence-files)
- [Assumptions & Uncertainties](#assumptions--uncertainties)

## Introduction

Orchestra coordinates issue execution through agent providers, stores runtime/session telemetry in SQLite, and exposes operational APIs for state, events, projects, docs, and terminal access. The desktop app is the primary operator interface, while the TUI provides a terminal-first control surface.

## Audience Profile

| Audience | What this repo provides |
|---|---|
| Platform/backend engineers | Go daemon (`orchestrad`) with orchestration loops, tracker integrations, workspace lifecycle, and HTTP/SSE/WebSocket APIs |
| Desktop/frontend engineers | Electron + React control plane with task board, runtime monitoring, docs browser, analytics, and terminal multiplexer |
| DevOps/release engineers | Dockerfile, systemd unit template, and GitHub Actions workflows for backend checks, desktop parity gates, and artifact builds |
| New contributors | Package-level READMEs, OpenAPI spec, usage/architecture docs, and shared protocol/test fixtures |

## Key Features

- Orchestration daemon that initializes tracker/workspace/agent registries and runs refresh + execution workers.
- Live runtime updates via `GET /api/v1/events` (SSE) plus snapshots from `GET /api/v1/state`.
- Task/issue lifecycle APIs (list/create/update/delete, history, logs, diff, artifacts, stop session, create PR).
- Project operations APIs including file tree/content and git actions (`status`, `diff`, `commit`, `push`, `pull`).
- MCP integration for listing tools/servers and executing external tools through orchestrated runs.
- Desktop operator console with sections for dashboard, tasks, running queue, projects, timeline, console, agents, warehouse, settings, and docs.
- Terminal WebSocket endpoint for interactive sessions: `GET /api/v1/terminal/{session_id}`.

## Tech Stack

| Area | Detected stack |
|---|---|
| Backend | Go (`chi`, `cors`, `zerolog`, `modernc.org/sqlite`, `gorilla/websocket`) |
| Desktop | Electron, React 18, Vite, TypeScript, Tailwind CSS, Radix UI |
| TUI | Go + Bubble Tea + Lipgloss |
| API contract | OpenAPI 3.1 (`docs/openapi.yaml`) |
| Shared contracts | `packages/protocol` (TS/Go types + JSON schemas), `packages/test-fixtures` |
| CI | GitHub Actions (`orchestra-backend`, `orchestra-desktop-smoke`, release artifacts, naming guard) |
| Deployment assets | Docker (`ops/docker/Dockerfile.backend`), systemd (`ops/systemd/orchestrad.service`) |

## Project Structure

```text
.
|- apps/
|  |- backend/      # Go backend (daemon + CLI + internal services)
|  |- desktop/      # Electron + React operator console
|  `- tui/          # Bubble Tea terminal dashboard
|- docs/
|  |- architecture/
|  |- usage/
|  `- openapi.yaml
|- ops/
|  |- docker/
|  `- systemd/
|- packages/
|  |- protocol/
|  |- config-spec/
|  `- test-fixtures/
`- .github/workflows/
```

<details>
<summary>Key entry points</summary>

- Backend daemon: `apps/backend/cmd/orchestrad/main.go`
- Backend CLI: `apps/backend/cmd/orchestra/main.go`
- Backend bootstrap: `apps/backend/internal/app/run.go`
- HTTP router: `apps/backend/internal/api/router.go`
- Desktop Electron main: `apps/desktop/electron/main.cjs`
- Desktop renderer bootstrap: `apps/desktop/src/main.tsx`
- Desktop main app shell: `apps/desktop/src/App.tsx`
- TUI entrypoint: `apps/tui/main.go`

</details>

## Quick Start

```bash
cd apps/backend && go run ./cmd/orchestrad
```

```bash
cd apps/desktop && npm ci && npm run dev
```

Then open the desktop app and verify the backend profile points to `http://127.0.0.1:4010`.

If the backend requires auth, configure the token in the desktop UI:

1. Open **Settings** (gear icon in the sidebar).
2. Go to **Backend Configuration**.
3. Set **API Token** to `dev-token`.
4. Save.

The app reconnects and should show all 20 projects.

## Installation

### Prerequisites

- Go (backend and TUI modules declare Go `1.25.x`)
- Node.js + npm (desktop CI uses Node 20)
- Git

### Backend

```bash
cd apps/backend
go mod download
go run ./cmd/orchestrad
```

### Desktop

```bash
cd apps/desktop
npm ci
npm run dev
```

### Optional TUI dashboard

From repository root:

```bash
make dash
```

## Environment Variables

Backend configuration is loaded from environment variables and workflow-frontmatter overrides in `apps/backend/internal/config/load.go`.

| Variable | Purpose | Default / behavior |
|---|---|---|
| `ORCHESTRA_SERVER_HOST` | Backend bind host | `127.0.0.1` |
| `ORCHESTRA_SERVER_PORT` | Backend port | `4010` |
| `ORCHESTRA_API_TOKEN` | Bearer token for protected routes | Empty by default; required for non-loopback host |
| `ORCHESTRA_WORKSPACE_ROOT` | Workspace + warehouse root | `$HOME/.orchestra/workspaces` (or temp fallback) |
| `ORCHESTRA_WORKFLOW_FILE` | Workflow markdown config | `WORKFLOW.md` |
| `ORCHESTRA_AGENT_PROVIDER` | Default provider | `codex` |
| `ORCHESTRA_AGENT_MAX_TURNS` | Max turns per issue | `3` |
| `ORCHESTRA_TRACKER_TYPE` | Tracker backend type | Empty unless configured |
| `ORCHESTRA_TRACKER_ENDPOINT` | Tracker endpoint | Empty unless configured |
| `ORCHESTRA_TRACKER_TOKEN` | Tracker token | Empty unless configured |
| `ORCHESTRA_GITHUB_CLIENT_ID` / `ORCHESTRA_GITHUB_CLIENT_SECRET` | GitHub OAuth config | Empty unless configured |
| `ORCHESTRA_MCP_SERVERS` | MCP server map (`name=command,...`) | Empty unless configured |

Desktop process defaults in `apps/desktop/electron/main.cjs`:

| Variable | Purpose | Default |
|---|---|---|
| `ORCHESTRA_BASE_URL` | Default backend profile URL | `http://127.0.0.1:4010` |
| `ORCHESTRA_API_TOKEN` | Default backend profile token | Empty |

## Usage

### Local development quick start

1. Start backend:
   ```bash
   cd apps/backend
   go run ./cmd/orchestrad
   ```
2. Start desktop in another shell:
   ```bash
   cd apps/desktop
   npm run dev
   ```
3. In desktop Settings, select/verify the backend profile (`baseUrl` + optional token).

### Backend CLI

```bash
cd apps/backend
go run ./cmd/orchestra start
go run ./cmd/orchestra check
go run ./cmd/orchestra check-pr-body /path/to/pr_body.md
```

### Desktop validation scripts

```bash
cd apps/desktop
npm run test
npm run test:smoke-renderer
npm run smoke:ops
npm run smoke:ops:go
npm run smoke:ops:go:auth
npm run parity:verify
npm run release:gate
```

## API Reference

- Canonical OpenAPI file: `docs/openapi.yaml`
- Runtime OpenAPI endpoint: `GET /api/v1/openapi.yaml`
- Health endpoints: `GET /healthz`, `GET /api/v1/healthz`

Major API areas (from router and OpenAPI):

| Group | Representative endpoints |
|---|---|
| Runtime | `GET /api/v1/state`, `GET /api/v1/events`, `POST /api/v1/refresh` |
| Issues | `GET/POST /api/v1/issues`, `PATCH/DELETE /api/v1/issues/{issue_identifier}`, `GET /history`, `GET /logs`, `GET /diff`, `GET /artifacts` |
| Projects | `GET/POST /api/v1/projects`, `GET /tree`, `GET /file`, `GET /git`, `POST /git/commit`, `POST /git/push`, `POST /git/pull` |
| Sessions/Warehouse | `GET /api/v1/sessions`, `GET /api/v1/sessions/{session_id}`, `GET /api/v1/warehouse/stats` |
| Agents/MCP/Docs | `/api/v1/config/agents*`, `/api/v1/agents`, `/api/v1/mcp/*`, `/api/v1/docs*` |
| GitHub/Terminal | `/api/v1/github/login`, `/api/v1/github/callback`, `POST /api/v1/issues/{issue_identifier}/pr`, `GET /api/v1/terminal/{session_id}` |

## Testing

### Backend

```bash
cd apps/backend
go vet ./...
go test -race ./...
```

### Desktop

```bash
cd apps/desktop
npm test
npm run test:smoke-renderer
npm run release:gate
```

### Additional root scripts

- `test_api.sh`
- `test_api_post.sh`
- `test_projects.sh`
- `verify_projects.sh`

## Deployment

### Docker (backend)

```bash
docker build -f ops/docker/Dockerfile.backend -t orchestra-backend .
docker run --rm -p 4010:4010 \
  -e ORCHESTRA_SERVER_HOST=0.0.0.0 \
  -e ORCHESTRA_SERVER_PORT=4010 \
  orchestra-backend
```

### systemd

Unit template: `ops/systemd/orchestrad.service`.

### CI signals

- Backend formatting/vet/race tests in `.github/workflows/orchestra-backend.yml`.
- Desktop parity/release gate in `.github/workflows/orchestra-desktop-smoke.yml`.
- Backend binary artifact build in `.github/workflows/orchestra-release-artifacts.yml`.

## Contributing

Formal contribution guide: **Not detected in repository analysis**.

Practical flow from repository tooling:

1. Run backend and/or desktop checks for changed areas.
2. Keep API changes aligned with `docs/openapi.yaml` and client usage in `apps/desktop/src/lib/orchestra-client.ts`.
3. Keep shared contract updates synchronized in `packages/protocol` and fixtures in `packages/test-fixtures`.

## License

Repository-level license declaration: **Not detected in repository analysis**.

Observed license artifacts:

- `apps/backend/LICENSE` (Apache License 2.0 text)
- `licenses/NOTICE`
- `licenses/OPEN_AI_LICENSE`
- `licenses/UNFIREHOSE_LICENSE`

## Evidence Map

| Claim | Evidence files | Confidence |
|---|---|---|
| Monorepo includes backend, desktop, TUI, shared packages | `apps/backend`, `apps/desktop`, `apps/tui`, `packages/protocol` | High |
| Backend exposes REST + SSE + WebSocket routes | `apps/backend/internal/api/router.go`, `apps/backend/internal/api/events.go`, `docs/openapi.yaml` | High |
| Daemon initializes orchestrator, tracker, MCP, telemetry workers | `apps/backend/internal/app/run.go` | High |
| Desktop implements multi-section operator console | `apps/desktop/src/App.tsx`, `apps/desktop/src/app/routes/sections.ts` | High |
| Desktop stores backend profiles and encrypted agent tokens | `apps/desktop/electron/main.cjs`, `apps/desktop/electron/preload.cjs` | High |
| SQLite warehouse schema for projects/sessions/events/issues/runs/history | `apps/backend/internal/db/schema.go` | High |
| Shared protocol schemas and fixtures support compatibility | `packages/protocol/README.md`, `packages/protocol/schemas/v1/*`, `packages/test-fixtures/api/v1/*` | High |
| CI enforces backend checks and desktop release gate | `.github/workflows/orchestra-backend.yml`, `.github/workflows/orchestra-desktop-smoke.yml` | High |
| Docker + systemd deployment assets are provided | `ops/docker/Dockerfile.backend`, `ops/systemd/orchestrad.service` | High |

## Evidence Files

- `apps/backend/cmd/orchestra/main.go`
- `apps/backend/cmd/orchestrad/main.go`
- `apps/backend/internal/app/run.go`
- `apps/backend/internal/api/router.go`
- `apps/backend/internal/api/events.go`
- `apps/backend/internal/api/openapi.go`
- `apps/backend/internal/api/docs.go`
- `apps/backend/internal/config/load.go`
- `apps/backend/internal/db/schema.go`
- `apps/backend/go.mod`
- `apps/desktop/package.json`
- `apps/desktop/electron/main.cjs`
- `apps/desktop/electron/preload.cjs`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/app/routes/sections.ts`
- `apps/desktop/src/lib/orchestra-client.ts`
- `apps/tui/main.go`
- `apps/tui/manager.go`
- `apps/tui/go.mod`
- `packages/protocol/README.md`
- `packages/protocol/package.json`
- `packages/protocol/types/v1.ts`
- `packages/config-spec/README.md`
- `packages/test-fixtures/README.md`
- `docs/openapi.yaml`
- `docs/index.md`
- `docs/usage/getting-started.md`
- `.github/workflows/orchestra-backend.yml`
- `.github/workflows/orchestra-desktop-smoke.yml`
- `.github/workflows/orchestra-release-artifacts.yml`
- `.github/workflows/make-all.yml`
- `.github/workflows/pr-description-lint.yml`
- `.github/scripts/check-orchestra-naming.sh`
- `Makefile`
- `ops/docker/Dockerfile.backend`
- `ops/systemd/orchestrad.service`
- `test_api.sh`
- `test_api_post.sh`
- `test_projects.sh`
- `verify_projects.sh`

## Assumptions & Uncertainties

- License signals are mixed: `docs/openapi.yaml` advertises `Proprietary`, while `apps/backend/LICENSE` contains Apache-2.0 text and additional license artifacts exist under `licenses/`.
- `apps/desktop/README.md` references files under `docs/plans/` that are not present in this repository snapshot.
