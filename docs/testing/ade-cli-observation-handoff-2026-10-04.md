# Orchestra CLI: authenticated task and project observations

Implemented a read-only CLI over existing backend APIs. This is an observation slice of C2, not completion of the shared control service, durable run contracts, native chat, or E2E orchestration.

## Reference inspection before implementation

Pinned revisions follow [the required registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md).

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: inspected [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) and [ProviderSelectionTransition.test.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderSelectionTransition.test.ts). The adapter separates app thread, run, attempt, provider session/thread/turn, and runtime request identities. Its selection tests reject unsupported changes. Orchestra retains the existing task ID, human issue identifier, source, project and requested settings without converting them into provider/run identities or claiming an effective model. These files supply identity/capability boundaries, not a corresponding project/task command CLI. No T3 CLI was copied or executed.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected [worker-list-run-scope.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/worker-list-run-scope.test.ts), [worker-observation-handlers.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/worker-observation-handlers.ts), [orchestration.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration.ts), and [format.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/format.ts). Observations use the runtime client; JSON formatting is centralized. Worker-list tests explicitly distinguish bound, flag-selected and all-run scope. Worker-show treats unevaluated observations as unknown. Orchestra adopts explicit command/scope envelopes and the existing service APIs. Deliberate deviation: no terminal-bound run discovery, inferred workspace, RPC mutations, liveness projection, or recovery receipts; Orchestra does not have verified equivalents in this slice. Orca was not executed for this receipt.

Source inspection and reference tests do not certify Orchestra. No reference source or assets were copied.

## Actual command surface

```text
orchestra status --json
orchestra project list --json
orchestra project show <project-id> --json
orchestra task list [--project <project-id>] [--states <comma-separated>] --json
orchestra task show (--id <task-id> | --identifier <issue-identifier>) [--project <project-id>] --json
```

Set `ORCHESTRA_BASE_URL` to the intended backend origin or provide `--base-url <origin>` after the command. Set `ORCHESTRA_API_TOKEN` in the process environment from the intended backend's existing authentication configuration. No token argument, implicit localhost port, account credential discovery, or home-directory configuration lookup is implemented. The legacy `start`, `check`, and `check-pr-body` commands remain intact; `--help` describes the implemented surface. JSON is also the default if `--json` is omitted.

Success is one stdout JSON envelope `{schema_version:1, command, scope, data}`. Scope includes `backend_base_url`, the observation origin rather than a durable environment ID. Unfiltered tasks use `source:global_tracker`, project-filtered tasks use `source:project_filter`, and project lists use `source:registered_projects`. Errors are a JSON stderr envelope `{schema_version:1, error:{code,message}}`; success exits 0, operational failure exits 1, invalid arguments/configuration exits 2. The envelope is versioned; the data fields remain the existing backend contract and may evolve independently.

| Command | Shared backend boundary | Returned data and limits |
| --- | --- | --- |
| `status` | `GET /api/v1/state` | Backend's operational snapshot, counts, current running/retrying entries and totals. Scope is `backend_snapshot`; this is not an immutable run ledger or effective-model observation. |
| `project list/show` | `GET /api/v1/projects` | Registered projects. Show resolves exactly one ID from this list; the existing `/projects/{id}` endpoint returns statistics rather than the project object. Local disk folders are not automatically imported or discovered. |
| `task list/show` | `GET /api/v1/issues` | Tracked WorkItems and list totals. Task show returns the exact matched WorkItem, not runtime detail. ID and identifier are separate selectors; duplicate matches fail rather than selecting the first. A project filter is validated against registered projects before querying issues; out-of-scope returned tasks fail. |

The current identifier detail API uses a global tracker and derives paths in idle responses. This CLI deliberately does not call it. `--project` scopes the selected project's configured issue source through the existing list API; an unfiltered list remains the backend's current global-source list, not a claim to enumerate all project sources. No GitHub issue, task/worktree binding, or provider session is created by observation.

## Transport and failure boundaries

- Every request uses the existing bearer token, with one ten-second total command deadline and a ten-second client timeout. Project validation and issue lookup share that deadline.
- Remote origins require HTTPS; HTTP is accepted only for loopback. URL credentials, non-root paths, queries and fragments are rejected. Redirects are not followed, including redirects to the same origin.
- Responses are limited to 8 MiB. Malformed/trailing JSON, missing identity fields, incorrect response shape and scope conflicts fail visibly. Status requires numeric running/retrying counts and entry arrays, so an unrelated empty JSON object fails. Empty null project/task collections normalize to arrays.
- Non-success response bodies and transport error details are not printed. The API token is removed from output strings and keys, and known secret fields are redacted. Arbitrary backend task content is not a universal secret detector; avoid treating observation output as public artifacts.
- No retries, discovery requests outside the chosen backend, or side effects occur. There are no create/dispatch/cancel/retry/worktree/run/approval/merge commands.

## Behavioral verification

Native Windows execution passed on this checkout:

```text
go test ./internal/cli ./cmd/orchestra
go vet ./internal/cli ./cmd/orchestra
go build -o dist/orchestra/orchestra.exe ./cmd/orchestra
dist/orchestra/orchestra.exe --help
```

New HTTP tests cover bearer authentication, GET-only endpoints, filter encoding, preservation of source/requested configuration, ID versus identifier separation, duplicate ambiguity, unknown project rejection before issue lookup, project scope conflict, redirects without credential forwarding, non-success body suppression, malformed/trailing/oversized response rejection, cancellation, normalized empty collections and credential redaction. Command tests verify dispatch argument/stream/exit preservation and documented task identities; existing legacy command tests remain green.

Local evidence logs: `apps/backend/baseline-cli-observation-tests.log` and `apps/backend/baseline-cli-observation-vet.log` (ignored diagnostics). Build and executable help returned exit 0. This receipt covers native CLI tests and local HTTP fixture boundaries, not authenticated provider inference, live hosted tracker behavior, UI/worktree E2E, restart recovery, or Docker race certification of this new slice.

Changed files: `apps/backend/cmd/orchestra/main.go`, `main_test.go`, `apps/backend/internal/cli/observation.go`, and `observation_test.go`.

## Remaining work

The Orchestra CLI skill should document only these executable commands and preserve the canonical WorkItem semantics. Future mutations require the shared service command contracts and durable request identities, repository/project ownership guards, honest uncertain outcomes, ordered completion effects, and independent lifecycle verification. Kanban states are task workflow states; running/retrying observations are separate. Requested model/turn settings remain authoring intent, and task branch names are not proof of owned worktrees.
