# Desktop submenu walkthrough coverage, 2026-10-05

## Reference review and test boundary

T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`, [`apps/web/src/components/chat/ChatComposer.tsx`](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/chat/ChatComposer.tsx): the provider/model controls are part of the composer and reflect provider-reported capabilities and state. Orchestra's harness/model fixture tests follow that boundary: they choose only catalog-provided IDs and do not infer runtime availability from local settings.

Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, [`src/main/native-chat/agent-model-catalog/agent-project-model-override.ts`](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts): a project override may affect an account default, and config-file presence alone does not establish the effective model. These renderer tests check selection identity and scoped callbacks; they do not claim a selected model is effective or that a provider accepted it.

Neither inspected source provides a corresponding Orchestra-independent usage-filter, file-explorer project-switcher, Git branch dropdown, or task assignment/runtime menu pattern. Those controls are verified against their local contracts. The tests use fixture project IDs/paths, fixture provider settings, and mocked callbacks. They do not mutate live accounts, credentials, provider configuration, Git repositories, or user workspaces. These are component tests; they do not establish native application E2E behavior.

## Inventory

| Area | Coverage | Status and limits |
| --- | --- | --- |
| Workspace file and tab context menus | `ContextMenus.walkthrough.test.tsx` (9 tests; root-owned) | Covered: root/item action differences, dispatch and close, portal placement, Escape and outside dismissal. |
| Workspace tab add/split menus | `TabGroupPanel.submenus.test.tsx` (11 new tests) | Covered every Add-tab item, both split directions, Close group, portal role, exact project/group scope, Escape/focus return, and the new-Markdown HTTP boundary using a mocked fixture response. No real file, process, browser, or agent terminal is launched. |
| Worktree menu and create-worktree choices | `WorktreeRemovalControls.test.tsx`, `ProjectWorkspaceTree.test.tsx`, create dialog tests (other owners) | Covered by parallel worktree lifecycle walkthroughs; see [worktree removal handoff](ade-worktree-removal-controls-handoff-2026-10-04.md). |
| Usage scope/range menu | `FilterMenu.test.tsx` (2 new tests) | Covered: exact scope/range callback, close after choice, Escape/outside dismissal without mutation. |
| File-explorer project switcher | `ProjectSwitcher.test.tsx` (3 new tests) | Covered: open available project with exact ID/path, switch open project through both store actions, outside dismissal, and Escape dismissal with focus return. |
| Sidebar Agents and Settings submenus | `AppSidebar.submenus.test.tsx` (2 new tests) | Covered actual Agents provider selection and project scope to project-ID mapping; Settings entry resets to Connections/top and subsection choice routes to the requested scroll target. |
| Task creation selectors | `layout/shared/controls.test.tsx` (4 new tests); `CreateTaskDialog.test.tsx` (1 new integration case) | Covered exact project/assignee/runtime values, configured runtime filtering, disabled trigger, and the final submitted task payload after choosing each menu. |
| Provider settings selector | `GeminiSettingsPanel.test.tsx` (1 new test) | Covered a fixture-only setting choice staying local until explicit save callback, with scoped file path and output JSON. No live settings were written. |
| Settings profile/theme selectors | `SettingsPage.submenus.test.tsx` (2 new tests) | Covered backend profile callback receives stable profile ID (never token), theme preset stable ID, and explicit Auto mode selection. Credentials and API config are fixture-only; external services are not contacted. |
| Agent project selector | `ProjectSelector.test.tsx` (existing); `AgentsDashboard.test.tsx` (existing) | Covered global/project identity and dashboard scope propagation. |
| Harness/model picker | `HarnessPicker.test.tsx` and `WorkspaceChat.test.tsx` (existing, chat owner) | Covered provider-reported model identity, hidden models, focus return, and chat integration fixtures. No live provider was contacted. |
| Agent-mode picker | `AgentPicker.test.tsx` (existing, chat owner) | Covered catalog failure/loading, scoped definition selection, unsupported modes, and composer Tab cycling. |
| Usage filters | `FilterMenu.test.tsx` (2 new tests) | Covered exact scope/range callback, close after choice, Escape/outside dismissal without mutation. |
| Kanban task project selector | `KanbanBoard.submenus.test.tsx` (2 new tests) | Covered Work Items project choice updates the global selected project ID; Escape leaves scope unchanged and returns focus. |
| Browser action menu | `BrowserPane.test.tsx` (5 new tests) | Covered active URL copy, homepage selection, page-source open with the active workspace identity, clear-data host API dispatch, Escape/outside dismissal, and focus restoration. The `webview` session is a test double; actual Electron session-storage clearing and OS browser launch are not runtime-verified here. |
| Git branches and stashes | `BranchBar.test.tsx` (3 new lifecycle tests plus existing selection/create tests); `BranchManagerView.test.tsx`; `StashPanel.test.tsx`; `GitTab.test.tsx` | Covered branch selection scope, Escape/outside cancellation, checkout error display without refresh, stash panel open/Escape/focus, project-scoped stash creation, exact stash apply, and close behavior. Actual Git operations are mocked. |
| Settings language selector | Repository search found no language selector in `SettingsPage` or sidebar settings sections | Not applicable to current UI; there is no menu to exercise. |

## Verification

- Focused Vitest run after the final menu changes: 15 files passed, 68 tests passed, including Add-tab/split, task/project selectors, browser, settings, Git, usage, and provider/model suites. The earlier broader run passed 20 files and 102 tests; the final focused rerun is the authoritative result after the last source edit.
- `npm run typecheck`: passed after all source and test additions.
- Focused final TabGroupPanel run: 1 file, 11 tests passed. Scoped ESLint: 0 errors and 5 warnings (three in `BranchBar.test.tsx`, two unused-symbol warnings in `KanbanBoard.tsx`).
- No app was restarted; no real provider credentials or user repositories were used.
