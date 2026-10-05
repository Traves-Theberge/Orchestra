# Antigravity catalog and native-session handoff

Date: 2026-10-04. This adds documented Antigravity CLI profile/skill discovery and hash-guarded authoring plus a native stream-json session adapter. Fixture tests do not establish signed-in runtime reliability, custom-agent application, or real provider behavior.

## Installed CLI evidence and containment gate

Read-only local probes:

```text
C:\Users\trave\AppData\Local\agy\bin\agy.exe --version
1.2.16
```

`--help` advertises `--agent`, `--mode (accept-edits|plan)`, `--model`, `--effort`, `--input-format stream-json`, `--output-format stream-json`, `--conversation`, and `--sandbox`. It documents newline-delimited user messages for a persistent process and exact conversation-ID resume. No ACP server option or subcommand appears in local help. The existing `antigravity_acp.go` remains an unwired synthetic ACP transport and is not connected to this runner.

The installed profile/skill file listing gate was attempted before any credential operation. A unique profile was written only beneath a disposable `%TEMP%` profile root, all home/config environment variables were redirected there, and `agy agent` / `agy agents` were invoked with and without a PTY. Both commands exited 0 without listing any profiles. Official docs describe `/agents` as an interactive TUI panel and do not document a read-only machine-readable list command. The adapter therefore does not claim that the native CLI honored the isolated profile root. No credential content was read or copied; no real provider turn ran; no global provider config was written. The profile-selection canary remains blocked at this containment gate.

Read-only directory metadata showed these files/locations exist in the normal user profile: `.gemini/oauth_creds.json`, `.gemini/google_accounts.json`, `.gemini/settings.json`, and Antigravity CLI directories. Their contents were not read, and no before/after hash was collected. No evidence was gathered that those exact files alone are sufficient for isolated auth.

## Official format and capability findings

Google's [CLI headless documentation](https://www.antigravity.google/docs/cli/headless/) documents NDJSON `init`, `step_update`, and `result` records; `conversation_id` is returned at initialization and terminal result. It documents persistent stream-json input with one result per user message and a separate process using `--conversation <id>` for resumption. The `result.num_turns` field is documented as the number of user turns in the conversation. The adapter requires this counter to advance exactly once for the active turn, persists its baseline in SQLite, and rejects results with missing, stale, duplicate, or skipped counts. The `init` event can report configured `agent`, `model`, `cwd`, tools, and permission mode. In headless mode, approval-requiring actions are soft-denied according to policy; workspace file access is allowed by default, and the `--dangerously-skip-permissions` flag switches to always-proceed. This adapter never supplies that flag.

The [Agents CLI documentation](https://www.antigravity.google/docs/cli/commands/agents/) documents workspace profiles at `.agents/agents/<name>.md` or `.agents/agents/<name>/agent.md`, and global profiles at `~/.gemini/config/agents/<name>/agent.md`. A sample requires YAML `name` and `description`. The [custom subagent reference](https://www.antigravity.google/docs/subagents/) shows role metadata such as `subagent: true` and `mainAgent: false`; the catalog preserves the complete native text, summarizes those fields as profile role metadata, and does not equate execution mode (`--mode`) with agent role. The docs also say custom profiles can be selected as primary in the interactive `/agents` panel; this does not prove CLI `--agent` applied a custom profile in Orchestra.

The [Antigravity CLI skills documentation](https://www.antigravity.google/docs/skills?tab=ide) gives CLI locations `.agents/skills/<skill-folder>/` and `~/.gemini/antigravity-cli/skills/<skill-folder>/`. The implementation uses those CLI locations, distinct from IDE global skills.

The [Antigravity SDK](https://www.antigravity.google/docs/sdk/overview) is a separate Python runtime/auth surface. This implementation does not substitute it for the installed CLI or infer that SDK sessions and CLI conversation IDs interoperate.

## Orchestra implementation

- `internal/agentcatalog/catalog.go` now discovers and writes AGY agent definitions and `SKILL.md` resources only in the documented CLI roots. Profile and skill IDs stay namespaced under `ANTIGRAVITY`, separate from `GEMINI`. CRUD is scoped to the selected project checkout or global user profile, uses stable mutation receipts and expected-content hashes, rejects symlinks/path traversal, preserves raw frontmatter/unknown metadata, and does not modify provider account/settings files.
- Antigravity profile role flags are reflected separately from agent identity. Skills are not primary-agent profiles. Selection remains `configured_unapplied` when AGY is configured; primary selection stays disabled until a real isolated canary proves the effect. A profile listing no-op is a containment gate failure, not evidence that AGY profile discovery is unsupported.
- `internal/agents/antigravity_native.go` launches the configured executable directly with fixed stream-json flags, a selected working directory, and no inherited command flags. It supports one initialized conversation, multiple user-message turns on that process, and explicit `--conversation` resume. It validates the runtime-reported working directory and conversation identity, persists NDJSON events through the native session contract, and rejects unsupported interactive request replies. It does not translate `--mode` into agent role or auto-approve tools.
- Cancellation requests termination of the local CLI process, but there is no documented in-band cancel method. This does not confirm that child processes or provider work have ended. The turn result remains unknown after cancellation; no external tool-effect settlement is claimed. Headless soft-denials are controlled by AGY's own policy and are not presented as Orchestra approval requests.
- `ProviderAntigravity` and the independent `ORCHESTRA_NATIVE_COMMAND_ANTIGRAVITY` setting wire the adapter as a distinct provider. The native adapter is registered, but registration and synthetic protocol tests do not establish authentication, successful model access, output correctness, or effective named-agent application.

## Reference receipt

T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: inspected [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts). It represents app thread, provider session/thread/turn/run and runtime request as distinct typed identities, and has explicit errors for open, resume, turn start, interruption, request response, and event-stream failure. Orchestra adapts the identity and terminal boundaries to one native conversation ID, local turn IDs, raw event payloads, and a non-replayed unknown outcome. Deliberate deviation: no T3 `Effect` runtime or ACP semantics are reused for the CLI; CLI headless denial/stream behavior follows Google's docs and local help.

Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected [journal-dispatch-observation.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.test.ts), where observations are scoped to a submission fence and distinguish `unknown`, `pending`, and `accepted`. Orchestra adapts the fail-closed identity and unknown-outcome boundary; its SQLite workspacechat journal remains the durable authority. Deliberate deviation: AGY does not expose a CLI mutation receipt or cancellation settlement, so the adapter reports unknown after process loss rather than treating local termination as provider rejection or completion.

No runnable T3 or Orca application was exercised. Their source tests were inspected, not executed. The pinned references have no relevant Antigravity stream-json CLI implementation; no relevant pattern is claimed there. Google documentation and local CLI help supply AGY semantics. Orchestra's subprocess fixture is independent code and does not copy reference implementation.

## Behavioral verification and remaining evidence

Synthetic process tests use the real Go native-session boundary and a helper process that speaks the documented NDJSON shapes. They cover two turns in one process, exact conversation-ID resume with a cumulative baseline, runtime cwd/conversation fences, reported profile and request-review fields, and refusal to fabricate interactive request replies. Separate cases reject a result without an active turn and stale, duplicate, skipped, missing, or mismatched native identities. A workspace-chat SQLite restart fixture verifies that the next native process receives the last persisted cumulative counter. The absolute Windows executable-path test covers a quoted path with spaces; the production launcher passes fixed arguments directly without a login shell.

Workspace chat rejects a known model change on an existing Antigravity conversation and unsupported effort requests before recording a submission. Its regression test verifies that no additional prompt or message is created and the observed model and idle state remain intact. The repository Orchestra CLI skill and its embedded Maestro copy include the distinct ANTIGRAVITY catalog value and preserve the authoring-versus-effective-selection distinction; skill validation and bundle equality checks pass.

Commands run from `apps/backend`:

```text
go test ./internal/agentcatalog ./internal/agents ./internal/config ./internal/workspacechat ./internal/api -count=1
PASS
```

The isolated CLI list command emitted no profile names, so no credentials were copied and no provider turn or agent-selection canary ran. Real session startup, auth isolation, provider continuity after process restart, cancellation settlement, custom profile loading, effective `--agent` selection, model/effort/mode application, and actual tool soft-denials remain unverified. Agent selection stays disabled until those specific effects are observed independently.
