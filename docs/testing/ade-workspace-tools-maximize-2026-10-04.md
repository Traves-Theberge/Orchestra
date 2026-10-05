# Workspace tools maximize and sidebar order

## Reference observations

T3 Code at `737993303d36e10674c54b95e5bd3826682c99c7`:
[PanelLayoutControls.tsx](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/chat/PanelLayoutControls.tsx)
provides a pressed maximize/restore toggle with expanding/contracting arrow icons.
[PreviewPanelShell.tsx](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/preview/PreviewPanelShell.tsx)
uses the full available inline width when maximized, disables its resize handle,
and retains its children and stored width. This is workspace expansion rather
than an operating-system fullscreen transition.

Orca at `3284b4c70c901402831bb4ccc5576ea083d2e5ae`:
[TerminalSplitWorkspaceSurfaces.tsx](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/TerminalSplitWorkspaceSurfaces.tsx)
retains mounted workspace surfaces and scopes visibility to the active worktree.
It distinguishes hidden surfaces from browser guests that still need paint. This
file does not establish an equivalent whole-tools maximize button. We adopt its
surface lifetime concern, without claiming background browser painting parity.
Neither reference runtime was exercised. No reference source was copied.

## Orchestra adaptation and deviations

The arrow button in each tab group's existing toolbar expands the entire tools
surface, including all split groups, across the workspace content area. Empty
tools also have this button. Chat stays mounted but hidden; the divider disappears.
Restore and Escape bring back the saved chat/tools ratio. Changing workspace or
closing tools leaves maximize mode. Expansion does not modify persisted ratios.
The sidebar and app chrome stay visible, following T3's inline expansion model.
Child controls may consume Escape before the workspace restore handler.

Projects is now the first primary sidebar navigation item, per explicit user
instruction. T3's SidebarChrome utility navigation and Orca's project-start
chooser were considered in the concurrent project-control review; neither
establishes Orchestra's section order. This ordering is a deliberate adaptation.
Kanban, task state, CLI commands and provider contracts are unchanged.

## Behavioral verification

- ResizableWorkspace and WorkspaceLayout renderer tests: 7 passed. Cover saved
  split restoration, exact tools DOM identity and mount/disposal count across
  maximize/restore, preserved session state, Escape, workspace switches and close.
- TypeScript checking and scoped ESLint passed.
- Collaborative preview opened the running frontend. Snapshot automation failed
  twice. DOM evaluation found the maximize control, but the standalone preview
  was showing a welcome/hidden workspace, so its zero-size measurements do not
  establish visible expansion. Native Electron/browser/PTY E2E verification
  remains pending; renderer mount tests do not establish provider reliability.

Integration run after sidebar reordering: App smoke, ResizableWorkspace and WorkspaceLayout passed (35 passed, 2 skipped). Home navigation now targets Projects. Removed the chat header bottom border per the user's additional request; this is a visual-only Orchestra adaptation, with no new behavior test added.
