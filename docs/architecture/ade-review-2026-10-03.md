# Orchestra ADE review and development roadmap

Reviewed on October 3, 2026 against checkout `bea2d11` on Windows. This assessment covers the current implementation, verification gaps, ideas from T3 Code and Orca, and a proposed sequence for development.

Keep the Kanban board as the main way to manage work. Make each card the entry point to a complete task workspace, and make the board show where human attention is needed. Before expanding that experience, establish a reproducible build and prove the core task lifecycle. The current checkout fails both backend and desktop build checks, and no complete real-agent workflow was verified during this review.

The refined interface requirement is a first-class native provider chat experience alongside Kanban, backed by a model-independent orchestration API, CLI and MCP interface. Users and capable external models should be able to drive and observe multiple scoped orchestrations, drill into worker conversations and intervene without losing task/workspace context. The [execution plan](../superpowers/plans/ade-2026-10-03/README.md) decomposes this into core packages and dedicated native-chat/control-plane tracks.

## Evidence and limits

Implementation is not proof of functioning behavior. Throughout this report:

- **Present in code** means relevant implementation was inspected.
- **Tested in isolation** means an automated check passed in this checkout; it does not establish an integrated workflow.
- **Verified E2E** requires an observed user action through the real app, backend, agent and workspace, with the resulting state and artifacts checked.
- **Reliability established** additionally requires repeated execution and failure/recovery evidence under a stated environment and provider version.
- **Blocked** means a prerequisite prevented verification. **Unknown** means evidence has not been collected. Neither means success.

No capability in this report is classified as reliable or verified E2E. Source review is broad but is not a line-by-line audit of every handler. External product capabilities are documented by their maintainers; they were not independently tested. Recommendations are design proposals, not claims that those products will perform better in our environment.

The repository already contains an [agent E2E matrix](../testing/agent-e2e-status.md) and an [issue lifecycle test plan](../testing/issue-lifecycle-e2e-test.md). The matrix records every provider and lifecycle step as not yet run. Its creation checklist says Todo, while the lifecycle plan and current board start at Backlog. Reconcile this before treating it as an executable specification.

## Baseline checks performed

Desktop dependencies were absent and were installed using `npm install --no-audit --no-fund`. Installation completed; npm reported React peer compatibility warnings in the Mosaic drag-and-drop dependency chain and pending install-script approvals. Dependency installation does not establish packaged Electron runtime readiness.

| Check | Observed result | What it establishes |
| --- | --- | --- |
| Backend `go test ./...` | Failed | Windows API compile failures plus failures in agent, log, Git and workspace packages |
| Desktop `npm run typecheck` after installation | Failed | Missing `./tools/orchestra-tools` import in `EmbeddedAgentProvider.tsx` |
| Desktop `npm run build` | Failed | The same missing module prevents production bundling |
| Desktop `npm run test` | Failed | 62 test files passed, three failed; 442 tests passed, four failed; `App.smoke.test.tsx` could not load |
| Desktop `npm run smoke:ops:go` | Failed | Spawned backend failed compilation and never became ready within 20 seconds |
| Collaborative browser at localhost port 5173 | No app available | Navigation reached an error page; no visual or interactive application verification completed |

The backend API calls `syscall.Umask` in `internal/api/agent_providers.go` and `internal/api/unsandbox_config.go`, which does not compile on Windows. Agent tests also expect `sh` on PATH. Other observed failures involve configuration discovery, `latest.log` symlinks, and Windows path representations. These findings establish limitations of this Windows baseline; they do not establish the status of Linux or macOS.

The four desktop test failures are two provider-panel routing assertions in `AgentsDashboard.test.tsx` and two Global-only selector assertions in `ProjectSelector.test.tsx`. Determine whether each is a regression or a stale assertion before changing either implementation or tests.

The embedded-agent module name is matched by `.gitignore`'s broad `**/*orchestra*` pattern. `git check-ignore` confirms that the missing path would be ignored. This is a plausible explanation for an omitted source file, not proof of how it was lost. Review ignore rules for source and lockfile exclusions as part of clean-checkout reproducibility.

The API smoke script is an HTTP operations check. Even a passing result would not prove Electron behavior, real provider authentication, agent execution, browser interaction, remote execution, or shipping a real change.

## Current implementation inventory

All E2E and reliability statuses below remain unknown or blocked by the baseline failures.

| Area | Implementation evidence | Gap to verify or refine |
| --- | --- | --- |
| Task board | Five columns, board/list views, project filtering, column dragging, task dragging, create/start/stop/delete actions, assignee picker, backlog readiness hints, running/retrying messages | No demonstrated integrated lifecycle; missing attention views, saved filters, durable ordering and rich delivery signals |
| Task authoring | Studio chat, structured drafts, criteria, attachments, provider guidance, template store and backend MCP tools | Prove conversation continuity, draft edits, project isolation, push/discard, reconnect and cleanup with each provider |
| Scheduling | Orchestrator claims, concurrency limits, retries/backoff, stall detection and tracker reconciliation | Prove no duplicate dispatch, correct cancellation, restart behavior, exhaustion and idempotent finalization |
| Dependencies | `WorkItem.BlockedBy` and dispatch checks for unresolved blockers; orchestrator tests passed | This is an existing primitive; a complete editable task DAG and dependency UX were not established |
| Agent execution | Registry and adapters for Codex, Claude, OpenCode, Gemini and 8gent; events, tools and token usage | Verify provider capabilities separately; provider presence is not interoperability or reliable execution |
| Remote execution | Runtime targets and transport code for Tailscale and Kubernetes, plus Unsandbox integration code | Prove file/credential ownership, connection failure, cancellation and local/remote path correctness |
| Workspaces | Worktree creation, base/branch metadata, hooks, diff/artifact access, cleanup and path guards | Windows tests fail; validate isolation, dirty-tree protection, setup failures, cleanup and concurrent environments |
| Task inspection | Metadata, plan progress, logs/session, diff, artifacts and activity surfaces | Reconnect them around one task workspace; distinguish reported progress from checked results |
| Editor and terminals | Monaco, file explorer/search, Xterm, terminal backend and split/tab layouts | Verify save/reload, correct working directory, resize, reconnect, scrollback and task switching |
| Git and PRs | Staging, commits, branches, stash, conflicts, diff viewer, PR creation/review/merge surfaces | Prove integrated PR lifecycle and failure visibility; line-anchored feedback to agents is a gap |
| Browser | Embedded browser tabs, navigation and element capture context | Tabs are project-scoped in the store; task/worktree scoping and a complete collaborative automation loop need verification/design |
| Tracker integration | SQLite, GitHub, Linear, Jira and registry abstraction | Operations differ by adapter; GitHub creation and search contain explicit unimplemented paths |
| Notifications | Completion sound and browser notification hook | No durable actionable attention inbox established |
| Analytics and budgets | Usage scans, provider analytics, pricing and budget persistence/utilization code | Prove measurement accuracy; budget records do not prove scheduler admission or run enforcement |
| Embedded assistant | Chat, direct LLM providers, tool families, voice, generative UI, watches and delayed actions | Missing tool module blocks app build; distinguish this assistant from CLI task execution and Studio |
| TUI and contracts | Separate Go TUI, API DTOs, JSON schemas and protocol documentation | Verify parity and compatibility; TUI execution was not tested in this review |

Inspected entry points include `features/kanban/KanbanBoard.tsx`, `features/issue-detail/IssueDetailView.tsx`, `features/studio/`, `features/git/`, `features/workspace/`, `core/store/`, and backend `internal/app/run.go`, `internal/orchestrator/state.go`, `internal/api/state.go`, `internal/agents/`, `internal/studio/`, `internal/workspace/`, `internal/tracker/`, and `internal/db/`.

## Specific behavior and reliability concerns

### Completion is stronger than the evidence

In `internal/app/run.go`, a successful agent result removes its running entry before commit/push and workflow finalization. It can automatically commit and push even for the Todo planning phase. Commit and push failures are logged while later workflow transitions can continue.

Execution plan extraction also replaces every unchecked checkbox with a checked checkbox when an extracted plan has no checked items. A successful provider run therefore can manufacture apparent plan completion. Unchecked-item continuation is present, but this fallback weakens it. The same path sets `effectiveMaxTurns` to one while separately consulting a turn-count condition for unfinished plans; the actual repeated-dispatch behavior needs explicit tests.

**Proposed change:** Separate agent turn completion, finalization, verification, review readiness and delivery. Record success/failure for each. Preserve unchecked or unknown criteria unless backed by evidence. Treat an agent summary as a claim; test results and review decisions should be separate records.

### Lifecycle columns also trigger execution

Todo triggers planning and successful planning advances to In Progress; execution then advances to Review. The board's Todo Play action moves directly to In Progress, which may skip planning. This may be intentional, but the product needs explicit commands for queue, plan, execute, retry, stop and request changes so users understand the effect.

Board dragging and backend transitions differ: the board treats Done as terminal, while the API permits Done to return to Todo or Backlog. The board accepts Review-to-Todo dragging but the API also accepts Review-to-In Progress. Assignee changes appear on cards outside Backlog, while the API locks `assignee_id` outside Backlog. These are source-level inconsistencies; their actual user-visible failures require integrated reproduction.

**Proposed change:** Return allowed actions and reasons from one backend policy. Keep drag movement as a convenience over those explicit commands. Make rejected actions visible and retain the prior state.

### Closing a task is coupled to committing and cleanup

`PatchIssue` can auto-commit on Review or Done. It prefers the task worktree if found but falls back to the project root. That makes unrelated project changes a risk when task checkout resolution fails. Done can initiate worktree cleanup without the transition validator checking merge or verification evidence. The task inspector labels this action Close.

The commit helper stages all changes with `git add -A`. Cleanup uses `git worktree remove --force` and then best-effort `git branch -D`. Those are concrete reasons to prioritize this path: committing before cleanup is not a sufficient safeguard if commit fails or the branch has not been retained remotely. No data-loss scenario was executed during this review.

**Proposed change:** Keep close/cancel distinct from completed delivery. Do not fall back to the project root for task commits. Verify ownership and retained changes before cleanup; make cleanup its own recorded operation, with recoverable failure and an explicit retention policy.

### Restart persistence is partial

`PersistStateToDB` replaces the stored running snapshot. `RestoreStateFromDB` reconstructs a subset of fields and resets start/event timestamps to the current time. Retry state, original timing, worktree context and cancellation functions are not reconstructed by those methods. This is persistence scaffolding, not proof that live processes can be reattached or that restart cannot duplicate work.

Electron invokes `stopManagedBackend()` on quit. A separately managed backend is a different deployment mode, but the packaged managed lifecycle does not establish that agents survive closing the UI. Workspace splits and open tabs are held in Zustand without a general layout persistence mechanism in the inspected store; individual preferences do persist.

**Proposed change:** Define UI-close, backend-crash and host-reboot semantics separately. Restore durable identity and work context, reconcile process ownership, and show interrupted work honestly. Never reconstruct a live run solely from a stored row.

### Events and human requests need durable identity

The PubSub bus is in memory and drops events when a subscriber buffer fills. Snapshots can help reconstruct current state, but an actionable question must not depend on receiving one transient event. Provider adapters recognize input/approval signals; the main task path passes `AutoApprove: true`, and its returned-error path generally schedules retries. Recognition of a signal is not a complete human response workflow.

**Proposed change:** Persist requests with task/run/provider request IDs, response capabilities and resolution state. Provide a durable attention inbox. Do not treat waiting for a human as an ordinary transient execution failure. Reconnect from a cursor or versioned snapshot and recover missing actionable records.

### Provider switching is not a complete handoff

The `request_handoff` tool changes the assignee and relies on a later turn cycle. It does not by itself establish transfer of conversation, verification state, filesystem ownership or outstanding questions.

**Proposed change:** Define a portable handoff containing goal, decisions, current branch/SHA, changed files, remaining work and verification evidence. Resume native sessions only when the provider supports it. Label unsupported behavior rather than promising uniform resume/fork/revert.

### Some advertised integration paths remain incomplete

The GitHub adapter's `Search` and `Create` delegate to `SearchIssues` and `CreateIssue`, which explicitly return not-implemented errors. Separate GitHub issue/PR utility endpoints may have other implementations; that does not complete these tracker paths. Exercise the exact route used by Studio and task creation for each issue-source configuration.

Studio read-only worktrees use file permissions. That is not sufficient evidence of a robust agent sandbox, especially across operating systems. Validate the actual provider policy and writable scope in the supported environments.

## Agent configuration persistence and application

Agent configuration is a core acceptance requirement across Agents settings, task authoring, saved tasks, workspace preparation, actual provider execution and restart. A successful settings save is only the first link in that chain. We need evidence that the requested configuration is the configuration the launched agent actually uses.

Additional source findings from the configuration trace:

- Studio stores `suggested_model` and `max_turns` as separate draft fields. `Manager.Push` transfers the suggested provider and serialized `agent_guidance`, but does not explicitly transfer those separate model/turn fields into the task. `SetModel` and `SetMaxTurns` update the separate draft fields; they do not merge them into guidance. This is a concrete transfer gap in the inspected path.
- SQLite permits updates to `agent_guidance` and acceptance criteria, but its task SELECT lists omit those columns. Persistence of a database value therefore does not establish retrieval through the canonical task object or dispatch consumption.
- `TurnRequest` has no explicit model/effort fields. Providers may read native configuration or command settings, but per-task model application was not established. The dispatch path passes `AutoApprove: true`, a fixed timeout, and separately hardcodes effective turn continuation to one. These need to be reconciled with visible task/provider choices.
- Task `DisabledTools` is copied into runtime entries and used to filter Orchestra-provided tool specifications. This is implementation evidence for that subset of tools, not proof that native provider tools, hooks, skills or separately configured MCP servers are restricted.
- Provider settings endpoints support various global/project file scopes. A newly created Git worktree contains tracked files from its selected revision; that does not automatically include ignored or uncommitted project settings. `EnsureWorktree` does not itself implement a general provider configuration materialization step. Hooks or provider discovery may supply additional behavior, which must be tested rather than assumed.

**Proposed contract:** Define explicit precedence for task overrides, project settings and provider/environment defaults. At dispatch, resolve and validate an effective configuration, then persist its version/hash and provenance against the run. Show both the requested and effective values, including any unsupported option. Changing a global setting must have documented behavior for queued tasks, future runs and already-running agents.

Keep credentials referenced through the appropriate environment/account identity; do not serialize secrets into task snapshots or copy entire global config directories into worktrees. Materialize only the required provider settings and instructions in the correct workspace, or pass supported options directly. Preserve project files and retain provider-native semantics where required. Retries and revisions should explicitly retain the previous configuration or record a new version.

| Configuration E2E scenario | Required proof |
| --- | --- |
| Save and reload Agents settings | Exact values read back through UI/API and native file; correct global/project scope; survive backend and app restart |
| Studio draft to saved task | Provider, model, effort where supported, turn limit, tool restrictions and guidance survive push, task reload and restart |
| Project to new/reused worktree | Tracked, ignored and uncommitted settings have explicit behavior; correct instructions, skills, hooks and MCP configuration discovered by the real provider |
| Task to running agent | Launch request/native configuration and provider-reported metadata agree with the displayed effective configuration; permission behavior exercised with an actual tool request |
| Override precedence | Conflicting global/project/task values resolve as documented; UI shows their source; no silent substitution |
| Retry, revision and provider handoff | Configuration retained or explicitly versioned; unsupported options surfaced; credentials and context belong to the correct environment |
| Concurrent tasks | Different models/tool policies stay isolated; one task's configuration save does not mutate the other running agent |

Use a recording fake adapter for precise launch assertions, then a real-provider canary to confirm native discovery and enforcement. Both layers are needed. Configuration persistence and application remain E2E unverified in this checkout.

## PR review persistence and task linkage

PR review must be a continuous task workflow: create or link the correct PR, inspect its current changes, request revisions, preserve feedback, re-review the new head, observe checks and merge/close, then update the task and retain the right artifacts. GitHub review state and local agent revision feedback are related records with distinct effects.

Additional source findings from the PR trace:

- PR creation stores `pr_url` on the issue after creating/finding the remote PR. A failure to save that URL only emits a warning; the endpoint still returns success. A remotely created PR can therefore become detached from the task's persisted link.
- The PR creation path can continue to the GitHub create request after both normal and force-with-lease push attempts fail. This should produce an explicit finalization outcome rather than implying that current local changes were published.
- `PRReviewView` loads the diff and reviews by project/PR number and submits a body plus review event. The inspected view does not implement the proposed local line-anchored revision batch. Its load/submit/merge failures are caught and logged to the console rather than displayed as actionable review failures.
- The view receives PR metadata as a prop. Its `loadData` refreshes diff/reviews, but not that metadata; a merge can leave its header using stale PR state unless the parent refreshes it. Verify that parent refresh and task reconciliation in the integrated flow.
- Review and merge handlers act on a project/PR number. The inspected merge handler returns success without directly updating a linked task. Reliable synchronization from hosted PR status back to the Kanban card is not established by these handlers.

**Proposed contract:** Persist a PR link with repository/host identity, PR number and task/workspace identity, rather than relying solely on a URL. Record the head SHA reviewed, comment anchors, revision batches and resolution status. Refresh hosted reviews/checks/merge state after relevant actions and reconnect. Mark approval and verification stale when their reviewed/tested head changes. Allow explicit linking or rediscovery if remote creation succeeded but the local write failed.

| PR review E2E scenario | Required proof |
| --- | --- |
| Create/link and restart | Correct repo/base/head; one PR after repeated requests; link survives task/app/backend reload; local-write failure recoverable |
| Open from task or workspace | Same linked PR and head SHA; diff matches the task worktree/branch; no cross-project review |
| Request changes | Hosted review submission and local agent feedback have explicit semantics; feedback persists and reaches the intended revision run |
| Revise and re-review | New commits update the existing PR; comments remain traceable; old approval/check evidence becomes stale appropriately |
| Approve and merge | Fresh PR/check state; protected-branch and permissions failures shown; merge result reconciled to task policy before cleanup |
| External changes | Review, merge or close performed outside Orchestra appears after refresh/reconnect; merged and closed-unmerged stay distinct |
| Concurrent review or failed network | Stale head detected; uncertain submission reconciled before retry; no duplicate feedback or false success |

Run these first against a controlled GitHub API fixture for failure injection, then a disposable hosted repository for real review/CI behavior. No hosted review, merge or configuration mutation was performed during this assessment.

## Ideas to adapt from T3 Code

T3 Code describes server ownership of processes, terminals, Git and project files, normalized provider adapters, durable commands/events and transactional effect records. It also separates turn completion from finalization and uses Git checkpoints without adding commits to the user's branch. These are documented architecture choices, not performance guarantees. [T3 architecture](https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/internals/overview.md).

The most useful adaptation is a durable task run model in our existing Go backend: record intent before side effects; give retries stable command identities; track finalization independently; then project that state onto the board. An incremental command receipt and effect table is a reasonable first step. A wholesale language or framework rewrite is not needed to apply this idea.

T3 documents provider capability boundaries and persistent human requests, including different response mechanisms between providers. [Provider constraints](https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/internals/providers.md). Adapt the capability-driven approach so pause, steer, resume, switch, checkpoint and revert controls reflect what each adapter can actually do.

T3 documents scoped defaults, inheritance visibility, worktree naming, setup actions and cleanup policies. [Project settings](https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/user/project-settings.md). Adapt visible effective configuration and its source to tasks: show which project/provider defaults were applied and freeze an execution configuration for each run. Worktree cleanup should protect active and changed work.

These recommendations retain our board while strengthening the runtime beneath it. The public repository also positions T3 as a control surface across desktop, web and mobile; remote/mobile parity should follow a proven local protocol here. [T3 repository](https://github.com/pingdotgg/t3code).

## Ideas to adapt from Orca

Orca documents a task/worktree-centered workspace containing agent terminals and a browser. [Orca overview](https://www.onorca.dev/docs). Adapt that scope beneath each Kanban card: opening a task restores its branch, conversation, terminal, changes and preview together. Our existing split layout, editor, browser and terminal components can be candidates for reuse once their integrated behavior is proven.

Orca documents line-anchored diff comments sent to an agent as a batch, with comment resolution and re-review. [Annotate AI Diff](https://www.onorca.dev/docs/review/annotate-ai-diff). This is a high-value improvement over one free-text request-changes field: store comments against a base/head SHA and file range, send a coherent revision batch, and show which comments remain unresolved after changes.

Orca describes a background PTY daemon, warm reattachment after UI closure, layout restoration, and the different result after host or daemon failure. [Session restore](https://www.onorca.dev/docs/model/session-restore). Adapt the explicit lifecycle contract and restore tests before claiming process continuity.

Orca's notification inbox links back to the matching worktree/pane, and its browser is scoped to a worktree and scriptable by agents. [Notifications](https://www.onorca.dev/docs/notifications), [browser](https://www.onorca.dev/docs/browser/overview). Adapt a persistent attention queue and a shared task preview with captured screenshots, console errors and a known checkout identity.

Orca documents supervised runs, worker messages, task DAGs, dispatch identity, heartbeats and decision gates. [Orchestration](https://www.onorca.dev/docs/cli/orchestration). Adapt these after single-task reliability: retain our blocker checks, add explicit parent/child tasks and gates, and reject stale worker completions using task and dispatch IDs. Parallel comparison should be an optional bounded workflow, not the default for every issue.

## Proposed Kanban experience

Keep Backlog, Todo, In Progress, Review and Done as the familiar lifecycle. Add runtime detail and delivery evidence alongside them instead of creating a column for every transient condition.

| Dimension | Proposed values | Why it is separate |
| --- | --- | --- |
| Task lifecycle | Backlog, Todo, In Progress, Review, Done; separate cancellation outcome | Expresses intent and human workflow |
| Run status | Queued, preparing, running, waiting for input, retrying, interrupted, failed, stopped, finished | Expresses what execution is doing |
| Verification | Not run, running, passed, failed, inconclusive, stale | Expresses what has actually been checked |
| Delivery | No PR, draft, checks pending, changes requested, mergeable, merged, closed | Expresses shipping state |

A card should answer: what is the goal, who is doing it, what is happening, what is blocking it, and what should I do next? Prioritize a short latest-activity line, provider/model, runtime age, blocker/attention marker, verification summary and PR/CI indicator. Detailed cost and tool traces belong in the inspector. Avoid a fabricated completion percentage.

Add saved views for Needs attention, Ready for review, Failed or interrupted, and Running. Add search, provider/label/priority filters, grouping by project or initiative, persistent order and density controls. Provide keyboard navigation and explicit move/action menus so drag-and-drop is not the only way to operate the board. Show why an action is unavailable.

Selecting a card should open a task workspace with conversation and structured requests, a diff/review pane, terminal and browser tabs, and an evidence/activity drawer. Preserve a lightweight inspector for fast triage. Every pane must resolve the same task, run, workspace and environment IDs; switching tasks should not leave the editor or preview on another branch.

The attention inbox should include questions, approvals, failed checks, exhausted retries, conflicts and review requests. Each item needs an owner, actionable reason and deep link. Resolving it must update the durable source record, not merely dismiss a toast.

## Proposed runtime model

Introduce a `TaskRun` identity distinct from an issue and a provider session. A task can have planning, execution and revision runs; a run can have attempts. Track workspace identity, base/head SHA, frozen configuration, state transitions, requests, checks and side-effect results against that run.

Recommended relationships are Project to Task to TaskRun to Attempt/ProviderSession, with Workspace, HumanRequest, VerificationResult, Artifact and PullRequestLink attached explicitly. A parent workflow can later own tasks and dependencies. Retain existing tracker DTO compatibility through projections while migrating consumers incrementally.

Commands such as queue, start, stop, answer, revise and complete should have idempotency keys. Record command receipt, resulting state and pending effects transactionally; publish after commit. A worker performs Git/provider operations and records their outcome. Fence attempts so late output from a canceled or superseded attempt cannot finalize the current one. Exactly-once external execution is not assumed: reconcile observable state when an effect outcome is uncertain.

Verification records should include command, working directory, exit status, relevant output/artifact, timestamp and tested SHA. A later code change makes prior verification stale. Review approval and merge eligibility are separate from whether a provider exited successfully.

## Verification program before feature expansion

Start with a disposable Git fixture, a local tracker/database, deterministic fake providers and controlled remotes. Exercise the real backend and desktop boundary without spending provider tokens or pushing to a production repository. These tests verify orchestration and UI wiring; label them simulated.

Then run a small real-provider task against a disposable repository for each supported provider and operating system. Record executable/version, model, auth mode, runtime target, app/backend revision and artifacts. Do not infer one provider's status from another. Use separate rows for local and remote targets, SQLite and hosted trackers, and development and packaged desktop builds.

| Scenario | Required evidence and assertions |
| --- | --- |
| Clean install and launch | Build from a fresh checkout; app/backend ready; meaningful startup failure on missing prerequisites |
| Author and queue | UI fields persist; correct project/provider/criteria; one task created despite repeated submission |
| Plan and execute | Exactly one current attempt; correct checkout and instructions; actual file changes; state transitions match policy |
| Review and revise | Diff belongs to the tested SHA; feedback survives reconnect; revision preserves task/workspace identity |
| Verify and ship | Independent check result; PR points to correct branch; CI/merge failure visible; Done follows the configured completion policy |
| Stop and retry | Child process stops; no unexpected redispatch; retry/exhaustion state and attempt identity remain correct |
| Questions and approvals | Request survives reconnect/restart; answer delivered once; waiting does not consume ordinary retry budget |
| UI close and reopen | Documented process behavior; layout/logs restored; no duplicate agent and no fabricated live status |
| Backend crash and reboot | Ownership reconciled; uncertain work becomes interrupted; history/timing retained; explicit safe resume |
| Concurrent tasks | Distinct worktrees, ports, browser context and output; no cross-task edits or credential leakage |
| Git failure and cleanup | Dirty/untracked work retained; missing checkout never commits project root; failed push/merge/cleanup remains visible |
| Tracker/network failure | No silent partial success; retry with stable identity; fresh reconciliation after reconnect |

Suggested initial acceptance target: ten consecutive deterministic core-lifecycle passes per supported OS, followed by at least three real-provider lifecycle passes per provider/environment combination being claimed. Include injected failures for each relevant recovery path. This is a proposed engineering threshold, not a statistical guarantee of reliability. Capture run counts, failures and recovery results instead of publishing a blanket green badge.

Measure duplicate dispatches, orphaned processes, lost requests, silent data loss and cross-task writes as correctness failures. Track time to attention, successful revision rounds, failed finalization and restart recovery as operational measures. No reliability percentage is justified by the evidence gathered here.

## Development sequence

| Phase | Deliverable | Exit criterion |
| --- | --- | --- |
| 0 Reproducible baseline | Restore missing source, narrow ignore rules, resolve Windows compile assumptions, triage failing tests, reconcile lifecycle docs | Fresh-checkout typecheck, tests, backend/desktop builds and scoped API smoke pass; Electron runtime launch checked |
| 1 Proven core lifecycle | Deterministic integrated fixture, real-provider evidence matrix, observable finalization, truthful progress and cleanup behavior | Author to execute to review to revise to complete exercised with saved evidence and failure cases |
| 2 Board visibility | Runtime/verification/delivery projections, actionable inbox, search/saved views, durable board preferences, keyboard actions | User can identify and resolve blocked work from the board; backend policy and UI agree |
| 3 Task workspace | Unified task context, structured CLI conversation, task terminal/browser/editor, line-level review feedback and evidence drawer | Two concurrent tasks remain isolated; reopening restores the correct context; revision loop proven |
| 4 Durable orchestration | Idempotent commands, run/attempt fencing, durable requests/effects, explicit restart and resume semantics, provider capabilities | Crash/reconnect and stale-event scenarios pass; no false live state or duplicate finalization |
| 5 Supervised workflows | Parent/child tasks, DAG authoring, role routing, decision gates, portable handoffs and enforced budgets | Bounded multi-task workflow completes and recovers with explainable routing and integration review |
| 6 Remote and automation | Proven remote targets, durable scheduled work, multi-client access and optional comparison runs | Each supported environment has its own E2E/recovery evidence; work remains correct with the UI disconnected |

Phases are incremental milestones, not strict isolation. Minimal run identity, request persistence and truthful finalization are needed during phases 1 and 2; phase 4 completes that foundation before complex orchestration. Reliability work should accompany every UI slice.

The first implementation slice should be a cleanly reproducible, observable single-task lifecycle with honest state. The next visible product slice is the board's Needs attention view and task workspace. These together preserve the product's current Kanban identity while making orchestration understandable and testable.

## Decisions to resolve during implementation

- Define Done: merged delivery, explicitly accepted local result, or both through a recorded completion policy. Keep canceled/closed distinct.
- Define automatic commit/push behavior and make planning runs follow their intended permissions.
- Select the primary supported OS/runtime matrix and publish unsupported combinations clearly.
- Decide which provider operations support structured steering, resume, fork and conversation rollback through evidence, not provider-name assumptions.
- Define task/worktree/browser retention after review, merge, cancel and restart.
- Define budget enforcement and cost estimates separately from provider-reported usage and subscription accounting.

No product source was changed as part of this review. The findings above are a starting backlog and verification plan; they do not certify any existing E2E workflow.

## Required reference rule

Every ADE implementation must observe the relevant Orca and T3 Code patterns before coding, record the adaptation and any deliberate deviation, and independently verify Orchestra's behavior. This is now a repository rule in AGENTS.md and a gate in every [implementation package](../superpowers/plans/ade-2026-10-03/README.md), with a [pinned source registry and inspection assignments](../superpowers/plans/ade-2026-10-03/reference-patterns.md).
