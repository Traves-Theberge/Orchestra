---
name: orchestra-cli
description: Inspect Orchestra CLI project and issue-backed task state, select the correct backend and task identity, and explain execution observations. Use for Orchestra CLI or Orchestra project/task operations. Orca-managed worktrees use the separate Orca CLI skill.
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

## Mutation and unsupported requests

This slice does not provide task create/update/dispatch/stop, project import, worktree create/remove, terminal send/wait, PR mutation or orchestration commands. Report the missing capability and continue any relevant read-only inspection; do not fall back to ad hoc curl, Git, or Orca commands that bypass the shared task system. When a newer CLI advertises mutations, read its current guide and preserve the user's authorized scope.

Before task mutation is supported, review the legacy effects in the task-system reference. In particular, “pause” must not be translated to destructive stop/reset, and changing a task to Review/Done can have commit/cleanup effects. Do not invent idempotency, a durable run identity, safe restart/resume, or a provider-turn acknowledgement that the backend does not supply. On an uncertain mutation outcome, reconcile before repeating rather than issuing another create/dispatch.
