# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is This

Orchestra — a multi-agent orchestration platform that dispatches coding agents (Claude, Codex, OpenCode, Gemini) to resolve issues from project trackers. Go backend + Electron/React desktop app + Bubble Tea TUI.

**Key Features:**
- **Multi-agent orchestration**: Dispatches work to different coding agents based on provider availability and workload
- **Embedded Agent Widget**: Floating chat interface with 40+ tools, multi-provider LLM support, voice input via Whisper
- **Real-time monitoring**: SSE streaming of agent execution events and status updates
- **Git worktree isolation**: Each issue runs in isolated git worktree to prevent conflicts
- **Issue tracker integration**: GitHub, SQLite, and memory backends for issue management

## Build & Run Commands

### Backend (`apps/backend/`)
```bash
cd apps/backend && go build -o orchestrad ./cmd/orchestrad/    # build daemon
cd apps/backend && go vet ./...                                 # lint
cd apps/backend && go test ./...                                # all tests
cd apps/backend && go test ./internal/db/...                    # single package
cd apps/backend && go test -race ./...                          # race detection
gofmt -l ./apps/backend/cmd ./apps/backend/internal             # format check
```

### Frontend (`apps/desktop/`)
```bash
cd apps/desktop && npm run dev:linux    # dev server (Linux, or use `make desktop`)
cd apps/desktop && npx vitest run       # all tests
cd apps/desktop && npx vitest run src/lib/validation.test.ts    # single test file
cd apps/desktop && npx tsc --noEmit     # typecheck
cd apps/desktop && npm run lint         # eslint
```

### TUI (`apps/tui/`)
```bash
make dash       # run TUI
make build      # build TUI binary
make install    # install to /usr/local/bin/orchestra-dash
```

### Desktop Development Scripts
```bash
cd apps/desktop && npm run dev:linux    # dev server with --no-sandbox for Linux
cd apps/desktop && npm run typecheck    # TypeScript type checking
cd apps/desktop && npm run lint         # ESLint
cd apps/desktop && npm run lint:fix     # ESLint with auto-fix
cd apps/desktop && npm run preview      # preview production build
cd apps/desktop && npm run dist:desktop # build distributable packages
```

### Testing Commands
```bash
# Backend
cd apps/backend && go test -coverprofile=coverage.out ./...  # tests with coverage
cd apps/backend && go test -race ./...                       # race detection

# Desktop
cd apps/desktop && npx vitest run --reporter=verbose         # verbose test output
cd apps/desktop && npm run test:smoke-renderer               # renderer smoke test
cd apps/desktop && npm run smoke:ops:go                      # operations smoke tests (requires backend)
cd apps/desktop && npm run parity:verify                     # API parity verification
cd apps/desktop && npm run release:gate                      # full release readiness check
```

### Running the backend
```bash
ORCHESTRA_API_TOKEN=dev-token ORCHESTRA_WORKSPACE_ROOT=/tmp/orchestra ./apps/backend/orchestrad
```
The daemon binds to `127.0.0.1:3284` by default. The desktop app in browser mode falls back to `localhost:4010` with `dev-token`.

## Architecture

### Monorepo layout
- `apps/backend/` — Go backend (Chi router, SQLite via modernc.org/sqlite)
- `apps/desktop/` — Electron 41 + React 19 + Vite + Tailwind v4
- `apps/tui/` — Bubble Tea terminal dashboard
- `packages/protocol/` — Shared JSON schemas
- `go.work` ties backend and TUI together; CI runs with `GOWORK=off`

### Backend structure (`apps/backend/`)
Entry point: `cmd/orchestrad/main.go` → `app.Run()` which wires everything.

Key packages:
- `internal/orchestrator/` — Central service: state machine for issue dispatch, concurrency control (global + per-state limits), retry with backoff
- `internal/api/` — Chi router with 100+ endpoints, middleware (rate limiting 20 req/s, bearer token auth, CORS, 30s timeout)
- `internal/agents/` — Agent registry mapping providers to Runner implementations
- `internal/tracker/` — Issue tracker abstraction with GitHub, SQLite, and memory backends
- `internal/workspace/` — Git worktree lifecycle per issue (create, hooks, cleanup)
- `internal/db/` — SQLite schema (8 tables: projects, sessions, events, issues, runs, issue_history, mcp_servers, ingest_offsets), migrations via `migrateColumn()`
- `internal/mcp/` — MCP server registry and lifecycle (JSON-RPC over stdin/stdout)
- `internal/tools/` — LinearToolExecutor bridges agent tool calls to tracker operations
- `internal/terminal/` — PTY/WebSocket terminal multiplexing
- `internal/observability/` — PubSub event bus for SSE streaming
- `internal/config/` — Config loaded from env vars + WORKFLOW.md YAML front matter

Background workers in `app/run.go`: execution worker (claims & dispatches issues), refresh worker (syncs tracker state), telemetry watcher, garbage collector.

### Frontend structure (`apps/desktop/`)
- `App.tsx` — Root component managing all global state, section routing, keyboard shortcuts
- `lib/orchestra-client.ts` — HTTP client wrapping all backend API calls
- `lib/runtime-sync.ts` — SSE subscription for real-time state updates with polling fallback
- `lib/runtime-store.ts` — Snapshot diffing and timeline management
- `components/embedded-agent/` — Floating AI chat widget with 40+ tools, multi-provider LLM support (AI SDK 6), voice input via Whisper
- `widgets/kanban/` — Drag-and-drop issue board (dnd-kit)
- `widgets/issue-detail/` — Issue inspector with tabs (Overview, History, Session Log, PR)
- `widgets/git/` — Git staging, diff, PR review
- `components/terminal/` — xterm-based terminal multiplexer (react-mosaic)
- `electron/main.cjs` — Spawns orchestrad, manages backend lifecycle, IPC bridge
- `electron/preload.cjs` — Exposes `window.orchestraDesktop` API (config, tokens, file ops)

Path aliases: `@/*` → `src/*`, plus `@app/*`, `@widgets/*`, `@features/*`, `@entities/*`, `@shared/*`.

State management: React hooks + SSE-driven server state, no Redux/Zustand.

### Data flow
1. Refresh worker queries tracker (GitHub/SQLite) → orchestrator enqueues candidates
2. Execution worker claims next issue → creates worktree → dispatches agent
3. Agent executes turn-by-turn with tool invocation → events stream via PubSub
4. Desktop subscribes via SSE → updates UI in real-time

## Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `ORCHESTRA_API_TOKEN` | Bearer token (required for non-loopback) |
| `ORCHESTRA_WORKSPACE_ROOT` | Workspace root directory |
| `ORCHESTRA_HOST` | Bind address (default `127.0.0.1:3284`) |
| `ORCHESTRA_AGENT_PROVIDER` | Default agent (CODEX/CLAUDE/OPENCODE/ANTIGRAVITY/OMP/8GENT) |
| `ORCHESTRA_TRACKER_TYPE` | `memory`, `sqlite`, or `github` |
| `ORCHESTRA_TRACKER_ENDPOINT` | `owner/repo` for GitHub tracker |
| `ORCHESTRA_MAX_CONCURRENT` | Global concurrent run limit |

## Database

SQLite at `{workspace_root}/.orchestra/warehouse.db`. Foreign keys enforced via `_pragma=foreign_keys(1)` in DSN. Delete cascades require `PRAGMA defer_foreign_keys = ON` before the transaction. `sessions.issue_id` was added via ALTER TABLE (no FK constraint) — must be NULLed manually on issue delete.

## Agent Configuration

The desktop app includes an Agents Dashboard for configuring coding agents:
- **Claude Config**: Edits real `settings.json`, `CLAUDE.md`, rules, skills, and sub-agents
- **Provider Settings**: Configure API keys, models, and behavior for different agent providers
- **Skills Management**: Add, edit, and organize agent skills and capabilities
- **Sub-agent Configuration**: Set up hierarchical agent relationships

Access via the Agents tab in the desktop app. Configuration changes are persisted to the appropriate files in the workspace.

## Gotchas

- Multiple `orchestrad` processes can accumulate — check with `ps aux | grep orchestrad`
- The `orchestrad` binary in `apps/backend/` is pre-built; rebuild with `go build -o orchestrad ./cmd/orchestrad/`
- No `main.go` in `apps/backend/` root — entry point is `cmd/orchestrad/main.go`
- `UpdateIssue` uses a column whitelist to prevent SQL injection
- CI sets `GOWORK=off` so backend tests don't depend on the workspace file
- Frontend dev server expects backend at `127.0.0.1:4010` in development — ensure backend is running with correct host/port
