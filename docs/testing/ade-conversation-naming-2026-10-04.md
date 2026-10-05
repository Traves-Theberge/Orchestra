# Conversation naming handoff — 2026-10-04

## Pinned reference receipt

Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`:

- [WorktreeTitleInlineRename.tsx](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/sidebar/WorktreeTitleInlineRename.tsx): inline input selects text; Enter/blur saves, Escape cancels, IME Enter does not commit; whitespace is trimmed and empty/equal input cancels. Its callback changes workspace display name.
- [structured-chat-tab-rename.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/store/terminals/structured-chat-tab-rename.test.ts): structured agent tab custom label is keyed by tab identity; clearing restores the default label. Worktree display title and structured tab label are distinct. No manual chat-label-to-branch rename was found in this path.
- [worktree-default-display-name.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/lib/worktree-default-display-name.ts): custom workspace displayName wins, otherwise branch label, otherwise path basename. [display-name-provenance.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/shared/worktree/display-name-provenance.ts) pins nonblank labels and resets empty labels to automatic branch-derived names.
- [first-work-structured-session-rename.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/agent-hooks/first-work-structured-session-rename.ts) invokes the separate first-work workspace auto-rename hook when a structured session starts working. [first-work-workspace-title-rename.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/agent-hooks/first-work-workspace-title-rename.ts) generates a folder workspace title from context and checks that manual naming did not supersede generation.

T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`:

- [Sidebar.tsx](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/Sidebar.tsx), inline rename handlers and commitThreadRename: Enter/Escape and blur commit handling; trim/nonempty validation; title mutation calls updateThreadMetadata with environment and thread scope. No worktree/branch mutation in manual title rename. [ChatView.tsx](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/ChatView.tsx) was also searched for title/worktree coupling; no corresponding manual title-to-worktree inheritance path was identified there.

These are source observations and reference test contents, not claims of reference runtime reliability. No runnable reference UI was inspected.

## Orchestra adaptation and deviations

`WorkspaceChat.tsx` keeps the h2 title inline editable, including a conversation that has not yet been created. Draft names persist in the credential-digest workspace receipt; naming does not create a session or dispatch a turn. First actual session creation sends the explicit draft name. Recovery preserves that name alongside its immutable creation UUID.

The backend snapshots the selected observed worktree branch as the default conversation title, with observed path basename for detached checkouts. The existing GitWorktree contract has no independent displayName store; using its actual branch label is an explicit adaptation, not a claim of an Orca displayName link. Nongit and orchestrator scopes keep `New conversation`. An explicit creation title overrides inheritance. Edited names are independent app metadata: no Git branch/path rename, inferred first-prompt generation, provider/model/thread change, or future automatic worktree-title propagation is implemented.

`PATCH .../chat/sessions/{id}/title` requires `{title, expected_title}` and returns Session. Both project and orchestrator routes require authentication. Titles are trimmed, valid UTF-8, 1–200 Unicode codepoints. SQL compare-and-swap rejects stale editors with 409. Exact project/workspace membership must hold. A replay of the immutable creation UUID returns its current edited title. Renderer reconciles a lost mutation response with a scoped GET before claiming success and rejects foreign observations before rendering them.

## Verification

- `go test ./internal/workspacechat -run TestTitle -count=1`: real Git worktree inheritance, SQLite persistence/reopening, scope rejection, optimistic stale-editor rejection, immutable creation replay, Unicode validation, no new messages/provider identity change.
- `go test ./internal/workspacechat ./internal/api`: service and HTTP contracts; API rename authentication, validation, 409 conflict and project scope tests; protected-route auth matrix includes both new PATCH routes.
- `npx vitest run src/features/workspace/chat/WorkspaceChat.test.tsx src/features/workspace/chat/chat-draft-storage.test.ts src/core/api/client.test.ts`: 68 tests passed, including inline rename, lost-response read reconciliation, foreign observation rejection, new draft name restore without create/send, and exact client URL/body scope.
- `npm run typecheck`: passed after combined dialog styling settled. Root final validation owns the native live smoke. These tests do not establish provider E2E reliability; consult the separate native smoke receipt for live observations.
