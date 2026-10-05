# Project / worktree / session sidebar receipt

## References inspected before implementation

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`, `apps/web/src/components/Sidebar.tsx`: thread rows carry project, branch and worktree identity; Git cwd resolves from the actual thread worktree before the project root. Selection preserves thread identity rather than deriving a directory from a branch label.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, `src/renderer/src/lib/sidebar-worktree-activation.ts`, `src/renderer/src/components/sidebar/WorktreeCardAgents.tsx`, and `WorktreeCardAgents.activation.test.tsx`: user activation selects the owning workspace first, then resolves the exact agent tab/pane; missing or malformed identity never falls back to another worker. Repository/worktree/agent hierarchy matches the supplied Orca screenshot.
- Runtime reference applications were not exercised for this package. These are source observations, not E2E evidence. No reference source was copied.

## Follow-up UI refinement

Inspected additional pinned Orca `src/renderer/src/components/sidebar/worktree-list/rows/repo-header-project-actions.tsx`, `WorktreeCardMeta.tsx`, and `worktree-card-compact-agents.tsx`. Repository controls are separate from row activation; metadata uses compact branch badges; agent summaries have their own disclosure and avoid propagating activation. T3 `SidebarThreadHeader.tsx` confirms search occupies the flexible header width with compact scope/add/new controls beside it. Orchestra adopts the layout pattern with 13px project/branch labels, muted project refresh/create actions, a bordered active primary checkout, truncating nested agent rows, status icons and an independent agent-count disclosure. Every control is backed by existing behavior; unavailable worktree migration and provider actions are not presented.

Observation rows are fenced by backend URL/credential/project identity. Changing backend hides previous worktree/session controls immediately until the new observation arrives. The refreshed UI tests independently cover disclosure without navigation, empty search results and stale-session prevention after backend switching.

Follow-up verification: six tree tests pass, scoped ESLint has zero errors, and desktop typecheck passes. T3 collaborative browser `tab_4` showed the live renderer but its browser-only default backend `127.0.0.1:4010` was disconnected; it therefore showed no populated projects. This browser observation does not validate the populated native Electron sidebar or real provider activity. Native fixture verification remains assigned to the integrating agent.

## Task identity collision follow-up

The task inspection adapter now passes stable task/cache ID before the display label and includes backend credential/project ownership captured by the tree. Scoped inspection fetches full task details directly, validates returned task and project identity, and discards late details after backend or project changes. It does not write a returned task workspace into another project's explorer state. GitHub virtual issue cache lookup is constrained to the owning project; an unscoped repeated `GH-N` label is rejected rather than opening the first global match. Existing unrelated unscoped inspection remains supported.

Ten combined tree and issue-action tests pass, covering duplicate GitHub numbers across projects, stable cache IDs, wrong-project task responses and late responses after backend identity changes. Desktop typecheck passes. The read endpoint now delegates to the shared `workspace.ListGitWorktrees` utility used by orchestration control; both real Git/HTTP tests pass after that adaptation.

## GitHub mutation ownership follow-up

GitHub virtual promotion, update synchronization, deletion and session-stop checks resolve stable cache IDs or labels within the selected/inspected project. Ambiguous identities, absent project context and URLs that disagree with the registered GitHub owner/repository fail closed. Every awaited mutation/refresh fences backend credential identity, project selection and registered repository metadata before any subsequent effect. A changed context reports that the previous action may have landed and requires inspecting the original project; no automatic replay was added. Promotion validates the returned local task's owner before linking its original GitHub URL. Failed remote closing retains the virtual task; successful dismissal removes only that exact project's task from board/backlog caches. New task creation captures project identity before its first await and cannot publish a GitHub issue after changing backend/repository context. Partial GitHub publication/link failures now identify that the local task already exists.

Additional pinned source correlation: T3 `apps/server/src/orchestration-v2/ThreadPullRequestService.ts` resolves canonical repository identity and checks workspace snapshots before PR state updates. Orca `src/cli/handlers/orchestration/mutation-request.ts` retains one mutation request identity through unavailable retries. Orchestra borrows identity/snapshot gating; this hook deliberately does not add transport retry because its existing endpoints do not expose durable replay receipts. Inspection/source correlation does not prove remote GitHub E2E reliability.

Focused verification after this follow-up: hook + App smoke tests report 41 passed and two existing skips, including selected-repository promotion, exact stable-ID dismissal, ambiguous label rejection, mismatched GitHub URL rejection, failed close retention, wrong-owner promotion responses, late backend changes before linking/publication, and late project changes before cache dismissal. These use mocked HTTP client boundaries; actual GitHub mutations and provider sessions are not claimed verified by them.

## Orchestra adaptation and deliberate boundaries

- Backend lists real Git worktrees with NUL-separated porcelain output and a bounded subprocess. The registered project root is the native-chat owner, including when the project itself is a linked checkout. Worktrees outside configured allowed roots are excluded; an unauthorized registered root returns 403.
- Sidebar selects a project before requesting its exact observed native-chat session. The request captures backend URL, credential identity, project and session; it remains memory-only. A monotonic request identifier prevents an older completion from clearing a newer request. The chat owner consumes this request without sending a message automatically.
- Issue-linked worktree rows inspect the existing task. A branch with multiple linked issues requires selecting the particular issue. Unlinked Git worktrees are shown as observation-only. The plus action uses existing issue-backed task creation instead of creating an untracked worktree.
- Unlike the references, Orchestra native chat remains bound to the registered checkout. This change does not add arbitrary worktree chat, worktree filesystem browsing, branch checkout, terminal reassignment, or provider session migration. It never invents a worktree path from a branch name. Global orchestrator behavior is a separate package.

## Independent verification

- `go test ./internal/api -run 'Test(ProjectWorktreesRealGitHTTP|ParseProjectWorktreesDetachedLockedPrunable)' -count=1`: passed. Real disposable Git repository, committed main branch, linked checkout with spaces, detached outside-root checkout, SQLite projects and HTTP router verify branch/path identity, registered linked-checkout ownership, outside-root filtering, 403/404 and detached/locked/prunable parsing.
- `npm run test -- src/features/projects/ProjectWorkspaceTree.test.tsx src/core/store/slices/workspace.slice.test.ts`: 29 passed. Sidebar activation verifies exact backend/project/session identity, rejection of foreign-project rows, linked-task inspection, read-only unlinked checkout and protection against stale request clearing.
- Native Electron rendering and real signed-in provider turns have not been verified by these tests. The renderer tests mock observation endpoints; the backend tests independently exercise real Git and HTTP. Root integration must verify chat request consumption and task inspection callbacks.
