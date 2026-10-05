---
name: maestro-integrations
description: Route Maestro issue-to-task-to-PR work through Orchestra's configured GitHub, Linear, Jira, or Azure DevOps integration and report connection and workflow gaps.
---

# Maestro integration journeys

Use this skill for cross-project issue discovery, assignment, task execution, and PR linkage. Orchestra is the application; Maestro is the agent.

Resolve the selected backend and exact registered project using `orchestra-cli` or `orchestra_control`. Read the project's issue source and tracker connection before choosing a provider. A Git remote or GitHub owner/repository does not make local SQLite tasks into GitHub issues. Blank issue source with no tracker connection currently means SQLite.

Read the matching provider skill under `.agents/skills` in Maestro's control profile. Maintained repository copies live under `.codex/skills`; use the control-profile copy during a Maestro session:

- `maestro-github/SKILL.md`: repository issues and GitHub PRs, including GitHub PRs attached to Linear/Jira tasks.
- `maestro-linear/SKILL.md`: Linear team/issue identity and workflow state.
- `maestro-jira/SKILL.md`: Jira site/project/issue identity and workflow mapping.
- `maestro-azure-devops/SKILL.md`: Azure Boards/Repos identity and the currently missing adapter.

Keep the journey's identities together: backend, Orchestra project ID, source/connection, external issue ID and URL, task ID, workspace ID/path, requested worker/harness, run observations, and exact PR URL. An issue URL is not a PR URL; a worktree or conversation is not the task. Preserve observed `pr_url` through task reads and assignment. Report absent linkage rather than constructing a URL from an issue number or branch.

For a supported task flow, observe the exact source inventory, create or resolve the Backlog task, configure/assign it using advertised shared controls, then queue it separately when complete. Retain one UUID and inspect its receipt after uncertainty. Queue acceptance is not proof of a running agent. Observe workspace/run state, then PR head/checks/review state independently. A merged PR does not establish a Done task or authorize checkout deletion.

Use the configured backend for issue-backed task mutations so source routing and receipts are retained. Repository/PR operations may use an available authorized provider tool or CLI, with explicit repository identity. Do not bypass an unavailable shared task mutation using a guessed HTTP endpoint. Never copy credentials into agent files, prompts, issues, or skills.

Connection configuration, adapter presence, and fixture tests are separate from a successful authenticated read. Report authentication failure as connection failure, not an empty inventory. Hosted adapters currently have routing/state/assignment limits; a source skill describes them and does not enable a missing operation. Do not change the selected tracker or fall back to a different provider to make a request appear successful.
