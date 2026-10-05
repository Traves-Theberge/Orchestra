# PR review concurrent task isolation verification (2026-10-05)

## Reference patterns

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`, `ThreadPullRequestService.ts`: PR discovery groups threads by project/worktree/branch, matches canonical repository identity, rechecks the discovered PR and repository identity, and rereads the project/workspace before dispatching a synchronization command. This supports fencing mutable PR and project context. It does not define concurrent agent-review receipts or a human approval gate. The pinned source was inspected at the registered revision; no local T3 source snapshot is present.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, `review-head-remote.ts` and `docs/site/content/docs/review/github.mdx`: the resolver honors an explicit `origin` preference and errors if that remote is absent; otherwise it checks repository identity for ambiguous multi-remote clones before falling back. The docs describe hosted review/check state and actions attached to worktrees. Neither source defines Orchestra's agent-review result or human approval receipt. The pinned source and documentation were inspected at the registered revision; no local Orca source snapshot is present.
- Registry and existing review-gate handoff: [`reference-patterns.md`](../superpowers/plans/ade-2026-10-03/reference-patterns.md) pins both revisions; [`ade-pr-agent-review-gate-2026-10-05.md`](ade-pr-agent-review-gate-2026-10-05.md) records their review and Orchestra's task/PR/head/context fencing. Reference code and documentation informed the identity-fencing approach; they do not establish runtime or concurrent isolation behavior in Orchestra.

## Orchestra adaptation and verification

Added `TestConcurrentReviewAttemptsAreIsolatedByTask` in `apps/backend/internal/reviewpipeline/runner_test.go`. Two Review tasks in one project are admitted with separate request UUIDs and provider runs. The fake provider blocks both runs until both are active, then returns a clean decision for one and findings for the other. The test replays each UUID while its run is blocked and checks that each request started exactly one provider turn. After release, it verifies each task retains its own attempt receipt, state, feedback, and plan: the clean task stays in Review without feedback, and the findings task returns to Todo with its own feedback while retaining its plan.

This adds local behavioral evidence for independent concurrent reviews and idempotent request replay. It uses SQLite and a fake provider; it does not verify live provider authentication, a hosted PR, or production database contention.

Verification from `apps/backend`:

```text
go test ./internal/reviewgate ./internal/reviewpipeline -count=1
ok   github.com/orchestra/orchestra/apps/backend/internal/reviewgate       1.156s
ok   github.com/orchestra/orchestra/apps/backend/internal/reviewpipeline   0.608s
```

`gofmt -w internal/reviewpipeline/runner_test.go` completed, and `git diff --check -- apps/backend/internal/reviewpipeline/runner_test.go` reported no whitespace errors.
