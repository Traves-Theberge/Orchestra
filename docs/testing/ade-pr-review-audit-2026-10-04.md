# PR review audit and immediate push safety fix

This slice inspected task PR creation, Git worktree/remote selection, review/merge transport and renderer state. The parent authorized only the smallest immediate production fix: remove automatic force retry, stop PR creation after a failed push, and require an existing task. Stale-head merging and the remaining identity/UI defects below are audit findings, not implemented capabilities.

## Pinned reference receipt

Read the [mandatory registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md), relevant complete pinned sources and associated tests before implementation:

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: [ThreadPullRequestService](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ThreadPullRequestService.ts) compares canonical repository identity, groups discovery by project/worktree/branch, rechecks PR and repository identity after network I/O, and rereads the project at dispatch before applying a guarded snapshot. Its [tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ThreadPullRequestService.test.ts) reject changed/deleted project roots. [RunFinalizationService](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/RunFinalizationService.ts) and [tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/RunFinalizationService.test.ts) order checkpoint capture before refresh and guard PR refresh by current branch and run. Adaptation: remote publication depends on successful preceding local Git effects and task existence. Deliberate difference: this narrow fix retains Orchestra's Go API/SQLite/task model; canonical identity and snapshot guards remain follow-up work rather than copying the reference service wholesale.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [review documentation](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/docs/site/content/docs/review/github.mdx) describes reviews attached to pushed worktrees and explicit creation context; that is documentation evidence. [review-head-remote.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/github/review-head-remote.ts) and [tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/github/review-head-remote.test.ts) distinguish upstream/fork identity, honor explicit origin and reject missing origin. [merge-actions.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/pull-request-page/actions/merge-actions.ts) checks mutation availability, confirms merge, displays errors, applies merged state and notifies readers. The inspected merge action does not send an expected head SHA; no claim of that safety pattern is inferred from this reference. Adaptation: failed push cannot silently proceed to review publication. Deliberate difference: Orchestra does not introduce provider/remote preference changes or an explicit force workflow in this slice; it simply stops on rejection.

Neither reference runtime was launched. No source code/assets were copied. No hosted GitHub mutations were attempted; reference/source tests cannot establish Orchestra hosted E2E reliability.

## Implemented smallest critical fix

`apps/backend/internal/api/state.go`, `CreateGitHubPR` only:

- Task lookup failure/nil task now returns 404 `issue_not_found` before project, token or remote side effects. This is consistent with existing issue handlers, though tracker unavailable/error is also represented as 404 because this lookup exposes no typed not-found distinction.
- Failed initial `git push -u origin <head>` now returns 409 `pr_push_failed` with an actionable instruction to resolve the remote/local Git/authentication rejection and retry. No automatic force retry occurs; remote PR creation and task PR-link mutation are skipped.
- Existing successful-push, explicit owner/repo/token and existing-PR lookup behavior is retained. No whole-file formatting was applied, preserving the parent's concurrent metadata API edits.

New `internal/api/pr_push_safety_test.go` uses a temporary actual local repository, bare remote and SQLite project metadata. It disables global/system Git config lookup for its test subprocesses and configures commit identity through invocation options. It never changes Git global settings. A temporary test HTTP client rejects hosted requests and counts attempts; these sequential tests restore it afterward.

## Verification

Windows `go test ./internal/api -run TestCreateGitHubPR -count=1`: **passed, 10.353 seconds**, including existing invalid-JSON coverage and three new regressions:

1. Independent remote commit plus divergent local commit and refreshed tracking ref: ordinary push rejects, remote branch SHA stays unchanged, hosted request count is zero, task PR URL remains empty. Refreshing the tracking ref ensures the old automatic force-with-lease would be eligible to overwrite the remote, making the assertion meaningful.
2. Missing local branch: push failure is returned and remote SHA/hosted request count remain unchanged.
3. Missing task with complete explicit PR credentials: 404 precedes hosted side effects.

Scoped diff check passed. Final full backend native/Docker unit/race verification is owned by the parent/config worker; those results are recorded separately. No real hosted success/approval/merge flow was verified.

## Remaining exact findings and next executable slices

### 1. Publication identity and finalization

- `api/state.go:87` still trusts request owner/repo/head overrides. Worktree selection at `:168` derives its path from caller `body.Head`, falls back to project root, and does not compare task `BranchName` or canonical remote repository identity. A missing project/root can skip the push entirely and continue with a hosted create; only the attempted failed-push path was changed here.
- `app/run.go:978` advances the task to Review before publishing updated PR commits; `:987` still automatically uses force-with-lease for an existing PR feedback cycle and logs push failure. This separate lifecycle code is outside the authorized fix.

Next slice: resolve task-owned branch/worktree, verify repository and push destination, require successful ordinary publication before claiming published review content. Make an explicit history-rewrite operation separate if needed. Acceptance: missing/deleted task/project/worktree; another task's branch; fork origin versus upstream; changed remote identity during lookup; divergent remote; failed post-run publication must remain visible and must not imply fresh reviewed commits. Use disposable bare Git remotes and fake hosted HTTP, then a separately authorized hosted scenario.

### 2. Reviewed-head merge and review anchoring

- Backend `utils/github/github.go:64` drops head SHA while decoding PRs; renderer `core/api/client.ts:1044` likewise carries only head ref/label.
- `PRReviewView.tsx:85`, client `:2004`, API `projects.go:1886` and utility `github.go:402` send only the merge method. No expected reviewed head is supplied at any boundary.
- ReviewRequest at `github.go:325` carries body/event only; renderer review submit at `PRReviewView.tsx:71` does not anchor its review to the displayed commit.

Next slice: carry PR head SHA in the read model; load a coherent fresh PR detail/diff/check snapshot; submit expected SHA to the merge operation and commit ID to review creation. [GitHub's merge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request) provides a head SHA precondition; implement Orchestra's guard independently rather than assuming either inspected reference already supplies it. Acceptance: viewed A then pushed B rejects merge of B, unchanged A merges, missing expected SHA is rejected, correct repository/PR identity enforced, pending/failed checks remain visibly distinguishable, review submission is attached to A or rejected when stale.

### 3. Visible errors and asynchronous PR identity

- `PRReviewView.tsx:52-65` loads diff/reviews without cancellation or an identity fence; switching PR/project while an earlier request is pending can display old data in the current review.
- `:61/:75/:88` report load/review/merge failures only through console. Failed diff load is indistinguishable from an empty diff; failed review collection can present 'No reviews yet'.
- Merge success calls `loadData` but that reload fetches only diff/reviews; the status badge still derives from the original `pr` prop at `:94`. `GitTab.tsx:243-248` holds and passes the selected PR object without a mutation refresh callback.
- Action buttons at `:179/:187/:196` depend only on mutation loading, even for closed, merged or draft PRs. Current PRReviewView tests check static rendering rather than stale async responses, mutation failures or merged status refresh.

Next slice: visible load/mutation error states, pending/freshness gating, keyed/fenced PR state, refresh authoritative details after mutation. Acceptance: delayed PR A response cannot replace PR B; load failure displays retry and disables actions; review failure preserves draft body; merge failure remains actionable; successful merge updates status/actions; closed/merged/draft PRs cannot offer invalid actions. Retain the Kanban model and shared API control path.
