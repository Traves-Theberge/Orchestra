# Worktree removal controls handoff

## Pinned references

- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: `src/cli/handlers/worktree.ts` resolves a worktree and requires its owning `hostId` before invoking `worktree.rm`. A failed archive hook is a separate concern from `--force`, and the handler reports preserved-branch and background-removal outcomes. This is a CLI mutation path, not a UI close-view pattern.
- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: `apps/server/src/orchestration-v2/ThreadDeletion.ts` durably emits `thread.deleted`, tombstones the thread projection and cancels active runs. A search of the pinned orchestration-v2 server and web surfaces found no matching physical-worktree removal control. This logical thread deletion behavior is not applicable to closing or deleting an Orchestra checkout.

## Orchestra adaptation and boundaries

Every workspace row exposes a compact actions menu. “Close workspace view” is an optional UI-only callback; it must navigate away without deleting files, branches, agent sessions, conversations or editor buffers. Orchestra's primary/registered checkout is always protected from disk deletion in this menu. Eligible child removal continues through the existing durable request/receipt flow and Git/backend guards; menu changes do not issue a mutation. The parent-owned `ProjectWorkspaceTree` integration must supply `onCloseWorkspace` to the control. Until wired, that action is disabled rather than pretending to close anything.

## Behavioral verification

`WorktreeRemovalControls.test.tsx` verifies that a primary checkout exposes the close-view action, presents a disabled removal reason, and never opens a removal dialog or calls the removal API. It also verifies that closing an eligible child view is independent of the enabled, receipt-backed removal action. The component tests passed (2/2).

The parent-integrated menu passed the isolated native Electron walk on 2026-10-05 (`apps/desktop/reports/submenu-native-smoke-20261005d.log`; receipt `apps/desktop/reports/multi-worktree-smoke-result.json`). The primary menu was opened by native pointer input, exposes Close workspace view while primary removal remains disabled, and closing/reopening preserves the registered project/worktree, editor groups and exact root/child file buffers. The audit sends no worktree removal request for close-view. The same run activated New terminal and observed the fixture backend's Windows PTY unsupported response (“a ConPTY adapter is required”); terminal runtime remains explicitly unverified and no shell is claimed. No live provider turn was sent.
