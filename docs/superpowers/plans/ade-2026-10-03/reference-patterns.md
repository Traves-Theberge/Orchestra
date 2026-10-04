# Mandatory Orca and T3 Code reference review

This is a required gate for every ADE implementation package. The user requires observing the reference patterns from both Orca and T3 Code. Inspect behavior and boundaries before deciding what to borrow. Adapt them to Orchestra's Go backend, SQLite ownership and Kanban model. Document a reason when a pattern does not apply or when Orchestra deliberately differs. This rule does not require copying either application's architecture wholesale.

## Pinned references

Source snapshots selected on 2026-10-03:

- T3 Code: [`pingdotgg/t3code` at `737993303d36e10674c54b95e5bd3826682c99c7`](https://github.com/pingdotgg/t3code/tree/737993303d36e10674c54b95e5bd3826682c99c7).
- Orca: [`stablyai/orca` at `3284b4c70c901402831bb4ccc5576ea083d2e5ae`](https://github.com/stablyai/orca/tree/3284b4c70c901402831bb4ccc5576ea083d2e5ae).

Use these revisions for repeatable comparison. A newer reference can be adopted by recording its revision and the relevant behavior change. Check the applicable license before copying code or assets; borrowing a design pattern does not require source copying.

## Source observations made during planning

The following source excerpts were inspected. They identify patterns, not a certification that either reference works reliably in a running application. Read the complete relevant implementation and tests when executing a package.

| Key | Inspected source | Pattern to evaluate |
| --- | --- | --- |
| T1 | [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) | Typed provider policy and events; distinct app thread, provider session, thread, turn and runtime request identities. |
| T2 | [RunFinalizationService.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/RunFinalizationService.ts) | Checkpoint capture followed by workspace refresh; explicit errors and checks against the current branch/run before PR refresh. |
| T3 | [ThreadPullRequestService.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ThreadPullRequestService.ts) | Repository identity matching and workspace snapshot checks around PR discovery; refreshable repository context. |
| T4 | [ChatComposer.tsx](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/chat/ChatComposer.tsx) | Composer integrates model/provider selection, runtime modes, requests, attachments, context and send-state logic. Trace implementations behind these imports. |
| O1 | [mutation-request.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.ts) | Retry identity is reused; bounded unavailable retries retain recovery information when a mutation may already have landed. |
| O2 | [agent-project-model-override.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts) | Workspace config can override an account model default; presence detection is explicitly insufficient to know the effective model. |
| O3 | [journal-dispatch-observation.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.test.ts) | Dispatch observations are scoped to a fence and distinguish unknown, pending and accepted submissions. |
| O4 | [worker-list-run-scope.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/worker-list-run-scope.test.ts) | Worker observation reports scope; explicit run overrides caller binding, and unbound callers can list all runs. |

Additional reference entry points are [T3 server orchestration](https://github.com/pingdotgg/t3code/tree/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2), [Orca orchestration handlers](https://github.com/stablyai/orca/tree/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration), and [Orca native chat](https://github.com/stablyai/orca/tree/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat). These directories are inspection targets; their full contents were not reviewed during planning.

Orca's [native-chat documentation](https://www.onorca.dev/docs/agents/native-chat) distinguishes terminal transcript chat from structured native provider chat. C1 must explicitly study structured sessions and delivery uncertainty. Its [orchestration documentation](https://www.onorca.dev/docs/cli/orchestration) is the control/observation reference for C2. Documentation describes intended behavior; correlate it with pinned source and tests.

## Package-specific reference assignments

Every row requires examining both references. The keys are starting points, not substitutes for tracing the feature through its implementation and tests. Where no corresponding feature exists, record the search and finding, then specify Orchestra's independent design.

| Package | T3 inspection | Orca inspection | Orchestra behavior to derive and verify |
| --- | --- | --- | --- |
| 00 Baseline | T1 adapter boundary and platform assumptions | O2 filesystem handling; native-chat platform boundaries | Explicit platform support and provider discovery; runnable builds. |
| 01 Verification | T1/T2 service tests and integration boundaries | O3/O4 tests and mutation recovery tests beside O1 | Layered evidence with real boundary coverage and failure injection. |
| 02 Run contracts | T1 identities; orchestration commands/events/projections | O1 request identity; O4 run scope | Durable task/run/attempt/session identities and shared commands. |
| 03 Configuration | T1 policy/model selection; T4 selection paths | O2 model-default ambiguity; model catalog/service tests | Requested versus effective configuration across task/workspace/provider. |
| 04 Lifecycle | T2 finalization and related tests | O1 recovery; orchestration worker settlement handlers/tests | Ordered execution/check/publication effects and guarded completion. |
| 05 PR review | T3 PR discovery/sync services and tests | Pinned `docs/site/content/docs/review/` plus corresponding review source | Task/PR repository identity, anchored feedback and fresh head-SHA state. |
| 06 Kanban | T4/ChatView state and runtime request presentation | O4 worker observation; notifications and attention UI | Preserve columns; expose actual runs, blockers, failures and decisions. |
| 07 Workspace | T2 workspace refresh; T4 thread context | O2 workspace identity; session restore/checkpoint implementation | Task-scoped panels, provider context and independently restored state. |
| 08 Recovery | T1 session/request identity; T2 effect failures | O1 uncertain mutation outcome; O3 journal and crash-boundary tests | Reconcile uncertain delivery, reconnect safely and avoid duplicate effects. |
| 09 Workflows | T1 execution nodes/subagents/runtime requests | O4 scope; dispatch, gate, question and worker settlement handlers | Bounded task DAGs, decisions, ownership and integration receipts. |
| 10 Remote | T1 adapter/session policy; environment ownership source | O4 run/caller identity; placement/remote guide and host authority tests | Remote environment ownership, capability checks and disconnected recovery. |
| 11 Automation | T1 scheduled-task message context; scheduling source/tests | O1 replay identity; automation scheduling implementation | Durable schedule occurrences, deduplication and evidence-based release gates. |
| C1 Native chat | T1 real session/turn events; T4 and ChatView logic | O2 model capability context; O3 journal; structured native-chat source | Persistent provider chat, context, tools, questions, approvals and honest delivery state. |
| C2 Control | T1 shared domain contracts and command dispatch | O1 mutation receipts; O4 scope; CLI handlers/specs | One control service used by UI/API/CLI/MCP, many isolated orchestrations and observable receipts. |

## Required receipt before implementation and at handoff

- [ ] Inspect the assigned T3 and Orca sources, associated tests, and relevant user-visible behavior where a runnable reference is available. Record unavailable runtime inspection honestly.
- [ ] Record source URLs/revisions, what was observed in code, what is documentation-only, and what remains unknown.
- [ ] Describe the adopted pattern, its fit to Orchestra, and deliberate differences. Document absence where one reference has no relevant feature.
- [ ] Define acceptance scenarios that prove the pattern in Orchestra, including its failure states. Reference tests cannot replace these scenarios.
- [ ] At handoff, link the changed code and verification evidence back to this receipt. Update the package only after its gates pass.

Do not mark a package complete without the receipt. Any later implementation plan for this ADE must carry this same rule.
