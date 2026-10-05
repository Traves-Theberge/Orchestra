# Workspace Files full-pane behavior

## Behavior and reference review

When Files is selected and the current workspace has no active editor, terminal, browser, or other tool tab, the file tree now fills the right-hand Workspace tools pane. Opening a file restores the resizable file inspector beside the active tool. Closing the last active tool returns Files to the full-pane view. Search continues to use the inspector and the Files/Search controls remain available to switch views.

The T3 Code reference was pinned at `737993303d36e10674c54b95e5bd3826682c99c7`. In `apps/web/src/components/files/filePreviewMode.ts`, `shouldShowFileExplorer` shows the explorer when there is no preview path, even when the saved explorer preference is off; with a file preview, the explorer can remain beside the preview. Orchestra adapts the no-preview fallback to the whole right-hand tools pane while retaining its inspector beside active tools.

The Orca reference was pinned at `3284b4c70c901402831bb4ccc5576ea083d2e5ae`. Inspection of `src/renderer/src/components/right-sidebar/FileExplorer.tsx` and `src/renderer/src/components/editor/EditorPanel.tsx` / `EditorPanelShell` showed a dedicated file explorer next to the editor. I found no equivalent no-active-tool full-pane fallback in those paths. Orchestra deliberately fills its existing tools pane with Files when no active workspace tool needs that space; it does not replace the chat pane or hide active editor tools.

## Implementation and verification

`WorkspaceLayout` derives whether a tool is active from the selected workspace context's split groups and active tab IDs. `WorkspaceToolSurface` fills the pane with a flex-column Files region only when Files is selected and no tool tab is active. Otherwise, the current resizable inspector layout remains in use.

Focused component coverage verifies full-pane Files, search-to-Files switching, file open and close transitions, inspector restoration, and active-tab selection across multiple split groups. `WorkspaceLayout.test.tsx` and `WorkspaceToolSurface.test.tsx` pass 18 tests; desktop typecheck passes. The production renderer build completed successfully.

The isolated native walkthrough passed at `apps/desktop/reports/full-files-pane-native-smoke-20261005d.log` (`ELECTRON_SMOKE_PASSED`). In the disposable project/worktree fixture it asserted Files fills the pane before opening the first file, the tree width is within 24 px of the Files region width, opening a file reveals the resize handle, closing the sole tab restores full-pane Files, and reopening the file restores the inspector. It also retained the pre-existing worktree, conversation, menu, and editor-buffer checks. No provider turn was sent; Windows terminal execution remains unavailable because the fixture backend requires a ConPTY adapter.

A later repeat (`full-files-pane-native-smoke-20261005e.log`) timed out before this Files sequence while waiting for a worktree-dialog receipt and child workspace. The prior complete run passed all Files assertions. This retry does not establish a Files regression; it leaves repeatability of the unrelated dialog step as an open native-smoke limitation.
