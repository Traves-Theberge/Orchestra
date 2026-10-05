---
name: orchestra-cli
description: Inspect Orchestra projects and issue-backed tasks, create Backlog tasks, queue complete tasks, and reconcile durable control receipts through the Orchestra CLI. Orca-managed worktrees use the separate Orca CLI skill.
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
orchestra task show --id <task-id> --project <project-id> --json
orchestra task show --identifier <issue-identifier> --project <project-id> --json
```

Set the selected backend/token first, or pass its `--base-url`. Read the command's help for its exact syntax and supported filters. Without `--project`, task listing observes the configured global tracker; it is not an aggregate of every project's distinct issue source. For every project's tasks, list the project catalog and query each project explicitly, retaining project/source context and reporting failures separately.

These requests are separate snapshots. Project-filtered success establishes the returned observations, not complete coverage of an external tracker; the legacy backend can fall back to its global tracker. Report that limitation when completeness matters.

Resolve project ID from the catalog and task ID/identifier from returned tasks. Names, issue numbers and identifiers can collide across repositories and sources. A request such as “work on #42” requires resolving its project/source/repository; ask for that context if the available inventory cannot identify one target. Never choose the first match. Do not derive repository identity or a worktree path from a display-name prefix.

JSON observation output has `schema_version`, `command`, `scope` and `data`. Respect nonzero exit status and structured errors; stdout is not proof of success by itself. Report the observed backend origin/project scope and task identity; the origin is connection context, not a durable environment ID. `task show` resolves an exact work item from the task catalog; it does not call the legacy identifier-detail route or claim richer run/session observations. Status is a backend snapshot, not a durable execution receipt.

Read [the task-system contract](references/task-system.md) when interpreting task states, configuration, worktree/run information, or requests to mutate tasks.

## Keep observations truthful

- A local SQLite task is not automatically a GitHub issue. A task without project/source linkage is unlinked; do not fabricate a repository or hosted URL.
- Creating or queuing a task is not creating a worktree, starting an agent, or completing execution. A branch name or session ID alone does not establish a live checkout/process. Report absent observations as unknown or not observed.
- Requested provider/model/budget values are intent, not effective runtime configuration. Do not infer that an installed executable can honor them. Current native adapters reject explicit unsupported model/turn requests.
- A merged PR is not an observed Done task. Task workflow state, runtime status, hosted issue state and reviewed-head state are separate observations.

## Create and queue issue-backed tasks

Use these commands only when the selected executable advertises them:

```text
orchestra task create --project <project-id> --request-id <uuid> --title <title> --description <text> --assignee <worker-id> --provider CODEX --json
orchestra task queue --project <project-id> --id <task-id> --request-id <uuid> --expected-state Backlog --json
orchestra control receipt --request-id <uuid> --json
orchestra control projects --json
orchestra control tasks --project <project-id> --json
orchestra control worktrees --project <project-id> --json
orchestra control status --json
```

Generate and retain one canonical UUID per intended mutation before issuing it. Create produces Backlog only. Queue requires the exact project/task identity, complete title/description/assignee/provider, and current Backlog state. Its Todo acceptance is an admission request; observe subsequent runtime/worktree state separately. A queue response is not a started agent or live worktree.

Queue currently supports local SQLite tasks with a conditional state update. Hosted queue is unavailable until that tracker adapter provides a guarded transition; do not substitute a legacy patch after this rejection. Hosted observation/create still depend on the selected adapter's actual support and returned scope.

These commands use the same bounded control service as the persistent top-level native orchestrator. They resolve the selected project's tracker without falling back to a different global tracker. A configured source that cannot be resolved fails closed. Native orchestrator conversations use reserved scope `__orchestrator__` and an owned control directory, not a fake catalog project; currently only the Codex native adapter exposes these control tools.

Use `control tasks` for that strict project-source observation; legacy `task list/show` retain the routing limitations described above. `control worktrees` observes the authorized Git worktree registry with exact paths, HEADs and branches. A listed Git worktree is not proof of an agent session or an active process.

The backend persists mutation intent before sending the effect. Reusing the same request ID with identical arguments returns its recorded result; different arguments conflict. A pending/unknown receipt is never automatically replayed. After a timeout or unknown result, inspect the receipt and intended project task inventory. Do not create a new request ID merely to get around uncertainty. Hosted-source failures can occur after an issue was created, so the receipt may honestly remain unknown.

Task metadata update, explicit dispatch/retry/stop, project import, worktree create/remove, terminal send/wait and PR mutation remain unavailable CLI commands. “Pause” must not map to destructive legacy stop/reset. Do not use ad hoc curl, Git or Orca operations to bypass those missing shared controls, and do not invent durable run/attempt or provider-turn acknowledgements.
