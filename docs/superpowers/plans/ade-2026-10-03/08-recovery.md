# Durable recovery and provider capabilities

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 04, 05, 07 and C1. Outcome: UI closure, backend failure, reconnect and stale provider events have explicit recoverable semantics without duplicated side effects or lost human requests.

## Files and boundaries

Existing: orchestrator persistence/reconciliation, app dispatcher, DB, PubSub/events API, native chat session service, provider adapters, terminal manager, Electron managed-backend lifecycle, runtime sync and attention UI.

Proposed: durable command/effect outbox, process/session ownership manifest or supervisor, request DAO/responder, event cursor/retention and recovery scenarios. Choose the smallest tested local process ownership design before adding remote complexity.

## 08.1 Persist intent and effects

- [ ] Extend package 02 receipts so state changes, history and pending effects commit in one SQLite transaction. Publish only after commit.
- [ ] Assign stable effect IDs, attempt fencing and operation outcomes for provider launch, commit/push, PR creation, request response and cleanup.
- [ ] Implement effect claim/lease and result recording with bounded retries. External I/O happens outside the DB transaction.
- [ ] Reconcile uncertain external outcomes before replay: inspect Git refs, PR identity or native session state. Never blindly replay a provider launch or message with unknown delivery.
- [ ] Crash-inject before/after intent commit, effect execution and result commit; verify retained uncertainty and no false completion.

## 08.2 Complete human request lifecycle

- [ ] Store original provider request/option IDs, run/attempt/session, question/policy scope and supported response method.
- [ ] Distinguish blocking native responses from asynchronous message-based answers. Preserve pending questions after a provider turn finishes where applicable.
- [ ] Validate and persist resolution plus response intent atomically. Repeated answer command returns its receipt rather than posting twice.
- [ ] Recover undelivered answers; reject stale/incompatible requests with an explicit result. Never count waiting for input as a normal failure retry.
- [ ] Test permissions unchanged after an unrelated request and answer delivery after reconnect/restart.

## 08.3 Define process ownership and UI closure

- [ ] Decide whether a backend service/supervisor owns long-lived provider/PTY sessions. Decouple supported background execution from Electron window lifetime.
- [ ] Store a verifiable process identity beyond PID alone: environment/start identity/session/owned endpoint. Avoid attaching to an unrelated reused PID.
- [ ] For UI close, reattach to surviving sessions with logs/history. For backend/host failure, resume only supported native sessions or mark interrupted with an explicit restart action.
- [ ] Persist original timestamps, config/worktree references, retry schedule and bounded scrollback/history. Do not restore fake current start times.
- [ ] Implement graceful stop deadlines and owned child-tree cleanup; confirm no orphaned workers after test teardown.

## 08.4 Capability driven session operations

- [ ] Advertise verified support for steer, interrupt, resume, fork, checkpoint, conversation rollback and attachments by provider instance/version.
- [ ] Build portable handoff summaries for cross-provider switching with decisions, remaining work, workspace SHA and evidence.
- [ ] Implement checkpoints only with coordinated filesystem and conversation semantics. If the provider cannot roll back its conversation, reject unsupported combined revert before touching files.
- [ ] Track account/config changes without mutating an active session's identity. Unsupported native account isolation is visible.
- [ ] Test each advertised operation through its real adapter; do not infer capability from a CLI flag name.

## 08.5 Replay and reconnect

- [ ] Add sequenced durable events and cursor-aware subscriptions, bounded retention and full resync when a cursor expires.
- [ ] Keep actionable state recoverable independently of transient PubSub delivery. Slow consumers receive a resync signal or recoverable snapshot version.
- [ ] Test UI/network disconnect during streaming, request delivery and finalization; ensure no lost questions or duplicate rendering/delivery.
- [ ] Verify legacy clients still receive compatible projections and old persisted events remain decodable.

## Validation and exit

Run race tests and crash/restart/reconnect fixture scenarios at every effect boundary; perform real-provider resume/interrupt canaries for claimed combinations.

- [ ] UI closure and backend/host failure have separately demonstrated outcomes.
- [ ] No duplicate launch/finalization, lost request or falsely restored live process in tested scenarios.
- [ ] Effect retry preserves run/config/workspace identity and uncertain outcomes remain visible.
- [ ] Capability matrix states proved, unsupported and unknown operations separately.

Handoff: ownership contract, crash-case receipts, replay compatibility rules and native capability evidence. C2 and package 09 depend on this foundation.
