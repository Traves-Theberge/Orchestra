# Workspace chat backend handoff — 2026-10-04

## Reference gate

Inspected both pinned references before implementation. No source code or assets copied.

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) separates app conversations, provider sessions/threads/turns, typed messages, terminal events, policies and runtime requests. [ProviderSelectionTransition.test.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderSelectionTransition.test.ts) checks capability-dependent selection rejection. Adaptation: project-scoped durable conversation identity, explicit delivery states and pre-dispatch capability validation. Deviation: Orchestra's existing adapters start fresh turns, so this slice explicitly reports transcript replay and no native resume; it does not advertise T3's interactive requests, attachments, steering, model switching or native thread continuity.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected [journal-dispatch-observation.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.ts), its adjacent test, and `agent-model-catalog/agent-project-model-override.ts` plus its adjacent test from the cached pinned settings reference. Journal observations distinguish dispatch states in an execution fence; workspace configuration can invalidate an account-default model claim. Adaptation: client message identity is stored before dispatch; duplicates never execute again; restart marks incomplete delivery unknown; configured provider presence is not verified login or observed model. Deviation: local SQLite ownership and explicit project path authority; no provider-item receipt or execution-fence reconciliation yet.

Reference runtime behavior was not exercised during this backend slice. Source and reference tests do not establish Orchestra reliability.

## Executable contract

Authenticated routes under `/api/v1/projects/{project_id}/chat`:

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/providers` | `{providers}`: configured Codex, Claude Code, OpenCode; local capability validation; `conversation_mode: transcript_replay`, `provider_resume: false`. No Gemini entry. |
| GET | `/sessions` | `{sessions}` for exactly the selected project. |
| POST | `/sessions` | `{provider,title?}` creates metadata only, returning a session (201). |
| GET | `/sessions/{session_id}` | `{session,messages}` persisted history, scoped to project and conversation. |
| POST | `/sessions/{session_id}/messages` | `{client_message_id,text,requested_model?,requested_max_turns?}` validates before effects, stores acceptance and starts one async local turn; returns `{session,message}` (202). |
| POST | `/sessions/{session_id}/stop` | Cancels owned current turn; returns `{session}`; no branch/worktree/file cleanup. |

`accepted` means Orchestra stored the submission, not proof the provider received it. Duplicate identity with the same text returns the original message; conflicting text is rejected. A fresh identity while any conversation in the same project is running/stopping returns 409: these conversations share one checkout and cannot silently launch concurrent agents there. Durable running/stopping ownership also blocks if no local process is known. Different project checkouts remain independent. Unsupported model/turn-budget requests return 422 before a message is written or a runner starts. History is bounded to 64 KiB of replay text; full conversations require a new conversation. There is no silent compaction or truncation of replay context.

Each turn has a ten-minute context independent of the HTTP request. App shutdown cancels owned turns and waits for terminal persistence. Restart never retries accepted messages: their state becomes unknown and sessions interrupted. Finalization is transactional; failed persistence logs the session identity and attempts unknown/interrupted recovery. If SQLite remains unavailable, persisted running/stopping continues to block further dispatch until recovery/restart.

The working directory is the selected registered canonical project root, revalidated against configured project roots. Arbitrary `cwd`, worktree paths, commands and unknown JSON fields are rejected. Root-based CLI turns explicitly opt into `ProjectRootWorkspace`, whose adapter guard accepts only equality with the canonical authorized root. Task/worktree turns retain existing descendant validation. The root is never broadened to its parent.

## Files and ownership

- `internal/workspacechat/service.go`, `service_test.go`: durable metadata/history, replay, lifecycle and validation.
- `internal/api/workspace_chat.go`, `workspace_chat_test.go`: typed HTTP routes, strict bodies and errors.
- `internal/api/router.go`: optional chat dependency preserves existing constructor call sites; authenticated route registration.
- `internal/app/run.go`: schema initialization and ordered service close before warehouse close.
- `internal/agents/types.go`, `workspace_guard.go`, `workspace_guard_test.go`, `codex_appserver.go`, `command_runner.go`: explicit exact project-root adapter validation. Existing generic task command runner warning behavior is unchanged; project-root chat failures reject execution.

Frontend removal/replacement of the embedded Maestro widget is owned by the coordinating agent, not this backend handoff.

## Verification

- Native Windows `go test ./internal/workspacechat ./internal/api -run TestWorkspaceChat -count=1`: passed. Service tests cover scoped identity, history replay, duplicate/conflicting submissions, unsupported selections before persistence, busy rejection, cancellation/file retention, unknown restart recovery, project-root authority and transactional persistence failure.
- The HTTP test uses a real loopback listener, normal router/auth middleware, SQLite and a deterministic fixture runner. It verifies authentication, capability listing, rejected arbitrary cwd/unsupported provider/model, create/send/poll/history and idempotent replay. It invokes no installed provider and no account files.
- `go vet ./internal/workspacechat ./internal/api ./internal/agents`: passed.
- `go build -o dist/orchestra/orchestrad.exe ./cmd/orchestrad`: passed.
- Native app test execution was blocked by Windows Application Control. No bypass or test executable relocation was attempted.
- Fresh Docker test target built from current source, final image `sha256:9dccbe77d16fea4a6840fbd146f4822311e5afcf2846373f1935a4f59c3757cb`: `docker run --rm --network none --entrypoint go orchestra-backend-test:workspace-chat-20261004 test -race ./internal/workspacechat ./internal/api ./internal/agents -run 'TestWorkspaceChat|TestProjectRootWorkspaceGuard' -count=1` passed all three packages, including persistence-failure and cross-session project-ownership scenarios. This Linux fixture boundary evidence does not claim a Windows/native-provider run.

## Remaining limits

This is the backend transport foundation, not complete C1. No live provider execution, signed-in readiness, true provider resume, interactive approval/question response, attachments, task-worktree placement, streaming projection or native chat E2E has been established. Structured assistant output is extracted from terminal result events; raw wire JSON is not displayed. Plain CLI output remains plain output and may include diagnostics. Missing terminal text does not fabricate an assistant answer. Kanban task state and PR completion are untouched.

Provider processes can modify the selected checkout according to their existing command/configuration. Cancellation retains those modifications. Conversation persistence is app-owned SQLite, not provider-native conversation storage. A single backend owns the chat service; cross-process dispatch leasing is not implemented. Project chat ownership serializes chat sessions on the same checkout. A shared checkout lease across chat, task runs, terminals and external applications remains required; task execution usually uses separate worktrees, but a task or external agent operating on the main checkout is not observed by this slice.

## Durable archive lifecycle follow-up (2026-10-04)

The archive change preserves conversation/session rows and all messages, provider events, and runtime requests. It writes only `workspace_chat_lifecycle(session_id, archived_at, version)`, so archive state is durable across SQLite close/reopen and independent of global provider/agent definitions. The normal live-checkout session list hides archived rows; `include_archived=true` is available only for an explicitly scoped live checkout. Project history discovery is metadata-only at `GET /chat/archives`; exact history reads use `GET /chat/sessions/{session_id}/history?workspace_id=…&cwd=…`. The project history catalog and history read do not resolve or read the checkout path, keeping retained transcript history available after a linked worktree is removed. Restore and archive mutations still require a live exact checkout plus expected status and lifecycle version.

Authenticated project routes added:

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/chat/archives` | Project-authorized archive metadata catalog; optional `workspace_id` and `cwd` filters must be supplied together for exact scope. Reads SQLite only. |
| GET | `/chat/sessions/{session_id}/history` | Archived detail/messages/events/runtime requests, matched to exact stored project, workspace ID, and cwd; reads SQLite only. |
| POST | `/chat/sessions/{session_id}/archive` | Requires `{workspace_id,cwd,expected_status,expected_version}`; rejects active or uncertain delivery and pending/unknown worktree removal. |
| POST | `/chat/sessions/{session_id}/unarchive` | Same optimistic and live-checkout checks; restores the existing session row. |

For `Create`, accepted `Send`, active `Stop`, `Archive`, and `Unarchive`, the service checks the removal receipt table inside the mutation transaction. A matching `pending` or `unknown` receipt fences the mutation by exact project/workspace and receipt path. This closes the race where worktree removal persists its intent before its final busy check. Archive itself rejects running/stopping/unknown sessions and accepted/unknown user messages or pending/sending/unknown runtime requests. Expected status plus lifecycle version are compared before the soft-delete row changes.

Reference receipt for this follow-up: T3 Code at `737993303d36e10674c54b95e5bd3826682c99c7`, `packages/client-runtime/src/state/threadArchive.ts`, its adjacent `threadArchive.test.ts`, `packages/client-runtime/src/state/threadCommands.ts`, and `packages/client-runtime/src/state/archivedThreads.ts`. The observed design uses explicit archived timestamps and a separate history projection; its archive guard consults runtime status, and lifecycle commands have a per-thread serial scheduler. Orchestra adopts the separation between active list and explicit archive history, but uses a SQLite versioned soft-delete row and transaction checks instead of in-memory optimistic reducers/snapshots. Orchestra is stricter about uncertain native dispatch (`accepted`, `unknown`, `pending`, `sending`) and must preserve history after a filesystem checkout disappears, so archive-history reads bind from stored project/workspace/cwd metadata without filesystem access. T3's queued/waiting edge cases do not transfer directly to this native project-chat lifecycle.

Orca at `3284b4c70c901402831bb4ccc5576ea083d2e5ae` was checked through its pinned native-chat source registry. No matching durable conversation archive/unarchive lifecycle was found in the inspected pinned native-chat source paths; its relevant `agent-session-journal` observation test instead distinguishes pending, accepted, and unknown dispatch inside a fence. Orchestra adopts that conservative uncertainty boundary and intentionally implements archive state independently in SQLite. Neither reference was run as a live app for this lifecycle change; their code/tests are design references, not Orchestra reliability evidence.

Behavioral verification: `TestArchiveSurvivesRemovedWorktreeAndDatabaseRestart` uses a real temporary Git linked worktree and on-disk SQLite to verify transcript retention, default hiding, exact-scope history, restart persistence, history reads after checkout deletion, restore rejection while absent, and successful restore only after the checkout returns. `TestArchiveRejectsPendingRemovalFence` verifies running and uncertain sessions cannot be archived and that Create, Send, active Stop, and Archive are fenced by pending removal intent. The authenticated HTTP `TestWorkspaceChatHTTPRoutes` exercises archive, default list filtering, project metadata discovery, exact history read, and restore. Native Windows `go test ./internal/workspacechat -count=1` and `go test ./internal/api -count=1` passed. These tests use deterministic fixture providers; no external provider was started.
