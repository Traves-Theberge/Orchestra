# ADE sidebar footer icons handoff — 2026-10-04

## Change and observed behavior

`apps/desktop/src/layout/AppSidebar.tsx` now renders Documentation, API Docs, Settings, and Usage as one compact icon footer. Documentation, Settings, and Usage retain their section IDs and route through `handleItemClick` / `onSectionChange`; API Docs retains its `/api/docs` external-open behavior. Each footer action has an `AppTooltip`, `title`, and matching `aria-label`. Footer section actions retain `sidebar-nav-{id}` test IDs. Usage (`WAREHOUSE`) is filtered out of the main navigation. The shared footer remains present in primary navigation, project/settings/docs/agent drilldowns, and collapsed mode, and collapsed main navigation filters footer actions to avoid duplicates.

The primary navigation keeps the footer controls inside its navigation container. This preserves the existing keyboard traversal across the section buttons, with Settings last, while drilldown states render the same footer beneath their content. The existing navigation smoke check now locates the explicit `sidebar-back` control because the persistent, correctly labeled Settings icon shares its accessible name with the drilldown header.

## Reference comparison

- **T3 Code** — pinned source revision `737993303d36e10674c54b95e5bd3826682c99c7`, inspected from `C:/Users/trave/AppData/Local/Temp/orchestra-project-reference-20261004/t3-SidebarChrome.tsx` (snapshot selected 2026-10-03; sidebar utility implementation around lines 142–244). `SidebarUtilityItem` renders icon-only buttons with an explicit `aria-label` and a hover/focus tooltip. `SidebarUtilityMenu` places Settings and Usage in a horizontal utility menu and routes both through their own handlers; the footer also switches to a Back action on utility pages. This directly supports the icon-plus-tooltip and bottom utility row pattern. Orchestra adapts the row to the existing section callback and app's custom tooltip, retains Documentation and API Docs, and keeps the same footer available inside drilldowns rather than replacing it with Back.
- **Orca** — pinned source revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, inspected from `C:/Users/trave/AppData/Local/Temp/orchestra-orca-sidebar-reference/SectionHeader.tsx` (snapshot selected 2026-10-03; `renderWorktreeSectionHeaderRow`). This is a virtualized worktree/project group header, not a utility footer. It uses a compact shared header row, sticky positioning, keyboard activation, and a contextual collapse affordance. No relevant footer icon/navigation pattern appears in this assigned source, so it does not inform this footer change. Orchestra's section/utility navigation remains separate from Orca's project/workspace grouping controls.

These are pattern observations from pinned source snapshots, not runtime reliability claims. The references' broader architectures were not needed for this presentation-only sidebar change.

## Verification and limits

- `npm run typecheck` — passed.
- `npm run test:smoke-renderer -- --testNamePattern="sidebar navigation|arrow key navigation in sidebar|Home/End navigation in sidebar"` — passed (3 tests). This checks navigation, drilldown/back flow, and keyboard compatibility. Vite printed its existing `configLoader: 'native'` `__dirname` warning; React also emitted existing `act(...)` warnings in the navigation smoke case.
- The smoke run did not exercise a live external API Docs open or manually inspect every collapsed/drilldown rendering state. The API Docs handler was retained unchanged in behavior and typechecked.

Final sidebar refinement: Orchestrator precedes Projects. Usage uses the chart icon and Settings the gear. The Orchestra brand is one accessible button that returns any expanded sidebar drilldown to primary navigation without changing the active workspace. The same borderless brand header appears in Projects; Projects retains its own search instead of duplicating the global search. T3 SidebarChromeHeader and SidebarBrand separate persistent chrome from page content; Orca SectionHeader provides project-group controls but no corresponding app-brand route in that inspected source. Orchestra deliberately keeps its local sidebar navigation state rather than adopting either router. The existing sidebar navigation smoke now exercises brand-button return from Projects and Settings.

User-directed footer refinement: remove the horizontal divider, reduce bottom padding to 0.5, and right-align expanded footer icons; collapsed mode retains centered vertical controls. Navigation handlers and accessible names remain unchanged.
User correction: expanded footer icons are left-aligned; the tighter padding and divider removal remain.
