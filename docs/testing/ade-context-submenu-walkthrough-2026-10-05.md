# File and tab submenu walkthrough

## Reference receipt

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`, `apps/web/src/components/Sidebar.tsx`: inspected the controlled snooze menu and its explicit MenuItem action callbacks, plus context-menu keyboard entry points. Selection is distinct from opening/dismissing a popup.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, `src/renderer/src/components/sidebar/worktree-card-surface.tsx`: the worktree surface delegates context-menu selection through a dedicated wrapper; a deletion overlay is a separate state. This is a worktree menu, not an equivalent file mutation implementation.
- Orchestra retains its existing file/tab portals and mutation owners. No reference code was copied. The walkthrough verifies submenu dispatch and cancellation at the component boundary, while actual filesystem changes remain a separate API/native test concern.

## Behavior and verification

`ContextMenus.walkthrough.test.tsx` opens each file action, verifies its exact dispatched action and dismissal, checks root menus exclude Rename/Delete, and exercises Escape/outside dismissal without dispatch. The tab submenu verifies cancellation does not close a tab and explicit Close dispatches once. All nine cases pass.

The tests exposed file action accessible names concatenated with shortcut text (for example `RenameEnter`). File actions now expose semantic `menuitem` roles and stable action labels; visible shortcuts remain intact.

These are component interaction tests. They do not claim native clipboard, Explorer launch, file deletion, complete keyboard arrow navigation, or viewport layout verification. The workspace/native walkthrough and the separate submenu coverage inventory record their own evidence.
