# Workspace chat layout and draft-first refinement

## Reference inspection

T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: complete cached ChatCanvas implementation and ChatView header/composer render paths around lines 10826–10868 and 11035–11114 were inspected. One chat header owns thread/project context and workspace controls. The composer is centered for an empty draft, then docked after messages; supporting panels are optional. ChatCanvas owns a constrained conversation lane rather than a permanently reserved empty tools column.

Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: NativeChatComposer draft ownership around lines 74–89 binds unsent input to a stable pane identity across reconnects. Its structured delivery and journal patterns require retaining intent through uncertain outcomes. Both source snapshots were inspected locally; no live reference application was exercised for this refinement. Registry: [pinned sources](../superpowers/plans/ade-2026-10-03/reference-patterns.md).

## Adaptation and deviations

Removed the duplicate WorkspaceLayout heading and default empty tools pane. Workspace controls occupy the chat header; tools open on explicit request or a real new tool tab. Tool visibility preferences remain per project. The composer is immediately editable, centered while empty, and docked after sending. Conversation navigation uses a collapsible list rather than a header dropdown; provider selection moves into the composer. Heading defaults now live in Tailwind's base layer so explicit component sizing wins. Responses/composer use 15px text.

First send creates a conversation using a caller-known UUID, then sends its immutable message identity. A repeated scoped create returns the same receipt; wrong project/provider rejects. Unknown creation can be reconciled by GET. Explicit Retry creating chat reuses the same UUID and preserves unsent text without automatically sending a message. See [service receipt](ade-native-workspace-service-2026-10-04.md) and [UI receipt](ade-native-chat-ui-2026-10-04.md).

Deliberate differences remain: the thread list is workspace-local rather than T3's complete app navigation model; files/terminal tools use Orchestra's existing split panels. Attachments, steering, plan policy controls, task-owned worktree chat and other native adapters remain unimplemented. These are not cosmetic parity claims.

## Actual request-boundary defect

The user's failed creation coincided with a real POST `/chat/sessions` HTTP 415 in the local backend log, followed by repeated 404 reads of the caller-known conversation ID. Chat mutation helpers had JSON string bodies but omitted Content-Type; browsers infer text/plain, which the backend guard rejects. Renderer mocks and prior Python HTTP canaries did not exercise that desktop request construction. This invalidates the earlier implication that the desktop send path was independently verified.

All four desktop chat mutation helpers now explicitly send application/json: create, send, stop and request reply. A client-level regression checks the real fetch options and identity payload, independently of WorkspaceChat's mocked API tests. A rejected creation does not establish provider inference or message delivery.

## Behavioral evidence

- Backend focused race tests for workspacechat/API creation/chat cases passed after optional caller-known session identity integration.
- Client API and workspace layout tests: 20 passed after the JSON-header fix. Scoped lint for layout, response renderer and client regression passed.
- Collaborative browser connected directly to the owned backend at 4014 using its audit profile; no network mocks were installed. Production chat rendered an editable centered draft and one header, with empty tools closed. Browser App configuration fallback left an unrelated stale state banner; this is not Electron-wide E2E certification. [Saved draft screenshot](evidence/ade-native-chat-2026-10-04/native-chat-draft-first.png).
- Actual desktop API helper calls created and repeated conversation `a2783cd3-155e-423f-b19d-0a3ec210398c`, then fetched the same identity. Native mode was reported with zero messages and no provider thread. No inference was requested. Empty-message submission returned invalid_chat_request; stopping the idle conversation succeeded; replying to an absent request returned chat_not_found. These prove the corrected client mutations reach handlers through the real guard, not a successful inference turn.
- Latest native Electron launch logged AUDIT_READY with renderer mounted, authenticated state and current-user provider context on 4014. Backend was rebuilt with the creation-identity extension. Further account-connected coding canaries remain paused under the previously documented trust-write investigation.

Full desktop suite: 78 files passed, 543 tests passed, two skipped. After the last pending-creation navigation/scope refinement, 32 focused chat/layout tests and scoped lint passed. Typecheck passed again; the production build passed before that narrow refinement and retains its existing large-chunk warning. Diff whitespace check passed. The user-requested message was not automatically resent.
