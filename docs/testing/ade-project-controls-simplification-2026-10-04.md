# ADE Project Controls Simplification (2026-10-04)

## Reference review

- **T3 Code**: pinned revision `737993303d36e10674c54b95e5bd3826682c99c7` (2026-10-03). Inspected cached `Sidebar.tsx` and `SidebarChrome.tsx`. T3 has a project-scope combobox above its sidebar list, with an “All projects” option and persisted scope state. This is a deliberate, first-class list-filtering journey in T3.
- **Orca**: pinned revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae` (2026-10-03). Inspected cached `SectionHeader.tsx`. Its worktree sidebar presents project/repository group headers and row actions; this source has no equivalent top-level project selector control. It does not establish that Orca lacks project selection elsewhere.
- No reference code was copied. Orchestra retains its existing project search, Add project, and New task actions. The redundant selector and its popup were removed from `ProjectControls`; the `onSelect` prop remains in the public props type for caller compatibility. This local simplification intentionally differs from T3's dedicated global project-scope workflow and does not alter Kanban or project state ownership.

## Verification

- `cd apps/desktop && npm run typecheck` passed after the edit.
- No `ProjectControls`-specific test exists. Source inspection confirms the `Select project` button and popup are gone while the Search, Add project, and New task controls remain. No separate end-to-end behavior claim is made.
