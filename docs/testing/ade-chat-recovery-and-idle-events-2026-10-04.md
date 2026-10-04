# Chat recovery, encoded requests, and idle observations

## Reference patterns and adaptation

Both pinned references apply: T3 `737993303d36e10674c54b95e5bd3826682c99c7` normalizes and persists app-facing draft/thread identities and accumulates token observations separately from terminal-turn state; Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae` binds drafts to stable pane ownership and distinguishes accepted/unknown delivery and duplicate/stale usage snapshots. Exact inspected source paths and source behavior are in the [UI handoff](ade-native-chat-ui-2026-10-04.md), [adapter handoff](ade-codex-native-session-handoff-2026-10-04.md), and [service handoff](ade-native-workspace-service-2026-10-04.md). No reference runtime was exercised. These patterns do not certify Orchestra.

Orchestra now restores scoped drafts and uncertain operation identities without automatic mutation replay. Storage keys hash backend URL, configured account token and project ID; raw configured credentials are not stored in draft receipts. Active idle chat observation runs every five seconds, running observation every second, and inactive workspace observation pauses while retaining state. Resume fetches immediately. This remains polling/full snapshots rather than T3's reactive transport or paginated history.

Native callbacks now belong to the session lifetime rather than a SendTurn waiter. Late usage retains its original turn ID and persists while idle; foreign/stale events cannot be reassigned to a newer turn. Completion and resolution retire exact pending requests, including late approvals for already completed turns. Shutdown closes the provider then drains queued observations outside service mutexes before SQLite teardown. Already-read protocol frames can drain; unread OS-pipe bytes after forced termination remain outside this guarantee. A bounded known-turn horizon is explicit in the adapter handoff.

## Second real HTTP boundary defect

The isolated UI canary's Allow once POST returned 404 although its request remained pending in SQLite. The desktop correctly percent-encoded the opaque provider request ID, including its incarnation prefix and quoted provider JSON-RPC ID. Chi routes match RawPath when present, so the handler was comparing an encoded segment with the stored unencoded request ID.

The reply handler now PathUnescapes once only when RawPath is present. It does not repeatedly decode literal percent sequences. The HTTP regression sends a request ID containing quotes, an encoded slash, a literal `%3A`, spaces, plus and question mark; scoped validation, successful reply and idempotency pass through the actual router. Root API ownership was separate from the service/adapter changes.

## Independent isolated UI canary

Reusable command: `cd apps/desktop && npm run audit:chat:fixture`. The launcher refuses an occupied 4010, owns its child backend, provisions a separate temporary home/data/project, scrubs provider routing/credential environment overrides, and selects the deterministic Node protocol fixture. It uses the existing browser dev-mode endpoint/token. It does not replace the user's managed backend at 4014. Fixture commands shown in approval cards do not execute a shell or modify a project. No signed-in native provider was used for these chat turns.

The production UI ran in the T3 collaborative browser with actual HTTP requests, SQLite persistence and the normal native adapter. No fetch/API mocks or captured response replay were installed:

- First Send created a caller-known conversation and sent a native turn. An approval card appeared from the fixture's JSON-RPC request. Allow once initially exposed the encoded-ID defect, then succeeded after the handler fix. The fixture observed `accept`; the persisted request became answered.
- A second waiting turn streamed text. The UI Stop control interrupted it and persisted cancelled output. A follow-up completed on the same provider thread. [Captured persisted detail](evidence/ade-native-chat-2026-10-04/isolated-ui-fixture-chat.json).
- Typed an unsent draft, reloaded the renderer, reopened the same project and observed the original selected conversation and exact unsent text. No Send was clicked on reload. [Screenshot](evidence/ade-native-chat-2026-10-04/isolated-ui-followup-reload.png).
- With the final native build, the fixture delayed usage until after terminal completion. SQLite recorded terminal event sequence 25 and usage sequence 26 with the same turn ID while idle. The visible cumulative counter changed from the baseline 22 to 44 tokens without manual refresh or another turn. [Persisted delayed-usage detail](evidence/ade-native-chat-2026-10-04/isolated-ui-late-usage-final.json). This is transport/UI observation evidence, not real model accounting or subscription cost evidence.

The first blocked fixture request became unknown during the deliberately owned backend restart; that was not automatically answered or retried. A fresh canary conversation exercised the corrected route.

## Verification and limits

Final focused desktop storage/API/chat/layout run: 59 tests passed. Typecheck and production build passed; existing large-chunk warning remains. Docker race checks for agents/workspacechat/API Native, Late, WorkspaceChat and Close cases passed with current source. Service shutdown persistence test and adapter idle burst/reentrant callback tests are covered independently. Windows native build and scoped vet passed. Earlier full renderer suite had 543 passed/two skipped before these additions; it is not represented as a new full-suite run.

Electron draft receipts now use profile localStorage; browser receipts remain tab-scoped. Existing Electron sessionStorage receipts migrate before removal, and migration/storage failures preserve the old receipt. Storage tests cover migration, restoration, scope and failure handling. Before relaunch, the actual desktop profile contained a valid durable receipt with no unsent drafts or uncertain mutations, and both stored conversations were idle. The owned app was restarted using the same profile and current-provider context. At 22:03 UTC, AUDIT_READY confirmed renderer mounting and authenticated state; the backend on 4014 had the same binary hash as the newly built source executable, and both conversation identities remained present. The isolated fixture backend was stopped. This restart checked an empty durable receipt; a non-empty draft surviving a full Electron restart remains a separate gate, beyond the demonstrated browser reload and storage tests.

Fixtures and renderer reload evidence do not establish live Electron approval/inference, signed-in provider isolation, native support for other providers, task/worktree ownership, attachments, steering, plan mode or bounded-history performance. Those gates remain open. Account-connected coding canaries remain paused under the [trust diagnostic](ade-codex-provider-trust-diagnostic-2026-10-04.md).
