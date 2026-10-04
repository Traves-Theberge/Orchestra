# Native workspace chat integration receipt

## Scope and references

T3 Code `737993303d36e10674c54b95e5bd3826682c99c7` and Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae` were considered in the adapter/service/UI/settings/usage handoffs. Native provider thread/turn/request ownership, catalog ambiguity, durable delivery receipts and separately observed effective settings were adapted to Orchestra's Go/SQLite and Kanban boundaries. See [adapter](ade-codex-native-session-handoff-2026-10-04.md), [service](ade-native-workspace-service-2026-10-04.md), [chat UI](ade-native-chat-ui-2026-10-04.md), [settings](ade-settings-native-scope-2026-10-04.md), [usage](ade-usage-ui-2026-10-04.md) and [settings/usage execution plan](../superpowers/plans/ade-2026-10-03/settings-and-usage.md). Current [official Codex app-server documentation](https://learn.chatgpt.com/docs/app-server) and installed CLI 0.160.0 generated schema informed protocol implementation.

## Independent real-provider evidence

[Installed transport canary](evidence/ade-native-chat-2026-10-04/installed-codex-canary.json): initialized the installed signed-in Codex app-server; observed account availability and eight catalog models; started one read-only thread; completed two text turns with earlier-marker recall. Usage notifications were observed for both turns. This is installed transport evidence, not Orchestra E2E.

[Orchestra HTTP canary](evidence/ade-native-chat-2026-10-04/orchestra-http-canary.json): launched the newly built native Go backend at an authenticated distinct loopback endpoint, with a dedicated scratch Git repository/database and process-only read-only/never approval overrides. Catalog reads returned eight models without creating conversations. Submitted two messages through Orchestra's chat HTTP API, polled durable events/assistant results, and verified marker recall on the same provider thread. Terminated only that owned backend process tree, restarted against its database, sent a third message with explicit requested model `gpt-6.1-sol`, and verified the same provider-thread identity, observed effective model, earlier-marker recall and persisted usage/events. No file-changing or tool requests were asked for. Checked Claude settings/instructions, Gemini settings and Codex config file hashes were unchanged before/after each canary.

[Orchestra coding canary](evidence/ade-native-chat-2026-10-04/orchestra-code-canary.json): in the dedicated scratch repository, Codex read a broken addition function and its tests, changed subtraction to addition, and ran the tests. A second turn revised the same function to handle numeric strings. Independent Node test runs passed after both edits; the actual file contained `Number(a) + Number(b)`. After backend restart, a third turn recalled the initial marker on the same provider thread. Tool, file-change and usage events persisted. This exercised HTTP/SQLite/native-provider coding, not Electron interaction or approval prompts; process-only overrides selected workspace-write and never approvals.

The coding canary's settings hash check failed for Codex config; the checked Claude/Gemini files remained unchanged. Installed Codex 0.160.0 has an automatic project-trust writer matching the observed writable sandbox and new scratch-project trust entry. That is a source-backed explanation, not exclusive forensic attribution or proof that no other config keys changed. No assumed backup was restored. Further automated account-connected coding tests are paused pending a separately authenticated isolated provider profile. See the [diagnostic and isolation strategy](ade-codex-provider-trust-diagnostic-2026-10-04.md). The earlier read-only canaries' unchanged hashes do not establish safety for writable sessions.

Native provider chat now has actual multi-turn editing, revision and restart continuity evidence for Codex. Approval/question/interrupt/EOF/request-idempotency boundaries remain fixture-tested. Catalog metadata is an observation, not proof of access to every listed model. Other providers retain explicit transcript replay; no Antigravity native support claim is made.

## Validation

- Full backend `go test ./...` passed in the isolated Docker test image with current source mounted read-only after native command wiring.
- Final focused Docker race tests passed for agents, config, workspacechat, API and app after reasoning-effort integration (API package 90.1 seconds).
- Full desktop suite: 78 files, 526 passed, two skipped before catalog selection; final focused settings/chat/workspace/usage run: eight files, 45 tests passed after T3-style layout, reasoning effort and typed preaccept rejection changes.
- TypeScript typecheck and production Vite build passed after those final UI changes. Existing large-chunk build warning remains.
- Managed-backend ownership tests: 16 passed. Launcher scripts pass syntax checks. `--smoke --current-provider-context` is rejected before launching children.
- Orchestra CLI skill updated in repository and installed copy to distinguish native conversations, task identity and imported log versus native usage; skill validator passed.

Windows Application Control intermittently rejects generated Go test executables. Docker race/full tests were used transparently; no policy bypass was attempted.

## Local audit availability and ownership

Latest app relaunched with `npm run audit:dev -- --current-provider-context`. Native Electron readiness verified renderer mount and authenticated state against its owned latest backend at `http://127.0.0.1:4014`; Vite remains on 5174. Existing dedicated Orchestra audit database/project registration remains intact, while provider processes use the current user's CLI home/account configuration. Native catalog was independently fetched from that managed backend. This mode is explicitly for user interaction and cannot run automated smoke tests. Default `audit:dev` and smoke continue isolating provider HOME/USERPROFILE/APPDATA/LOCALAPPDATA and clearing inherited provider-account paths. Native global configuration edits in current-provider mode target the user's actual account files; they are not Orchestra-only preferences. No account restoration or Orchestra configuration-write RPC was performed. Provider-managed automatic project-trust writes can still affect the selected account home, as the coding canary demonstrated.

Create a new Codex conversation in the Orchestra workspace to use native sessions. Existing replay conversations are deliberately not silently upgraded because their history belongs to a different provider-session model.

## Remaining gates

Real Electron send/approval/question/interrupt/reconnect interaction; isolated account-connected writable canaries; long-history pagination/bounded output UI; scoped permissions/runtime editing beyond inherited provider policy; task-owned worktree attachment; attachments/context, steering/queueing and plan controls; coordinator tools/shared Kanban/CLI run controls; deduplicated task/workspace usage attribution including imported logs/subagents; verified native adapters for additional providers. These keep full C1/C2 release gates open. Reference patterns, passing unit tests and the coding canary do not establish every ADE capability's E2E reliability.

## T3-style visual review

The actual persisted coding-canary messages/events were rendered in the collaborative browser using the production WorkspaceChat component. Mutations were disabled and the surface explicitly labeled as captured UI replay. Reviewed the constrained conversation lane, expanded command output, ordered tool cards, Markdown responses, anchored composer and Latest navigation. [Saved screenshot](evidence/ade-native-chat-2026-10-04/native-chat-t3-style.png). This is browser visual evidence with captured real data, not a live Electron provider interaction. See the UI handoff for reference paths, keyboard/draft controls and deliberate functional gaps.
