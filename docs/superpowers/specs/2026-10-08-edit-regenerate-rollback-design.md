# Edit message & regenerate response, with file rollback

Date: 2026-10-08. Status: draft for review. Scope: **workspace chat conversations in the Orchestra UI** (project and worktree chats).

## Intent

On any past turn the user can **Edit** their message (change the prompt and re-run from there) or **Regenerate** a response (re-run the same prompt). Both start from the state the agent originally saw: the conversation is rewound to that point and, if the user chooses, the **files are restored** to how they were before the turn. It must be careful and honest: no silent data loss, no over-promising about what can be undone.

Decisions from the user (this session):

1. **File restore is chosen each time**: *conversation only* or *conversation and files*.
2. When restoring files, **everything goes back to the pre-turn state, including the user's own later edits**, after a **safety snapshot** of the current state is saved, so the restore is itself undoable.
3. **The original is kept as a branch**: the message shows a `‹ 1 / 2 ›` switcher; each version remembers its own file snapshot.
4. **UI conversations only.** Agents running in terminal tabs own their conversation in their own TUI; their native rewind (Claude `/rewind`, OpenCode `/undo`) is unchanged.

## Non-goals

- Terminal-hosted harness sessions (no message list or turn boundaries in Orchestra).
- Undoing non-file effects: commits, branch changes, pushes, PRs, network calls, DB changes, installs, anything outside the working folder.
- Ignored files (`node_modules`, build output, `.env`) and files over the size cap.
- Mid-turn rollback; per-tool-call granularity (the unit is a whole turn).
- Maestro (orchestrator) conversations get **conversation-only** rewind: there is no single working folder.

## Background (what the research established)

- Harness protocols rewind only conversation history. Codex's `thread/revert` / `thread/fork` explicitly "do not revert local file changes"; Claude's checkpoints miss shell-command changes; Antigravity has no headless rewind; OpenCode snapshots the tree in a private git store; OMP exposes session fork/clone over RPC.
- Therefore Orchestra owns file snapshots, using the proven **shadow-git** pattern: a private git dir pointing at the project's work tree, `add -A` then `write-tree`, restore by tree.
- Today: messages are an append-only table (`workspace_chat_messages`, `ordinal`), native harnesses keep context in a provider thread (`workspace_chat_native.thread_id`), replay harnesses (Claude, OpenCode) rebuild context from stored messages each turn, and there is no checkpoint infrastructure.

## Architecture

### 1. Checkpoint service (`internal/checkpoint`)

Owns the shadow store and exposes three operations over a work-tree path:

- `Snapshot(ctx, worktree) -> Tree{hash, files, bytes, skipped}`: `git add -A` against a private `GIT_DIR` then `write-tree`.
- `Diff(ctx, worktree, tree) -> []Change{path, added|modified|deleted}`: current folder vs a tree.
- `Restore(ctx, worktree, tree) -> Result{restored, deleted, failed[]}`: make the folder equal the tree: write tree files, delete files that exist now but not in the tree (and are not ignored), report per-file failures (locked file, permission) instead of aborting silently.

Shadow store at `<workspace_root>/.orchestra/checkpoints/<sha256(worktree path)>/`, never inside the project and **never touching the project's own `.git`**. Configured with `core.autocrlf=false`, `core.safecrlf=false`, `core.fileMode=false`, `core.longpaths=true`. The project's `.gitignore` applies because the work tree is the project. Files over the size cap (default 2 MB, configurable) are left out and counted in `skipped`.

Safety rules: the work-tree path must resolve inside a registered project/workspace root (reuse the workspace-scope guard); restore is refused while any turn is running in that session **or any other session sharing the worktree**; restore holds the session lock so no send can interleave.

### 2. Branch model

Add branches to the conversation. A branch's visible history = its parent's messages up to `fork_after_ordinal` plus its own messages.

- `workspace_chat_branches(id, session_id, parent_branch_id, fork_after_ordinal, created_at)`; every existing session gets an implicit `main` branch.
- `workspace_chat_messages` gains `branch_id` (existing rows = `main`).
- `workspace_chat_active_branch(session_id, branch_id)`: which branch the UI shows and which the next send extends.
- Provider thread state becomes per-branch: `workspace_chat_branch_threads(branch_id, thread_id, ...)` (migrated from `workspace_chat_native`).

**Edit** forks a new branch at the message before the edited one and appends the edited message. **Regenerate** forks at the user message that produced the response and re-sends its text unchanged. Both use the same code path.

### 3. Checkpoints

`workspace_chat_checkpoints(id, session_id, branch_id, message_id, kind, tree_hash, file_count, bytes, skipped, created_at)` with `kind` in `before | after | safety`.

- `before`: taken just before a user message is dispatched. This is the restore target for rewinding to that message.
- `after`: taken when the turn ends (completed, failed or interrupted). It records what the version produced, so switching to a branch can restore **that branch's** files, and so the rewind dialog can tell which files changed since the turn.
- `safety`: taken immediately before any restore, so **Undo restore** puts the folder back.

If a snapshot fails (git missing, repo too large), the turn still runs; the message is marked "no file checkpoint" and the rewind dialog offers conversation-only for it. Snapshots never block sending.

### 4. Provider thread handling per harness

When a new branch is created, its provider thread must match the kept history:

| Harness | Mode | New branch gets |
|---|---|---|
| Claude, OpenCode | transcript replay | nothing special: context is rebuilt from the branch's messages |
| Codex | native thread | `thread/fork` with `beforeTurnId` (exclusive); fall back to a new thread seeded with the transcript |
| OMP | native session | RPC `fork`/`clone` at the matching entry; fall back to a seeded new session |
| Antigravity | native conversation | a new conversation seeded with the transcript (the same mechanism as a harness switch); no native rewind exists |
| 8gent | command | transcript replay |

The seeded-transcript fallback already exists for harness handoff and is reused. The assistant's reply on a seeded thread notes it continued from a transcript.

### 5. API

All under `/api/v1/projects/{project_id}/chat/sessions/{id}` (workspace-scoped like the existing chat routes):

- `GET /branches`: branches, active branch, and per-message version counts.
- `POST /rewind/preview` `{message_id}`: `{changes: [...], user_edits: [...], has_checkpoint, running}` for the dialog; read-only.
- `POST /edit` `{message_id, text, restore_files, client_message_id}`.
- `POST /regenerate` `{message_id, restore_files, client_message_id}`.
- `POST /branches/{branch_id}/activate` `{restore_files}`.
- `POST /restore/undo`: restores the latest `safety` checkpoint.

Errors reuse the chat error vocabulary (`chat_busy`, `invalid_chat_request`, ...) plus `checkpoint_unavailable` and `restore_partial` (with the failed files).

### 6. UI

- Your messages get **Edit** (in place; Enter submits) beside Copy; replies get **Regenerate** beside Copy. Same button style as the existing copy button.
- Submitting opens a **Rewind dialog** that shows the choice (*Conversation only* / *Conversation and files*), the list of files that will be changed, restored or deleted (counts plus expandable list, files you edited since the turn marked), and a standing note: "Does not undo commits, pushes, installs, network actions or ignored files."
- After a files restore, a banner offers **Undo restore** until the next send.
- Messages with several versions show `‹ 1 / 2 ›`; switching offers the same files choice.
- Disabled with a reason while a turn is running or for sessions without a working folder (Maestro: files option hidden).

## Error handling

- Restore failures are reported per file; the dialog shows what was and wasn't restored. A partial restore keeps the safety snapshot so Undo restore still returns to the starting state.
- Git missing or shadow store unreadable: feature degrades to conversation-only with an explanation; sending is never blocked.
- Pruned or missing checkpoints: the dialog says why files can't be restored for that message.
- Concurrent worktree use: blocked with a message naming the busy conversation.
- A backend panic inside a rewind marks only that conversation failed (existing turn recovery).

## Testing

- **Checkpoint service** against real temp git work trees: modified/added/deleted files, untracked files, nested dirs, CRLF, files over the cap, ignored files untouched, Windows locked file reported not fatal, user-edited file overwritten and then recovered via Undo restore, restore idempotent, project `.git` byte-identical before and after.
- **Branches** with the fake registry: edit and regenerate create the right history; provider thread selection per harness; version counts; activation; switching restores the right tree.
- **Concurrency**: restore refused during a running turn and for shared worktrees.
- **UI**: dialog contents, disabled states, switcher, undo banner.
- **Live**: on a temp backend, run a real Claude turn that edits files, edit-and-rewind with files, verify the folder and the conversation; repeat with a native harness.

## Delivery order

1. Checkpoint service and restore (package plus tests), no UI.
2. Branch storage, per-turn checkpoints, edit/regenerate/activate API.
3. Per-harness thread handling.
4. UI.

Each step is verified on a real folder (including Windows) before the next starts.

## Decided in the plan, not blocking

Exact size-cap default and config key; checkpoint retention (proposal: kept for the life of the session, objects pruned when a session is deleted); the shadow store's `gc` schedule.
