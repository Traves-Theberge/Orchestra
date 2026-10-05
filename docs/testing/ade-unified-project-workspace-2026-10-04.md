# Unified project workspace and project sources

## References

T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`:
inspected SidebarThreadHeader, Sidebar, CommandPalette, useNewProject and
packages/client-runtime/src/operations/projects.ts. Sidebar controls combine
search, project scope, add-project and new-thread actions. The source chooser
separates local folders, new repositories and clones. Creating a project opens
a thread draft after registration; repository publication is a separate action.
The new-project hook documents a managed folder and initial commit.

Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`:
inspected src/renderer/src/components/sidebar/AddRepoStartSteps.tsx. Local browse,
clone, create and remote-host entry points are distinct, with explicit readiness
and keyboard selection. Its project/worktree hierarchy is separately recorded
in ade-project-workspace-tree-2026-10-04.md. Neither reference runtime was used
to certify these flows.

## Adaptation and deviations

Projects replaces the separate Development navigation entry. Old CONSOLE state
still opens the same workspace, preserving restored navigation. One registered
project owns native chat, editor/browser/terminal tools, Git and PR review, tasks
and settings. Git review uses the resizable right tools pane beside mounted chat.
Task/project settings retain the existing issue board and integration controls.
The old embedded Studio/Create with AI journey and its UI state were removed;
persisted backend authoring data was not deleted.

Project toolbar/source chooser structure adapts T3; its MIT notice is retained
in docs/licenses/t3-code-project-controls.txt. Orchestra's pen action creates an
issue-backed Kanban task instead of a T3 thread. Available sources are local
folder, new repository, Git URL and GitHub owner/repository. Provider-specific
Azure/Bitbucket repository discovery is not advertised; their Git URLs may use
the generic clone flow. No implicit remote publication occurs.

The Go backend validates access before creating an exclusively owned destination.
Existing folders are never overwritten. New repositories receive an initial
empty commit using invocation-scoped Git identity, allowing task worktrees.
HTTPS credentials/passwords embedded in URLs are rejected; SSH usernames are
allowed. Git prompts are disabled and setup has a two-minute bound. Failed
destinations are retained for inspection. The desktop refreshes registration and
opens the actual catalog project/root. Backend registration responses are typed
as IDs rather than pretending they contain full project records.

GUI source operations do not establish unavailable CLI project-import commands.
The CLI skill must be read for supported executable commands.

## Verification

- Real Git + HTTP + SQLite new/clone registration test verifies destination
  identity, matching clone HEAD, default main branch and successful task checkout.
- Source guards test verifies traversal/unknown source/URL credential rejection,
  authorized parents, existing user data preservation and failed-clone retention.
- App smoke plus WorkspaceChat renderer integration: 66 passed, 2 skipped after
  sidebar/history response validation. Malformed catalogs produce an observation
  error rather than crashing the workspace or being treated as empty success.
- New renderer coverage checks backend-scoped sidebar conversation selection,
  no automatic message delivery, and preserving chat while changing project views.
- Native Electron workspace-controls audit is implemented; final execution
  evidence will be appended after the backend/frontend integration build.

## Native UI integration observation

On 2026-10-04, the built production renderer/preload and a newly built managed
Windows backend passed `node scripts/launch-electron.mjs
scripts/electron-smoke.cjs --workspace-controls` (exit 0). This created a real
Git repository through the source chooser, opened its registered workspace,
maximized/restored the right tools pane without remounting chat, and opened Git
beside chat. Capture: `apps/desktop/reports/electron-smoke-launch.png` (local,
ignored audit artifact). The initial screenshot exposed an overly wide changes
list in the narrow Git pane; responsive refinement is recorded in the Git handoff.

Both right-pane references were inspected: T3's PanelLayoutControls and
PreviewPanelShell provide contextual expansion/layout controls; Orca's
TerminalSplitWorkspaceSurfaces preserves workspace-owned terminal surfaces.
Orchestra places file search/explorer inside the right tools surface and retains
the left sidebar for projects/worktrees/sessions. Its maximize action fills the
application workspace, rather than invoking operating-system fullscreen.

Desktop validation before final responsive/task-fence followups: 85 test files,
571 passed, 2 skipped; TypeScript passed, production build passed. ESLint had
zero errors and existing warnings; newly unused sidebar imports were removed.
The additional requested-conversation navigation test passed separately.

The smoke uses an empty owned Git config file: Node's Windows device-null path
is unsuitable as Git's global configuration filename. All provider/config/temp
homes remain isolated. No real provider inference is sent by this UI audit.

Final integration on 2026-10-04: desktop suite 86 files, 588 passed and 2 skipped;
TypeScript and production build passed; ESLint zero errors, 127 warnings.
The full native backend Go suite passed, with new control/race details in
`ade-global-orchestrator-control-2026-10-04.md`.

The final native command added `--pr-visual-fixture` and exited 0. The underlying
project creation, main worktree registry, file sidebar, maximize/restore and Git
navigation use real local Git and API operations. Only GitHub reads in the
disposable project are intercepted for a merged PR fixture; GitHub writes are
forbidden. Summary/Timeline/Code, file review conversations, binary-file status
and disabled mutation controls were exercised. Local captures:
`apps/desktop/reports/pr-visual-{summary,timeline,code,code-narrow}.png`.
The narrower capture checks that review action buttons stay within the tools
pane. Initial fixture catalog and diff-layout issues were corrected before this
final run. This is populated native renderer evidence, not a hosted GitHub canary.

Remote authenticated clone, signed-in provider turns and external tracker
completeness require their own independent observations. They are not proved by
local fixture registration or renderer tests.
