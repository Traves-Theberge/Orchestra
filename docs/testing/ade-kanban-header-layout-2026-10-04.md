# Kanban header layout handoff — 2026-10-04

## Scope and result

`apps/desktop/src/features/kanban/KanbanBoard.tsx` now places the Board and Work Items tabs, Create Task action, board filters, and board/list control in one wrapping header row. At narrow widths, the controls can wrap with consistent spacing. Board-specific filters and view controls are shown only on the Board tab. Create Task remains available on both tabs, and the Work Items project picker remains beside its tab. Task creation, issue states, columns, and actions were not changed.

## Pinned reference review

- **T3 Code, revision `737993303d36e10674c54b95e5bd3826682c99c7`:** reviewed [`ChatComposer.tsx`](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/chat/ChatComposer.tsx), the package 06 starting point. It organizes provider/model/runtime controls and submission around a single composer. It is a chat composer rather than a board header, so it gives no directly reusable board toolbar rule. Orchestra keeps its existing tab/button treatment and groups the board-level action with the view switch.
- **Orca, revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`:** reviewed [`AgentKanbanBoard.tsx`](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/dashboard-popout/AgentKanbanBoard.tsx) and the assigned [`worker-list-run-scope.test.ts`](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/worker-list-run-scope.test.ts). The Kanban board uses a compact header with optional header actions, then a separate toolbar and board; the test concerns run-scoped worker observations and has no visual layout assertions. The header/action grouping is applicable. Worker scope semantics and Orca's separate dashboard buckets do not apply to this visual-only edit; Orchestra retains its task Kanban and five columns.
- No local cached checkout of either pinned reference was present in the inspected cache locations; source files were reviewed at the pinned GitHub revisions above. No source code or assets were copied.

## Orchestra adaptation and acceptance

The existing Board/Work Items buttons, Work Items project picker, and board controls share a `flex-wrap` header with spacing. Create Task keeps its existing callback and Backlog behavior on both tabs. Acceptance: at wide widths the action and board controls sit inline with the tabs; when available width is insufficient, the controls wrap without changing task or view behavior.

## Verification

The existing Kanban component test passed (3 tests), and desktop TypeScript typecheck passed. Source review confirms the Create Task action has one render location and the previous separate board-only controls row is removed. No workflow code changed. Desktop screenshots were not captured; visual responsive behavior remains to be confirmed in the desktop app.
