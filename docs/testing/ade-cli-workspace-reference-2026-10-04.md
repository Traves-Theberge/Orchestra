# CLI and central workspace control reference receipt

## Evidence and scope

Read-only source inspection of Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`. Source snapshots are outside the repository at `%LOCALAPPDATA%/Orchestra/diagnostics/orca-project-reference-3284b4c`. Reference tests were read, not executed. No workspace, terminal, agent, or host repository was created or modified. Installed Orca command compatibility is not established by this pinned-source review. T3 Code `737993303d36e10674c54b95e5bd3826682c99c7` terminal/UI review is a separate parent-coordinator input; this receipt alone does not pass the required two-reference gate for implementation.

## Observed contract patterns

1. **One runtime authority, multiple clients.** [CLI worktree handlers](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/worktree.ts) call typed runtime methods `worktree.list/show/create/set/rm`. [Renderer creation](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/store/slices/worktrees/create/create-worktree.ts) uses local IPC or the same remote `worktree.create` contract. CLI is an adapter, not an independent Git/workspace database. Explicit activation uses host navigation because CLI is not a viewer. Removal first resolves the authoritative host; unresolved host rejects rather than guessing local.
2. **Terminal handles and host scope are explicit.** [Terminal CLI handlers](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/terminal.ts) expose list/show/read/send/wait/stop/rename/create/split. Remote creation requires a worktree selector because client cwd cannot identify server context. Requested shell and rendered-screen reads reject incompatible hosts rather than silently returning default-shell or accumulated-output behavior. [Host-scope CLI tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/index-terminal-list-host-scope.test.ts) check scope in JSON/text and avoid claiming local scope when the host omitted it.
3. **Input acceptance is not provider submission.** [terminal-send.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/terminal-send.ts) treats text+enter without interrupt as an agent prompt, preflights runtime capability/identity, requires durable receipt for capable hosts, supports retry request and bounded wait-submit, and includes observation warnings in JSON. A legacy host may accept bytes while submission observation remains unsupported. Host replacement or absent receipt produces uncertain-delivery guidance, not automatic resend.
4. **Replay is identity- and payload-bound.** [mutation-request.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.ts) reuses one request ID for opted-in unavailable retries, exponential delay capped at 15 seconds, and retains recovery data even if a later attempt failed before attaching its ID. Not every repo/worktree mutation automatically receives this guarantee. [Durable executor](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/runtime/rpc/orchestration-mutation-executor.ts) binds authenticated caller, request ID, method, canonical payload hash, and terminal incarnation where applicable. Different payload rejects. Completed receipt replay may observe fresh state but does not resend; pending prompt after restart becomes operation_unknown. [Executor tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/runtime/rpc/orchestration-mutation-executor.test.ts) cover ambiguous write failure, replaced incarnation, re-minted handle, restart fence, and concurrent different-payload worker start.
5. **Actual write authority is checked near the write.** [Terminal send tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/runtime/rpc/terminal-send.test.ts) check stale handle rejection, controller-floor ownership, zero bytes on vanished subscriber/rebound handle, permission-required guard, oversized input, and PTY mismatch. Observation and control must share the same session binding.

## Orchestra evidence and gaps

- `apps/backend/cmd/orchestra/main.go` currently exposes only start/check/check-pr-body. No project, worktree, terminal, or orchestration command surface is present there.
- `apps/backend/internal/api/router.go` already has project and Git APIs, Studio APIs, issue/session APIs, and a terminal WebSocket. These are useful adapters to retain; they do not constitute the Orca-style central control contract.
- `apps/backend/internal/api/terminal.go` creates/attaches by caller-supplied session ID, derives task worktree from an issue prefix and branch path, silently retains workspace fallback on missing project/path, permits an existing absolute cwd override, and requests `/bin/bash`. No typed list/create/read/wait/stop terminal resource surface or durable prompt receipt is exposed in this inspected handler. Windows terminal support must be verified independently before enabling interactive controls.
- `apps/tui/manager.go` supervises local backend/frontend service subprocesses using bash and process groups. It is a development-service dashboard, not a client over the workspace/terminal control authority.
- Existing workspace file routes do not establish durable project-host-workspace identity or terminal ownership. Source availability and passing unit tests cannot establish that capability.

## Prioritized executable packages

### P0: host files and project import

Separate desktop user-directory browsing from provider/test HOME isolation. Offer Local folder and explicit path entry first. Backend validates actual path, canonical Git root, case-normalized Windows duplicates, linked-worktree main repository, and explicit non-Git folder handling. Persist selected project and reveal it in the central UI. Tests: real folder outside isolated HOME; cancellation; missing folder; nested Git root; duplicate casing; linked worktree; restart retains project; no global provider files touched.

### P1: shared project/workspace control service

Define stable project ID, host ID, checkout/root path, workspace ID, task/run relation, branch and base revision. Put mutations in Go service used by REST and future CLI; renderer does not invoke independent Git mutations. Add capabilities/status and explicit local-host boundary before remote targets. CLI project list/add/show and workspace list/show/create should use this service and support JSON envelopes. Tests: API and CLI produce the same identities/state; invalid selector or unavailable host has no filesystem side effect; actual Git worktree creation and DB persistence survive restart.

### P2: create-worktree composer

Project + Run on + source/base + workspace/branch name + agent, then advanced setup/policy. Preserve Kanban tasks as task identity; worktree is a resource. Start with local Git/name/branch capabilities; hosted issue/PR sources and remote targets must show truthful unavailable/setup states. Tests: branch collision; missing base; empty repo; invalid branch; setup policy rejection before mutation; successful worktree visible without refresh races; failure does not fabricate created/agent-running state.

### P3: terminal resource and centralized UI

Create backend-owned terminal identity bound to host/workspace and process incarnation. Add list/show/create/read/resize/input/stop/events; distinguish buffer versus rendered-screen reads. Desktop tabs/splits and CLI are clients of that authority. Explicit shell/platform capability; no silent default fallback. Tests: real PTY echo/resize/exit on supported platform; reconnect does not spawn duplicate shell; stale handle sends zero bytes; project/workspace switch cannot retarget an existing terminal; unsupported Windows path reports unsupported rather than a dead panel. Adopt T3 terminal interaction after its separate reference receipt is integrated.

### P4: durable commands and prompt observations

Add request ID + caller + method + payload digest + pending/completed/failed/unknown receipt to mutations that require replay safety. Record effect boundary; replay identical request, reject differing payload, fence pending uncertain effects after restart. Agent prompt byte acceptance, submission observation and completion are separate states. Tests: disconnect after write; duplicate concurrent request; payload mismatch; restart pending receipt; replaced runtime/PTY incarnation; accepted bytes with unobserved submission. CLI returns receipt and actionable JSON error, never automatically resends unknown input.

### P5: all-workspaces central observation

Use shared backend projection/event stream for project/workspace/run/terminal summaries in sidebar/Kanban and CLI/TUI. Preserve actual host/run scope and last observed version. Tests: multiple workspaces and agents; no cross-task output leakage; stale event ignored; reconnect reconciles snapshot; closed terminal remains historical rather than reported running; disconnected host explicitly unknown.

## Deliberate deviations and unresolved decisions

Borrow Orca CLI's contract and control/observation model, not its private Electron IPC as a dependency or an assumption that installing Orca controls Orchestra state. Go/SQLite remains Orchestra authority. Embedding installed Orca itself requires a separate product decision and compatibility boundary; this review does not claim support. Do not copy 25 name retries, parent-drop fallback, or any global configuration advice blindly: define bounded Orchestra policy and expose changed intent before proceeding. Full provider model/effective configuration and native-chat delivery remain separate implementation packages.
