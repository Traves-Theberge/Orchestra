---
name: maestro-github
description: Use GitHub repository issues and pull requests for Maestro task journeys, preserving Orchestra project identity, source routing, and exact PR linkage.
---

# GitHub for Maestro

Read `maestro-integrations` for the shared journey and `orchestra-cli` for executable task controls. Resolve exact `owner/repo` from registered project metadata or a verified Git remote; Maestro's control directory is not a repository. Match PR base repository to that identity before linking it to a task.

When `gh` is available, reuse its existing signed-in account. Verify an authenticated repository read before claiming access. Use explicit scope from the control directory:

```text
gh repo view OWNER/REPO --json nameWithOwner,url,viewerPermission
gh issue list --repo OWNER/REPO --json number,url,title,assignees,state
gh pr list --repo OWNER/REPO --json number,url,title,state,headRefName,baseRefName
gh pr view NUMBER --repo OWNER/REPO --json number,url,state,headRefOid,headRefName,baseRefName,reviewDecision,statusCheckRollup
```

These commands read GitHub; they do not attach a PR to an Orchestra task. Preserve the task's persisted `pr_url`, and verify the remote PR repository/head/status separately. An empty open-PR list does not prove no historical PR is linked. Inspect explicit linked PRs even when closed or merged.

For issue-backed tasks, select an actual GitHub issue source connection; local SQLite tasks remain local even when their project has a GitHub remote. Use advertised source-scoped create/assign controls and receipts. GitHub issue numbers collide between repositories; a GitHub assignee is a login, while an Orchestra worker/harness is a separate identity. Do not infer execution from assignment or treat GitHub open/closed as the complete Kanban lifecycle.

GitHub's add-assignee endpoint is additive and may silently ignore users without permission. When the shared adapter supports assignment, confirm the requested login in the returned issue and preserve concurrent assignees; do not claim atomic remote compare-and-set. A timed-out external mutation remains uncertain and must not be replayed with a new UUID.

For authorized repository/PR actions, inspect installed CLI help and use the user's requested scope. Do not change credentials or permissions to resolve an error. UI review discussions, checks, and the reviewed head are distinct evidence; report any missing observation.

Primary API reference: [GitHub issue assignees](https://docs.github.com/en/rest/issues/assignees). Native GitHub CLI access does not prove that another harness or the backend tracker uses the same credential.
