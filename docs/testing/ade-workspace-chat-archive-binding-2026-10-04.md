# Workspace chat archive binding repair — 2026-10-04

## Reference receipt

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: `docs/user/thread-sidebar.md` documents archive as a reversible thread state with Undo that reopens the archived thread. This supports treating archive as conversation metadata while preserving the conversation. The inspected material is user documentation; it does not establish T3's storage transaction or checkout-binding implementation. No T3 code was copied.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: `src/cli/handlers/orchestration/mutation-request.ts` reuses one request ID across retries when a mutation may already have landed, retaining recovery identity after uncertain delivery. I found no equivalent native-chat archive operation in the assigned Orca orchestration/native-chat reference areas. Orchestra's archive is a local SQLite metadata transaction, so its expected lifecycle version is sufficient for this repaired path; no provider or filesystem mutation occurs.
- The adaptation preserves the existing exact project/workspace/path authorization and lifecycle-version checks. Legacy sessions with no workspace row receive the already-defined registered-primary-root fallback, and the exact resolved binding is materialized in the same transaction as archive metadata. A missing legacy child binding is never inferred from a caller-provided child ID.

## Cause and change

`ListWithArchived` accepts pre-binding legacy root sessions through `validateSessionScope`, which supplies their registered root workspace ID and path in the response. `setArchived` used only `bindScope`, so it saw empty fields for that visible session and returned `conversation not found in this project`. The UI had a valid displayed scope, but the server's archive mutation did not apply the corresponding legacy-root rule.

`setArchived` now re-resolves the requested target's primary status, applies the fallback only when both stored fields are absent and the exact target is the registered primary root, and inserts/verifies that binding inside the archive transaction. That makes the archived catalog and DB-only history work after the legacy session is archived. A wrong project, child checkout, partial/mismatched stored binding, or stale workspace still fails closed.

## Verification

- `TestWorkspaceChatHTTPRoutes` now removes the fixture session's workspace binding before listing and archiving it through the authenticated loopback HTTP router. It verifies the legacy row is still listed, archive succeeds, the archive catalog and history work, and unarchive restores it.
- `TestArchiveMaterializesLegacyBindingOnlyForPrimaryRoot` uses a disposable real Git repository, linked worktree and SQLite database. It checks wrong-project and child-scope attempts cannot bind the legacy root chat, then verifies exact root binding persistence, archive catalog/history, database reopen, restore, and active listing.
- Focused checks passed: `go test ./internal/workspacechat ./internal/api -run 'TestArchiveSurvivesRemovedWorktreeAndDatabaseRestart|TestArchiveMaterializesLegacyBindingOnlyForPrimaryRoot|TestArchiveRejectsPendingRemovalFence|TestWorkspaceChatHTTPRoutes' -count=1`.
- Full focused packages passed: `go test ./internal/workspacechat ./internal/api -count=1` (workspacechat 5.633s; API 62.503s).
- Read-only inspection of the live audit conversation returned status `idle`, zero messages and zero provider requests. No archive or other mutation was sent to that user conversation.

These tests verify the Orchestra API/service boundary with disposable fixtures; they do not establish a desktop click-through or modify any live chat.
