# Local dispatch and approval gate handoff

## Pinned reference review

T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7` was reviewed at [`ProviderAdapter.ts`](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) and [`RunFinalizationService.ts`](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/RunFinalizationService.ts). The observed behavior separates provider policy and session/run identities, and checks the current run/workspace around finalization. Orchestra applies that identity discipline to project-scoped local dispatch and fingerprints the exact task context for approval. The T3 sources do not define Orchestra's human plan approval rule.

Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae` was reviewed at [`journal-dispatch-observation.test.ts`](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.test.ts), [`worker-list-run-scope.test.ts`](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/worker-list-run-scope.test.ts), and [`mutation-request.ts`](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.ts). The observed patterns distinguish pending/unknown/accepted dispatch, keep observation scoped to the caller's run context, and preserve request identity through uncertain mutation recovery. Orchestra adopts exact project/task scope and durable plan receipts; it keeps the Kanban state model and adds an explicit approval transition rather than copying Orca's worker runtime.

## Orchestra contract and adaptation

Source-empty local SQLite projects may dispatch their exact project's Todo tasks into the planning stage when the selected provider has a reviewed local read-only adapter. When a registry is configured but its selected provider lacks that stage capability, the plan projection says `unsupported` with a reason and the task does not enter a retry loop. Planning writes a durable plan result and leaves the task in Todo awaiting an explicit approval receipt. In Progress candidates require a matching approved fingerprint. Hosted sources remain unsupported by this local approval gate; a hosted task is not assigned an invented local scope. Source-empty task creation and control share the configured worker-assignee allowlist so a human assignee cannot become a worker merely because the scoped local client was created separately.

Fingerprints canonicalize nil and empty collection fields. This is required because old SQLite rows may contain SQL NULL while exact task reloads project those columns as empty JSON collections. Both projections describe the same task context and therefore must produce the same approval hash. The fingerprint continues to include task identity, provider, plan, feedback, repository/base context, and execution-relevant metadata.

Generic state patches cannot stand in for the durable replan control. Service and API guards reject execution unless the source state is Todo with a matching explicit approval, and reject returning execution/review/completed tasks to Todo or Backlog; those changes must pass the replan receipt, feedback, and settled-run checks. Ordinary Backlog→Todo admission and Todo→Backlog remain available. Plan lifecycle history uses the newest ready/approved/failed/replan/review-finding event as authoritative, so same-feedback replans and later review findings cannot revive an older matching approval hash. Read-only planning is currently restricted to LOCAL runtime; remote runtime tasks are projected unsupported and not queued.

The explicit stop endpoints use a separate scoped reset path. Local source-empty tasks are atomically held in Backlog and receive a `plan_invalidated` history event keyed to the exact current fingerprint before the active session is canceled. Stop preserves plan, feedback, branch/base metadata, PR linkage, and worktree files; it cannot make the previous approval executable after a later Backlog→Todo transition. DELETE `/session` uses the same held-Backlog behavior and checks provider-specific session identity before persisting the hold. If persistence fails, the session remains uncanceled and the API reports a conflict.

Gemini is retired for new harness selection. Existing task/session provider identity and stored legacy default are preserved; explicit new Gemini assignments/default selection are rejected. Antigravity is a distinct provider. It currently has no verified enforced read-only stage adapter, so this work does not claim that a prompt or CLI plan mode makes it safe for unattended planning/review.

## Verification evidence

The bounded local lifecycle test `TestLocalTwoTaskLifecycleIsBoundedAndRequiresPlanApproval` uses two worker-assigned local tasks, a human-assigned task, an explicit fake runner, and a capacity of two. It verifies both tasks reach planning independently, remain in Todo pending approval, exclude the human assignee, and enter separate execution only after matching approvals. `TestUnsupportedTodoPlanningStageIsVisibleAndNotQueued` checks fail-closed admission for a registered Antigravity command without a verified read-only adapter. No authenticated provider turn or live project mutation is part of these tests.

The dispatch suite now uses exact source-empty SQLite fixtures. Its In Progress fixtures carry durable matching approval history, and legacy SQL NULL rows exercise the nil/empty fingerprint normalization. `TestSourceEmptyProjectCreationUsesConfiguredWorkerAllowlist` distinguishes a configured worker from `person-smoke`. Explicit Gemini default rejection and legacy-default preservation have focused tests. `TestLatestInvalidationEventWinsEvenWhenFingerprintReturns` covers same-hash replan and review-finding invalidation. `TestPatchIssueRequiresDurableReplanForTaskReopening` verifies API conflicts for Review→Todo/Backlog while preserving ordinary Backlog↔Todo transitions. `TestRemoteRuntimePlanningIsVisibleAndNotQueued` verifies fail-closed remote-runtime admission. `TestPostIssueStopResetsStateAndCancelsSession` and `TestDeleteIssueSessionHoldsTaskAfterCancellation` verify cancellation, durable approval invalidation, and preservation of task/worktree context. `TestStopPersistenceFailureDoesNotCancelSession` verifies both stop routes fail closed without canceling when the durable state transaction is rejected.

Verified on 2026-10-05:

```text
go test ./internal/agents ./internal/config ./internal/harnesssetup ./internal/control ./internal/orchestrator ./internal/app -count=1
```

All listed packages passed. The separate API tests for explicit Gemini-default rejection also passed. This evidence does not certify live Antigravity access, hosted-source plan approval, or pull-request review behavior.

The final gate fixes were verified with:

```text
go test ./internal/orchestrator ./internal/control ./internal/plangate -count=1
go test ./internal/api -count=1
```

All four affected packages passed, including the API suite in 80.382 seconds. These tests cover exact generic-transition conflicts, same-hash replan/review/stop invalidation, local-only runtime planning admission, and explicit stop holding while retaining workspace context.

## Late runner result after stop

The post-run path now treats the originally admitted task stage as authoritative. It checks cancellation and exact project/task stage after the provider returns, after continuation evaluation, and immediately before finalization. A late successful result after stop settles the runtime entry but skips plan persistence, state advancement, commit, and push. Git commit/push subprocesses inherit the run context so a stop can cancel an in-flight command. The plan/execution branch is selected from the admitted `planOnly` stage; it is not inferred from a task state that changed while the provider was running.

`TestStoppedSuccessfulExecutionCannotCommitOrAdvanceTask` plans and approves a disposable local task, adds an uncommitted worktree marker, then has a fake execution runner synchronously stop the session and hold the task in Backlog before returning success. It verifies the task remains Backlog, HEAD is unchanged, and the marker remains uncommitted. This uses a temporary SQLite database and temporary Git checkout; it does not invoke a real provider or mutate a user project.
