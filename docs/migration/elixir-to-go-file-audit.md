# Elixir-to-Go File Audit

This tracks one-to-one coverage against the Elixir source tree and is updated during migration.

Status legend:
- `implemented`: functional Go counterpart exists
- `partial`: scaffold exists, feature parity incomplete
- `missing`: no meaningful Go counterpart yet

## Core Runtime (`elixir/lib/symphony_elixir/*`)

- `symphony_elixir.ex` -> `apps/backend/internal/app/run.go` (`implemented`)
- `agent_runner.ex` -> `apps/backend/internal/agents/*` + `apps/backend/internal/app/run.go` (`implemented`)
- `cli.ex` -> `apps/backend/cmd/orchestra/main.go` (`implemented`)
- `config.ex` -> `apps/backend/internal/config/load.go` (`implemented`)
- `http_server.ex` -> `apps/backend/internal/api/router.go` + `cmd/orchestrad` (`implemented`)
- `log_file.ex` -> `apps/backend/internal/logfile/logfile.go` (`implemented`)
- `orchestrator.ex` -> `apps/backend/internal/orchestrator/*.go` (`implemented`)
- `prompt_builder.ex` -> `apps/backend/internal/prompt/builder.go` (`implemented`)
- `specs_check.ex` -> `apps/backend/internal/specs/check.go` + `cmd/orchestra check` (`implemented`)
- `status_dashboard.ex` -> `apps/backend/internal/staticassets/assets.go` + `apps/backend/internal/api/static.go` (`implemented`)
- `tracker.ex` -> `apps/backend/internal/tracker/types.go` (`implemented`)
- `workflow.ex` -> `apps/backend/internal/workflow/frontmatter.go` (`implemented`)
- `workflow_store.ex` -> `apps/backend/internal/workflow/store.go` (`implemented`)
- `workspace.ex` -> `apps/backend/internal/workspace/*.go` (`implemented`)

## Codex (`elixir/lib/symphony_elixir/codex/*`)

- `codex/app_server.ex` -> `apps/backend/internal/agents/codex_appserver.go` (`implemented`)
- `codex/dynamic_tool.ex` -> `apps/backend/internal/tools/tracker_executor.go` (`implemented`)

## Linear (`elixir/lib/symphony_elixir/linear/*`)

- `linear/adapter.ex` -> `apps/backend/internal/tracker/graphql/client.go` + config wiring in `apps/backend/internal/app/run.go` (`implemented`)
- `linear/client.ex` -> `apps/backend/internal/tracker/graphql/client.go` (`implemented`)
- `linear/issue.ex` -> `apps/backend/internal/tracker/types.go` (`implemented`)

## Tracker Memory (`elixir/lib/symphony_elixir/tracker/*`)

- `tracker/memory.ex` -> `apps/backend/internal/tracker/memory/client.go` (`implemented`)

## Web Layer (`elixir/lib/symphony_elixir_web/*`)

- `endpoint.ex` -> `apps/backend/internal/api/router.go` (`implemented`)
- `router.ex` -> `apps/backend/internal/api/router.go` (`implemented`)
- `presenter.ex` -> `apps/backend/internal/presenter/presenter.go` (`implemented`)
- `observability_pubsub.ex` -> `apps/backend/internal/observability/pubsub.go` (`implemented`)
- `static_assets.ex` -> `apps/backend/internal/staticassets/assets.go` (`implemented`)
- `error_html.ex` -> `apps/backend/internal/api/router.go` + `apps/backend/internal/staticassets/assets.go` (`implemented`)
- `error_json.ex` -> `apps/backend/internal/api/router.go` (`implemented`)
- `components/layouts.ex` -> `missing`
- `live/dashboard_live.ex` -> `apps/backend/internal/staticassets/assets.go` + `apps/backend/internal/api/static.go` (`implemented`)
- `controllers/observability_api_controller.ex` -> `apps/backend/internal/api/state.go` (`implemented`)
- `controllers/static_asset_controller.ex` -> `apps/backend/internal/api/static.go` (`implemented`)

## Mix Tasks (`elixir/lib/mix/tasks/*`)

- `pr_body.check.ex` -> `apps/backend/internal/specs/pr_body.go` + `cmd/orchestra check-pr-body` (`implemented`)
- `specs.check.ex` -> `cmd/orchestra check` (`implemented`)
- `workspace.before_remove.ex` -> `apps/backend/internal/workspace/service.go` + `apps/backend/internal/api/workspace_migration.go` (`implemented`)

## Current Priorities After Backend Parity

1. Close remaining web-template audit gap (`components/layouts.ex`) when frontend parity work starts (`medium`).
2. Keep backend parity evidence green in CI (`go test ./...`, race checks, contract tests) during follow-up changes (`critical`).
3. Use `docs/migration/parity-gate.md` + `docs/migration/production-cutover-checklist.md` for cutover sign-off and decommission sequencing (`high`).
