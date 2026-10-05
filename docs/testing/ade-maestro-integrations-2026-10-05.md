# Maestro integration skills and journey boundaries

## Reference receipt

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`, `apps/server/src/orchestration-v2/ThreadPullRequestService.ts`: PR discovery validates canonical repository identity, retains verified closed/merged links, and rechecks the project/workspace snapshot before synchronization. Orchestra's skills require explicit repository identity and persisted PR linkage; they do not fabricate a URL from a task/branch label.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, `src/cli/handlers/orchestration/mutation-request.ts`: mutation recovery retains request identity across uncertain delivery. The skills use Orchestra's existing receipt domain and distinguish connection observations from mutation completion. No directly corresponding multi-tracker task journey was established by this inspected source.
- No source code was copied. Skills describe Orchestra's actual adapters and explicit missing capabilities rather than certifying reference behavior or claiming tracker parity.

## Implementation

Five discoverable skills ship with the backend: `maestro-integrations`, `maestro-github`, `maestro-linear`, `maestro-jira`, and `maestro-azure-devops`. Their maintained sources are `.codex/skills/<name>/SKILL.md`; bundled copies provision into Maestro's owned `.agents/skills` control profile. The router is included in the native Maestro developer instructions even when the existing AGENTS.md predates the new routing paragraph. Provider detail is loaded only when relevant.

Existing customized profile files are retained. These skills do not write credentials or change provider-account settings. The same Maestro identity and base workflow apply independently of agent harness; actual harness tool support remains separately negotiated.

## Flow inventory

| Integration | Implemented basis | Journey boundaries still requiring work or verification |
| --- | --- | --- |
| Local SQLite | Exact project/task identity, create/assign/queue receipts, unassigned filters, persisted PR URL | Guarded assignment is separate from queue; queue acceptance is not a running agent or Done proof. See the CLI assignment handoff. |
| GitHub | Existing issue adapter; installed signed-in `gh`; repository/issue/PR reads verified for `Traves-Theberge/Orchestra` | Git remote does not select an issue source. Guarded hosted assignment/queue and task PR attachment remain unavailable through the bounded CLI. |
| Linear | Team-scoped GraphQL adapter, key-to-UUID creation resolution, prefixed native IDs, verified local project binding, state mapping | Provider/runtime metadata, guarded hosted admission, PR attachment and complete pagination remain separate gaps. No live authenticated Linear read was performed. |
| Jira | Configured native project key, bounded/project-scoped JQL, prefixed native IDs, ADF text/comments, verified local binding, state mapping | Credential-method limits, exact creation metadata, assignee update support, hosted admission and complete pagination remain gaps. No live authenticated Jira read was performed. |
| Azure DevOps | Explicit skill documents Boards/Repos identities and desired workflow | No adapter exists in the current tracker factory. Connection, source routing, revision-safe mutations, PR attachment, and lifecycle reconciliation remain unavailable. |

The common flow is connection and project selection, exact source issue discovery, Backlog task creation/resolution, explicit assignment/configuration, separate queue/admission, workspace/run observation, persisted PR linkage, reviewed-head/check verification, and task-state reconciliation. Each step needs independent behavioral evidence; a merged PR does not authorize checkout cleanup.

## Verification

- All five skills pass the skill-creator `quick_validate.py` validator via the installed `uv` Python runtime.
- `TestMaestroIntegrationSkillsSurviveProfileReopen` verifies source/bundle equality, provisioning of every provider skill, retention of customized router content, and that the retained router is loaded into actual Maestro instructions.
- Focused Maestro/orchestrator package tests passed. These fixture tests verify profile packaging and instruction delivery, not a live model choosing to obey the skill.
- Read-only `gh repo view`, `gh issue list`, and `gh pr list` succeeded for the exact repository using its existing account. No issue/PR mutation or authentication change was made.
- A separate worker rehearsed SQLite-with-GitHub-remote, Jira-native-identity and missing-Azure-adapter scenarios without mutating live tasks. One proposed command abbreviated a project ID; it was not executed. The router now explicitly requires copying complete returned IDs. This rehearsal is not a live agent or provider journey certification.
- Windows race testing could not run: this environment has `CGO_ENABLED=0` and no C compiler on PATH. Ordinary tests remain separate evidence; no race-test pass is claimed.

Primary provider references inspected: [GitHub assignees](https://docs.github.com/en/rest/issues/assignees), [Linear API](https://linear.app/developers/graphql), [Jira Cloud REST](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/), and [Azure Work Items](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1). These are design inputs; installed source and independently tested behavior determine Orchestra's capability.
