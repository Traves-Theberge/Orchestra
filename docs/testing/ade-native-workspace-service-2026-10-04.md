# Native workspace conversation service handoff

## Reference receipt

T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: inspected `ProviderAdapter.ts`, session/request release and resume boundaries in `ProviderSessionManager.ts` and its test fixtures, and exact thread/session/turn targeting in `ProviderTurnControlService.ts`. The design distinguishes application conversations from provider threads/turns and live requests; closing a runtime invalidates pending response capabilities. Orchestra adopts these identity and lifecycle boundaries without importing Effect or the complete T3 execution-node graph.

Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected `journal-dispatch-observation.ts` and its tests. Write-ahead submissions are observed within an execution fence, and pending/accepted/unknown are distinct. Orchestra records client submission and response identities before provider effects; uncertain responses remain unknown and repeated identities return their stored receipt without another provider write. Runtime requests include an incarnation prefix so a restarted process cannot answer an old numeric provider request accidentally.

Reference source behavior is not evidence of Orchestra reliability. Neither reference GUI was executed for this package. Installed Codex protocol schemas and current app-server documentation are tracked in the adapter owner's receipt; this service consumes that adapter contract.

## Adaptation and deliberate boundaries

- New Codex app-server conversations persist `native_session` mode. Existing conversations retain their explicitly persisted replay mode; legacy history is never silently discarded or misrepresented as a resumed provider thread.
- The selected project root is authorized before reads and mutations. Its main checkout is serialized across active chat conversations. Kanban and task turn-budget semantics are unchanged.
- Provider thread identity and observed model/approval/sandbox information are recorded before sending the first native turn. Later turns use the live session; after restart a new process resumes the recorded thread rather than replaying the transcript.
- Provider events, including text/tool/output deltas and observed usage, are committed to SQLite before a polling reader can see them. Detail accepts a durable event cursor while still returning message/request snapshots.
- Approval and question replies are scoped to project, conversation, and exact live runtime request. Answers are typed and validated; task-budget options remain unsupported. Replies record a `sending` receipt before writing and settle `answered` or `unknown`; repeated identities never rewrite the provider.
- Stop interrupts the native turn while retaining checkout files and thread identity. Backend close closes owned native runtimes, waits for turn settlement, and leaves durable records. Restart marks unsettled submissions/requests unknown without replaying them.
- Claude/OpenCode remain explicitly described transcript replay; this package does not claim native session parity for those providers. Policy controls are fixed to the adapter defaults, not invented from task settings.

## Behavioral verification

Windows native commands passed on 2026-10-04:

```powershell
go test ./internal/workspacechat -count=1
go test ./internal/workspacechat ./internal/api -run 'TestNative|TestWorkspaceChat' -count=1
go vet ./internal/workspacechat
```

Tests exercise two turns on one native runtime without transcript replay, a fresh service resuming the recorded provider thread, model request versus observed identity, submission replay after model changes, committed event cursors, typed question ID validation, incarnation-scoped approval receipt replay, unknown request recovery, and no provider retry after restart. The real HTTP router/auth middleware and SQLite boundary test native questions, rejected wrong question IDs, successful answers, same-response replay, and stale conflicting replies.

These tests use a deterministic native adapter fixture. They do not execute signed-in providers, establish account readiness, prove the renderer/browser boundary, or certify live provider E2E behavior. Race/combined adapter verification and the desktop audit belong to the root integration handoff. Event/message history retention and attachments are not implemented here; histories are currently fully retained in SQLite.

Changed service: `apps/backend/internal/workspacechat/{service.go,native.go,native_test.go}`. HTTP integration: `apps/backend/internal/api/{workspace_chat.go,workspace_chat_test.go,router.go}`. The adapter owner's `agents.NativeSession` contract remains separate from the batch/task runner contract.

## Provider model catalog extension

`GET /api/v1/projects/{project_id}/chat/providers/{provider}/models` authorizes the actual project root before asking the adapter for its catalog. It returns project/provider scope, typed provider model metadata, and `observation: "provider_catalog"`. The adapter initializes a disposable app-server runtime, reads `model/list`, and closes it; no thread, conversation, message, or inference is created. A catalog entry is not a promise of login readiness or model entitlement. Unsupported providers return 422; failed reads remain errors rather than invented defaults.

This extends the T3 explicit model/provider capability selection pattern and Orca's distinction between requested defaults and actually observed configuration. The picker can request the provider's `model` string while a session's `effective_model` remains independent.

`go test ./internal/workspacechat ./internal/api -run 'TestModels|TestNative|TestWorkspaceChat' -count=1` and `go vet ./internal/workspacechat` passed after the extension. Fixtures verify root authorization, unknown projects, unsupported providers, failed reads, absence of SQLite conversation/message/event effects, no native session start, and the real HTTP route's authentication and scoped catalog response. New service files: `models.go` and `models_test.go`.

## Reasoning effort composer extension

The pinned T3 `ChatComposer.tsx` exposes selected prompt effort and selected model options as part of its send context; those controls are backed by provider capability information. Orchestra now accepts `requested_reasoning_effort` with an explicitly selected `requested_model`. It checks the provider catalog's exact advertised effort for that model before accepting a message or starting a thread. An unresolved default model is intentionally insufficient because the provider/project configuration can override the catalog's default. The native adapter's optional typed options interface sends the validated effort through the installed protocol's `turn/start` field.

Catalog preflight does not hold the service ownership mutex; acceptance rechecks submission identity, project root, and active ownership afterward. The immutable submission tuple includes text, model, and effort. A repeated client identity returns its receipt without another catalog read or provider turn; changing its effort is rejected. Requested effort persists independently from provider-observed effort. Model or effort changes clear stale observed fields at acceptance; an absent provider observation remains unknown. Omitting effort inherits the provider/thread setting and is not presented as a reset to a guessed default.

`go test ./internal/workspacechat ./internal/api -run 'TestRequestedEffort|TestModels|TestNative|TestWorkspaceChat' -count=1` and `go vet ./internal/workspacechat` passed. Tests cover explicit model requirements, absent models/efforts, read failures without acceptance effects, actual typed options dispatch, immutable identity replay without repeat reads, restart persistence, and HTTP rejection on unsupported replay providers. New test: `effort_test.go`. Combined native adapter/race and live provider verification remain in the root integration receipt.

## Draft-first conversation identity

The pinned T3 `ChatView.logic.ts` keeps a local draft before server ownership and promotes navigation only after a persisted user message or run observation; `buildLocalDraftThread` gives the draft a known identity. Its draft-promotion tests explicitly avoid treating a pending background submission as server ownership. Orca's write-ahead dispatch observation and retry-identity pattern provide the complementary uncertain-delivery boundary.

Orchestra conversation creation now accepts optional `client_session_id`, a canonical UUID. The client can keep that identity through draft-first create/send and reconcile an uncertain create through the existing scoped GET endpoint. A repeated identity on the same project/provider returns the existing conversation receipt, including its durable mode and status, without native session creation. Rebinding it to another project/provider returns 409; malformed or nil UUIDs return 400. Omitting the field preserves the server-generated-ID API. Retries do not rename the original conversation.

`go test ./internal/workspacechat ./internal/api -run 'TestClientConversation|TestRequestedEffort|TestModels|TestNative|TestWorkspaceChat' -count=1` and `go vet ./internal/workspacechat` passed. New creation tests verify repeated/concurrent receipts, normalization, identity conflicts, restart reconciliation, no extra conversations or native launches, and legacy callers. The HTTP router test verifies accepted known identity, replay, provider conflicts, and malformed identity rejection. Tests do not modify provider accounts; UI draft/send/network behavior is verified separately by its owner. New test: `create_test.go`.

## Persistent late-event verification

The adapter's session event pump is now independent of a turn waiter. The service callback already belongs to the provider runtime/conversation lifetime; its durable event append remains usable while the conversation is idle. It preserves the provider's original turn ID and rejects foreign nonempty thread IDs against the recorded provider thread. An event is an observation, not proof that a newer turn emitted it.

Async dispatch introduces a request settlement boundary: a callback can arrive after turn finalization. New request records are only pending while the conversation is running and that provider turn has no recorded terminal event. Recorded completion retires matching pending requests, and provider `serverRequest/resolved` notifications retire matching pending response capabilities. A late request for a completed turn cannot become answerable merely because another turn is running.

The pinned T3 token-usage accumulator explicitly treats late finished-turn usage separately from the live turn baseline. Orca's token-delta reducer distinguishes snapshot baselines, duplicates, and stale regression instead of adding thread cumulative totals as new usage. This package preserves observations and identity; it does not implement billing estimates or claim per-turn aggregation.

`go test ./internal/workspacechat -count=1` and `go vet ./internal/workspacechat` passed with `late_events_test.go`. Fixtures emit usage after completion while idle, confirm cursor/typed/raw observation persistence, reject foreign thread observations, reload SQLite through a new service without another native start/turn, and reject late completed-turn approvals while a newer running state exists. Adapter stream ordering/flush tests and the root isolated renderer canary supply the other boundaries; no real provider account was used in these service tests.

## Shutdown callback barrier

Native process close can be called reentrantly from a provider callback, so its process-reaping boundary does not itself wait for the callback worker. The workspace service now calls the optional `DrainEvents(context)` observation barrier after closing each owned runtime, outside all service mutexes, before returning to database teardown. The same helper covers failed-runtime disposal and a runtime finishing startup while service shutdown is underway. It uses an uncancelled barrier because these service-owned callbacks only persist SQLite observations; an ignored timeout would permit callbacks to outlive their database.

`shutdown_test.go` queues a delayed usage callback, proves service Close remains blocked after runtime Close until the callback commits, and only then closes SQLite. `go test ./internal/workspacechat -count=1`, `go vet ./internal/workspacechat`, and ten focused runs of `TestCloseDrainsQueuedPersistenceBeforeDatabaseTeardown` passed. Combined race verification is recorded by the root integration run. This test uses a fixture runtime and does not touch provider accounts.
