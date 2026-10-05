# ADE inline workspace header handoff

## Reference review

- T3 Code, pinned revision `737993303d36e10674c54b95e5bd3826682c99c7`: inspected the local `t3-layout.tsx` reference excerpt. Its `PanelLayoutControls` groups compact actions in a shrink-resistant, no-drag flex row and keeps unavailable controls disabled with explanatory tooltips. The excerpt does not show the full workspace conversation header or task navigation behavior.
- Orca, pinned revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected the local `orchestra-orca-sidebar-reference/SectionHeader.tsx` excerpt. Its section header gives the title a `min-w-0 flex-1` slot and keeps row actions grouped at the trailing edge; nested labels truncate while actions keep their size. The excerpt is a sidebar header and does not show conversation navigation or a task page.
- The pinned ADE source registry is [`reference-patterns.md`](../superpowers/plans/ade-2026-10-03/reference-patterns.md). No reference application was launched for this focused UI change, and the inspected excerpts do not establish Orchestra behavior.

## Orchestra adaptation

The conversation title now shares its header row with the Workspace, Files & editor, Git & pull requests, and Tasks navigation. The navigation stays in one compact row at normal widths; the header itself wraps only when the available space requires it. Task details render inside the active `WorkspaceChat` body while that chat body stays mounted and hidden, so its draft textarea and session state survive a return to chat. The existing chat owner map and backend/project/workspace keys remain responsible for scoping state. New conversation returns to Workspace before focusing the composer. The task view closes the tools pane and is labeled Tasks. The Files & terminals and New terminal actions return to Workspace and open the tools pane when invoked from Tasks.

This UI-only change keeps Orchestra's existing task and Kanban model and introduces no provider, API, or orchestration changes. No reference code or assets were copied. Both references provide useful compact header layout patterns; neither has a matching task-page composition to adopt.

## Behavioral verification

- `npm run test -- --run src/features/workspace/WorkspaceLayout.test.tsx src/features/workspace/chat/WorkspaceChat.test.tsx` — 2 files and 46 tests passed.
- `npm run typecheck` — passed.
- Layout coverage checks the Tasks label and panel, visible conversation title and actions, task-to-chat navigation, tool actions from Tasks, unchanged draft node after returning, and root/child workspace chat scoping. The chat suite also passed its existing draft, session, and request behavior checks.

The layout test uses a `WorkspaceChat` mock for composition and mounted-draft assertions; it does not certify provider/network behavior or full desktop E2E rendering. A desktop smoke run remains separate verification.
