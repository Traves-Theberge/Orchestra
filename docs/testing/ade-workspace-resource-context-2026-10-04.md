# Workspace resource ownership and tools integration

## Reference patterns

Pinned T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: inspected
SidebarChrome, SidebarThreadHeader and PanelLayoutControls. Chat belongs to its
thread/workspace; tools have explicit open and presentation controls. Provider
identity and panel presentation are separate concerns.

Pinned Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected SectionHeader,
worktree-card-surface and compact-agent-row. Project headers group selectable
checkout surfaces; agents belong to actual workspace identities. Selecting a
checkout controls its tools, rather than selecting an unrelated issue inspector.

## Orchestra adaptation

The registered project ID remains the tracker/API identity. A selected Git
workspace has a separate stable ID, canonical path, branch and main-checkout
flag. Child editor/browser/tool groups use a backend-specific resource context.
Chat history, creation and Git requests use the exact selected workspace ID.
Root chat retains the legacy draft key; child drafts and uncertain submission
identities have distinct keys. Hidden chat surfaces remain mounted across
workspace and tool selection. Returning to an editor restores its real project
and checkout rather than setting a synthetic resource ID as a tracker project.

Files & editor opens the actual file tree. Terminal and Markdown creation use
the selected checkout path. Workspace tabs belong to the chat column so the
right tools toolbar reaches the top; the resize handle remains keyboard and
pointer operable with no permanent divider. The tools toggle closes the pane
from Files or Git as well as the normal workspace view. Project navigation is
compact, and task creation remains separate from new agent/worktree creation.

## Deliberate differences and limits

Kanban and project settings remain first-class. No reference implementation is
copied wholesale. Resource context maps and running tool handles are currently
renderer state; durable backend chat records and creation receipts are separate.
No claim is made that browser processes or terminals survive an app update.
Creating an agent records a conversation and requested preferences, sends no
message, and reports no effective model or running provider until observed.

## Verification

- Focused layout/resizing checks: 11 tests pass, including checkout draft
  separation, registered project identity, file entry point and pane toggle.
- Chat draft storage checks include independent root/child recovery identities.
- App smoke/layout/storage follow-up: 40 pass, two existing skips. The first
  full desktop pass had 607 passing and two header navigation regressions;
  both were corrected and independently rerun.
- Full backend `go test ./...` passes, including real Git/SQLite job and scope
  tests. See native-chat/worktree identity handoffs for race evidence.
- Production build succeeds. Native multi-checkout UI verification is tracked
  separately; unit tests and references do not establish live provider E2E.

Final desktop run after toolbar/header/sidebar integration: 93 files pass,
622 tests pass, two existing skips. Typecheck passes; lint has zero errors and
127 pre-existing warnings. Native production Electron smoke independently
creates an actual child via the durable backend, restores root/child editor
groups and same-name file buffers, and displays separately scoped idle native
conversations. The provider has no thread/messages in that fixture; this is
not a live inference/resume claim. Final dialog/+menu native audit follows in
the multi-worktree handoff.

Final follow-up: full desktop suite passes 93 files / 629 tests (two existing skips); backend go test ./... passes and the Windows backend rebuild succeeds. Typecheck and production renderer build pass. After the final sidebar/Kanban/dialog refinements, the focused dialog/Kanban suite passes 10 tests and brand-navigation smoke passes. The persistent interactive audit profile was relaunched with the rebuilt backend on port 4014 and Vite 5174; AUDIT_READY confirms mounting/state. Interactive CLI context uses the current user account, while automated native tests retain isolated provider homes. No live inference claim follows from this readiness check.
