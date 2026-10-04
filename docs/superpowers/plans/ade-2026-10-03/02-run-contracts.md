# Run contracts and persistence

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 01. Outcome: each task execution has durable run/attempt identity, explicit states, one action policy and migration-compatible API projections.

## Files and boundaries

Existing: backend `internal/tracker/work_item.go`, `internal/orchestrator/state.go`, `internal/app/run.go`, `internal/db/schema.go`, `internal/db/migrate.go`, `internal/api/state.go`, presenter, protocol schemas/fixtures, desktop `core/api/types.ts`, `core/api/client.ts`, `core/sync/runtime-sync.ts` and issue/runtime store slices.

Proposed: focused domain files under `internal/orchestrator/`, DB run DAO/migrations, a task action-policy module, and additive run/action response schemas. Do not extend the existing snapshot `runs` table without accounting for its current delete-and-replace persistence path.

## 02.1 Specify domain states and transitions

- [ ] Define TaskRun and Attempt IDs independent of issue ID and provider session ID. Distinguish planning, execution and revision run kinds.
- [ ] Define run status, finalization status, verification status and delivery status independently. Include queued, waiting, interrupted and canceled outcomes.
- [ ] Define legal transitions, invalid transitions and superseded-attempt handling. Document queue-plan versus execute-directly semantics.
- [ ] Define project completion policy and cancellation/closure outcomes. Preserve existing board states through a compatibility projection.

## 02.2 Persist identities and histories safely

- [ ] Create additive tables for task runs/attempts and their recorded transition history. Preserve project/workspace/base/head identities, original times and provider-session references.
- [ ] Stop using delete-and-replace snapshots as the authoritative history. Keep a legacy projection if older clients require it.
- [ ] Migrate existing active rows to explicit legacy/unknown recovery status; do not fabricate a live process or verified state.
- [ ] Test migration from a populated database, repeated migration, failed migration and legacy read compatibility. Take a backup before modifying a user's persistent DB during implementation.

## 02.3 Unify action policy

- [ ] Move allowed action/readiness rules into one backend policy. Include required fields, field editability, feedback validation and reasons actions are unavailable.
- [ ] Route manual API actions and orchestration-triggered transitions through the same domain rules, with explicit system actions where needed.
- [ ] Return allowed actions and current state version to clients. Reject stale updates with a conflict response and current authoritative state.
- [ ] Test board/detail/API parity, empty feedback, case/whitespace normalization and attempts to edit locked fields.

## 02.4 Add stable command and attempt fencing

- [ ] Add a persisted idempotency receipt for admission and task-mutating commands. A repeated identical key returns the accepted result; reusing it with a different payload fails.
- [ ] Enforce one current active attempt per run/task policy transactionally. Carry attempt ID through provider events and finalization.
- [ ] Reject late success/failure from superseded or canceled attempts without overwriting the current run.
- [ ] Add concurrency tests using duplicate requests and interleaved cancellations. Do not promise exactly-once external effects; package 08 adds reconciliation.

## 02.5 Update API contracts and projections

- [ ] Extend schemas, fixtures and typed clients additively. Supply unknown for missing new evidence rather than inferring passed.
- [ ] Update snapshot/event projections and desktop normalization so task/run/attempt identity survive refresh and reconnect.
- [ ] Test old payloads, new payloads and malformed states. Record compatibility rules in API docs.
- [ ] Run a fixture task through repeated actions and assert one durable run/attempt plus an intact transition history.

## Validation and exit

Run targeted DB/orchestrator/API/presenter and desktop sync tests, then package 01 duplicate/stale/cancel scenarios. Use race tests for the modified scheduling paths.

- [ ] UI refresh and backend restart retain run identity and original timing.
- [ ] Duplicate admission cannot create two current attempts.
- [ ] Stale completion cannot finalize current work.
- [ ] Board/detail actions share one policy; existing clients still decode responses.

Handoff: transition table, schemas/migration notes and evidence. Configuration, PR review and workspace packages use these identities rather than parallel task IDs.
