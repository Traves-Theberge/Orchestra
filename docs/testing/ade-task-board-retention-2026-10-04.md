# Manual task transitions retain Git work

## Problem and scope

PATCH issue state previously ran `git add -A` and commit when entering Review or
Done. A missing worktree fell back to the shared project root. Done subsequently
force-removed the task worktree and attempted branch deletion, including after a
commit failure. Repeated Done requests repeated those effects.

Manual board transitions now only persist the requested task metadata. They do
not stage, commit, push, delete branches or remove worktrees. Existing field locks
and transition validation still apply. Agent finalization, task stop/delete and
explicit PR operations are unchanged and require separate audit; this is a narrow
04.3/04.5 improvement, not completion of the lifecycle package.

## Required reference receipt

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`,
  `apps/server/src/orchestration-v2/RunFinalizationService.ts`: finalization captures
  checkpoint context and refreshes the scoped workspace; PR refresh checks the
  current branch against the thread. Adopt the separation of finalization effects
  from displayed task status. Orchestra does not yet have T3's complete scoped
  checkpoint/finalization service and does not claim it here.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`,
  `src/renderer/src/components/sidebar/worktree-list/drag/use-status-mutations.ts`:
  status/lane moves update workspace metadata and order. Inspected
  `src/cli/handlers/orchestration-worker-settlement.ts`: completion observation
  checks dispatch/task identities and worker-report provenance rather than treating
  a metadata status as proof. Adopt metadata-only board transitions and preserve
  separate execution/delivery observations.
- Deliberate deviation: Orchestra retains issue-backed Kanban states rather than
  Orca's worktree status model. No source was copied. Reference runtime behavior
  and reference suites were not executed; these are source observations.

## Independent behavioral verification

`TestBoardReviewAndDoneRetainGitWork` uses a real loopback HTTP server, temporary
Git repository, bare remote and an optional owned linked worktree. Both missing
and owned worktree cases transition In Progress to Review, Review to Done and
repeat Done. Assertions re-read task state and check unchanged project HEAD,
index/work status and remote ref. The owned case also checks the task HEAD,
unpublished and ignored file contents, branch and surviving checkout after each request.

The focused native Windows test passed. A Go source overlay of the original
handler failed both fixture cases as expected: Review changed project work in
the missing-worktree case and changed task commits in the owned-worktree case.
The overlay did not modify the working source. Full Linux backend
`go test -race ./...` passed in the existing Docker validation environment,
including the API package (104.967s). Full desktop renderer tests passed:
85 files, 571 tests, two existing skips. Typecheck and production build passed. Hosted CI is recorded
separately after completion. No production repo, tracker,
provider authentication or user checkout is used by these fixtures. Full hosted
issue-to-agent-to-reviewed-PR execution remains an open acceptance gate.
