# Persistent global orchestrator and shared controls

## Reference receipt

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: inspected [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts). Its adapter contract distinguishes app thread, provider session/thread/turn and runtime requests, carries cwd and provider policy, and explicitly reports unsupported operations. Orchestra adopts separate durable conversation/provider-thread identities and honest native capability gating. It does not copy the Effect runtime or claim T3's complete run/node contract.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected [mutation-request.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.ts) and [journal-dispatch-observation.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.test.ts). The mutation wrapper retains request identity across retries and recovery errors; the journal tests distinguish accepted/pending/unknown submissions by fence and return no observation for missing submissions. Orchestra adopts durable request identity, unresolved-intent reconciliation and provider thread/turn fences. Deliberate difference: the control service never automatically replays an unresolved external mutation, even with the same request ID; identical confirmed requests return their recorded result.
- Neither reference application was launched for this slice. These sources/tests establish observed patterns, not Orchestra E2E reliability.

The installed `codex-cli 0.160.0` generated experimental app-server JSON schemas locally without provider inference. Inspected `ThreadStartParams`, `ThreadResumeParams`, `DynamicToolCallParams` and `DynamicToolCallResponse`: new threads accept `dynamicTools` function specifications, resume reuses the stored thread declarations, `item/tool/call` carries thread/turn/call/tool/arguments, and its response uses `success` plus `contentItems` with `inputText`. This implementation extends the actual interactive native adapter; the older batch author's tool callbacks are not treated as native-session proof.

## Implemented scope and controls

The reserved chat scope `__orchestrator__` is stored in the existing durable SQLite chat tables. It is not inserted into the project catalog. Its cwd is the owned `<WorkspaceRoot>/.orchestra/orchestrator` directory; existing ancestors are checked before creation to reject symlink escape. Per-project chat remains a separate scope and receives no cross-project control tools.

Authenticated routes reuse the existing chat suffixes under `/api/v1/orchestrator/chat`: providers, provider models, sessions, session detail/events, messages, stop and request replies. Conversation messages/events, provider thread identity and interrupted-delivery behavior retain existing durable machinery. Stopping this chat interrupts its turn and retains provider thread/workspace; it does not call destructive task stop.

Global provider availability additionally requires a native control-tool adapter. Currently that means Codex; other harnesses are disabled for this scope with a reason. Provider policy is inherited; no automatic approval, account-home redirection or account configuration edit was added. Model listing is an observation, not entitlement proof.

The shared `internal/control` service serves both the native `orchestra_control` tool and authenticated `/api/v1/orchestrator/control` CLI requests:

| Operation | Actual effect or observation |
| --- | --- |
| projects | Registered project IDs, names, roots and source types, with credential fields omitted |
| tasks | Selected project's exact task inventory; unavailable sources fail closed, mismatched returned task scope is rejected |
| worktrees | Authorized real Git worktree registry rows with exact paths, HEADs, branches and selected-checkout primary identity |
| status | Task orchestration snapshot, separate from chat activity |
| create | Creates a Backlog task in the selected source; no worktree or worker launch is asserted |
| queue | Conditionally changes a complete local SQLite task from Backlog to Todo and requests refresh; execution/worktree remain explicitly not observed |
| receipt | Reads the persisted request outcome without replaying the task mutation |

Mutation UUID plus canonical argument fingerprint is persisted before effects. Same identity/different arguments conflicts; confirmed identical requests return the receipt. Unconfirmed external effect or incomplete intent stays unresolved and is not automatically repeated. A confirmed preflight rejection is recorded as rejected. CLI requests never retry mutations automatically.

Queue's SQLite update checks task ID, project ID, Backlog and required metadata in the same statement, preventing a stale read from overwriting a newer state. Hosted queue is rejected until that adapter supplies an equivalent guarded transition. Hosted observation/create use the configured adapter; its actual identity and lifecycle support must be verified separately. Pause/stop/delete, task metadata editing/retry, project import, worktree creation/removal and PR mutations are unavailable control operations.

The Orchestra CLI skill and task-system reference were updated to executable help. New commands are `task create`, `task queue` and `control projects/tasks/worktrees/status/receipt`; legacy `task list/show` retain their documented source-routing limits. No planned command is advertised as operational.

## Independent behavioral evidence

- `TestGlobalOrchestratorNativeControlsPersistAndCLIReconciles` uses an authenticated real loopback API, real native harness subprocess, actual interactive dynamic-tool callback path and on-disk SQLite. It verifies owned control cwd, tool declaration and instruction registration, rejection of foreign-thread requests, one task after repeated create request identity, native queue effect, five persisted tool observations, CLI receipt reconciliation and actual CLI create/queue requests through the same service. It closes/reopens the database, recreates the chat service/router, verifies transcript/events/thread identity retention and no fake project, rejects project-scope access to the global conversation, then resumes the same provider thread through a new native process. Native fixture success is not model inference evidence.
- Control tests cover changed-payload identity rejection, persisted incomplete intent not replayed after service recreation, exact project/task scope, state preconditions, unsupported destructive operations and configured tracker failure without SQLite/global fallback.
- Shared worktree test provisions real Git primary/linked checkouts, verifies the registered linked checkout is primary despite Git row ordering, filters an outside allowed root, and rejects an unauthorized starting checkout. The workspace tree endpoint uses this same reader.
- CLI tests verify all new commands use the authenticated shared endpoint, preserve mutation identity, report structured failure and send exactly one request after an unknown outcome.
- Full affected-package native Windows tests passed: `control`, `workspacechat`, `agents`, `api`, `cli`, `cmd/orchestra`. The first full run recorded API 57.8 seconds and agents 21.1 seconds.
- Isolated Linux `go test -race` passed for all six affected packages; API 95.2 seconds. After adding shared worktree/CLI observations and actual database reopening, targeted race tests passed for control, CLI, workspace and global API paths. Final conditional-queue/native/actual-CLI control checks passed under the race detector too: control 2.438 seconds, API 1.814 seconds.
- `go run ./cmd/orchestra task create --help` successfully advertised the implemented syntax. `uv run --with pyyaml python -X utf8 .../quick_validate.py .codex/skills/orchestra-cli` passed. No global provider settings or credentials were modified for these fixtures.

Parent integration owns visible desktop verification and production build validation. This receipt does not establish live provider inference, automatic task-engine admission/worktree creation, hosted tracker execution parity, arbitrary worktree native chat, automation/DAG recovery, PR control, or trusted Windows signing. A persistent global conversation and durable control receipt are not a complete durable task run/attempt contract.
