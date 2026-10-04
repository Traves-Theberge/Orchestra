# Unified task workspace

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 03, 05, 06 and C1. Outcome: opening a card restores one coherent task context across native provider conversation, configuration, editor, terminal, browser and review. Native chat is the primary working pane; terminal access supports diagnostics and providers whose interactive capabilities remain unsupported.

## Files and boundaries

Existing: `features/workspace/WorkspaceLayout.tsx`, `SplitLayout.tsx`, tab groups, file explorer/editor/browser components, core workspace/editor/browser/terminal slices and types, task inspector, Studio/embedded-agent chat components, terminal API/manager and Electron filesystem/preload/main code.

Proposed: TaskWorkspace shell, task-context store/API, persisted layout DAO or versioned client persistence, task-scoped preview/process registry and typed chat/request rendering. Reuse visual components without conflating Studio authoring, embedded assistant chat and CLI execution sessions.

## 07.0 Project onboarding and issue-owned worktrees

User clarification on 2026-10-04: follow the supplied project-source and Create Worktree interfaces from T3 Code/Orca. A task is a repository issue; its execution takes place in an associated worktree. Preserve Kanban and separate repository identity, checkout/environment, issue identity, worktree identity and provider session. Creating a worktree must not imply that an agent started or an issue completed. Multiple attempts may reference the same verified worktree; concurrent worktrees must have explicit identities.

Pinned inspection and current access fixes are recorded in the [audit handoff](../../../testing/ade-audit-launch-handoff-2026-10-04.md). Reference runtime reliability remains unverified. The supplied screenshots define the desired interaction model; do not claim an exact screenshot menu appears in every pinned source. Orca's pinned Add Project start choices differ from its pictured menu, while its composer retains the project/host/base/source/agent/advanced separation.

Execute these slices in order. UI/UX work can use these contracts while backend behavior is completed; advertise only implemented capabilities.

### A. Register an existing repository

- [x] Separate local repository access from audit/provider HOME. Start native browsing at the real user folder and pass explicit project roots to the managed backend. Prove authenticated registration/tree/file/Git reads and restart retention with an actual disposable repository outside audit HOME; reject an outside-root path.
- [x] Propagate registration errors; retain the entered path/dialog and display picker/backend failures rather than closing as success.
- [ ] Authorize before Git inspection, canonicalize paths and check canonical authorization again. Resolve Windows casing, symlink/junction escapes and repository-root identity before persistence.
- [ ] Validate an existing Git repository. Importing a subdirectory or linked worktree must resolve to the same repository identity rather than silently creating duplicates. If plain-folder workspaces are retained, expose them as a separate capability.
- [ ] Preserve existing project metadata on repeat import and persist the checkout on its owning environment. Return a structured registration result with identity and canonical path.
- [ ] Verify nonexistent/non-Git folders, canceled picker, duplicate import, linked worktree import, junction escape and backend rejection. Native picker retry itself remains a manual audit check.

### B. Add project source selection

- [ ] Add a searchable, keyboard-accessible source chooser: New project, Local folder, Git URL and GitHub repository. Other catalog providers show unavailable/setup-required according to actual backend capability; do not present a successful-looking placeholder flow.
- [ ] New project: name, destination and environment; initialize only an owned fresh destination. Establish HEAD for worktrees with explicit scoped Git identity, or retain a registered project with an actionable initial-commit warning and disable worktree creation until HEAD exists. Never change global Git/provider configuration.
- [ ] Git URL: URL and destination preview, noninteractive clone, progress/cancel, per-target operation identity and locks. Register only after successful clone. Cleanup must prove ownership and finish before retry; existing contents must survive every failure.
- [ ] GitHub repository: discover configured connection, search/select repository, then use the same clone contract. Authentication/setup failures remain visible. Add other providers only through their real discovery/clone capabilities.
- [ ] Verify local bare-remote clone, failed clone, cancellation, occupied destination, concurrent duplicate requests and restart reconciliation. Hosted authentication requires a separate authorized canary.

### C. Create or select the repository issue

- [ ] Make project/environment selection explicit when creating a Kanban task. Resolve source context against that repository; persist provider, repository identity, issue number/URL and stable task ID separately.
- [ ] For a hosted issue source, create the issue through that repository's configured provider and retain its mutation receipt. An offline local draft is explicitly unsynced, not a fabricated GitHub issue.
- [ ] Smart source entry accepts a title, issue number/URL, branch or PR only when it can resolve the relevant repository identity. Reject cross-repository mismatches; distinguish existing issue, new issue and existing branch.
- [ ] Preserve the repository issue link when creating the execution worktree and later PR. Test duplicate issue delivery, failed/ambiguous hosted creation and issue changes while creation is pending.

### D. Expose explicit worktree preparation

- [ ] Introduce a typed, independently callable prepare/create operation used by both manual UI and automatic issue dispatch. Input: project, environment/checkout, task/issue, source/base ref, requested branch/name and requested agent configuration.
- [ ] Composer follows the supplied model: Project, Run on, Create From/base, source/name, Agent, Advanced and Create more. Show resolved destination, branch and issue link. Unsupported environments/agents/options reject before filesystem or setup effects.
- [ ] Resolve base to a commit without switching the main checkout. Keep creating a new branch from a source distinct from checking out/reusing an existing branch. Verify existing checkout ownership against Git's worktree registry instead of reusing any directory that exists.
- [ ] Allocate a durable worktree identity and operation receipt. Persist canonical path, repository/task/environment identity, branch, base SHA and creation state; reconcile interrupted creation. Do not persist only a guessed deterministic path.
- [ ] Keep parent-worktree lineage optional and separate from base selection. Advanced setup shows command/config provenance and explicit run/skip/ask decision. Agent start is a later observable action; setup/agent failure must preserve a truthful worktree result.
- [ ] Verify a real temporary Git repository: create from selected ref, inspect `git worktree list --porcelain`, branch HEAD and returned path, confirm unchanged main checkout, create two issue worktrees, restart and restore both.
- [ ] Verify invalid/missing base, unborn HEAD, branch/path collision, existing branch checked out elsewhere, locked worktree, missing host, cancellation and setup/agent partial failures. Never remove a pre-existing checkout during rollback.

### E. Open the task workspace and retain it

- [ ] Kanban open-card and composer success resolve the same task/worktree context. Bind native chat, files, terminal, branch/Git and PR panes to that identity; clear or fence stale loads on switching.
- [ ] Show preparing, ready, setup failed, agent not started, running and interrupted independently. Worktree-created is not agent-started; requested agent/model is not an observed effective model.
- [ ] Restore project/task/worktree selection after relaunch. Missing or removed worktrees offer explicit repair; dispatch must use the prepared worktree rather than creating another hidden checkout.
- [ ] Keep archive/worktree removal, branch deletion, issue closure and Kanban completion as separate actions with ownership-aware outcomes. Verify unsaved files and uncommitted work are retained appropriately.
- [ ] Connect the full issue → worktree → agent → review/revision → PR merge flow to packages 03/04/05/C1/C2 and the E2E evidence harness. None of these remaining checklist items is certified by the reference tests or startup smoke.

## 07.1 Introduce explicit task context

- [ ] Define a context containing environment, project, task, run, attempt, workspace path, branch/base/head and configuration version. Resolve its path on the owning backend.
- [ ] Preserve project workspace tabs as a separate mode. Add task workspace tabs keyed by task/workspace identity rather than overloading project IDs.
- [ ] Route open-card/deep-link actions into the right context. A missing/retained/removed checkout must have an explicit state and recovery action.
- [ ] Test two tasks in one project and identically named projects across environments.

## 07.2 Bind every pane to the same context

- [ ] Point file explorer/editor/search at the resolved task checkout. Prevent stale asynchronous loads from overwriting a newly selected task.
- [ ] Associate terminals with workspace/attempt and show their working directory. Preserve independent user terminals without confusing them with the agent process.
- [ ] Scope browser tabs, preview ports and screenshots to task/worktree identity; allocate different ports for concurrent local dev servers.
- [ ] Bind changes/review panes to the task's linked PR and reviewed head. Display configuration/evidence in a shared drawer.
- [ ] Add a visible branch/environment indicator so task switching can be checked immediately.

## 07.3 Integrate execution conversation and requests

- [ ] Integrate the persisted native conversation/session service from C1. Render its typed messages/tool calls/results/errors; do not create a second task conversation store. Keep raw logs available for diagnostics.
- [ ] Add steering/send/resume controls only when the adapter advertises support. Distinguish queued messages from delivered messages.
- [ ] Surface durable questions/approval requests from the attention system and route answers through the owning backend. Do not route task input to the unrelated embedded assistant.
- [ ] Retain attachment identity and provenance outside the project where required; avoid accidental access broadening through copies.

## 07.4 Persist and restore workspace layout

- [ ] Store versioned task layouts, open tabs, focused pane, browser URLs and safe editor state. Define where client preferences versus shared task data live.
- [ ] Define unsaved-buffer handling before tab close/restart. Restore recoverable drafts without claiming the file was saved.
- [ ] On reopen, reconcile terminal/process existence rather than creating a duplicate agent. Show disconnected/interrupted when reattachment is unsupported.
- [ ] Migrate existing project layouts without losing tabs. Handle missing files, removed worktrees and corrupt layout data.

## 07.5 Prove browser feedback and isolation

- [ ] Attach captured element context/screenshot/console output to the intended task revision, with page URL, viewport and checkout/version identity.
- [ ] Add responsive viewport presets and preview error indicators if supported by the existing webview. Distinguish human capture from agent browser automation capabilities.
- [ ] Test task switching while file reads, terminal output and browser navigation are in flight. Ensure no cross-task output or edits.
- [ ] Exercise Electron filesystem IPC, webview behavior, terminal reconnect and editor save against the actual task checkout; renderer-only tests are insufficient.

## 07.6 Central workspace control and T3-style terminals

The user explicitly prefers T3's terminal interaction and one central UI across workspaces, with Orca CLI as the shared control model. The [two-reference terminal receipt](../../../testing/ade-terminal-workspace-reference-2026-10-04.md) records implementation/tests inspected and the current runtime gaps. Reference source review and the current audit startup do not prove terminal support.

- [ ] **TW1 — Resource contract and capability truth:** bind terminal ID, process incarnation, backend/environment, task/worktree and canonical cwd; expose list/show/create/input/resize/stop/events through shared control. Reject missing/unauthorized workspace paths and unsupported platform before WebSocket upgrade; never silently open a default cwd.
- [ ] **TW2 — Real platform transport:** implement Windows ConPTY with correct PowerShell/shell discovery and process ownership. Retain POSIX transport and test process-tree teardown separately. Actual echo, Unicode, resize, exit and descendant cleanup must pass per platform before controls show supported.
- [ ] **TW3 — Reconnect and startup:** sequence output with bounded replay and backpressure; isolate slow subscribers from process output handling. Preserve stream framing/errors. Startup/input acknowledgements distinguish bytes accepted from an agent turn starting; reconnection cannot duplicate a shell or replay an unacknowledged command blindly.
- [ ] **TW4 — Central UI and appearance:** project → issue/worktree navigation, visible environment/branch/cwd/status, attention and activity overview, and deep links from Kanban into the same workspace. Adopt focused terminal drawer/tabs/splits, predictable focus/search/clear/copy shortcuts and theme/font/density settings. Persist layout per backend/environment/task/worktree, not a global array of project IDs.
- [ ] **TW4 — Lifecycle controls:** explicitly distinguish hide tab, detach, stop terminal, sleep workspace and remove worktree. A close action that claims to stop must observe process exit; hidden tabs must not imply stopped shells. Build launch menus from actual capability inventory rather than hard-coded legacy provider commands.
- [ ] **TW5 — Desktop evidence:** run two issue worktrees with independent shells, switch while output/file reads are pending, resize and interrupt, disconnect/reconnect, stop, relaunch and reconcile inventory. Verify no cross-workspace output/cwd, no duplicate process, retained layout and truthful unsupported/failed states. Capture real terminal screenshots after transport works; styling alone is not terminal E2E evidence.

## Validation and exit

Run context/store/component tests and Electron E2E scenarios for two concurrent tasks, reopen, missing checkout and unsaved changes. Capture layout screenshots and verify actual filesystem paths.

- [ ] Every pane resolves the same task/workspace/environment after switching and reopening.
- [ ] Browser/dev-server context and configuration remain isolated between tasks.
- [ ] Restored layouts do not fabricate process continuity or duplicate execution.
- [ ] Feedback from a preview reaches the intended task revision.

Handoff: context contract, persistence version/migration, layout evidence and provider capability limitations. Package 08 supplies stronger process survival/recovery semantics.
