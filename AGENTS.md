# Repository Guidelines

## Required ADE Reference Patterns
For ADE changes, inspect the relevant Orca and T3 Code patterns before implementation. Follow the pinned source registry and package mapping in `docs/superpowers/plans/ade-2026-10-03/reference-patterns.md`. Record the source revision, observed behavior, Orchestra adaptation, deliberate deviations, and behavioral verification in the package handoff. Both references must be considered; if one has no relevant pattern, document that finding. Preserve the Kanban model while integrating native provider chat and a shared orchestration control/observation layer. Reference code, documentation, and passing unit tests do not establish Orchestra's E2E reliability; verify each claimed capability independently.

## Project Structure & Module Organization
The repository's Orchestra CLI skill is `.codex/skills/orchestra-cli/SKILL.md`. Keep its command examples and `references/task-system.md` aligned with executable CLI help, shared task semantics, and behavioral verification whenever CLI/task behavior changes. Planned commands must stay explicitly marked as unavailable.

`apps/backend` contains the Go API server and orchestration logic. Put binaries in `cmd/` and application code in `internal/`. `apps/tui` is a separate Go module for the terminal dashboard. `apps/desktop` is the Electron + React client; renderer code lives in `src/`, Electron entrypoints in `electron/`, static assets in `public/`, and dev scripts in `scripts/`. Shared schemas live in `packages/protocol/schemas`, test fixtures in `packages/test-fixtures`, and longer-form references in `docs/` and `ops/`.

## Build, Test, and Development Commands
- `cd apps/backend && go test ./... && go build -o orchestrad ./cmd/orchestrad/`: run backend tests and build the server.
- `cd apps/tui && go test ./...` or `make dash`: test or launch the TUI.
- `cd apps/desktop && npm install && npm run dev`: start the desktop app with Vite + Electron.
- `cd apps/desktop && npm run typecheck && npm run test && npm run build`: validate TypeScript, run Vitest, and build production assets.
- `cd apps/desktop && npm run smoke:ops:go`: run the desktop smoke flow against a spawned backend.

## Coding Style & Naming Conventions
Go code must stay `gofmt`-clean; keep packages focused and prefer `internal/<domain>` organization. Use `CamelCase` for exported Go symbols and `snake_case` only where the language or file format requires it. In the desktop app, follow the existing TypeScript + ESM setup, keep components in `PascalCase.tsx`, utilities in `kebab-case` or concise domain files under `src/lib`, and prefer typed APIs over `any`. Lint with `cd apps/desktop && npm run lint`.

## Testing Guidelines
Go tests use the standard `testing` package and follow `*_test.go`. Desktop tests use Vitest with `*.test.ts` and `*.test.tsx`; keep tests near the code they verify. Add coverage for new API handlers, orchestration logic, and desktop widgets when behavior changes. For higher-risk flows, run `go test -race ./...` in `apps/backend` and relevant smoke scripts in `apps/desktop/scripts`.

## Commit & Pull Request Guidelines
Recent history uses short Conventional Commit prefixes such as `fix:`, `feat:`, `docs:`, `refactor:`, and `chore:`. Keep subjects imperative and specific, for example `fix: resolve MCP enable toggle bug`. Pull requests should explain user-visible impact, summarize testing performed, link the issue or tracker item, and include screenshots for desktop UI changes.
