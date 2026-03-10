# Code Review Checklist & Deep Wiki Progress

This document tracks the comprehensive, file-by-file review of the entire Orchestra codebase (Backend + Desktop) to build a Deep Wiki-style knowledge base.

## Backend (Go)

### Entrypoints & CLI
- [x] `apps/backend/cmd/orchestrad/main.go`
- [x] `apps/backend/cmd/orchestra/main.go`
- [x] `apps/backend/cmd/orchestra/main_test.go`
- [x] `apps/backend/internal/app/run.go`
- [x] `apps/backend/internal/app/run_test.go`

### Configuration
- [x] `apps/backend/internal/config/load.go`
- [x] `apps/backend/internal/config/load_test.go`
- [x] `apps/backend/internal/config/types.go`

### Agents & Adapters
- [x] `apps/backend/internal/agents/claude_runner.go`
- [x] `apps/backend/internal/agents/codex_appserver.go`
- [x] `apps/backend/internal/agents/codex_appserver_test.go`
- [x] `apps/backend/internal/agents/command_runner.go`
- [x] `apps/backend/internal/agents/command_runner_test.go`
- [x] `apps/backend/internal/agents/config.go`
- [x] `apps/backend/internal/agents/opencode_runner.go`
- [x] `apps/backend/internal/agents/registry.go`
- [x] `apps/backend/internal/agents/registry_test.go`
- [x] `apps/backend/internal/agents/types.go`

### API & Router
- [x] `apps/backend/internal/api/auth.go`
- [x] `apps/backend/internal/api/contract_test_helpers.go`
- [x] `apps/backend/internal/api/docs.go`
- [x] `apps/backend/internal/api/events.go`
- [x] `apps/backend/internal/api/github_auth.go`
- [x] `apps/backend/internal/api/health.go`
- [x] `apps/backend/internal/api/projects.go`
- [x] `apps/backend/internal/api/router.go`
- [x] `apps/backend/internal/api/security_and_events_test.go`
- [x] `apps/backend/internal/api/state.go`
- [x] `apps/backend/internal/api/state_test.go`
- [x] `apps/backend/internal/api/static.go`
- [x] `apps/backend/internal/api/static_test.go`
- [x] `apps/backend/internal/api/workspace_migration.go`
- [x] `apps/backend/internal/api/workspace_migration_test.go`

### Database
- [x] `apps/backend/internal/db/db.go`
- [x] `apps/backend/internal/db/projects.go`
- [x] `apps/backend/internal/db/schema.go`

### Core Orchestrator
- [x] `apps/backend/internal/orchestrator/dispatch_test.go`
- [x] `apps/backend/internal/orchestrator/reconcile.go`
- [x] `apps/backend/internal/orchestrator/reconcile_test.go`
- [x] `apps/backend/internal/orchestrator/refresh_test.go`
- [x] `apps/backend/internal/orchestrator/soak_test.go`
- [x] `apps/backend/internal/orchestrator/state.go`
- [x] `apps/backend/internal/orchestrator/state_test.go`

### Workspace Management
- [x] `apps/backend/internal/workspace/hooks.go`
- [x] `apps/backend/internal/workspace/hooks_test.go`
- [x] `apps/backend/internal/workspace/migration.go`
- [x] `apps/backend/internal/workspace/migration_test.go`
- [x] `apps/backend/internal/workspace/path_guard.go`
- [x] `apps/backend/internal/workspace/path_guard_test.go`
- [x] `apps/backend/internal/workspace/service.go`
- [x] `apps/backend/internal/workspace/service_test.go`

### Linear Client & Tools
- [x] `apps/backend/internal/tracker/github/client.go`
- [x] `apps/backend/internal/tracker/memory/client.go`
- [x] `apps/backend/internal/tracker/memory/client_test.go`
- [x] `apps/backend/internal/tracker/sqlite/client.go`
- [x] `apps/backend/internal/tracker/types.go`
- [x] `apps/backend/internal/tools/tracker_executor.go`
- [x] `apps/backend/internal/tools/tracker_executor_test.go`

### Utilities & Telemetry
- [x] `apps/backend/internal/logfile/logfile.go`
- [x] `apps/backend/internal/logfile/logfile_test.go`
- [x] `apps/backend/internal/logging/logger.go`
- [x] `apps/backend/internal/observability/pubsub.go`
- [x] `apps/backend/internal/observability/pubsub_test.go`
- [x] `apps/backend/internal/presenter/presenter.go`
- [x] `apps/backend/internal/presenter/presenter_test.go`
- [x] `apps/backend/internal/prompt/builder.go`
- [x] `apps/backend/internal/prompt/builder_test.go`
- [x] `apps/backend/internal/runtime/identity.go`
- [x] `apps/backend/internal/runtime/identity_test.go`
- [x] `apps/backend/internal/specs/check.go`
- [x] `apps/backend/internal/specs/check_test.go`
- [x] `apps/backend/internal/specs/pr_body.go`
- [x] `apps/backend/internal/specs/pr_body_test.go`
- [x] `apps/backend/internal/staticassets/assets.go`
- [x] `apps/backend/internal/telemetry/watcher.go`
- [x] `apps/backend/internal/utils/git/git.go`
- [x] `apps/backend/internal/utils/github/github.go`
- [x] `apps/backend/internal/workflow/frontmatter.go`
- [x] `apps/backend/internal/workflow/frontmatter_test.go`
- [x] `apps/backend/internal/workflow/store.go`
- [x] `apps/backend/internal/workflow/store_test.go`
- [x] `apps/backend/go.mod`
- [x] `apps/backend/go.sum`
- [x] `apps/backend/LICENSE`

## Desktop (React + Electron)

### App Root & Types
- [x] `apps/desktop/src/App.tsx`
- [x] `apps/desktop/src/App.smoke.test.tsx`
- [x] `apps/desktop/src/main.tsx`
- [x] `apps/desktop/src/crash-boundary.tsx`
- [x] `apps/desktop/src/index.css`
- [x] `apps/desktop/src/types/global.d.ts`

### Layout & Shell
- [x] `apps/desktop/src/components/app-shell/panels.tsx`
- [x] `apps/desktop/src/components/app-shell/sidebar-nav.tsx`
- [x] `apps/desktop/src/components/app-shell/top-bar.tsx`
- [x] `apps/desktop/src/components/app-shell/types.ts`

### Dashboards & Views
- [x] `apps/desktop/src/components/agents/AgentsDashboard.tsx`
- [x] `apps/desktop/src/components/docs/DocsDashboard.tsx`
- [x] `apps/desktop/src/components/projects/ProjectDetailView.tsx`
- [x] `apps/desktop/src/components/projects/ProjectGrid.tsx`
- [x] `apps/desktop/src/components/warehouse/AnalyticsDashboard.tsx`
- [x] `apps/desktop/src/components/warehouse/SessionDetailView.tsx`

### UI Primitives (shadcn/ui)
- [x] `apps/desktop/src/components/ui/badge.tsx`
- [x] `apps/desktop/src/components/ui/button.tsx`
- [x] `apps/desktop/src/components/ui/card.tsx`
- [x] `apps/desktop/src/components/ui/dialog.tsx`
- [x] `apps/desktop/src/components/ui/scroll-area.tsx`
- [x] `apps/desktop/src/components/ui/skeleton.tsx`
- [x] `apps/desktop/src/components/ui/table.tsx`
- [x] `apps/desktop/src/components/ui/tooltip-wrapper.tsx`
- [x] `apps/desktop/src/components/diagrams/D3ArchitectureGraph.tsx`

### Lib & State
- [x] `apps/desktop/src/lib/orchestra-client.ts`
- [x] `apps/desktop/src/lib/orchestra-client.test.ts`
- [x] `apps/desktop/src/lib/orchestra-types.ts`
- [x] `apps/desktop/src/lib/runtime-store.ts`
- [x] `apps/desktop/src/lib/runtime-store.test.ts`
- [x] `apps/desktop/src/lib/runtime-sync.ts`
- [x] `apps/desktop/src/lib/runtime-sync.test.ts`
- [x] `apps/desktop/src/lib/view-models.ts`
- [x] `apps/desktop/src/lib/view-models.test.ts`
- [x] `apps/desktop/src/lib/navigation.ts`
- [x] `apps/desktop/src/lib/navigation.test.ts`
- [x] `apps/desktop/src/lib/utils.ts`
