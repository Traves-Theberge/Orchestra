# Orchestra task-system contract

This reference describes the current repository implementation. The selected CLI's help is the authority for available commands. Planned Orca-style control features are not operational commands yet.

## Identity and ownership

| Concept | Current representation | Interpretation |
| --- | --- | --- |
| Project | Catalog `id`, `root_path`, optional Git remote/hosted configuration and issue source | A registered checkout/context; not a task or provider HOME |
| Task/issue | `tracker.WorkItem`: `id`, `identifier`, `source`, `project_id`, `state`, `url` | Canonical work item across SQLite/memory/GitHub/Linear/Jira; local tasks are not automatically hosted issues |
| Repository issue | Source + owning repository + issue number/URL | A bare number is not globally unique; confirm repository scope |
| Worktree/branch | Optional task branch/base metadata and running-entry worktree path | Execution resource; task creation alone does not prove it exists |
| Runtime | Running/retry observations, session information and counters | Distinct from Kanban state; not a complete durable run/attempt/workspace contract |
| PR | Linked URL and separately fetched head/merge observations | Review/merge attaches to a commit; it does not imply task completion |

The intended product relationship is repository/project → repository issue/task → worktree → run/provider session → PR. Current local/unlinked tasks and incomplete host/tracker routing must be described as such rather than silently converted into that desired relationship.

Task lists use `id` and `identifier`; detail responses expose `issue_id` and `issue_identifier`. SQLite IDs are UUIDs with separate generated human identifiers. GitHub adapters may use the repository issue number as ID. Match both identity fields plus project; do not reinterpret an arbitrary ID as an issue URL. `project show` resolves the project catalog entry, because the legacy HTTP project-detail endpoint returns statistics rather than catalog metadata.

## Kanban and runtime

The local workflow currently permits:

```text
Backlog → Todo
Todo → In Progress | Backlog
In Progress → Review | Todo | Backlog
Review → Done | Todo | In Progress | Backlog
Done → Todo | Backlog
```

Backlog → Todo requires title, description, project and assigned worker. Title, description, project and assignee are editable only in Backlog. Review → Todo/In Progress requires feedback. Hosted trackers can have different states; use their actual returned state, not this local transition table, to interpret them.

Todo/In Progress admission additionally depends on assignment, blockers and capacity. A refresh/HTTP acceptance response does not prove a provider started. Todo currently enters planning and can progress automatically to execution; it is not a guaranteed human approval pause. Runtime IDLE/RUNNING/retry state is separate from the task's Kanban state. Restart and retry counters are not reliable measures of provider turns.

`status.data` exposes `generated_at`, `counts.running`, `counts.retrying`, and `running`/`retrying` arrays. Running entries currently expose `issue_id`, `issue_identifier`, `state`, `session_id`, `session_log_path`, `turn_count`, recent events/messages, timestamps, provider and token counters. Retry entries expose `issue_id`, `issue_identifier`, `state`, `attempt`, `due_at` and `error`. The current state presenter does not expose project/source identity or worktree paths in these arrays. Correlate only when exact task ID plus identifier has one unambiguous match in the selected backend inventory; otherwise report the runtime entry without assigning a project. Absence from these arrays means not observed in that snapshot, not proof of completion or durable cancellation.

Workspace chat has separate persisted conversation/message identities in `internal/workspacechat`. Its HTTP API accepts `workspace_id` for an observed Git worktree and persists that exact workspace ID/canonical cwd on new sessions; every selected-scope operation checks current authorized membership. Omitted workspace selection belongs only to the registered project root, and legacy root chats cannot appear under children. New Codex conversations support persistent native app-server threads, scoped approvals/questions, interrupt and provider-thread resume; legacy conversations and other providers retain explicit transcript replay. A chat in a task-owned checkout remains a separate conversation identity, not that task's orchestrator run. Provider-reported chat usage is separate from imported account-log statistics; do not sum both as independent billable events. The existing CLI `status` snapshot covers task orchestration and does not include workspace-chat turns. Zero running tasks is not proof that no chat agent is active. The CLI still exposes no workspace-chat control commands; do not use a chat conversation ID as a task/run selector.

The top-level orchestrator is a separate durable chat scope `__orchestrator__`, stored with the same SQLite message/event/request and native thread recovery machinery. It runs in the backend-owned `.orchestra/orchestrator` control directory, not a catalog project or provider HOME. Its native Codex thread declares `orchestra_control` dynamic tools; tool requests must match the active provider thread/turn and declared tool. Unsupported harnesses are disabled for that scope rather than advertised as control-capable. Workspace chat does not inherit these cross-project tools.

`task create`, `task queue` and `control receipt` use that same shared control service. Create authors a Backlog task; queue changes an exact, complete Backlog task to Todo and requests a refresh. Queue does not certify engine admission, worktree creation, agent launch, provider delivery, PR creation or Done. Project source resolution for these controls fails closed; local/no-source projects use SQLite explicitly. Durable `request_id` receipts deduplicate identical completed requests, reject changed arguments, and retain unresolved intent without replay. This request identity is not a durable run or attempt identity.

Queue is currently limited to SQLite's conditional ID/project/Backlog/required-metadata update. Generic hosted tracker read-then-patch does not supply an atomic precondition, so hosted queue is rejected without sending that mutation. Source-scoped hosted create/observation are not a hosted execution or lifecycle certification.

## Requested configuration

`provider`, `runtime_target`, `requested_model`, nullable `requested_max_turns`, `disabled_tools`, guidance, criteria and attachments describe requested task context. Requested max turns supports 1–100 or unset in storage, but current production runners do not enforce explicit selected budgets and reject them. No production runner currently advertises the explicit model-selection capability used by the new guard. Do not report these requests as effective.

Generic legacy task creation does not author requested model/max-turn fields; a subsequent patch is a separate operation and can leave a partial result. Running-state snapshots preserve admitted requests; waiting retries are not durable yet. Immutable versioned effective configuration, provider-confirmed settings and crash-atomic admission remain open.

## Legacy mutation effects and routing limits

These endpoints are implementation findings, not instructions to call them outside the CLI:

- Task stop is a destructive reset: session cancellation, recursive worktree removal, forced branch deletion, clearing plan/feedback/branch/base and returning to Backlog. Task deletion can also remove the worktree and branch. Neither means harmless pause or detach.
- Manual Review/Done updates persist board state without committing, pushing or removing a checkout/branch. Repeated Done updates retain work as well. This does not verify delivery or establish that a PR merged. Agent finalization and explicit stop/delete remain separate legacy flows with Git/cleanup effects; the manual-transition fix does not certify those paths.
- Backend startup observes terminal tasks without deleting their worktrees. A Done state does not authorize cleanup of unpublished or ignored work. Verify provider-session recovery independently; checkout retention alone does not establish it.
- Project-scoped legacy creation now fails before sending when its configured tracker cannot resolve; local projects explicitly create through SQLite. Returned task project/source/ID must be confirmed before a follow-up runtime-target patch, and the patch must return the same identity. `project_tracker_unavailable` means creation was not sent; `creation_unconfirmed` means an effect may have landed and requires inspecting that tracker before repeating. This legacy HTTP path has no durable retry receipt and does not certify hosted create parity. Project-scoped lists can still fall back globally; detail/search/update/delete still use the global tracker. Even a unique catalog match does not establish that a later operation routes to the same source. The read-only CLI validates the selected project and resolves `task show` from the task list instead of the legacy identifier-detail endpoint; it does not certify consistent source routing or expose those mutations.
- Legacy task creation/configuration can fail after creating the item and has no durable receipt. The bounded control create/queue path persists request intent and confirmations, but an interrupted/unconfirmed external effect remains unknown and must be reconciled. Neither path guarantees exactly-once external tracker behavior.
- Interactive Windows PTY support is not established. The Orca-style terminal resource/handle/send/wait API and durable prompt observations are not implemented in Orchestra. Installed Orca's handles address Orca's runtime, not Orchestra's task IDs.

## Source maintenance

When behavior changes, reconcile this reference with `apps/backend/internal/tracker/work_item.go`, API issue handlers in `internal/api/state.go`, orchestrator issue mutation/admission code, and the CLI's help/tests. Update the skill as part of a command change; never advertise plan-only commands. The pinned T3 and Orca comparison receipts live under `docs/testing/ade-cli-workspace-reference-2026-10-04.md`, `ade-terminal-workspace-reference-2026-10-04.md`, and the CLI observation handoff. Reference patterns guide design but do not certify Orchestra runtime behavior.

Audited against the working tree on 2026-10-04, including uncommitted implementation changes. The skill handoff records source hashes for that snapshot; these are implementation findings, not verification that every legacy mutation works reliably end to end.
