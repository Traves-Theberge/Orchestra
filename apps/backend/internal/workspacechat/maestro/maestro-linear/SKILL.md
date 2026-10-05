---
name: maestro-linear
description: Guide Maestro's Linear issue/task journeys using exact team and issue identities, source-scoped controls, state mappings, and repository PR linkage.
---

# Linear for Maestro

Read `maestro-integrations` and `orchestra-cli`. Use the selected project's configured Linear connection; GitHub login does not authenticate Linear. Keep Linear workspace/team identity, issue UUID, display identifier, and issue URL separate from the Orchestra project/task IDs. Never send the `linear:` storage prefix as an API-native issue UUID.

The adapter reads a configured team key from connection metadata (legacy configurations may store it in endpoint) and maps workflow state types. Creation resolves that key to exactly one team UUID. Returned issues must confirm the native team before the registry binds the local Orchestra project. Do not assume a human team key is a UUID. Examine authenticated results and GraphQL errors even with HTTP 200.

Creation, assignment, state transitions, and PR attachment are distinct operations. Creation can send native assignee, workflow-state and priority values, but provider/runtime metadata is not established by a hosted issue response. Inspect the returned task and receipt rather than assuming every requested field was applied. If shared control reports unknown creation or missing scope, inspect that same team's inventory before retrying. Never create a duplicate in SQLite to hide a Linear failure. Reads currently return a bounded first page; do not claim a complete team inventory.

Use only advertised shared controls for task mutations. Guarded hosted queue/assignment support must be established by the executable and adapter; a generic Linear update method is not atomic admission. Preserve the user's existing authorization, but do not invent an unavailable command.

A Linear issue URL is not a PR link. Read the task's exact persisted PR linkage and use the matching repository provider skill to inspect the linked PR. Missing PR linkage is unknown/absent; mentioning an issue identifier in a branch is not linkage verification. Review and Done reconciliation remain separate from provider workflow-state mapping.

Connection setup belongs in Orchestra's tracker settings using the existing account/token mechanism; do not put keys in skills or global provider config. [Linear's API guidance](https://linear.app/developers/graphql) distinguishes personal keys from OAuth and requires checking GraphQL errors and team IDs. No configured connection means access is not established.
