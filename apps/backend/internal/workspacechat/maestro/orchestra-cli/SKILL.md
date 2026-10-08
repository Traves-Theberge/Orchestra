---
name: orchestra-cli
description: Inspect Orchestra projects and tasks, assign workers, queue planning, approve exact plans only on human instruction, request replanning with feedback, show stored PR linkages, reconcile receipts, and scope native agent/skill authoring. Orca-managed worktrees use the separate Orca CLI skill.
---

# Orchestra CLI

Use Orchestra's backend as the authority for projects, tasks and execution observations. Keep Kanban task identity separate from its repository, worktree, agent session and PR.

## Resolve the CLI and backend

Use an explicitly supplied executable or `ORCHESTRA_CLI_COMMAND` when present. Otherwise resolve `orchestra` on PATH. In an Orchestra checkout, the staged build is `apps/backend/dist/orchestra/orchestra.exe` on Windows or `apps/backend/dist/orchestra/orchestra` elsewhere. If no binary exists, report that or build the repository CLI when development is authorized. Do not substitute `orca` or `orchestrad`; they are different interfaces. Invoke a chosen executable directly with argument arrays, not shell evaluation of a command string.

Read the chosen binary's `--help`, then the relevant command's `--help`. Use only commands it advertises. Older binaries may have only `start`, `check` and `check-pr-body`; absence of observation commands means that build needs updating. Never invent a future command or assume the installed binary matches this skill.

Observation commands use `--base-url` or `ORCHESTRA_BASE_URL`, and `ORCHESTRA_API_TOKEN` in the environment. Choose the backend/profile the user is operating; do not probe unrelated servers or assume cwd identifies a remote project. Avoid tokens in command arguments, logs or final responses. A 401/403 is not an empty project/task list. Audit managed-backend credentials can change on relaunch; refresh the selected profile credential without printing it. Never change provider account settings to connect the CLI.

The CLI does not select desktop profiles automatically. For this repository's explicitly selected Windows `audit-dev` instance, desktop connection profiles are in `%LOCALAPPDATA%\Orchestra\audit-dev\desktop\backend-profiles.json`: select the entry matching `activeProfileId`, then assign its `baseUrl` and `apiToken` to the process environment without displaying the file or token. Other instances use their own configured user-data directory; do not assume this audit path describes them. If connection context is unavailable, request it rather than guessing. Restore temporary environment assignments after inspection.

## Inspect projects and tasks

The current observation slice is read-only:

```text
orchestra status --json
orchestra project list --json
orchestra project show <project-id> --json
orchestra task list --project <project-id> --json
orchestra task list --project <project-id> --states Backlog,Todo --json
orchestra task list --project <project-id> --unassigned
orchestra task list --project <project-id> --assignee <worker-id>
orchestra task show --id <task-id> --project <project-id> --json
orchestra task show --identifier <issue-identifier> --project <project-id> --json
```

Set the selected backend/token first, or pass its `--base-url`. Read the command's help for its exact syntax and supported filters. Without `--project`, task listing observes the configured global tracker; it is not an aggregate of every project's distinct issue source. For every project's tasks, list the project catalog and query each project explicitly, retaining project/source context and reporting failures separately.

These requests are separate snapshots. The legacy `task list/show` path uses the existing issue API: no `--project` means its configured global tracker; `--project` validates a registered project and passes `project_id` to that API, whose legacy routing can still fall back globally. A successful response is only the returned snapshot, not proof of complete external-source coverage or strict project-source ownership. Use `control tasks --project <project-id>` for strict selected-source inventory; it fails closed instead of falling back globally. Report scope/routing limitations when completeness matters.

Resolve project ID from the catalog and task ID/identifier from returned tasks. Names, issue numbers and identifiers can collide across repositories and sources. A request such as “work on #42” requires resolving its project/source/repository; ask for that context if the available inventory cannot identify one target. Never choose the first match. Do not derive repository identity or a worktree path from a display-name prefix.

JSON observation output has `schema_version`, `command`, `scope` and `data`. Respect nonzero exit status and structured errors; stdout is not proof of success by itself. Report the observed backend origin/project scope and task identity; the origin is connection context, not a durable environment ID. `task show` resolves an exact work item from the task catalog; it does not call the legacy identifier-detail route or claim richer run/session observations. Status is a backend snapshot, not a durable execution receipt.

Read [the task-system contract](references/task-system.md) when interpreting task states, configuration, worktree/run information, or requests to mutate tasks.

## Inspect local diagnostics

Use these read-only commands only when the selected executable advertises them:

```text
orchestra diagnostics overview
orchestra diagnostics traces --project <project-id> --task <task-id> --limit 100 --json
orchestra diagnostics trace <32-lowercase-hex-trace-id> --json
orchestra diagnostics logs --severity error --search <operation-name> --limit 100
orchestra diagnostics settings --json
orchestra diagnostics check --json
orchestra diagnostics export --project <project-id> --json
```

Use the same explicitly selected backend origin and environment API token as other observations. Human output describes the activity, outcome, API method/route/status where recorded, measured duration, and correlation ID. `--json` preserves raw diagnostic fields in the existing `schema_version`, `command`, `scope`, `data` envelope, including optional HTTP metadata and labels. API activity without a task identity is backend activity; it must not be presented as an unknown task or provider execution.

`overview`, `traces`, `logs`, and `export` accept `--project`, `--task`, `--provider`, `--status`, `--search`, `--since`, and `--until`. Project/task/search values have a 128-byte bound, provider 96 bytes. Status is `running`, `ok`, `error`, `cancelled`, or `unknown`. Times require RFC3339 with a timezone and since must not follow until. Only `logs` accepts `--severity debug|info|warn|error`. Only `traces` and `logs` accept `--limit 1..500` and `--offset 0..1000000` (defaults 100 and 0). `trace`, `settings`, and `check` accept only connection/output flags. Exact trace IDs are 32 lowercase hexadecimal characters, as returned by the API. Diagnostic identity filters query retained local metadata directly; they do not require a currently registered project or external tracker lookup.

`check` makes GET settings and GET overview requests. Its JSON reports `available`, `collection_state`, `history_gaps`, `queue_depth`, `storage_bytes`, `dropped_records`, warnings and both snapshots; `execution_verified` is always false. Disabled collection is intentional configuration, not an unavailable API. Drops indicate historical gaps in the current backend process, not necessarily current failure; queued records in a snapshot are pending persistence, not proof of a stalled queue. Storage at or above the configured budget is reported explicitly. These two separate snapshots do not certify task execution, live model inference or end-to-end reliability. Warnings return success when both reads are available; missing diagnostics routes, rejected authentication, unavailable stores, malformed data and transport failures return nonzero structured errors. A missing route is an old/incompatible backend, not empty history.

`export` is a bounded sanitized snapshot (up to 500 traces and 5000 spans/logs); inspect `truncated`. Use `--json` to preserve its complete raw payload and write it to an explicitly chosen file. Human export output is a summary. There are no CLI settings writes, clear operations, collection probes or provider calls. Retention expiry and disabled intervals can leave unobserved history even when the drop counter is zero.

## Keep observations truthful

- A local SQLite task is not automatically a GitHub issue. A task without project/source linkage is unlinked; do not fabricate a repository or hosted URL.
- Creating or queuing a task is not creating a worktree, starting an agent, or completing execution. A branch name or session ID alone does not establish a live checkout/process. Report absent observations as unknown or not observed.
- Requested provider/model/budget values are intent, not effective runtime configuration. Do not infer that an installed executable can honor them. Current native adapters reject explicit unsupported model/turn requests.
- A merged PR is not an observed Done task. Task workflow state, runtime status, hosted issue state and reviewed-head state are separate observations.

## Create, assign and queue issue-backed tasks

Use these commands only when the selected executable advertises them:

```text
orchestra task create --project <project-id> --request-id <uuid> --title <title> --description <text> --assignee <worker-id> --provider CODEX --json
orchestra task assign --project <project-id> --id <task-id> --request-id <uuid> --assignee <worker-id>
orchestra task assign --project <project-id> --id <task-id> --request-id <uuid> --assignee <worker-id> --provider CODEX --json
orchestra task queue --project <project-id> --id <task-id> --request-id <uuid> --expected-state Backlog --json
orchestra task approve-plan --project <project-id> --id <task-id> --request-id <uuid> --expected-plan-hash <returned-plan-hash> --json
orchestra task replan --project <project-id> --id <task-id> --request-id <uuid> --expected-state <returned-state> --expected-plan-hash <returned-plan-hash> --feedback <review-or-human-feedback> --json
orchestra control reviewers --json
orchestra task request-review --project <project-id> --id <task-id> --request-id <uuid> --expected-pr-url <stored-pr-url> --expected-head-sha <fresh-head-sha> --provider <available-harness> --reviewer-agent provider-default --json
orchestra task approve-review --project <project-id> --id <task-id> --request-id <uuid> --expected-pr-url <stored-pr-url> --expected-head-sha <fresh-head-sha> --review-attempt <returned-attempt-uuid> --json
orchestra task complete-review --project <project-id> --id <task-id> --request-id <uuid> --expected-pr-url <stored-pr-url> --expected-head-sha <fresh-head-sha> --review-attempt <returned-attempt-uuid> --json
orchestra control receipt --request-id <uuid> --json
orchestra control projects --json
orchestra control tasks --project <project-id> --json
orchestra control worktrees --project <project-id> --json
orchestra control status --json
```

Generate and retain one canonical UUID per intended mutation before issuing it. Create produces Backlog only. Queue requires the exact project/task identity, complete title/description/assignee/provider, and current Backlog state. Its Todo acceptance is an admission request; observe subsequent runtime/worktree state separately. A queue response is not a started agent or live worktree.

PR review controls apply the same contract to every registered harness. Read `control reviewers` first; unavailable adapters must not be replaced silently. Current review execution supports the `provider-default` native profile with Orchestra's fixed PR reviewer role; this does not select a custom native agent. Resolve the exact task's stored PR, fetch its current head, and request review with both identities. Admission is not a finished review. Clean reviews wait for explicit human approval of the exact returned attempt and freshly fetched head. Findings return to Todo with feedback and retained work; execution needs a new plan approval. `complete-review` independently requires approved review and fresh merged evidence for that same head. It does not merge or publish the PR. Last-recorded `review_gate` metadata is not a fresh remote observation. Never approve on an agent's behalf without the human's explicit instruction.

`task list --unassigned` returns tasks with blank/null assignees; `--assignee <worker-id>` selects one exact worker identity. These filters are mutually exclusive. Human task list/show/assign and `control tasks` output includes the persisted PR URL when present, and says `PR: none` when the task has no linkage; add `--json` to task list/show/assign and control tasks for the versioned envelope. Task `assignee_id` is a worker identity, separate from `provider` (the execution harness).

`task assign` is a guarded local SQLite operation: it requires an exact project ID and task ID, canonical UUID request ID, `expected_state=Backlog`, and an unassigned Backlog task. It sets only the assignee unless `--provider` is explicitly supplied; it never guesses a provider or queues/starts the task. Assignment can therefore leave an incomplete Backlog task that queue still rejects until its required title, description, assignee and provider are present. Hosted assignment is unavailable: current hosted adapters lack a shared guarded Backlog transition, and GitHub's `open` issue state is not equivalent to Orchestra's Backlog. Do not use generic tracker PATCH or replace-all assignee updates to bypass this boundary.

Queue currently supports local SQLite tasks with a conditional state update. Hosted queue is unavailable until that tracker adapter provides a guarded transition; do not substitute a legacy patch after this rejection. Hosted observation/create still depend on the selected adapter's actual support and returned scope.

## Human approval and replanning

Provider subprocess approval policy is separate from Orchestra's human gates. A Windows Codex planning command using native `approval_policy=never` still requires explicit human approval of the resulting Orchestra plan; it does not grant task execution or PR approval. Inspect provider logs when planning cannot read files, and distinguish a completed provider turn from successful inspection.

Todo means planning admission, not execution permission. Observe the task's `plan_gate`: a completed plan must wait at `awaiting_approval`. Copy its exact opaque `plan_hash` and complete project/task IDs into `approve-plan` only after the human explicitly approves that plan or tells Maestro to approve it. A previous approval does not authorize a changed plan, code context or task configuration. Never infer approval from assignment, a successful provider turn, a checked checklist, or a state label; never replace a rejected gate control with a generic state PATCH.

`replan` requires the observed current state and plan hash plus nonempty feedback. It preserves the task's code/worktree and review context, returns an inactive task to Todo, and invalidates the prior approval. It does not stop an active run or approve the new plan. Unknown delivery requires receipt and exact-task reconciliation before another mutation. These gate controls support local SQLite tasks; fail closed for hosted sources without an equivalent durable gate contract.

The PR agent must review the exact linked repository/PR/head, leave its review for human feedback, and preserve findings and changed-code context when returning work to planning. A clean agent review is not human approval or Done. Use PR gate commands only when the selected executable advertises them and the backend returns their capabilities; the PR reviewer integration remains separate from plan approval.

These commands use the same bounded control service as the persistent top-level native orchestrator. They resolve the selected project's tracker without falling back to a different global tracker. A configured source that cannot be resolved fails closed. Native orchestrator conversations use reserved scope `__orchestrator__` and an owned control directory, not a fake catalog project; currently only the Codex native adapter exposes these control tools.

Use `control tasks` for that strict project-source observation; legacy `task list/show` retain the routing limitations described above. `control worktrees` observes the authorized Git worktree registry with exact paths, HEADs and branches. A listed Git worktree is not proof of an agent session or an active process.

The backend persists mutation intent before sending the effect. Reusing the same request ID with identical arguments returns its recorded result; different arguments conflict. A pending/unknown receipt is never automatically replayed. After a timeout or unknown result, inspect the receipt and intended project task inventory. Do not create a new request ID merely to get around uncertainty. Hosted-source failures can occur after an issue was created, so the receipt may honestly remain unknown.

Task metadata update, explicit dispatch/retry/stop, project import, worktree create/remove, terminal send/wait and PR publication/merge remain unavailable CLI commands. “Pause” must not map to destructive legacy stop/reset. Do not use ad hoc curl, Git or Orca operations to bypass those missing shared controls, and do not invent durable run/attempt or provider-turn acknowledgements.

## Inspect and author native agent resources

Use the executable's `agent` and `skill` commands for provider-native named definitions. These commands call the shared agent catalog API; they do not write files from the CLI process, start a provider, select an effective agent, or change account/global provider settings.

```text
orchestra agent list --project <project-id> --harness OPENCODE --scope effective --workspace <workspace-id> --json
orchestra agent show --project <project-id> --harness OPENCODE --scope project --workspace <workspace-id> --id team/planner --json
orchestra agent create --project <project-id> --harness OPENCODE --scope project --workspace <workspace-id> --id team/planner --request-id <uuid> --format opencode-v1 --content-file ./planner.md --json
orchestra agent update --project <project-id> --harness OPENCODE --scope project --workspace <workspace-id> --id team/planner --request-id <uuid> --expected-hash <sha256> --format opencode-v1 --content-file ./planner.md --json
orchestra agent delete --project <project-id> --harness OPENCODE --scope project --workspace <workspace-id> --id team/planner --request-id <uuid> --expected-hash <sha256> --json
orchestra skill list --project <project-id> --harness CODEX --scope project --json
orchestra agent list --project __orchestrator__ --harness OPENCODE --scope global --json
orchestra agent receipt --project <same-project-id> --request-id <uuid> --json
```

`list` and `show` accept `effective`, `project` or `global` scope. Effective scope is read-only and reports the global and selected project resources together; a project worktree is selected by its observed workspace ID, never by a path. Use `--id` exactly as reported by the provider-native catalog, including nested IDs such as `team/planner`; do not add provider-specific filename extensions. Harness values are `CODEX`, `CLAUDE`, `ANTIGRAVITY`, `OPENCODE` and `8GENT`; a provider's catalog may report unavailable or unsupported capabilities. Discovery is not proof that Orchestra can select or enforce a definition. Gemini is retained only as historical provider identity and is not selectable for new work. Antigravity has its own credentials and native session identity; its Markdown agents and skills can be authored through the catalog, but named primary selection remains disabled until a live runtime verifies the requested profile and conversation resume.

Mutations require `project` or `global` scope, one canonical UUID `--request-id`, and one exact resource ID. Create/update read content only from the explicitly named `--content-file`, preserve its text, and send it to the API. Update/delete require the latest `content_hash` returned by `show` or `list` as `--expected-hash`; a stale hash conflicts without applying that mutation. Global resources are shared user-level native files: use `--project __orchestrator__ --scope global` to make that shared ownership explicit. The reserved `__orchestrator__` scope cannot be used for project resources. Do not store secrets in authored resources.

The backend persists mutation identity and a receipt before the filesystem effect. It returns `pending`, `completed`, or `unknown`; startup can convert pending work to unknown. Network, timeout, malformed response or server error means the result may be unknown. Keep the original request ID and inspect `agent receipt`/`skill receipt` for the same project before deciding what to do. The CLI never retries a mutation automatically. Do not issue the same intent with a new request ID while the first result is unresolved. A completed receipt confirms the catalog file operation only; it does not prove a provider can run, load or select that resource.

The persistent native orchestrator exposes the same backend service as `orchestra_resources`, with strict JSON keys `operation`, `project_id`, `workspace_id`, `harness`, `scope`, `kind`, `resource_id`, `request_id`, `expected_hash`, `format` and `content`. Operations are `list`, `get`, `create`, `update`, `delete` and `receipt`; kinds are `agent_definition`, `skill` and the narrowly allowlisted `orchestra_config`. List returns metadata, get returns raw content plus hash. Use exact native resource IDs, never host paths. Project resources require an exact observed `workspace_id`; effective scope is read-only. The reserved `project_id: __orchestrator__` is global-only and refers to shared user-level agent/skill/config ownership. Its `orchestra_config` access is limited to Orchestra's own `workspace.json`; it does not authorize provider account credentials or other provider settings. The tool and CLI share the same UUID receipt, expected-hash and uncertainty rules.
