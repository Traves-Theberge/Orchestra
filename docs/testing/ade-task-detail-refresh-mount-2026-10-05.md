# Task detail refresh mount verification — 2026-10-05

## Package and source review

This UI fix covers Orchestra's task inspector (`Details`, `Plan`, `Session`, and `Changes`). The task identity remains the issue id/identifier already owned by the inspector lookup; a refresh for that same task must update data without replacing the mounted panel.

T3 Code was reviewed at the pinned revision [`737993303d36e10674c54b95e5bd3826682c99c7`](https://github.com/pingdotgg/t3code/tree/737993303d36e10674c54b95e5bd3826682c99c7). In `apps/web/src/components/ChatView.tsx`, the right-panel host receives `open`, `surfaces`, and `activeSurfaceId` separately, and is rendered based on panel presence and active thread identity. The same panel host appears in both inline and sheet layouts. This keeps panel identity and visibility explicit while chat data changes. The behavior was inspected in source; the T3 application was not run.

Orca was reviewed at the pinned revision [`3284b4c70c901402831bb4ccc5576ea083d2e5ae`](https://github.com/stablyai/orca/tree/3284b4c70c901402831bb4ccc5576ea083d2e5ae), including `src/main/native-chat/agent-session-journal/journal-dispatch-observation.test.ts`. Its observations are scoped to a dispatch fence, and the test verifies that a submission from another fence cannot become the current observation. This is not a UI panel lifecycle implementation; no equivalent task-detail panel mount pattern was found in the reviewed Orca native-chat reference. Orca's app runtime was not run.

## Orchestra behavior and adaptation

`useAppSync` periodically calls `executeIssueLookup` for the open task. That marks the lookup pending while retaining the last task result. `AppDialogs` previously prioritized pending state and replaced `IssueDetailView` with a skeleton, unmounting the selected panel. A successful refresh remounted it at `Details`, which also discarded the panel's scroll position. A failed refresh cleared the result and replaced the detail view with an error.

`AppDialogs` now renders an existing result only when one of its task identities matches the requested lookup id. Same-task refreshes keep the mounted `IssueDetailView` while pending, accept fresh result objects and callback/config identities in place, and show refresh errors alongside the retained task. `useIssueLookup` preserves the last matching result after a failed refresh. A different task identity still shows the pending state until its own result arrives, so an old task panel cannot appear under a new lookup. Tab selection remains local to the task inspector; this change does not persist tabs globally or change Kanban behavior.

The T3 panel-host separation was adapted as stable component presence tied to the selected task identity. The Orca fence-scoping principle was adapted as a guard against displaying stale panel state for a different lookup. Orchestra deliberately keeps its current inspector and per-instance tab state rather than adopting T3's multi-surface store or Orca's session journal architecture.

## Behavioral verification

The regression tests in `apps/desktop/src/layout/AppDialogs.test.tsx` and `apps/desktop/src/hooks/use-issue-lookup.test.tsx` check that:

- A same-task lookup entering the pending state preserves the selected Plan tab and the same panel DOM node.
- A fresh task object with new config and callback objects updates the plan in the existing panel and retains selection/scroll container identity.
- The selected Session tab and its scroll container survive same-task polling while the session timeline refreshes.
- A Backlog task's description editor stays in Markdown Preview mode and retains the local preview through same-task polling.
- A failed refresh keeps the last matching task visible and reports the error.
- The lookup hook itself retains the matching last result after a same-task request fails.
- A pending lookup for a different task does not carry over the previous task panel.

Verification command: `cd apps/desktop && npm test -- --run src/layout/AppDialogs.test.tsx src/hooks/use-issue-lookup.test.tsx`.

This is component-level behavior evidence. It does not claim desktop end-to-end reliability or validate live backend polling in the packaged application.

Final isolated validation against committed application code plus this package's owned changes: 14 tests passed across `AppDialogs`, `useIssueLookup` and `IssueDetailView`; TypeScript checking and the production build passed. The existing audit app was relaunched with the fixed dialog/lookup source. No automated native UI walkthrough was performed, so the live planning verification in the Windows sandbox handoff is separate from these component regressions.
