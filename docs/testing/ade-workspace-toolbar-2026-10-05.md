# ADE workspace toolbar handoff — 2026-10-05

## Result

Workspace file, search, add-tool, visibility, maximize, and conversation-refresh controls now share a compact toolbar inside the workspace tools pane. The toolbar stays available in workspace and Git views. The editor/terminal surface remains mounted while Git is shown, so switching views does not discard its local state. When the pane is hidden, the chat header exposes **Show workspace tools**.

The toolbar is 40px high, borderless, and aligned with the chat header. Its icon actions use Orchestra `AppTooltip` with accessible button names; the moved controls do not rely on native `title` tooltips. Conversation refresh retains `WorkspaceChat`'s pending/disabled state and revision logic: the chat renders the button into a toolbar slot when present, and retains a local header fallback for contexts without a workspace pane.

## Reference patterns

- T3 Code, pinned source revision `737993303d36e10674c54b95e5bd3826682c99c7`: [`PanelLayoutControls.tsx`](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/chat/PanelLayoutControls.tsx) exposes panel controls with accessible labels, explicit open/availability state, and independent maximize/restore behavior. Orchestra uses the same explicit state and separate maximize control, while placing the actions in its workspace pane and using `AppTooltip`.
- Orca, pinned source revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [`use-floating-workspace-panel.ts`](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/app-shell/use-floating-workspace-panel.ts) owns panel visibility, focus restoration, a distinct open-maximized path, and mounting behavior for hidden workspace content. Orchestra preserves the editor/terminal mount when switching into Git and gives a hidden pane an explicit reopen control. The inspected Orca source did not expose a directly matching chat/workspace toolbar placement pattern.

## Verification

The focused Vitest run passed: `WorkspaceToolSurface.test.tsx`, `WorkspaceLayout.test.tsx`, `ResizableWorkspace.test.tsx`, and `WorkspaceChat.test.tsx` (4 files, 67 tests). Coverage checks toolbar placement and controls, the Git-view shared toolbar and single maximize action, pane hide/show, editor-surface mount retention across Git switching, refresh-slot ownership, files/search toggles, conversation-list Escape/focus return, title-edit cancellation, and ensuring a nested widget's consumed Escape does not interrupt an active turn. Focused ESLint passed for the changed workspace components and tests.

The isolated native Electron workspace-controls audit passed on 2026-10-05 using `scripts/electron-smoke.cjs --workspace-controls` and the rebuilt production renderer. Evidence is in `apps/desktop/reports/submenu-native-smoke-20261005d.log` and `apps/desktop/reports/multi-worktree-smoke-result.json`. The run verified native pointer tooltip rendering and viewport containment, toolbar actions in the tools pane, refresh ownership, Files & terminals navigation after workspace close/reopen, retained editor groups and buffers, Git view, submenus, and archive/history interactions. The Windows terminal action was selected from the real menu; the fixture records the backend's explicit “interactive PTY terminals are unavailable on Windows: a ConPTY adapter is required” response and does not claim a usable shell.

The audit initially selected a hidden retained workspace header after the selected workspace context had not rendered yet, and inspected Monaco text pane-wide. The final selector waits for a visible active workspace `role=tablist`, selected workspace row, `Files & terminals` selected state and `Tasks` unselected state, then reads the active editor group only. Close/reopen retained both editor groups and the expected buffers; no product layout bug was reproduced. `TabGroupPanel` now exposes split-group and active-tab data attributes for stable native observations.

## Deliberate adaptation

The Orchestra pane combines actions for files, search, workspace tools, and chat refresh because they operate on the same resizable workspace surface. Git content shares that surface and toolbar; its editor/terminal content remains mounted in a hidden wrapper to preserve state. In direct chat contexts without a workspace toolbar slot, refresh remains in the chat header.
