# Native agent chat as the primary interface

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 02, 03 and the planning/execution boundary from 04. Implement this before the complete task workspace in 07. Outcome: a first-class conversation controls the selected provider's real session and exposes its work, questions and orchestration activity without requiring terminal interaction for supported capabilities.

This is a primary product interface alongside Kanban. It must not be implemented as a generic LLM chat panel that only narrates what a separate coding agent is doing. Native means an application chat experience backed by the actual provider session, its workspace and its permissions. Providers can use different native protocols behind a common capability-aware adapter.

## Files and boundaries

2026-10-04 first workspace slice: removed the global Maestro widget and its API-key settings form. Added project-scoped full-height workspace chat beside existing file/terminal tools, backed by persisted CLI conversation routes. Existing adapters still launch fresh turns with bounded transcript replay; provider-native resume, streaming tool/request UI, task/worktree attachment and orchestration tool controls are not complete. See [workspace UI handoff](../../../testing/ade-workspace-chat-ui-2026-10-04.md) and [backend handoff](../../../testing/ade-workspace-chat-backend-2026-10-04.md). This partial delivery does not pass C1.2's two-turn native continuity gate.

2026-10-04 native Codex slice: new project conversations now use a separate app-server command, persistent native thread/turn identity, durable streamed events and usage, scoped approval/question reply receipts and nondestructive interrupt. Existing replay conversations are retained explicitly. Real signed-in installed Codex canaries through Orchestra HTTP/SQLite verified text continuity, actual file editing and subsequent revision with independently passing tests, then same-thread recall after backend restart. The UI now follows T3's constrained Markdown timeline, ordered tool cards, bottom composer, provider-backed model/effort controls and live-edge navigation. This does not prove live tool approvals, Electron interaction, task/worktree binding or shared Kanban/CLI controls. The writable canary detected a Codex config mutation consistent with provider-managed project trust; further account-connected coding tests await isolated authentication. See [native adapter](../../../testing/ade-codex-native-session-handoff-2026-10-04.md), [service](../../../testing/ade-native-workspace-service-2026-10-04.md), [UI](../../../testing/ade-native-chat-ui-2026-10-04.md) and [integration evidence](../../../testing/ade-native-chat-integration-2026-10-04.md). Full C1.6 and package exit gates remain open.

Existing: `internal/agents/types.go`, registry and adapters including `codex_appserver.go`/command runners; backend Studio session/event code, session logger, DB/API; desktop Studio chat/composer, embedded-agent message components, task inspector, core store/sync and API contracts.

Proposed: backend conversation/session service, persisted thread/turn/item/message/request DAOs, provider session capability interface; desktop `features/agent-chat/` shared native chat, thread navigation and typed event renderer. Reuse rendering pieces, but keep authoring threads, task execution threads and orchestration coordinator threads explicit.

## C1.1 Define thread and session ownership

- [ ] Define persistent conversation ID independent of task, run and native provider session. Associate a thread with a task/workspace or an orchestration coordinator; a draft authoring thread has its own purpose.
- [ ] Specify model/account/environment identity and how threads create or attach a run. A new user message must not silently launch a second agent on an occupied workspace.
- [ ] Define typed items: user/assistant messages, tool call/result, exposed reasoning summary when supplied, plan, attachment, question, approval, error, verification and orchestration operation.
- [ ] Define accepted, queued, delivered and completed message states. Persist IDs and sequence/version so UI reconnection cannot duplicate message delivery.

## C1.2 Add a provider session interface

- [ ] Inventory each runner's actual session support. The current Codex RunTurn initializes a process/thread per invocation; do not assume the supplied session ID provides native conversational continuity.
- [ ] Introduce adapter operations for session start/load, send, events, interrupt and close, with optional steer/resume/fork/rollback. Keep the one-shot Runner adapter for batch providers.
- [ ] Select one real provider with a verified structured protocol as the first vertical slice. Use its current official protocol documentation during implementation; prove session continuity over two turns before claiming chat support.
- [ ] Normalize provider items while preserving native request/option IDs, tool identities and sequence. Retain bounded redacted native diagnostics for failures.
- [ ] Add recording-provider tests for streaming, interleaving tool events, unsupported input, process exit and late events.

## C1.3 Persist conversation and deliver messages

- [ ] Persist a user message and delivery intent transactionally before invoking the provider. Repeated submission with the same key cannot deliver twice.
- [ ] Persist assistant/tool/request items before notifying clients. Paginate history and support replay/cursor resync; do not rely on an in-memory token stream as history.
- [ ] Reconcile accepted-but-undelivered messages after disconnect/restart. If a provider's delivery outcome is uncertain, retain that uncertainty and inspect native session state before retry.
- [ ] Store attachments with thread/environment ownership, checksums and native adapter input references. Validate availability before dispatch.
- [ ] Test thread reload after application/backend restart with preserved user messages, provider-session identity and configuration version.

## C1.4 Build the chat experience

- [ ] Add project/task/orchestration thread navigation, a model/provider picker and explicit workspace context. Selecting a new model affects a new turn or explicit handoff under the defined policy.
- [ ] Render streamed text, tool cards, plans, check results, questions and errors with durable status. Keep raw terminal/log access as a supporting pane.
- [ ] Implement composer attachments, queued follow-ups, stop/interrupt and retry. Show unsupported steering/resume capabilities clearly; never pretend a queued message was delivered.
- [ ] Add question and approval panels with typed answers/choices, visible scope and audited response. A model-proposed approval is not a user grant.
- [ ] Preserve composer drafts and scroll/focus on task switching. Virtualize long histories only with tests for pagination, selection and streaming behavior.

## C1.5 Connect native chat to orchestration

- [ ] Add a coordinator thread mode using the same chat surface. Structured orchestration operations from C2 appear as cards with run/task/worker IDs, results and links.
- [ ] Let users drill into a worker's native conversation from the board or coordinator thread, then return without losing context.
- [ ] Show live orchestration summaries, questions and decisions from durable backend records. Chat prose never becomes the authoritative task status.
- [ ] Associate every control operation with the initiating thread, actor and authorization scope. Worker/coordinator tools are restricted to the runs they own.
- [ ] A coordinator can use any supported capable provider/model; worker provider choices can differ. Invalid combinations are explicit rather than silently swapped.

## C1.6 Prove native behavior

- [ ] Execute a two-turn real-provider task: first inspect/change code, then revise it based on prior context; verify the same intended native session/workspace and actual file results.
- [ ] Exercise a real tool request, a user question, interruption, reconnect and permission rejection. Record unsupported native capabilities independently.
- [ ] Run two conversations concurrently with different tasks/configurations and check isolation. Reload the app while output streams and verify history completeness.
- [ ] Test using both chat and board controls for the same run without duplicate admission or contradictory state.

## Exit and handoff

- [ ] Native chat supports a demonstrated selected-provider session across multiple turns, not just rendering terminal output.
- [ ] Requests, messages, config and workspace association survive reload; uncertain delivery is visible.
- [ ] Chat, board and CLI/API consume the same underlying run model.
- [ ] Each additional provider earns its own real canary evidence; missing native capabilities remain unsupported.

Handoff: thread/turn/item contracts, adapter capability matrix, actual session-continuity evidence and screenshots. Full orchestration controls depend on C2; strong crash recovery depends on 08.
