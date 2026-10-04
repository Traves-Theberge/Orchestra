# PR review and persistent task linkage

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 04. Outcome: a task retains its correct PR association, revisions preserve review context, and hosted review/check/merge state is reconciled to the exact code being evaluated.

October 4 partial progress: [push failure guard](../../../testing/ade-pr-review-audit-2026-10-04.md), [strict reviewed-head merge](../../../testing/ade-pr-reviewed-head-merge-handoff-2026-10-04.md) and [commit-bound snapshot/UI](../../../testing/ade-pr-snapshot-ui-handoff-2026-10-04.md). A rejected push stops PR creation; merge requires a SHA and explicit host confirmation; visible review failures disable mutation until refresh. Canonical repository fencing, approval/check reconciliation, commit-anchored hosted review batches, durable PR linkage and task completion remain open. No hosted lifecycle certification is claimed.

## Files and boundaries

Existing: backend PR creation in `internal/api/state.go`, review/merge/comment routes in `internal/api/projects.go`, `internal/utils/github/`, DB/WorkItem PR metadata; desktop `features/git/PRReviewView.tsx`, `DiffViewer.tsx`, `GitHubPRsTab.tsx`, issue-detail PR dialog and rejection actions, typed API client.

Proposed: PR-link/review-thread/revision-batch DAOs, task delivery projection/reconciler, line/range comment model and a shared review feedback surface. Keep provider-neutral agent revision feedback distinct from a hosted GitHub review submission.

## 05.1 Persist canonical PR identity

- [ ] Add a PR link record with host, repository identity, number, URL, task/workspace IDs, base/head refs and observed head SHA. Support more than one explicit link where a task spans repositories; UI must identify which one an action targets.
- [ ] Migrate existing `pr_url` into a legacy link only when safely parseable. Preserve the URL for compatibility; unknown identity remains unresolved.
- [ ] Add link/unlink/discover endpoints with ownership checks. A project PR listing must not silently attach unrelated PRs to a task.
- [ ] Test task reload, backend restart, repository mismatch and legacy links. Add schema/fixture coverage.

## 05.2 Make create or discover recoverable

- [ ] Record a creation command receipt before external work. Validate branch/worktree/base and require successful publication of the intended head before remote creation.
- [ ] On uncertain creation outcome, search using the owned repository/head and reconcile before retry. Store explicit remote-created/local-link-pending state if persisting the association fails.
- [ ] Replace warning-only link persistence failure with a recoverable visible operation outcome. Do not return a wholly successful task association when the local link is absent.
- [ ] Record push failures and use force-with-lease only under an explicit policy and expected remote head; do not silently escalate any push failure.
- [ ] Inject API timeout after remote creation, local DB failure, duplicate submit and push rejection. Assert one PR and recoverable linkage.

## 05.3 Persist anchored feedback and revision batches

- [ ] Define review threads against repository, base/head SHA, path, side and line/range. Record author, status and resolution history; handle deleted/renamed files.
- [ ] Add inline comments and a batch-to-agent action to the diff viewer. Preserve unsent drafts on accidental navigation/restart under the documented local persistence policy.
- [ ] Snapshot a revision batch with its reviewed head and target task/run. Submit it once through the idempotent revision command and verify actual provider receipt.
- [ ] Keep outdated comment anchors visible as outdated when mapping across revisions fails; never move them to arbitrary new lines.
- [ ] Provide separate actions for local revision and hosted COMMENT/REQUEST_CHANGES/APPROVE. Show partial success if one succeeds and the other fails.

## 05.4 Reconcile current review and check state

- [ ] Refresh PR metadata, head SHA, review threads, check runs/statuses and mergeability after actions, new commits and reconnect. Poll/webhook/reactor choice must work when the UI is closed.
- [ ] Associate approval/check/verification evidence with its evaluated head. New code invalidates the applicable local approval; display hosted stale/dismissed approvals accurately.
- [ ] Replace console-only errors with retained review errors and retry controls. A failed fetch must not look like an empty diff or zero reviews.
- [ ] Expose unresolved comments, failed/pending checks and current merge eligibility in task delivery state.
- [ ] Test external reviews, CI updates, permission loss, rate limits and merge conflicts. Preserve last-known data as stale when refresh fails.

## 05.5 Guard merge and task completion

- [ ] Include expected head SHA in merge decisions and revalidate applicable checks/policy. A stale head prompts fresh review; do not merge code the user did not inspect.
- [ ] Persist the merge command and reconcile uncertain outcomes before retry. Refresh the PR metadata prop/state so the view no longer shows an old open status after confirmed merge.
- [ ] Feed confirmed merged/closed-unmerged state to the task completion policy from package 04. External merges must reconcile too.
- [ ] Retain task artifacts/review/config history and run guarded cleanup only after confirmed completion policy. Failed merge never advances Done.

## Validation and exit

Run controlled GitHub fixture tests, UI/API review tests and package 01 PR scenarios. Then exercise a disposable hosted repo with real PR creation, request changes, revision, CI and merge under configured authorization.

- [ ] PR identity survives task/workspace reload and restart.
- [ ] Review notes reach one intended revision run and remain traceable afterward.
- [ ] New head makes old evidence visibly stale; errors remain actionable.
- [ ] Confirmed hosted outcomes synchronize to the board and guarded cleanup.
- [ ] Simulated and real hosted evidence are separately labeled; no production PR is used as a default fixture.

Handoff: API identity contract, comment/revision model, recoverable partial-failure behavior and hosted canary evidence.
