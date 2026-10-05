# Workspace tools toolbar handoff

## References considered

T3 Code pinned revision `737993303d36e10674c54b95e5bd3826682c99c7`: inspected `apps/web/src/components/chat/PanelLayoutControls.tsx`. It keeps terminal, right-panel and maximize controls compact, shows pressed/available state and presents unavailable controls honestly. The new toolbar preserves Orchestra's existing inline maximize control alongside its compact creation menu.

Orca pinned revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected `src/renderer/src/components/TerminalSplitWorkspaceSurfaces.tsx`. Each retained surface has an explicit worktree ID/path, focused group and visibility rather than a global active-root guess. Orchestra's browser/editor actions use the selected workspace context, and asynchronous Markdown creation captures the exact selected checkout and backend before writing.

Both sources have relevant control/ownership patterns. The four-entry creation menu is an Orchestra adaptation to the user's requested tools; neither inspected source establishes an identical four-entry menu. No reference source or assets were copied, and neither reference application was exercised.

## Implementation and boundaries

`WorkspaceToolSurface` exposes a borderless compact header with file/search controls, a portalled `+` menu and inline maximize. Menu entries are File viewer, New terminal, New markdown document and New browser tab. Terminal creation delegates the existing optional callback and is disabled when unavailable; no provider executable or direct shell command is introduced. File viewer reveals the existing workspace tree. Browser creation receives `getActiveWorkspaceContextId` explicitly.

Markdown uses a UUID filename under the selected checkout (falling back to the current explorer root), writes raw Markdown with the existing text/plain PUT file contract, awaits confirmed success and opens the editor with the captured workspace context. A changed backend/selection does not pull the user back into the old workspace. Failed/unknown writes display their exact candidate path, without automatically opening an editor or retrying. The menu uses document-body portal positioning with viewport bounds, outside-pointer and Escape dismissal, focus restoration and keyboard item navigation. Existing tools stay mounted.

The root integration removes the large empty-pane actions and supplies `onAddTerminal`. This package does not establish that an interactive terminal process is available or survives updates; its test proves delegation, not PTY delivery.

## Verification

Desktop typecheck passed. Twelve workspace layout/tool-surface tests passed, including portal placement, keyboard/outside dismissal, selected browser context, one terminal callback, exact child-checkout PUT bytes, waiting before editor open, failed PUT handling and no context switch after an asynchronous write. Native rendering/file creation/PTY behavior remain separate integration evidence.

The base-ref picker prerequisite was also corrected: project branch inventory uses machine-format local ref names and remote ref records, excludes symbolic remote aliases, and never returns Git's linked-checkout `+` decoration as part of a branch name. A real-Git linked checkout and remote HEAD alias test passed.

## Subsequent header and inspector refinement

The same pinned T3 `PanelLayoutControls` and Orca `TerminalSplitWorkspaceSurfaces` ownership patterns were considered again. T3's pinned `SidebarThreadHeader` also wraps compact icon actions in its tooltip primitives. Orchestra adapts that pattern with the existing `AppTooltip` rather than browser-native title balloons. The duplicate Files & terminals title/header row is removed: file/search, add-tool, panel visibility and maximize actions share the conversation header. Maximized tools retain local restore controls because the chat header is hidden. This is an Orchestra layout adaptation, not a copied reference implementation.

File and search inspectors now have borderless pointer-capture drag handles, keyboard resize, Home/End bounds and double-click reset. Width preferences are separated by backend, workspace context and inspector type. Narrow panes clamp the visible inspector while retaining the preferred desktop width; a drag captured in one context cannot mutate a different context. No inspected reference source established this exact persistence/keyboard contract, so it is independently implemented.

Absent provider usage now renders no message or invented zero. Measured usage still renders its actual counters. Focused layout/tool/usage/chat tests passed (67 tests before the new agent-picker tests). The production Electron audit passed on disposable fixture `orchestra-electron-smoke-eQqYwB`: tool controls are in the conversation header with native titles removed, inspector top offset is zero, keyboard resizing changes 176 to 216 pixels and survives closing/reopening, absent usage is hidden, and the agent picker is visible. The real Git child creation, scoped native-session rename, editor isolation, raw Markdown creation and actual browser guest also pass without sending a provider turn. A subsequent production Electron audit on fixture `orchestra-electron-smoke-ZuXygw` additionally used native mouse input to resize the inspector to 250 pixels and hover the toolbar control; the styled tooltip was visible and entirely inside the viewport. Both audits sent zero provider turns. Earlier audit attempts used the Files tab instead of the distinct visibility button and failed the close check; the locator was corrected, with the failures retained in ignored reports.
