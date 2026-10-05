# Pipeline harness and CLI contract evidence

## Required reference review

T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: inspected [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts). Its adapter separates runtime policy, capabilities, plans, runs, provider sessions and pending requests. A provider choice does not establish an effective sandbox. Orchestra adapts that boundary to stage capability checks and exact task context, retaining Kanban. This source does not define Orchestra's human plan approval gate.

Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected [mutation-request.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.ts). It retains a mutation identity during bounded retry and supplies recovery context when the outcome is uncertain. Orchestra uses one UUID receipt across UI, CLI and native tool controls, with exact project/task and expected plan fingerprints. It does not copy Orca's runtime or claim that a successful HTTP request proves agent execution. The inspected handler has no Orchestra Kanban planning gate.

## Harness inspection, not execution certification

All stages must obey the same provider-independent approval contracts. Native modes and CLI names are adapter details. These observations identify what must be verified; they do not certify live provider turns.

| Harness | Primary evidence inspected | Boundary requiring attention |
| --- | --- | --- |
| Codex | Installed `codex exec --help`; [non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode) | Explicit per-turn read-only sandbox; omit the configured execution bypass. External MCP and inherited settings require separate policy handling. |
| Claude | [CLI reference](https://code.claude.com/docs/en/cli-reference) | Use a restricted built-in tool set; this does not restrict MCP tools, which require separate denial. Plan mode alone is not an OS sandbox. Claude was not found on this session's PATH. |
| Gemini (historical inspection only) | Installed `gemini --help`; [plan mode](https://geminicli.com/docs/cli/plan-mode/) | Withdrawn from active harness selection at the user's request. Existing provider identities remain historical records; this inspection does not advertise an active stage adapter. |
| Antigravity | Installed `agy --help` | Exposes per-session plan mode and terminal sandbox flag. Independent permissions and inherited settings must be checked; request-review is not evidence of enforced read-only behavior. |
| OpenCode | [V2 permissions](https://opencode.ai/v2/docs/permissions/) | V2 uses permissions/shell/subagent, unlike V1. Plan-agent edit restrictions leave other tool boundaries to policy; version and effective configuration matter. Not found on this session's PATH. |
| OMP | Installed `omp --help`, v18.4.6 | Offers explicit tool whitelist and disabling LSP/PTY. Plan-YOLO explicitly auto-approves and is unsuitable for a human-held gate. Plugins and custom tools need their own restriction. |
| 8gent and arbitrary registered commands | Orchestra runner/config source | No verified per-turn stage isolation established by this inspection. Registration and streaming-output parsing are not stage capability evidence. |

No global provider settings were edited during this inspection. A missing capability must be visible and prevent dispatch, rather than silently selecting another harness or running the unrestricted execution command.

Gemini is rejected for new CLI task creation, assignment and review requests, and is removed from runnable catalog help. Antigravity uses its own registration, credentials and native session identity. Historical Gemini sessions and usage are not rewritten as Antigravity.

## CLI and skill slice

`task approve-plan` carries the exact returned hash and a canonical stable request UUID. `task replan` additionally requires observed state and nonempty feedback. Both route through the shared control service, rather than generic issue state PATCH. Human-readable task output includes the observed plan gate and hash. Maestro's maintained and bundled skills state that approval requires explicit human instruction for every harness; no agent result or request to repair the pipeline grants that approval.

CLI focused tests passed on 2026-10-05, including exact shared request bodies and rejection before HTTP for incomplete or guessed identities. Workspace-chat tests passed after synchronizing the native skill bundles. Backend dispatch, frontend confirmation, PR review and live harness behavior remain separate verification packages; this receipt does not certify those stages.

The rebuilt `apps/backend/dist/orchestra/orchestra.exe --help` advertises `approve-plan`, `replan`, `request-review`, `approve-review` and `complete-review`, and lists Antigravity instead of Gemini for resource commands. Focused CLI/control/workspace-chat tests pass, including rejection of Gemini task creation, assignment and review requests before HTTP. Both maintained Maestro skills pass the skill validator; bundled parity is covered by workspace-chat tests. This verification does not run a provider-authenticated Antigravity turn.

Tasks needing a plan expose `unsupported` with an observed reason when their configured harness lacks a reviewed read-only adapter. An Antigravity regression verifies that such a task creates no running or retrying attempt. The task UI shows that reason instead of claiming planning is running, and human-readable CLI output includes plan availability. Antigravity planning and review are still unavailable; registering it does not grant those capabilities.

The integrated backend suite passed after dispatch fixtures were updated to durable local approvals. The desktop suite passed 764 tests with two skips before the final availability-message and toolbar changes; those later changes require their own focused verification. A contained two-task fixture covers independent local dispatch, worker-only eligibility, Todo planning held for human approval, and approved execution. Historical NULL collections normalize to the same approval fingerprint as empty collections, preventing false context changes. These are fixture results, not live harness certification.

The final integrated `go test ./...` rerun passed, including the API, app, CLI, control, review gate and review pipeline packages. An isolated checkout of the staged commit passed desktop typecheck, 94 focused tests across task controls, workspace chat, the tools surface and harness setup, and the production build. ESLint on the staged UI files reported zero errors and 24 warnings. Further contract-review fixes to plan invalidation and hook configuration are verified in their package handoffs. Native Electron Backlog search passed; a physical drag/drop was not established by either available input driver, as recorded in the Backlog handoff.

Provider credential-home overrides are now selected per subprocess: Codex receives `CODEX_HOME`, Claude receives `CLAUDE_CONFIG_DIR`, and other providers receive neither override. Backend and GitHub token environment variables stay excluded. Persistent agent terminals reject reuse when their environment context changes. This adapts the provider-scoped runtime boundary observed in T3 and the project/account override boundaries observed in Orca; neither source establishes Orchestra's credential isolation. The focused agents/terminal suites cover synthetic home and token sentinels and environment signatures. The live PTY reuse fixture is skipped on Windows because ConPTY is unavailable. Environment filtering is not filesystem isolation: ordinary HOME and Windows profile paths remain inherited. Authentication, usage and a successful provider turn remain independent observations.

After the stop UI and terminal-capability changes, the final staged desktop snapshot passed typecheck, 97 focused tests and the production build. Stop confirmation retains task context and performs no second generic state/feedback PATCH. The full API rerun passed; subsequent focused regressions verify that the durable stop hold commits before cancellation and that failed persistence cannot silently cancel and later resume an approved task. The orchestrator/control/plangate suites cover same-feedback replanning, review-finding invalidation, generic state bypasses and unsupported remote planning. These results remain bounded fixture evidence.
