# Antigravity integration research

Research date: 2026-10-03. Updated recommendation: evaluate the [official ACP runtime used by pinned T3](antigravity-acp-research-2026-10-03.md) as the preferred richer native-chat candidate. Keep the installed CLI and public Python SDK as separately evaluated alternatives, and a distinct future cloud adapter. Do not assume these interfaces share credential storage, model availability or session identity.

This is a source review and integration proposal. No authenticated inference, SDK installation, account migration or provider E2E test was performed.

## What exists

| Interface | Verified source facts | Orchestra fit |
| --- | --- | --- |
| Official ACP runtime | Registry pinned at `f6c0f4e8357c7f28e84e3b883695c387b04ed2b9`, release 1.3.0. T3 source implements typed session/model/approval boundaries. | Preferred full native-chat candidate; acquisition, authentication and interoperability unverified. |
| Local CLI, `agy` | Local `--version`/`--help` passed at 1.2.16. Headless streaming and explicit conversation resume are documented. | Alternative text/task transport with capability limits. |
| Local Python SDK, `google-antigravity` | Official SDK; latest published version inspected is 0.1.20. Python >=3.10, platform wheels include the compiled runtime; Windows amd64/arm64 wheels are published. | Optional managed Python process behind the Go provider boundary; richer policy and tool interaction. |
| Managed Antigravity agent | Gemini Interactions API, hosted Linux environment, documented Go/JS/Python/Java/REST examples. | Future remote execution adapter; separate workspace ownership and authentication. |

Sources: [CLI interface](https://www.antigravity.google/docs/cli/headless/), [SDK release/package metadata](https://pypi.org/project/google-antigravity/), [managed agent documentation](https://ai.google.dev/gemini-api/docs/antigravity-agent). Published platform artifacts establish distribution availability, not successful operation on our machine.

## SDK source receipt

Official repository: [`google-antigravity/antigravity-sdk-python`](https://github.com/google-antigravity/antigravity-sdk-python), inspected at `12f9a4c3becf487302dc799b0f59054f01f3ddb9`; its `pyproject.toml` declares 0.1.20. Apache-2.0 is the declared license. No third-party SDK is needed to establish the official integration options.

Inspected public guides and selected source boundaries:

- [agent.py](https://github.com/google-antigravity/antigravity-sdk-python/blob/12f9a4c3becf487302dc799b0f59054f01f3ddb9/google/antigravity/agent.py): high-level Agent lifecycle and chat.
- [local_connection_config.py](https://github.com/google-antigravity/antigravity-sdk-python/blob/12f9a4c3becf487302dc799b0f59054f01f3ddb9/google/antigravity/connections/local/local_connection_config.py): models, API-key/Vertex fields, workspace normalization and session/storage configuration.
- [local_connection.py](https://github.com/google-antigravity/antigravity-sdk-python/blob/12f9a4c3becf487302dc799b0f59054f01f3ddb9/google/antigravity/connections/local/local_connection.py): runtime process/connection management, halt request on cancellation and sandbox-availability warning.
- [conversation.py](https://github.com/google-antigravity/antigravity-sdk-python/blob/12f9a4c3becf487302dc799b0f59054f01f3ddb9/google/antigravity/conversation/conversation.py): accumulated history, streaming response, cancellation/disconnect; sending another turn waits for the active turn to settle.
- [local_connection_test.py](https://github.com/google-antigravity/antigravity-sdk-python/blob/12f9a4c3becf487302dc799b0f59054f01f3ddb9/google/antigravity/connections/local/local_connection_test.py): mocked harness cancellation and unavailable-sandbox tests. These were read, not run; they do not establish our platform's behavior.

The inspected transport uses a managed runtime process and local WebSocket/protobuf messages. Proposal: use the public Python SDK if selected; direct Go calls into that internal transport would add an undocumented compatibility boundary.

## The authentication decision

The [official SDK quickstart](https://www.antigravity.google/docs/sdk/overview/) documents Gemini API keys and Google Cloud/Vertex authentication. Reuse of signed-in CLI Google-account credentials remains an [open enhancement request](https://github.com/google-antigravity/antigravity-sdk-python/issues/20). The issue is a request, not proof that every future SDK release lacks that ability; current official guidance and inspected configuration do not establish it.

Consequently, we cannot promise that a Python SDK integration uses the user's existing Antigravity subscription, quotas or accessible models. CLI account reuse is documented for headless execution. Keep account references and authentication mode explicit; never extract account tokens to make an unsupported SDK login work.

The legacy Gemini settings incident affected a different path from the [CLI's documented configuration](https://www.antigravity.google/docs/cli/install/), `~/.gemini/antigravity-cli/settings.json`. This does not restore the overwritten files or prove all Antigravity components ignore them. The incident remains recorded in the [baseline receipt](../testing/ade-baseline-2026-10-03.md).

## Native chat and orchestration capabilities

The SDK has stateful conversations, text/tool streams, custom Python tools and MCP integration. Session restoration uses explicit conversation identity and storage paths; identifiers have documented format restrictions. Hooks expose turn/tool failures and usage metadata. These map well to persisted task chat and configuration provenance. Sources: [SDK repository overview](https://github.com/google-antigravity/antigravity-sdk-python), [lifecycle/persistence guide](https://www.antigravity.google/docs/sdk/lifecycle/).

The [policy interface](https://www.antigravity.google/docs/sdk/policies/) supports allow/deny/ask handlers, making it a candidate for an actual desktop approval queue. The [subagent interface](https://www.antigravity.google/docs/sdk/subagents/) supports dynamic and configured subagents. Proposal: keep provider subagents subordinate to an Orchestra attempt, expose their identities/events, and leave task admission, budgets and DAG ownership in Orchestra. SDK delegation alone does not prove supervised orchestration or safe permission inheritance.

The [local-model interface](https://www.antigravity.google/docs/sdk/local-models/) supports LiteRT and external local OpenAI-compatible endpoints. That is useful for the model-independent direction, but does not establish arbitrary hosted provider or subscription compatibility. Test each endpoint/model/policy combination separately.

### Limits that affect implementation

- CLI streamed stdin currently rejects control request/response messages and accepts text blocks only. Headless tool approvals can be denied while the process still exits successfully. Session usage counters are cumulative. Therefore a CLI adapter cannot claim interactive approvals, rich attachments or completed task effects from exit code alone. [Headless documentation](https://www.antigravity.google/docs/cli/headless/).
- SDK cancellation sends a halt request. Our adapter must observe settlement and apply bounded teardown when the process/transport fails; issuing cancel is not proof that tools stopped. [Pinned cancellation implementation](https://github.com/google-antigravity/antigravity-sdk-python/blob/12f9a4c3becf487302dc799b0f59054f01f3ddb9/google/antigravity/connections/local/local_connection.py).
- Inspected SDK code warns when requested OS command sandboxing is unavailable; it does not establish a fail-closed execution guarantee. Orchestra must reject an unmet required sandbox capability before allowing tool execution. [Pinned sandbox tests](https://github.com/google-antigravity/antigravity-sdk-python/blob/12f9a4c3becf487302dc799b0f59054f01f3ddb9/google/antigravity/connections/local/local_connection_test.py).
- One SDK conversation serializes turns; do not model it as concurrent workers. Proposal: separate conversation/process/workspace scopes for independent runs, with concurrency admitted and observed by Orchestra. [Pinned conversation implementation](https://github.com/google-antigravity/antigravity-sdk-python/blob/12f9a4c3becf487302dc799b0f59054f01f3ddb9/google/antigravity/conversation/conversation.py).
- The managed API runs in hosted Linux environments with their own IDs; background operations can be polled/canceled. It does not operate a local Windows worktree simply by selecting Antigravity. [Managed agent environment/lifecycle guide](https://ai.google.dev/gemini-api/docs/antigravity-agent).

## Reference patterns and repository gaps

Re-inspected T3's pinned [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts): session/thread/turn/request identities, typed runtime policy, terminal outcomes and explicit unsupported steering. Proposed adaptation: both CLI and SDK implementations satisfy a shared typed capability/session boundary; the desktop receives normalized events rather than transport details.

Re-inspected Orca's pinned [mutation-request.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.ts): retry identity is reused and uncertain delivery retains recovery context. Proposed adaptation: persist a dispatch/request receipt before sending a turn. Do not blindly retry after a broken pipe if the provider may already have accepted it. This concerns Orchestra delivery, even if the provider lacks native idempotency support.

In current Orchestra, `TurnRequest` has workspace/prompt/AutoApprove but no typed model/effort, provider conversation identity or approval-response channel. `Runner.RunTurn` returns an exit code and text; provider outcomes need a stronger contract. Studio draft model/turn values exist separately. Adding an `agy` command string alone cannot satisfy the requested chat or task configuration behavior.

## Decision and next experiments

Proposed integration boundary: Electron chat/Kanban → Go command/session service → capability-selected adapter. The [ACP research and executable sequence](antigravity-acp-research-2026-10-03.md) now take priority for the richer native-chat interface, following T3's actual provider pattern. CLI/Python remain alternatives, and cloud execution retains distinct remote environment identity. No additional scheduler belongs inside these adapter processes.

Before selecting a production implementation:

1. Run the preferred [ACP acquisition/discovery/login/turn acceptance sequence](antigravity-acp-research-2026-10-03.md) in isolated state. CLI remains an alternative experiment: capture a harmless turn, explicit resume and multi-turn streaming; verify authentication/model metadata, denial, cumulative usage and invalid-model failure.
2. Evaluate SDK 0.1.20 in an isolated Python environment when a supported API/Cloud authentication mode is available. Verify Windows runtime launch, ask/deny approval callbacks, cancellation, restart restoration and effective workspace/model/policy.
3. Run two independent sessions with different models/configurations; inject process/pipe failure around submission, approval and settlement. Verify no cross-task context, duplicate work or orphaned processes.
4. Compare features and deployment/auth costs after those traces exist. Keep unsupported native chat features visible in the capability matrix.
5. Implement the selected adapter through packages 02/03/C1 and then earn task/PR lifecycle evidence. Follow the [executable integration plan](../superpowers/plans/ade-2026-10-03/antigravity-adapter.md).

Research confirms suitable official interfaces. Their reliability in Orchestra remains unverified.
