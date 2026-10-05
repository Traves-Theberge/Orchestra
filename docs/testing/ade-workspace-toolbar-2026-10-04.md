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
