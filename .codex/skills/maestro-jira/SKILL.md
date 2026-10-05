---
name: maestro-jira
description: Guide Maestro's Jira issue/task journeys with exact site/project/issue identity, source-state mapping, supported task controls, and verified repository PR links.
---

# Jira for Maestro

Read `maestro-integrations` and `orchestra-cli`. Resolve the configured Jira site, project key, numeric issue ID, issue key, and browse URL separately from the Orchestra project ID. Never use a registered Orchestra UUID as a Jira project key, or send the `jira:` storage prefix as a native Jira issue ID.

Validate authentication and project access through the selected connection before claiming Jira access. Cloud and Server/Data Center authentication and API versions differ. Orchestra's current factory has limited credential configuration; if it cannot express the account's required method, report that gap rather than rewriting credentials or assuming a token works.

Preserve the configured workflow-state map. Unmapped Jira states remain their reported states and are not automatically Backlog/Todo/Review. Jira Cloud descriptions can use structured document format; the current mapper may not preserve that content. Report missing description observations instead of inventing an empty task requirement or discarding the source issue.

The current create path needs a Jira project key; its returned hosted item does not establish Orchestra project binding or exact requested workflow/assignee metadata. Inspect the source issue and shared mutation receipt after an unconfirmed creation. The current generic update field allowlist does not implement assignee changes, and hosted queue is not a guarded transition. Use newly advertised dedicated capabilities when verified; otherwise report the unavailable operation without sending an unrelated legacy patch.

Treat issue creation/assignment, agent execution, PR linkage, review, and Done reconciliation as separate observations. A Jira development-panel link or issue mention is not a verified task PR URL. Use the exact persisted `pr_url` and matching GitHub/Azure repository identity; preserve the current reviewed head and checks when inspecting the PR.

Configure account connections in Orchestra settings, not AGENTS.md or skills. [Jira Cloud REST guidance](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) describes the native authentication and issue API; it does not certify Orchestra adapter parity.
