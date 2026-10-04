# Terminal and central workspace reference audit — 2026-10-04

Status: read-only implementation audit and executable backlog. No terminal/UI code was changed and no reference application was run. Source tests were inspected, not executed. This receipt does not establish Orchestra E2E reliability.

## Pinned references inspected

T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`:

- [ThreadTerminalDrawer.tsx](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/ThreadTerminalDrawer.tsx) and adjacent `.test.ts`: thread/environment/worktree-scoped terminal panes, horizontal/vertical split groups, keyboard action labels, mount-inherited terminal colors, selection actions including adding context to chat, and output cursor synchronization. Tests cover inherited colors, selection menu ownership and exits arriving during surface loading.
- [Manager.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/terminal/Manager.ts) and adjacent `.test.ts`: composite thread/terminal identity, explicit open/attach/restart/close, bounded persisted history, worktree metadata, platform shell candidates and structured I/O failures. Inspected tests cover concurrent opens spawning once, attachment without restart, multiple terminals per thread, missing/invalid cwd, Unicode/chunk boundaries, bounded history, replay-unsafe sequences, shutdown escalation and worktree metadata.
- [NodePtyAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/terminal/NodePtyAdapter.ts): native `node-pty` boundary, Windows ConPTY environment/PID readiness, retained early exits, cancellation cleanup and Windows process-tree termination semantics. This is substantially more than selecting a different shell executable.
- [OutputProtocol.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/terminal/OutputProtocol.ts): bounded output acknowledgement window (8 chunks / 64 KiB threshold). [terminalSessions.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/state/terminalSessions.ts) indexes terminal metadata by environment and thread, with an all-terminal view.

Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`:

- [terminal-host-create-contract.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/daemon/terminal-host-create-contract.ts) and [terminal-host-session-create.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/daemon/terminal-host-session-create.ts): explicit create versus attach-only, shell/launch parameters, startup delivery, snapshots, incarnation and attach tokens. A terminating session must settle before recreation; attach-only cannot manufacture a new process after exit. Requested cwd readability is observed by the owning daemon before spawning.
- [orca-runtime-terminal-create-deduplication.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/runtime/orca-runtime-terminal-create-deduplication.ts) and [orca-runtime-terminal-create-idempotency.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/runtime/orca-runtime-terminal-create-idempotency.test.ts): handle derived from authenticated client/canonical workspace/mutation identity; concurrent create sharing; reconnect reconciles inventory on the owning execution host. Unknown/unavailable inventory cannot prove absence and cannot authorize duplicate creation. Tests cover runtime restart adoption without rerunning startup, unavailable relay, legacy missing identity, wrong-worktree conflict and bounded concurrent creates.
- [worker-terminal-host-scope.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/shared/worker-terminal-host-scope.ts) and adjacent `.test.ts`: one classification for local/WSL/SSH ownership; malformed scope does not silently become local authority.
- [windows-terminal-shell.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/shared/windows-terminal-shell.ts): canonical supported shell names and shell-specific startup quoting; local Windows settings do not override remote host quoting.

These are observed source patterns, not documentation-only promises or proof that either reference runs reliably on this machine. Both references have relevant patterns. No source/assets were copied.

## Orchestra findings

Existing assets worth retaining:

- `TerminalMultiplexer.tsx` already has tabs and Mosaic splits; inactive terminal tabs remain mounted within its tab mode. `TerminalView.tsx` has search, resize/visibility handling, file-path drop and xterm rendering.
- `workspace.slice.ts` has project-specific tab groups, split layout and explorer roots. `WorkspaceLayout.tsx` integrates editor/terminal/browser panels; the Kanban model need not be replaced.
- `api/terminal.go` checks authentication and WebSocket origin; `terminal/manager.go` reuses an in-memory session and retains up to 100 KiB output.

Concrete gaps, in priority order:

1. **Native Windows terminal is unavailable.** `terminal.Manager.CreateSession` explicitly rejects Windows pending a ConPTY adapter. `TerminalWebSocket` upgrades first, then logs creation failure and closes; renderer only prints disconnected. Native subprocess execution passing does not prove interactive terminal capability.
2. **Terminal identity is not workspace identity.** Backend map is keyed only by caller-supplied session ID; reusing an ID can adopt an existing process regardless of requested project/cwd. Issue worktree discovery derives a path from identifier/branch text and scans all issues, rather than reading a canonical workspace record. Missing project or invalid cwd silently falls back. `handleJumpToTerminal` creates an issue terminal without project metadata.
3. **UI close does not terminate the resource.** `App.handleCloseTerminal` and `TabGroupPanel.closeTab` remove renderer state only. No terminal close API is wired. WebSocket detach removes the handler but leaves the shell alive. Backend session close kills its direct process without a `Cmd.Wait` reap path; explicit process-tree exit ownership needs verification.
4. **Output delivery can stall or replay inaccurately.** Broadcast invokes network callbacks while holding the session mutex, so a slow client can block every viewer and shutdown. There is no output sequence/incarnation acknowledgement or bounded per-client delivery. All retained bytes replay on every reconnect/remount, and there is no bounded reconnect recovery protocol.
5. **Issue terminal filtering damages the transcript.** `filterAgentOutput` treats arbitrary PTY read chunks as complete JSON lines, truncates/drops content and explicitly drops error events. A real shell terminal should render its bytes faithfully; native chat needs a separate structured provider decoder/session contract.
6. **Startup execution is not acknowledged.** Renderer uses a process-global `Set<string>` plus 500 ms delay. It marks the command sent before checking the delayed socket, so disconnect can lose startup; renderer restart can resend it. The set is not scoped by backend/workspace/incarnation. Tabs-to-split transitions remount terminal surfaces; project `TabGroupPanel` also renders only the active panel.
7. **State restoration is incomplete.** Root Zustand store has no persistence middleware; terminal records/layouts are renderer memory. Backend session map/history are process memory. Durable transcript recovery is different from keeping a process alive across backend restart; neither is proven here.
8. **Central navigation is incomplete.** Workspace context is project-keyed rather than canonical issue worktree-keyed. `IssuesPanel` derives explorer cwd by splitting a session log string on `/_logs/`, which is not a robust Windows path contract. Session rows are not actionable workspace/host-aware inventory. Global console knows renderer-open tabs, not authoritative running terminals.
9. **Appearance/settings are partly hardcoded.** xterm fonts/colors are inline; split topology rebuilds when terminal membership changes; no persisted terminal settings or subprocess-aware close confirmation. Agent quick launch includes Gemini and bypasses capability discovery/effective launch configuration. Replacing its label alone would not integrate Antigravity.

## Adaptation and deliberate differences

Use T3's compact terminal drawer/group controls, inherited theme tokens, selection-to-chat context and explicit terminal states. Use Orca's host-owned handles, mutation receipts, create/attach distinction and inventory reconciliation as the control semantics. Keep Orchestra's Go backend/SQLite and project → issue/task → workspace/run identities; do not replace Kanban with either reference's thread model.

Orca CLI is the behavioral base requested by the user. Orchestra UI/API/CLI should call one Orchestra control service with equivalent ownership/receipt concepts. The installed Orca CLI controls Orca-managed state, so it must not become an undocumented second owner of Orchestra's SQLite or shells. Cross-app import/interop is a separately specified boundary.

Keep the current xterm renderer initially. T3's pinned Ghostty renderer is an implementation choice, not a prerequisite for matching its interaction model. Renderer replacement should wait for measured Unicode/IME/performance failures and a license/dependency assessment. Add a Go platform PTY abstraction with a verified Windows ConPTY implementation (or an explicit host process bridge design); do not substitute plain pipes and claim TUI support. Durable metadata/transcripts can restore after process exit, but live process survival requires an independently owned host/daemon and reconciliation, not a saved PID.

## Executable implementation packages

### TW1 — Canonical workspace and terminal contracts

Define terminal ID, workspace ID, project/task/run links, execution host, requested/resolved cwd, shell, incarnation, lifecycle status, output cursor and create mutation ID. Add shared typed schemas and backend inventory/create/attach/resize/write/close operations. Resolve issue worktree from canonical ownership data; reject unknown project, mismatched workspace, invalid cwd or unavailable host before spawning. Keep authentication around every entry point.

Acceptance: concurrent same-mutation creation starts one shell; same terminal ID in another workspace is rejected; unknown project/cwd errors do not start a fallback shell; unavailable host inventory yields unknown/unavailable, not absent; UI and CLI see the same metadata and receipts.

### TW2 — Windows and POSIX terminal runtime

Introduce platform PTY adapter with explicit capability discovery and shell resolution. Implement native Windows ConPTY readiness, input/output/resize/exit, shell-family quoting, cancellation and child-tree teardown; retain POSIX PTY support with reap ownership. Separate attach-only from restart and close. Show typed unsupported capability before connection upgrade until Windows implementation passes.

Acceptance on actual Windows: PowerShell prompt reports exact requested worktree cwd; a path containing spaces and Unicode works; interactive full-screen program resizes correctly; Ctrl+C reaches foreground command; close terminates owned shell/descendants and reports exit; failed startup leaves no child. Repeat lifecycle suite on POSIX. A Docker Linux pass cannot substitute for Windows ConPTY proof.

### TW3 — Output and recovery

Move callbacks out of session locks; use bounded client queues with explicit slow-consumer recovery. Preserve raw terminal bytes, incremental Unicode decoding and sequence/incarnation fences. Persist bounded history with replay-safe restoration and explicit gap/truncation metadata. Replace renderer timer startup with host-owned, acknowledged startup intent and mutation reconciliation. Do not rerun startup on attach.

Acceptance: disconnect immediately before/after command delivery gives one execution or a visible unresolved state; Unicode/ANSI split at every byte boundary round-trips; slow viewer cannot block another viewer/input/close; remount and split transitions do not duplicate output/startup; stale incarnation writes are rejected; restart restores history with honest exited/disconnected state.

### TW4 — Central UI and terminal settings

Add project → issue/workspace navigation with host/branch/cwd/status badges and actionable authoritative terminal inventory. Preserve per-workspace panel/terminal groups, focus, split direction/ratio, scroll position and selected tab, scoped by backend/environment/task identity so switching servers cannot reuse another host's session. Provide compact new/split/rename/search/close controls, keyboard shortcuts and subprocess-aware close confirmation. Bind fonts/colors/scrollback/shell to typed settings and discovered runtime capabilities. Keep Kanban status independent from a shell exiting.

Acceptance: two projects with multiple issue worktrees stay isolated while switching; files/chat/terminal agree on the selected canonical workspace; restoring UI cannot spawn missing shells implicitly; close panel detaches while explicit close terminal ends the shell; font/theme updates preserve process and input; unavailable providers/shells show actionable capability errors.

### TW5 — Real desktop audit gate

Use an isolated fixture repository with real files, two branches/worktrees and harmless owned commands. Drive add project → select issue workspace → new terminal → verify cwd → split → switch project/workspace → reconnect → close → relaunch. Capture UI evidence, actual PID/exit inventory, byte markers and mutation receipts. Inject failed cwd, disconnected host, lost response, early shell exit and slow client. Keep provider authentication/global home outside this fixture; audit shell isolation must not hide the user's file-navigation root.

Gate: mark each capability separately as source-reviewed, unit-verified, boundary-verified or real desktop-verified. No package is complete until Orchestra's behavior, including failure states, has independent evidence. This audit itself ran no implementation tests because it changed no behavior. The current native audit at backend port 4014/frontend port 5174 has no terminal canary evidence in this review; successful desktop startup is not terminal proof.
