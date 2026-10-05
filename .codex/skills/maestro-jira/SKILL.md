---
name: maestro-jira
description: Guide Maestro's Jira issue/task journeys with exact site/project/issue identity, source-state mapping, supported task controls, and verified repository PR links.
---

# Jira for Maestro

Read `maestro-integrations` and `orchestra-cli`. Resolve the configured Jira site, project key, numeric issue ID, issue key, and browse URL separately from the Orchestra project ID. Never use a registered Orchestra UUID as a Jira project key, or send the `jira:` storage prefix as a native Jira issue ID.

Validate authentication and project access through the selected connection before claiming Jira access. Cloud uses email/API-token Basic auth when `extra.jira_user` is set; an empty user selects the intentional Bearer path. Server/Data Center uses username/token Basic auth. Cloud gateway/cloudId OAuth routing is unavailable; report that gap rather than rewriting credentials or assuming a token works.

Preserve the configured workflow-state map. Unmapped Jira states remain their reported states and are not automatically Backlog/Todo/Review. Jira Cloud structured descriptions are projected into readable text; rich document formatting is not preserved verbatim. Cloud comments use the version-aware document encoder. Read operations require the configured `extra.default_project`, add that project scope to JQL, and verify returned native project identity. Cloud uses enhanced `/rest/api/3/search/jql`; Server/Data Center uses `/rest/api/2/search`. Reads currently return a bounded first page; do not claim complete site/project coverage.

Creation uses the configured Jira project key, independently of Orchestra's local project UUID. The registry binds the local project only after native scope is verified; that binding does not establish exact requested workflow/assignee/provider metadata. Inspect the source issue and shared mutation receipt after an unconfirmed creation. The current generic update field allowlist does not implement assignee changes, and hosted queue is not a guarded transition. Use newly advertised dedicated capabilities when verified; otherwise report the unavailable operation without sending an unrelated legacy patch.

Treat issue creation/assignment, agent execution, PR linkage, review, and Done reconciliation as separate observations. A Jira development-panel link or issue mention is not a verified task PR URL. Use the exact persisted `pr_url` and matching GitHub/Azure repository identity; preserve the current reviewed head and checks when inspecting the PR.

Configure account connections in Orchestra settings, not AGENTS.md or skills. [Jira Cloud REST guidance](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) describes the native authentication and issue API; it does not certify Orchestra adapter parity.
