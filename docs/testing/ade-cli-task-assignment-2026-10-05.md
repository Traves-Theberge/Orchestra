# CLI task assignment and PR linkage handoff

## Cause and contract

Before this change the executable exposed `task list/show/create/queue`, but no assignment command or unassigned-only filter. `task list` could filter state and the HTTP endpoint already accepted exact `assignee_id`; there was no way to request null/blank assignees. The strict `control tasks` response contained all project tasks, but CLI human output was only JSON. The WorkItem already stores `pr_url`, while human output did not show it. Worker `assignee_id` and harness `provider` are separate fields: inferring one from the other would make partially authored Backlog tasks look runnable.

The bounded CLI now has:

```text
orchestra task list --project <project-id> --unassigned
orchestra task list --project <project-id> --assignee <worker-id>
orchestra task assign --project <project-id> --id <task-id> --request-id <uuid> --assignee <worker-id> [--provider <harness>]
```

Assignment is a shared-control mutation scoped to one registered project and exact task ID. It requires canonical UUID request identity, `expected_state=Backlog`, and blank/null existing assignee. SQLite writes with one conditional update over task ID, project ID, state and unassigned status. It preserves provider unless one is explicitly supplied, preserves PR linkage, records an `assigned` receipt and reports `execution: not_started`. It does not queue or start the task. An already-assigned task, wrong project, non-Backlog task, changed UUID arguments or unresolved mutation is rejected/reconciled through the existing control receipt boundary.

`--assignee` and `--unassigned` are mutually exclusive list filters. Task list/show/assign and strict `control tasks` print human-readable output by default; `--json` returns the versioned envelope. Rows show the exact persisted PR URL, or `PR: none`. This is a stored linkage, not proof of PR existence or merge.

Hosted assignment intentionally remains unsupported. The current selected project observed by the parent has no issue-source type and uses local SQLite. Generic hosted read-then-update cannot guarantee an unassigned/Backlog compare-and-set. GitHub's additive issue-assignees endpoint preserves existing remote assignees but requires issue number/repository identity and a post-write verification; more fundamentally the current GitHub tracker reports its state as `open`, which is not evidence of Orchestra `Backlog`. This change does not relax the Backlog contract, issue a GitHub write, or claim hosted assignment. Linear/Jira/Azure provider assignment is also not added here.

## Reference patterns and adaptation

Pinned references are T3 Code `737993303d36e10674c54b95e5bd3826682c99c7` and Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, per [the reference registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md).

- T3's pinned [ProviderAdapter](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) and provider-selection tests distinguish requested provider/runtime values from runtime acceptance. The reviewed T3 CLI/reference paths do not provide this same bounded Kanban worker-assignment command or an unassigned filter, so there is no directly reusable task assignment pattern. Orchestra keeps worker ownership independent from provider selection and retains Kanban Backlog state. No T3 code was copied or executed.
- Orca's pinned [mutation request helper](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.ts) and [run-scope tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/worker-list-run-scope.test.ts) preserve one request ID for recovery and make scope explicit. Orchestra adapts those boundaries to a task mutation receipt, exact project ID, exact task ID, and no global tracker fallback. Deliberate difference: the feature assigns an issue owner without starting an Orca-style worker/run; queue remains a separate Kanban transition requiring full metadata. No Orca source was copied or executed.

## Behavioral verification

Automated checks exercise null/blank/assigned task filters; mutually exclusive filters; exact project/task identity; unassigned Backlog conditional mutation; preserved PR URL and provider; explicit provider update; receipt replay and changed-argument conflict; no implicit queue or execution; queue failure for incomplete assignment; human and JSON output; and list/show/assignment PR display. A native executable test builds the CLI into a temporary directory and invokes it against an isolated HTTP fixture, observing `unassigned=true`, exact POST body, and human output. Separately, `TestCLIAssignUsesAuthenticatedAPIAndSQLiteControl` runs `cli.Run` with the real authenticated API router, a temporary SQLite database/project/task, and the shared control service; the task is re-read directly from SQLite to verify exact project/ID, Backlog state, assignee, unchanged provider, retained PR URL, and zero running/retrying entries. This is an API-to-local-store assignment verification, not an external process/provider E2E. No live task or hosted issue is mutated.

The CLI's existing unfiltered observations still follow the legacy global tracker routing. Use the new project-scoped `control tasks` API when strict source scope matters. The new assignment mutation does not use that legacy mutation path. Full `go test ./internal/api -count=1` passed after syncing the embedded/repository OpenAPI documents and repairing test fixtures; focused assignment/OpenAPI identity tests and `go vet ./internal/api` passed after the final schema update.

Changed files for this package: `apps/backend/internal/cli/observation.go`, `control.go`, `task_human.go`, tests; `apps/backend/cmd/orchestra/task_assignment_cli_test.go`; `apps/backend/internal/control/service.go` and tests; `apps/backend/internal/api/state.go`, `auth_matrix_test.go`, issue/OpenAPI tests and both OpenAPI source copies; the two Orchestra CLI skill files; and this handoff. The checkout may contain simultaneous unrelated desktop, Maestro-profile and tracker-journey changes by other agents.
