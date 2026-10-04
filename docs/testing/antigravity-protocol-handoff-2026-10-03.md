# Antigravity protocol preparation handoff

Date: 2026-10-03. This is a simulated protocol boundary, not a registered provider, authenticated integration, or completed ADE package. Existing dispatch, provider identity, global configuration and Kanban behavior are unchanged.

## Implementation and verification

- [antigravity_protocol.go](../../apps/backend/internal/agents/antigravity_protocol.go): typed init/step/result decoding, local request fences, conversation identity checks, cumulative usage snapshots/deltas, and terminal classification.
- [antigravity_protocol_test.go](../../apps/backend/internal/agents/antigravity_protocol_test.go): seven fixture test groups, including streaming/resume accounting and malformed/identity/order/failure cases. Fixtures are synthetic and do not contain user credentials or actual model output.

Commands run from `apps/backend`:

```text
go test ./internal/agents -run Antigravity -count=1
PASS (2.650s)
go vet ./internal/agents
PASS
```

`gofmt` applied. Read-only `agy --version` and `agy --help` passed using `%LOCALAPPDATA%/agy/bin/agy.exe`, version 1.2.16. No authenticated inference, installation, login, global settings writes, or workspace tool invocation ran. Race verification remains outside this receipt: this Windows environment previously lacked the required cgo C compiler.

| Scenario | Fixture evidence |
| --- | --- |
| Two turns in one session | One init; distinct local request IDs; second result usage is a delta, without adding step usage again. |
| Resume with known/unknown baseline | Known conversation snapshot produces a delta; first resumed cumulative total with no baseline remains unknown; next result establishes a baseline. |
| Identity mismatch | Init, step, result and supplied usage baseline reject another conversation. |
| Malformed/unsupported stream | Invalid JSON, null/ambiguous payload, absent required fields, unknown discriminators, negative usage and >4 MiB records poison the decoder. A later SUCCESS cannot conceal the failure. |
| Duplicate/stale completion | Duplicate init/result, reused request IDs, overlapping turns, stale/skipped cumulative counters and usage regression are rejected. |
| Missing result or failed process | Exit 0 without a terminal result is incomplete; nonzero exit after SUCCESS is process_failed. |
| Tool denial then SUCCESS | Structured tool error remains visible; final outcome is completed_unverified. |
| Launch/input failure before init | Explicit ERROR with zero turns may have no provider identity; requested resume identity does not fabricate provider acceptance. |

`BeginTurn` must precede submission. Consuming stdout never constitutes a durable dispatch receipt. A broken write/pipe can remain uncertain and must not be blindly replayed. `Finish` reconciles EOF/process exit with protocol evidence; no outcome certifies task delivery, checks, commits, pushes, PR review, or cancellation of external effects.

## Reference receipt

T3 revision: `737993303d36e10674c54b95e5bd3826682c99c7`.

- [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts): inspected typed session/thread/turn/request identities, policies and terminal outcomes. Adaptation: distinct provider conversation and local request identity; terminal classification separate from task effects. Deviation: independent Go decoder; no Effect service or production orchestration wiring in this patch.
- [ChatComposer.tsx](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/chat/ChatComposer.tsx) imports traced into [ChatView.logic.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/ChatView.logic.ts): selected-instance compatibility and Antigravity auth/model gates. Missing continuation metadata cannot move history into another Google profile. This implementation fences conversations only; account-instance identity and composer gates remain required before wiring it to tasks.
- [AntigravityProtocol.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/provider/acp/AntigravityProtocol.ts) and [associated tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/provider/acp/AntigravityProtocol.test.ts): inspected negotiated approval options, choice IDs, tool normalization/bounds and subagent limitations. These are ACP semantics, not CLI NDJSON semantics; no unsupported CLI approval-reply capability is inferred from them.
- [AntigravityAcpSupport.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/provider/acp/AntigravityAcpSupport.ts) and [AntigravityDriver.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/provider/Drivers/AntigravityDriver.ts): inspected eager authentication, explicit resume, wait-for-prompt cancellation, selected model validation, account profiles and per-process temporary directories. Observed setup/health separation: installation detection is not a launched/authenticated session. These patterns guide future native integration; none is implemented by this parser.

Orca revision: `3284b4c70c901402831bb4ccc5576ea083d2e5ae`.

- [mutation-request.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.ts) and [associated tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.test.ts): inspected reused retry request identity and preservation of uncertain recovery context. Adaptation: explicit local request reservation and no automatic replay in the protocol. Deviation: the CLI does not provide Orchestra mutation idempotency; durable receipts and recovery still belong in the shared control service.
- [journal-dispatch-observation.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.ts) and [tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.test.ts): observed latest observation scoped to an execution fence, distinguishing pending/accepted/unknown. Adaptation: a pending local request cannot be replaced by an overlapping turn; stale completion is rejected. Deviation: this decoder is in-memory and does not claim journal durability or provider acceptance from a local reservation.
- [agent-project-model-override.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts): inspected explicit ambiguity of effective workspace model defaults. Adaptation: missing init model stays empty/unknown; no default is manufactured.

No runnable Orca/T3 reference was exercised, and reference tests were read rather than executed. No relevant Antigravity CLI NDJSON decoder was found in these inspected reference files. Google documentation defines that transport; typed identity, uncertainty and capability patterns are independently adapted.

## Capability and interface findings

Official [CLI headless documentation](https://www.antigravity.google/docs/cli/headless/) inspected on 2026-10-03 defines the NDJSON fields, cumulative result metadata, explicit conversation resume, unsupported control replies/text-only input, and tool soft-denials. The implementation accepts known init/step/result discriminators and SUCCESS/ERROR; unfamiliar statuses/events are explicitly unsupported, awaiting traces and semantics. Additive fields are tolerated. This is a compatibility choice, not a claim that all possible CLI statuses were enumerated.

| Interface/capability | Evidence | Orchestra runtime status |
| --- | --- | --- |
| CLI text streams / explicit resume | Official documentation and installed help | Parser fixtures pass; real session unverified. |
| CLI interactive approval replies / rich input blocks | Documented unsupported | Must be unavailable through this transport. |
| CLI selected model/effort/mode | Installed help | Launch/config observation unverified; parser retains model only when emitted. |
| CLI cancellation and child teardown | No real run here | Unverified; process exit cannot certify tool effects stopped. |
| Python SDK rich interaction | Prior [research](../architecture/antigravity-research-2026-10-03.md) | Separate authentication/deployment experiment remains necessary. |
| Official ACP runtime | New reference finding below | Separate richer native-chat candidate; not installed or run here. |

The pinned [T3 Antigravity user guide](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/docs/user/providers-antigravity.md) documents its use of Google's official ACP agent, with a sign-in separate from CLI/IDE and account-specific model access. Its source-backed profile isolation is especially relevant to avoiding global configuration mutation.

The [ACP registry manifest](https://github.com/agentclientprotocol/registry/blob/f6c0f4e8357c7f28e84e3b883695c387b04ed2b9/antigravity-acp/agent.json), pinned to `f6c0f4e8357c7f28e84e3b883695c387b04ed2b9` on 2026-10-03, advertises `antigravity-acp` version 1.3.0, Google LLC authorship, proprietary terms, Windows x64/ARM64 distributions from `dl.google.com`, and `agy_acp_server.exe`. This is distribution metadata, not runtime or credential compatibility evidence. Archive verification remains required; no archive was downloaded. See the [ACP research and execution sequence](../architecture/antigravity-acp-research-2026-10-03.md) for the preferred richer native-chat candidate, associated T3 tests, and authentication nuance.

## Remaining acceptance gates

1. Compare CLI, official ACP and public Python SDK before selecting the full native-chat transport. ACP now deserves direct evaluation because the required T3 reference uses it for typed approvals and session resume. Preserve separate authentication/instance ownership; do not reuse/extract CLI credentials by assumption.
2. Record harmless real CLI init/steps/results, multi-turn session, explicit resume, missing-auth and invalid-model traces in disposable homes/workspaces. Confirm version-specific status values, full counters, step ordering and effect-denial diagnostics.
3. Add bounded subprocess I/O, cancellation settlement, process-tree cleanup and tests around interrupted submission. The parser's record cap does not bound total session output, request history, or tool retention in a future process owner.
4. Add durable request/conversation/account/task bindings and configuration provenance before registration. Reject stale step activity across turn fences; the current decoder validates conversation/pending ownership and terminal counters, but does not infer wire request IDs absent from the protocol.
5. Expose requested versus observed workspace/model/policy, capability gates and native chat controls through the shared service. Do not bypass permissions or write global config to make a task work.
6. Prove task lifecycle, checks, PR review/revision and restart recovery independently. No lifecycle/package checkbox is completed by these fixture tests.

## Second executable slice: unwired ACP transport

Added [antigravity_acp.go](../../apps/backend/internal/agents/antigravity_acp.go) and [antigravity_acp_test.go](../../apps/backend/internal/agents/antigravity_acp_test.go). This is a text-only ACP v1 client over `io.ReadWriteCloser`, with one bound session and serialized calls. It remains disconnected from provider registration, production dispatch, authentication and the desktop.

Official protocol pages inspected on 2026-10-03: [initialization](https://agentclientprotocol.com/protocol/v1/initialization), [session setup](https://agentclientprotocol.com/protocol/v1/session-setup), [prompt turn/cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn), and [v1 schema](https://agentclientprotocol.com/protocol/v1/schema). Adapted independent Go code; no reference source was copied. Registry metadata did not define the transport semantics.

The source patterns above were inspected before this slice. T3's ACP capability negotiation, exact session restore, offered approval IDs and cancellation settlement inform the API. Orca's request identity/uncertain delivery inform connection retirement and no implicit replay. Deliberate differences: an in-memory fixture transport rather than T3's Effect runtime or Orca's durable journal; no authentication, filesystem grants, runtime installation, account profile or scheduler is implemented.

### Behavioral verification

Eleven test groups exchange actual JSON-RPC NDJSON through `net.Pipe`; a fake peer validates requests and emits responses, notifications and permission requests. They cover:

- Empty advertised client capabilities, initialization, new session, scoped text updates and prompt terminal reason.
- Explicit load/resume identity, replay updates during restoration, and rejection when the peer omitted required restore capability.
- Fixed-choice native questions distinct from ordinary approvals, opaque offered option IDs, and rejection of invented choices.
- Method-not-found responses to unsupported client filesystem requests; no fabricated file-write success.
- Concurrent cancellation of an active prompt, pending permission cancellation, acceptance of a final tool update, and observed cancelled terminal reason.
- Refusal to send cancel before the prompt was dispatched; cancel cannot reach the peer ahead of its target request.
- A captured cancel delayed past prompt replacement is rejected under the outbound write lock. A generation fence prevents an earlier turn's cancel from reaching a later turn; the fake peer observes only the valid replacement cancellation.
- Disconnect, malformed JSON, unsupported protocol version, mismatched/stale/duplicate response IDs and wrong-session/unsupported updates.
- Deadline retirement without replay, and a sent cancellation followed by peer loss that remains unconfirmed.
- Explicit Close while a permission handler waits on its context cancels that handler and releases a Background-context prompt; closing the pipe alone is insufficient.
- A queued prompt's admission deadline returns without writing or retiring the active Background-context prompt. After the active prompt settles, a subsequent valid prompt still uses the same transport successfully.

Latest validation from `apps/backend`:

```text
go test ./internal/agents -run Antigravity -count=1
PASS (2.246s; both NDJSON and ACP tests, including review regressions)
go vet ./internal/agents
PASS
```

`gofmt` applied. These tests prove the implemented client/fake-peer I/O boundary, not Google ACP interoperability or real-provider E2E reliability.

### API and compatibility limits

`Initialize` negotiates protocol v1 and retains agent capabilities/auth-method metadata; client filesystem, terminal, authentication and other optional services are not advertised. `OpenSession` selects new/load/resume with an explicit absolute workspace and exact restore identity. `Prompt` sends text and returns a stop reason. `Cancel(ctx)` sends a bounded notification; only the original prompt's `cancelled` stop reason records observed cancellation. Connection/context failure is sticky and requires a new client with fresh negotiation and explicit restoration, not automatic resend.

The permission callback must honor context cancellation. Explicit Close and transport failure cancel its active context; registration also checks whether failure already occurred. Missing callbacks cancel requests. Questions are recognized by the inspected Antigravity `interaction_` convention; that convention requires runtime validation for the selected release. Callback delivery is synchronous and not a durable desktop approval queue. Serialized call admission honors each waiting caller's context independently; a queued expiry never closes the active turn's transport.

Supported session updates are text chunks and tool-call identity/state notifications; raw update data is retained up to the per-record bound. Config, plan, model/mode, available-command, media and unknown notifications deliberately fail rather than silently gaining unsupported behavior. Consequently a full Google startup stream can be rejected today: this client is a preparation slice, not a working native provider.

The transport reads while an RPC is active rather than running an always-on notification pump. Late activity is fenced by connection/session identity but the wire does not supply Orchestra attempt identity. Ordered event draining, late-turn fencing, pending decision persistence, model/config application, total retention budgets and process ownership/teardown remain prerequisites for production. Callbacks must not recursively invoke serialized RPC operations. A protocol-confirmed cancellation does not independently prove all external tool effects stopped.

No subprocess, authenticated model run, archive installation or global configuration mutation was performed. Packages 02/03/C1 and real-provider acceptance gates remain open.
