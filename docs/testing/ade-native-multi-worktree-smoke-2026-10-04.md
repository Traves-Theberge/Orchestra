# Native multi-worktree UI verification

## Reference receipt

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: inspected `apps/web/src/components/Sidebar.tsx`, including explicit `thread.worktreePath ?? project.workspaceRoot` Git ownership, active worktree context, and navigation retaining thread identity. Adopt the ownership pattern; verify Orchestra's selected checkout and native conversation independently.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected `src/renderer/src/components/sidebar/WorktreeCardAgents.tsx` (cached pinned source), including `activateAndRevealWorktree` and structured-session activation. Adopt explicit worktree/card/session activation. Orchestra retains registered projects and issue-backed Kanban tasks; workspace-only creation does not create an issue or start inference.
- Neither reference's source or tests establish Orchestra's native execution reliability. This package adds Orchestra-specific production Electron observations; no reference source code was copied.

## Changes

`apps/desktop/scripts/electron-smoke.cjs --workspace-controls` now runs `multi-worktree-audit.cjs` after actual project creation. The smoke uses a disposable Electron profile, home/config paths, Git configuration, backend database and allowed project/worktree roots. The backend is built into a separate temporary target; no signed-in provider configuration or existing workspace is changed.

The audit visits all four worktree source modes (Smart, GitHub, Branch and Name) and checks the dialog remains usable, then selects a visible base-branch option from the custom dropdown. It records the base popup and dialog bounds, scrolls the dialog fields to the bottom, and verifies the complete Create worktree button remains inside the dialog and viewport. It captures both the dialog before submission and the footer after scrolling. Submission uses the real Create worktree dialog with None agent; the audit observes one POST with its original request UUID, then reads the durable completed job. It checks actual Git membership, exact sidebar selection, distinct file trees and same-name Monaco buffers, restored per-workspace editor groups, and unchanged root files. Idle native session fixtures prove list/read/UI ownership without sending a provider turn. The + menu must be portalled and within the viewport. Creating Markdown must write the child-owned file; opening a browser must attach an Electron webview guest. Returning to the root must restore its editor without child document/browser tools.

The child idle Codex conversation is also renamed through its native title control. The audit confirms the changed title through the scoped GET API, rejects a PATCH scoped to the root workspace, and checks the child conversation remains idle with no messages or provider thread. A newly created child session with an omitted title must inherit the selected branch label.

## Behavioral evidence

On 2026-10-04, the source-built backend and latest production renderer passed the final native run:

```powershell
$env:ORCHESTRA_BACKEND_BIN = Join-Path $env:TEMP 'orchestra-smoke-backend-20261004/orchestrad.exe'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
node scripts/launch-electron.mjs scripts/electron-smoke.cjs --workspace-controls --pr-visual-fixture
```

- Exit 0, disposable fixture `orchestra-electron-smoke-o1aeww`; the smoke used an isolated profile, home/config, backend database, Git config, and allowed workspace roots.
- Real dialog workspace-only creation submitted once; durable job completed and child membership matched the current Git registry.
- The four source-mode controls rendered without an error boundary. In the 1346×864 renderer viewport, base-branch dropdown bounds were `{left:714, top:335.4, right:914, bottom:401.725}` and remained within the viewport.
- Dialog bounds were `{left:421.2, top:56, right:925.2, bottom:808}`; measured width and `scrollWidth` were both 502. After scrolling its fields to the bottom, the full Create worktree button bounds were `{left:750.963, top:754.7, right:903.4, bottom:786.2}` and fully visible inside the dialog and viewport. The footer screenshot shows the full button.
- Root/child file trees, same-name buffers, editor groups and root disk retention passed.
- Idle scoped Codex session records and selected child session row passed; a child conversation title rename persisted through the scoped API, wrong-workspace PATCH was rejected, default child title inherited the branch label; provider turns: **0**.
  - Header top offset: **0 pixels**; navigation sits beside the conversation title.
- Four + menu actions present, portalled and unclipped; child Markdown disk write and actual native browser guest attachment passed; root editor/tool isolation passed.
- Tasks header capture passed with Board, Work Items and Create Task controls visible; unified header top/bottom were 14/42 pixels.
- Existing project creation, file sidebar, maximize/restore, retained chat and Git alongside chat checks passed.
- Existing read-only PR visual fixture passed; this does not verify hosted GitHub operations.
- `node --check` passed for both scripts; owned script and handoff diffs passed `git diff --check`.

Local evidence: `apps/desktop/reports/multi-worktree-smoke-result.json`, `multi-worktree-smoke.log`, `electron-smoke-worktree-dialog.png`, `electron-smoke-worktree-dialog-footer.png`, `electron-smoke-tasks-header.png`, `electron-smoke-multi-worktree.png`, `electron-smoke-workspace-tools-menu.png`, `electron-smoke-child-browser.png` and PR visual screenshots. Screenshot inspection confirms the fully visible dialog footer, inline navigation, Tasks header and unclipped + menu.

## Limits and earlier observations

This proves the exercised local production Electron flow, not all provider inference, remote browser navigation, hosted tracker/PR reliability or persistence across a real application update. Native session fixtures are idle and the PR fixture intercepts only read operations. Subsequent renderer/backend changes require rerunning the affected checks.

An earlier native attempt created the worktree but found a New agent dialog still visible; it failed and captured `orchestra-electron-smoke-gPORdN/failure.png`. Two subsequent attempts did not reproduce that modal observation. The script retains bounded submission/dialog diagnostics rather than dismissing an unexpected modal. A following attempt passed ownership checks but failed an obsolete tab-padding alignment assertion; the final assertion compares actual header bounds and also requires inline navigation beside the title.

Several intermediate runs also exposed stale renderer builds and dialog overflow while the worktree dropdown/dialog layout was being changed. They failed their explicit selector or bounds assertions; the final run above used the rebuilt renderer and passed strict viewport and footer checks. These failures were retained as diagnostics and were not counted as passing evidence.

## 2026-10-05 expanded walkthrough follow-up

After toolbar, archive and primary close-view integration, the expanded disposable Electron run passed against the latest production renderer: `apps/desktop/reports/submenu-native-smoke-20261005d.log` (`ELECTRON_SMOKE_PASSED`). Structured evidence is `apps/desktop/reports/multi-worktree-smoke-result.json`. It again verified real dialog submission exactly once, visible dropdown/dialog/footer bounds, four source modes, scoped workspace selection, same-name root/child Monaco buffers, retained editor groups across close/reopen, native-pointer primary menu, conversation archive/history/restore, task header and toolbar submenus. No provider turn was sent.

The audit now resolves only the visible active workspace header's `role=tablist`, waits for the exact selected workspace row and `Files & terminals`/unselected `Tasks` state, and scopes Monaco assertions to the active split group. The earlier zero-sized hidden editor was caused by the audit's generic control fallback running before context navigation settled; the corrected audit reproduced no product buffer loss. `TabGroupPanel` supplies `data-group-id`, `data-active-tab-id` and `data-active-tab` for that observation.

The real New terminal menu item was activated. The fixture backend returned the explicit Windows limitation: interactive PTY terminals are unavailable until a ConPTY adapter is implemented. The audit records that outcome and makes no claim that a shell session started. The editor buffer check also remains read-only: fixture sentinel contents matched their original disk bytes.
