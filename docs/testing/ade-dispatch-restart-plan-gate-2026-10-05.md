# ADE dispatch recovery and plan gate handoff

## Reference receipt

Inspected the pinned sources required by package 08:

- T3 Code `pingdotgg/t3code` revision `737993303d36e10674c54b95e5bd3826682c99c7`: `ProviderAdapter.ts` keeps application thread, provider session, thread, turn, and runtime request identities distinct. `RunFinalizationService.ts` captures the checkpoint, re-reads the thread projection, and refreshes workspace/PR state only when the current branch and active run still match. These are identity and stale-finalization safeguards; T3 does not provide the local Kanban plan approval gate used here.
- Orca `stablyai/orca` revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: `mutation-request.ts` reuses one request ID for bounded retries and retains the earlier uncertain request when a later retry fails before carrying its ID. `journal-dispatch-observation.test.ts` scopes dispatch observations by fence and distinguishes pending, unknown, and accepted submissions. These sources protect mutation replay and native-chat dispatch observation; they do not define task-stage approval semantics.

## Orchestra finding and adaptation

Source inspection and persisted-state fixtures reproduced a dispatch gap: a persisted `In Progress` run entry can outlive its durable task stage. Revalidation reads the task as `Todo`, checks no `In Progress` approval gate, updates only the service's entry, and returns success. The caller still holds the stale claimed clone and selects execution mode from its old `In Progress` state. A related fixture shows released/restored `Todo` retries can skip the plan gate applied during candidate enqueueing.

The live restart history separately showed `plan_ready` at 17:48:21Z followed by `plan_approved` at 17:55:32Z. Although the reporting operator had not issued that approval, the receipt means the run itself does not prove an approval bypass. The observed plan later became stale because checklist progress from execution was written back into the fingerprint-bound approved plan. The handoff now treats that as a confirmed plan-integrity defect and keeps the dispatch gap as an independently fixture-reproduced defect.

Orchestra keeps the Kanban task and SQLite audit history authoritative. Dispatch revalidation now rejects a task whose live stage differs from the claimed entry, applies the same `Todo` and `In Progress` gate rules to restored/retry entries, and fails closed when no tracker client is available. The app also revalidates the exact live task and gate immediately before handing the turn to the provider, after workspace setup. A rejected claim is dropped so a later refresh can enqueue it from current state.

The deliberate difference is that Orchestra does not restore or replay a provider turn from the persisted run row. A stale row is only a claim candidate; it must match current task stage and approval evidence before any provider handoff. This does not add a durable effect outbox or solve uncertain provider delivery, which remain package 08 work.

## Behavioral verification

- `TestRevalidateClaimedIssueDropsRestoredExecutionStageWhenTaskIsAwaitingApproval` restores an `In Progress` run row against a `Todo` task whose plan awaits approval and verifies that it is dropped.
- `TestRevalidateClaimedIssueDropsRestoredTodoRetryWhenPlanAwaitsApproval` restores a same-stage `Todo` retry and verifies that candidate-enqueue bypass cannot bypass the approval gate.
- The app lifecycle test emits completed checklist progress as a provider event, then verifies the event remains in SQLite while the human-approved plan and its fingerprint stay unchanged through `Review`.
- `go test -p 1 ./internal/orchestrator ./internal/plangate` passed.
- `go test -p 1 ./internal/app` passed on the current shared working tree after approved-task fixtures were updated to persist their branch and base-SHA identity before generating the approval receipt.
- `go test -race` could not run because this Windows Go environment has `CGO_ENABLED=0` and no C compiler was found.
- The desktop targeted suite `npm.cmd run test -- src/features/issue-detail src/features/kanban/KanbanBoard.submenus.test.tsx src/features/kanban/KanbanBoard.backlog.test.tsx` passed 37 tests across 7 files; the AppDialogs/useIssueLookup suite passed 5 tests across 2 files; `npm.cmd run typecheck` passed. These checks ran on the current shared working tree.
- No real provider/account action or task mutation was performed by these fixture tests. The separate live restart observation that exposed this bug is recorded by the operator; it is not treated as verification of the fix. The runner-handoff guard has unit/integration coverage only through the focused app lifecycle test, not a provider-backed canary.

The live `plan_approved` history receipt means the reported provider work may have followed a valid earlier approval; the receipt does not establish who submitted it. The stale plan is explained by execution checklist writes and is covered by the lifecycle fixture. These results apply to the current shared working tree, including concurrent account-related edits. Passing unit tests do not certify full restart/E2E reliability.

## Corrected-build live restart observation

The isolated committed-scope build passed `go test -p 1 ./internal/orchestrator ./internal/plangate ./internal/reviewgate ./internal/reviewpipeline ./internal/app` and built successfully. After relaunching the persistent audit profile with that binary, the authenticated CLI observation at 2026-10-05T20:25:10Z found ORCHESTRA-2 still In Progress with stale plan fingerprint `1ad21144046443620e69edb73c00511bb3265f8d4d0ed6a038e837701adacd7e`, unchanged task timestamp, and zero running/retrying workers. The new launch log contained no worktree/provider dispatch for the task. No new plan or PR approval was submitted. The runtime is left running with the task held; returning it to planning requires an explicit scoped replan with feedback rather than editing SQLite.

This is live evidence that this stale task is held after restart on this host. It does not verify every recovery case, provider, approved execution, or PR gate end to end. The in-memory runtime usage totals reset on relaunch; durable usage restoration remains a separate verification gap.