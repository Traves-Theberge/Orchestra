# Edit message & regenerate response with file rollback: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In UI chat conversations, let the user edit a past message or regenerate a response, optionally restoring the working folder to its pre-turn state first, keeping the original as a switchable branch.

**Architecture:** An Orchestra-owned shadow-git `checkpoint` package snapshots/diffs/restores a work tree. The conversation gains branches (a branch = parent + fork point); `Detail` and `send` already operate on "the visible messages", so filtering those to the active branch makes replay harnesses work unchanged and native harnesses reuse the existing seeded-transcript restart (the harness-switch mechanism). A new rewind service orchestrates restore + branch + resend; a small API and UI expose it.

**Tech Stack:** Go (chi, SQLite, `git` CLI via `os/exec`), React 19 + TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-edit-regenerate-rollback-design.md`

## Global Constraints

- Scope is **UI chat conversations only**; terminal-hosted harnesses are untouched. Maestro (`OrchestratorScope`, `__orchestrator__`) gets conversation-only rewind; the files option is hidden/rejected there.
- Shadow store: `<workspace_root>/.orchestra/checkpoints/<sha256(cleaned worktree path)>/`; **never** inside the project and **never** touching the project's own `.git`.
- Shadow git config: `core.autocrlf=false`, `core.safecrlf=false`, `core.fileMode=false`, `core.longpaths=true`, `core.quotepath=false`. The project's `.gitignore` applies.
- Snapshot size cap: files over **2 MB** (`2*1024*1024` bytes, configurable) are left out and counted in `Skipped`.
- Snapshots never block sending: snapshot timeout 20 s, any failure is logged and the message is simply "no file checkpoint".
- Restore is refused while any turn runs in the session **or in any other session sharing the worktree**; restore holds the service lock.
- Restore overwrites everything to the pre-turn tree including the user's later edits, after saving a `safety` checkpoint; **Undo restore** restores that safety tree.
- Error codes (exact): `checkpoint_unavailable`, `restore_partial`; existing `chat_busy`, `invalid_chat_request`.
- UI copy (exact): buttons **Edit**, **Regenerate**, **Undo restore**; dialog choices **Conversation only** / **Conversation and files**; standing note **"Does not undo commits, pushes, installs, network actions or ignored files."**; version switcher `‹ 1 / 2 ›`.
- Match surrounding code style and comment density. gofmt clean. TypeScript strict, no `any`. Heredocs in Git Bash drop backslashes: create files with the Write tool.
- Never run git stash/checkout/reset on the user's tree; the telemetry agent works in `internal/telemetry` and `internal/usage`: do not touch them.

## Review Focus

Failure modes the spec implies but a happy-path test would miss (each is pinned by a named test in the owning task):

1. **Not a git repo / `git` missing**: turns still run; rewind offers conversation-only. (Task 1, 3)
2. **Windows**: CRLF files unchanged by snapshot/restore; a locked file during restore is reported per file, not fatal. (Task 1)
3. **Editing the very first message** (nothing before it) and editing the only message. (Task 4)
4. **Another conversation running in the same worktree** blocks restore with a named reason. (Task 4)
5. **A harness or agent switch after a branch exists**, and **deleting a conversation** removing its branches/checkpoints (no orphans). (Task 2, 4)

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/backend/internal/checkpoint/checkpoint.go` | `Store`: Snapshot / Diff / Restore over a work tree |
| `apps/backend/internal/checkpoint/checkpoint_test.go` | real-git tests in temp dirs |
| `apps/backend/internal/workspacechat/branches.go` | schema, branch chain resolution, visibility filters, branch/checkpoint row helpers |
| `apps/backend/internal/workspacechat/rewind.go` | `PreviewRewind`, `Edit`, `Regenerate`, `ActivateBranch`, `UndoRestore` |
| `apps/backend/internal/workspacechat/turn_checkpoints.go` | per-turn `before`/`after` snapshot hooks |
| `apps/backend/internal/api/workspace_chat_rewind.go` | HTTP handlers; routes added in `router.go` |
| `apps/desktop/src/features/workspace/chat/RewindDialog.tsx` (+ test) | preview + choice dialog |
| `apps/desktop/src/features/workspace/chat/UndoRestoreBanner.tsx` (+ test) | persistent undo banner |
| Modified: `service.go`, `native.go`, `delete.go`, `app/run.go`, `api/router.go`, `api/workspace_chat.go` (error mapping), `core/api/client.ts`, `ChatMessage.tsx`, `WorkspaceChat.tsx`, both `openapi.yaml` copies | wiring |

---

### Task 1: Checkpoint package

**Files:**
- Create: `apps/backend/internal/checkpoint/checkpoint.go`, `checkpoint_test.go`

**Interfaces:**
- Produces:
  ```go
  type Tree struct{ Hash string; Files int; Bytes int64; Skipped int }
  type ChangeKind string // ChangeCreate | ChangeModify | ChangeDelete: what Restore will do to the folder
  type Change struct{ Path string; Kind ChangeKind }
  type FileFailure struct{ Path, Reason string }
  type RestoreResult struct{ Written, Deleted int; Failed []FileFailure }
  var ErrUnavailable = errors.New("checkpoint unavailable") // git missing / shadow store unusable
  func NewStore(dir string, maxFileBytes int64) *Store
  func (s *Store) Snapshot(ctx context.Context, worktree string) (Tree, error)
  func (s *Store) Diff(ctx context.Context, worktree, treeHash string) ([]Change, error)
  func (s *Store) Restore(ctx context.Context, worktree, treeHash string) (RestoreResult, error)
  ```

- [ ] **Step 1: Write failing tests** in `checkpoint_test.go` (helper `newWorktree(t)` makes a temp dir; tests call real `git`; skip with `t.Skip` only when `git` is absent):
  - `TestSnapshotRestoreRoundTrip`: write `a.txt`, `dir/b.txt`; snapshot T1; modify `a.txt`, delete `dir/b.txt`, add `c.txt`, add untracked `dir/new/d.txt`; `Restore(T1)`; assert folder equals the original (contents, `c.txt` and `dir/new/d.txt` gone, empty dirs removed), `RestoreResult{Written:2, Deleted:2}`.
  - `TestDiffDescribesRestore`: after the same mutations `Diff(T1)` returns `{a.txt ChangeModify, dir/b.txt ChangeCreate, c.txt ChangeDelete, dir/new/d.txt ChangeDelete}` (sorted by path).
  - `TestIgnoredFilesAreNotTouched`: `.gitignore` contains `node_modules/`; a file in `node_modules/x` survives snapshot and restore unchanged and is not in `Diff`.
  - `TestFilesOverTheCapAreSkipped`: store with cap 100 bytes; a 200-byte file is counted in `Tree.Skipped`, excluded from the tree, and survives restore.
  - `TestProjectGitDirIsNeverTouched`: worktree has a real `.git`; hash every file under it before/after snapshot+restore; identical. Shadow dir lives outside the worktree.
  - `TestCRLFFilesAreByteIdentical`: a file with `\r\n` round-trips byte-for-byte.
  - `TestRestoreReportsLockedFilePerFile` (Windows only, `runtime.GOOS` guard): hold a file open without share-delete; restore returns that path in `Failed`, restores the others, `err == nil`.
  - `TestUnavailableWhenGitMissing`: `t.Setenv("PATH", "")`; `Snapshot` returns an error satisfying `errors.Is(err, ErrUnavailable)`.
  - `TestRestoreIsIdempotent` and `TestEmptyFolderSnapshot`.
- [ ] **Step 2:** Run `cd apps/backend && go test ./internal/checkpoint` → FAIL (package missing).
- [ ] **Step 3: Implement.** Shadow dir per `sha256(strings.ToLower(filepath.Clean(worktree)))` (lower-case only on Windows) under `dir`; `git init --bare`-style on first use; every command runs with env `GIT_DIR=<shadow>`, `GIT_WORK_TREE=<worktree>` and the `-c` config values from Global Constraints. Snapshot: list candidates with `ls-files -z --cached --others --exclude-standard`, `os.Stat` each, drop entries over the cap (count them), feed the rest to `add -A --pathspec-from-file=- --pathspec-file-nul` (deleted paths included so deletions are staged), then `write-tree`. Restore: take no new snapshot; compute `Diff`, `read-tree <target>`, write files with `checkout-index -f -z --stdin` in batches (on batch failure retry per file to attribute failures), delete `ChangeDelete` paths with `os.Remove`, prune now-empty directories, collect failures. Wrap exec failures that mean "git not runnable" in `ErrUnavailable`. Apply the 20 s timeout in callers, not here.
- [ ] **Step 4:** `go test ./internal/checkpoint` → PASS; `gofmt -l internal/checkpoint` empty.
- [ ] **Step 5:** Commit `feat(checkpoint): shadow-git snapshot, diff and restore`.

### Task 2: Branch and checkpoint storage

**Files:**
- Create: `apps/backend/internal/workspacechat/branches.go`, `branches_test.go`
- Modify: `service.go` (`New` calls `migrateBranches`; `Detail`, `finish`, `send` message inserts), `native.go` (`loadNative` event filter, `recordEvent` branch tag), `delete.go` (table lists)

**Interfaces:**
- Produces:
  ```go
  // Main branch id == session id. messages.branch_id '' means main.
  type Branch struct{ ID, SessionID, ParentID string; ForkAfterOrdinal int64; ForkAfterTime, CreatedAt string }
  type Checkpoint struct{ ID, SessionID, BranchID, MessageID, Kind, TreeHash, CreatedAt string; Files int; Bytes int64; Skipped int }
  func migrateBranches(d *db.DB) error
  func (s *Service) activeBranchID(ctx context.Context, sessionID string) (string, error)
  func (s *Service) branchChain(ctx context.Context, sessionID, branchID string) ([]chainLink, error) // newest-first: {BranchID, MaxOrdinal, MaxTime}
  func (s *Service) createBranch(ctx context.Context, tx *sql.Tx, sessionID, parentID string, forkAfterOrdinal int64, forkAfterTime string) (Branch, error)
  func (s *Service) saveCheckpoint(ctx context.Context, c Checkpoint) error
  func (s *Service) checkpointFor(ctx context.Context, sessionID, messageID, kind string) (Checkpoint, bool, error)
  ```
  `Message` gains `HasCheckpoint bool \`json:"has_checkpoint,omitempty"\`` and `Versions []VersionRef \`json:"versions,omitempty"\`` with `type VersionRef struct{ BranchID string \`json:"branch_id"\`; Active bool \`json:"active"\` }`.
- Tables: `workspace_chat_branches(id PK, session_id, parent_id, fork_after_ordinal INTEGER, fork_after_time, created_at)`, `workspace_chat_active_branch(session_id PK, branch_id)`, `workspace_chat_checkpoints(id PK, session_id, branch_id, message_id, kind, tree_hash, files, bytes, skipped, created_at)` + index on `(session_id, message_id, kind)`, `workspace_chat_branch_seed(session_id PK, created_at)`, columns `workspace_chat_messages.branch_id TEXT NOT NULL DEFAULT ''` and `workspace_chat_events.branch_id TEXT NOT NULL DEFAULT ''` (added with the existing `ALTER TABLE … ADD COLUMN` pattern, ignoring "duplicate column").

- [ ] **Step 1: Write failing tests** (`branches_test.go`, fake registry fixtures like `nativeFixture`):
  - `TestExistingConversationsAreUnchangedByMigration`: legacy session with 4 messages and events; `Detail` returns the same messages/events as before.
  - `TestDetailShowsOnlyTheActiveBranch`: messages m1..m4 on main; create branch B forking after m2 with own messages b1,b2 and set active; `Detail.Messages` ids == `[m1,m2,b1,b2]`; activate main → `[m1..m4]`.
  - `TestEventsFollowTheirBranch`: events tagged to main after the fork time are hidden while B is active; events before the fork time stay; `Detail.Cursor` still equals `MAX(sequence)` over all events so polling advances.
  - `TestVersionsListedOnForkingMessages`: the first message after the fork point carries `Versions == [{main},{B}]` with the active one flagged, on both branches' view.
  - `TestDeleteRemovesBranchesCheckpointsAndSeed`: after `Delete`, all four new tables have zero rows for the session.
  - `TestFinishAndSendTagTheActiveBranch`: with B active, a send + completed turn writes both user and assistant rows with `branch_id = B`.
- [ ] **Step 2:** `go test ./internal/workspacechat -run 'Branch|Versions|Events'` → FAIL.
- [ ] **Step 3: Implement** `migrateBranches` and helpers. `Detail` selects messages with the visibility predicate `(branch=? AND ordinal<=?) OR …` built from `branchChain`; `loadNative` filters events by the same chain (ancestor links bounded by `MaxTime`); `recordEvent` stores the session's active branch id inside its existing tx. `send` inserts `branch_id` (active branch) and `finish` inserts the assistant row with the same value (`''` for main keeps legacy rows valid). `finish` also `DELETE FROM workspace_chat_branch_seed` where it clears handoffs (`msgStatus == "completed"`). Add the new tables to `chatSessionTables` in `delete.go`.
- [ ] **Step 4:** Run the new tests, then the whole package `GOWORK=off go test ./internal/workspacechat` → PASS (existing behavior untouched).
- [ ] **Step 5:** Commit `feat(chat): conversation branches and checkpoint storage`.

### Task 3: Per-turn checkpoints

**Files:**
- Create: `apps/backend/internal/workspacechat/turn_checkpoints.go`, `turn_checkpoints_test.go`
- Modify: `service.go` (`Service.checkpoints *checkpoint.Store`, `SetCheckpointStore`), `native.go`/`service.go` (`runNative`/`run` call the hooks), `app/run.go` (construct the store under the workspace root after `workspacechat.New`)

**Interfaces:**
- Consumes: Task 1 `Store`, Task 2 `saveCheckpoint`.
- Produces:
  ```go
  func (s *Service) SetCheckpointStore(store *checkpoint.Store)
  func (s *Service) checkpointTurn(sess Session, branchID, messageID, kind string) // best-effort; never returns an error
  ```

- [ ] **Step 1: Write failing tests** with a real `checkpoint.Store` on a temp git-less folder:
  - `TestTurnTakesBeforeAndAfterCheckpoints`: a fake native harness writes `out.txt` during its turn; afterwards the user message has a `before` checkpoint (tree without `out.txt`) and an `after` checkpoint (tree with it); `Detail` shows `has_checkpoint=true` on that message.
  - `TestSnapshotFailureNeverBlocksTheTurn`: store pointed at an unwritable dir; the turn completes `idle`, message `has_checkpoint=false`.
  - `TestSnapshotTimeoutDoesNotDelayTheTurn`: store wrapper that blocks; the turn dispatches within the timeout (use an injectable timeout of 50 ms).
  - `TestMaestroTurnsAreNotCheckpointed`: `OrchestratorScope` sends create no checkpoint rows.
  - `TestNoGitMeansNoCheckpointButTurnRuns` (Review Focus 1): `PATH` without git.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** `before` is taken in the turn goroutine before the harness starts (after the message is durably accepted, outside `s.mu`); `after` after `finish`, whatever the outcome. Skip when the store is nil, scope is Maestro, or the session has no `WorkspacePath`. Timeout 20 s (field, overridable in tests). Record `Skipped` so the UI can mention omitted files.
- [ ] **Step 4:** package tests PASS; `go vet`.
- [ ] **Step 5:** Commit `feat(chat): per-turn file checkpoints`.

### Task 4: Rewind service (edit, regenerate, activate, undo)

**Files:**
- Create: `apps/backend/internal/workspacechat/rewind.go`, `rewind_test.go`
- Modify: `service.go` `send` (consume `workspace_chat_branch_seed`), `native.go` if the seeded prompt/thread reset needs a shared helper

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  ```go
  var ErrCheckpointUnavailable = errors.New("no file checkpoint for that message")
  type RestoreError struct{ Failed []checkpoint.FileFailure } // satisfies error; maps to restore_partial
  type RewindPreview struct {
      MessageID string `json:"message_id"`; HasCheckpoint bool `json:"has_checkpoint"`
      FilesAvailable bool `json:"files_available"` // false for Maestro / no checkpoint
      BusyReason string `json:"busy_reason,omitempty"`
      Changes []checkpoint.Change `json:"changes"`; ChangedSinceTurn []string `json:"changed_since_turn"`
      Skipped int `json:"skipped"`
  }
  type EditRequest struct{ MessageID, Text, ClientMessageID string; RestoreFiles bool; SendRequest-style model/agent fields embedded as SendRequest }
  type RegenerateRequest struct{ MessageID, ClientMessageID string; RestoreFiles bool }
  func (s *Service) PreviewRewind(ctx, pid, id, messageID string) (RewindPreview, error)
  func (s *Service) Edit(ctx, pid, id string, req EditRequest) (Accepted, error)
  func (s *Service) Regenerate(ctx, pid, id string, req RegenerateRequest) (Accepted, error)
  func (s *Service) ActivateBranch(ctx, pid, id, branchID string, restoreFiles bool) (Detail, error)
  func (s *Service) UndoRestore(ctx, pid, id string) (checkpoint.RestoreResult, error)
  ```

Algorithm (Edit; Regenerate = Edit with the target's own text): under `s.mu`: reject if running/active/archived or another session shares the worktree is running (`ErrBusy`, `BusyReason` names it); target must be a visible `user` message; fork point = ordinal and time of the visible message immediately before it (`0` if none). If `RestoreFiles`: require the target's `before` checkpoint (`ErrCheckpointUnavailable` otherwise), save a `safety` snapshot, `Restore`; any `Failed` entries abort **before** touching the conversation and return `*RestoreError` (safety kept, so Undo restore works). Then, in one transaction: create the branch, set it active, insert `workspace_chat_branch_seed`, reset the native thread exactly as the agent-switch path does (`UPDATE workspace_chat_native SET thread_id='',cumulative_turn_count=NULL`), stale pending requests, close and drop the in-memory native session. Finally call `send` with the new text: when a seed is pending, `send` builds `turn.Prompt` with a new `branchTranscript(messages, prompt, budget)` header ("The user edited an earlier message; your session restarts here. The conversation before that point follows as context. Work only in the selected project."). Replay harnesses need nothing extra. `ActivateBranch` mirrors this without a send (seed set, files restored to that branch's latest `after` tree when requested). `UndoRestore` restores the newest `safety` checkpoint and removes it.

- [ ] **Step 1: Write failing tests** (fake native + replay registries, real checkpoint store):
  - `TestEditCreatesABranchKeepingTheOriginal`: edit message 2 of a 3-turn conversation; active view `[m1, edited, reply]`; switching to main shows the original three turns; both versions list each other.
  - `TestEditingTheFirstMessage` (Review Focus 3): fork ordinal 0; single-message conversation works; replay harness prompt contains no earlier messages.
  - `TestRegenerateResendsTheSameText`: assistant-message target resolves to its user message; new branch's user text equals the original.
  - `TestRestoreFilesRewindsTheFolder`: harness turn creates `a.txt`; `Edit(restore_files=true)` removes it before the resend; `Undo restore` brings it back.
  - `TestRestoreOverwritesUserEditsAfterSafetySnapshot`: a hand edit after the turn is overwritten by the restore and recoverable via `UndoRestore`.
  - `TestPartialRestoreAbortsBeforeBranching`: injected failure → `*RestoreError`, no new branch row, conversation unchanged, safety checkpoint exists.
  - `TestBlockedWhileAnotherConversationRunsInTheSameWorktree` (Review Focus 4): `ErrBusy`, `PreviewRewind.BusyReason` names the other conversation; nothing restored.
  - `TestNativeBranchSeedsTranscriptAndResetsTheThread`: after `Edit` the next native start has `threadID == ""` and its prompt begins with the branch header and contains the kept messages only; the seed row is cleared after the turn completes.
  - `TestMaestroEditIsConversationOnly`: `RestoreFiles=true` on `__orchestrator__` → `ErrInvalid`; without it, works.
  - `TestRewindAfterHarnessOrAgentSwitch` (Review Focus 5): switch harness, edit an earlier message: replay/seed uses the active branch and the new harness.
  - `TestPreviewListsChangesAndUserEdits`: `Changes` matches `checkpoint.Diff`; `ChangedSinceTurn` lists files whose current content differs from the turn's `after` tree.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement per the algorithm above; reuse `closeNative`, `rejectPendingRemoval`, the busy checks from `send`. Keep all rewind code in `rewind.go`; the only `send` change is the seed branch.
- [ ] **Step 4:** `GOWORK=off go test ./internal/workspacechat ./internal/checkpoint` PASS; `go vet`; gofmt.
- [ ] **Step 5:** Commit `feat(chat): edit, regenerate and branch switching with file rollback`.

### Task 5: HTTP API

**Files:**
- Create: `apps/backend/internal/api/workspace_chat_rewind.go`, `workspace_chat_rewind_test.go`
- Modify: `router.go`, `workspace_chat.go` (`chatError`), `api/spec/openapi.yaml` and `docs/openapi.yaml` (keep the embedded copy in sync; the parity test enforces it)

Routes under both `/api/v1/projects/{project_id}/chat/sessions/{session_id}` and `/api/v1/orchestrator/chat/sessions/{session_id}` (via `orchestratorChatScope`): `POST /rewind/preview` `{message_id}`, `POST /edit`, `POST /regenerate`, `POST /branches/{branch_id}/activate` `{restore_files}`, `POST /restore/undo`. `chatError` maps `ErrCheckpointUnavailable` → 409 `checkpoint_unavailable`, `*RestoreError` → 409 `restore_partial` (message lists the first 5 failed paths).

- [ ] **Step 1: Failing tests:** `TestRewindRoutesRequireAuth` (existing auth-matrix style), `TestEditRoundTrip` (POST edit → 202 with the new message; GET detail shows the branch), `TestPreviewReturnsChanges`, `TestRestorePartialMapsTo409`, `TestCheckpointUnavailableMapsTo409`, `TestMaestroRejectsRestoreFiles` (400 `invalid_chat_request`).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement handlers and routes. **Step 4:** `GOWORK=off go test ./internal/api` PASS (OpenAPI parity included).
- [ ] **Step 5:** Commit `feat(api): rewind, edit, regenerate and branch routes`.

### Task 6: Desktop client and types

**Files:** Modify `apps/desktop/src/core/api/client.ts`; test `client.rewind.test.ts` (new).

**Interfaces:** `WorkspaceChatMessage` gains `has_checkpoint?: boolean; versions?: { branch_id: string; active: boolean }[]`. Add `WorkspaceChatRewindPreview` and `previewWorkspaceChatRewind(config, projectId, sessionId, messageId)`, `editWorkspaceChatMessage(config, projectId, sessionId, { message_id, text, client_message_id, restore_files })`, `regenerateWorkspaceChatResponse(config, projectId, sessionId, { message_id, client_message_id, restore_files })`, `activateWorkspaceChatBranch(config, projectId, sessionId, branchId, restoreFiles)`, `undoWorkspaceChatRestore(config, projectId, sessionId)`, each using the existing `requestJSON` and `workspaceChatPath`.

- [ ] Steps: failing test asserting each function's URL, method and body against a mocked `fetch` (follow `client.test.ts` style) → implement → `npx vitest run src/core/api` PASS, `npx tsc --noEmit` clean → commit `feat(desktop): rewind API client`.

### Task 7: UI

**Files:**
- Create: `RewindDialog.tsx`, `RewindDialog.test.tsx`, `UndoRestoreBanner.tsx`, `UndoRestoreBanner.test.tsx` (under `features/workspace/chat/`)
- Modify: `ChatMessage.tsx` (+ test), `WorkspaceChat.tsx` (+ test)

**Interfaces:** `RewindDialog({ open, mode: 'edit' | 'regenerate', preview, busy, onConfirm(restoreFiles: boolean), onCancel })`; `ChatMessage` gains props `onEdit?(message, text)`, `onRegenerate?(message)`, `onSwitchVersion?(branchId)`, `rewindDisabledReason?: string` (and the memo comparator includes them).

- [ ] **Step 1: Failing tests:**
  - `ChatMessage`: user message shows **Edit** beside Copy; clicking opens an in-place textarea (Enter submits, Esc cancels, unchanged text disables submit); assistant message shows **Regenerate** with the same button style as Copy; both are disabled with a title when `rewindDisabledReason` is set; a message with `versions` shows `‹ 1 / 2 ›` and the arrows call `onSwitchVersion`.
  - `RewindDialog`: renders both choices; with files unavailable only **Conversation only** is enabled and says why; lists changes (counts + expandable list), marks `changed_since_turn` files, shows the standing note exactly; shows `skipped` count; confirm passes the chosen boolean.
  - `UndoRestoreBanner`: shows **Undo restore**; click calls the handler once and hides the banner; reappears only after the next restore.
  - `WorkspaceChat`: Edit → preview fetched → dialog → confirm calls `editWorkspaceChatMessage` with `restore_files` and refreshes the snapshot; Regenerate likewise; failure `restore_partial` shows the failed files and keeps the conversation; Maestro hides the files option; buttons disabled while a turn runs; typing in the composer still does not re-render messages (extend the existing perf test).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (match the existing copy-button styling, `Check`/`Copy`-style lucide icons for Edit/Regenerate, radix `Dialog` like the delete dialog in `MaestroConversations.tsx`). **Step 4:** `npx vitest run src/features/workspace` PASS, `npx tsc --noEmit` clean, eslint on changed files has no errors.
- [ ] **Step 5:** Commit `feat(desktop): edit, regenerate and rewind UI`.

### Task 8: Live verification and docs

**Files:** Modify `CLAUDE.md` (one paragraph under Architecture); optional new `docs/`-free; no new product code.

- [ ] **Step 1:** Build a temp backend on port 4077 with a temp workspace root (`ORCHESTRA_SERVER_PORT=4077`, **not** the user's 4010), register a temp git project, run a real Claude turn that creates and edits files, then via the API: preview, `edit` with `restore_files=true`, verify the folder and conversation, then `restore/undo`, branch activate back to the original. Repeat once with a native harness (Codex or OMP) to confirm the seeded restart answers from the kept history. Record results in the PR/summary.
- [ ] **Step 2:** Verify on Windows paths (spaces, CRLF project) with the same flow. Delete all temp projects/conversations afterwards.
- [ ] **Step 3:** Full suites: `GOWORK=off go test ./...` in `apps/backend`; `npx tsc --noEmit`, `npx vitest run` in `apps/desktop`.
- [ ] **Step 4:** Commit `docs: rewind and branches`.

### Task 9 (optional, may be deferred): native thread forks

Everything above ships complete without this: new branches restart native harnesses from the seeded transcript (exactly like a harness switch). This task only preserves native tool/reasoning state across a branch. **Codex:** implement `thread/fork` with `beforeTurnId` in the Codex native adapter and use it when the fork point maps to a known turn, else fall back to the seed. **OMP:** use the RPC `fork`/`clone` equivalently. Each is gated behind a test showing the fallback still works when the call fails. Do this only after Task 8 is signed off.
