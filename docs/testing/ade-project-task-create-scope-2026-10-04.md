# Project task creation scope boundary — 2026-10-04

The desktop New task action uses legacy `POST /api/v1/issues`. Its `CreateIssue` service previously used the global tracker when a selected project's configured tracker failed to resolve. This package changes only creation routing and confirmation; other legacy task handlers retain their documented limits.

## Reference receipt

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: inspected `apps/server/src/orchestration-v2/ProviderAdapter.ts` for distinct scoped request/session identities and explicit provider failures, and `ThreadPullRequestService.ts` for canonical repository matching and rechecking expected workspace identity before applying discovered results. Orchestra adapts these identity boundaries to exact catalog project, configured source, task ID and identifier. No T3 issue-creation adapter behavior is asserted or copied.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected `src/cli/handlers/orchestration/mutation-request.ts` and project model override boundaries. Orca preserves retry request identity and recovery information when an effect may have landed; workspace context can differ from a global default. Orchestra refuses global source substitution and reports creation uncertainty explicitly.
- Deliberate deviation: this narrow legacy HTTP route does not add Orca-style durable request replay. An uncertain response requires inspecting the selected tracker before repeating. The separate shared control API retains its durable receipt contract. This package does not claim hosted tracker create parity or live reference E2E reliability.

## Implemented behavior

- A selected catalog project resolves its embedded source or assigned tracker configuration; absent project/database/registry/configuration or a failed adapter factory returns HTTP 503 `project_tracker_unavailable` before sending creation. No global or local fallback substitutes for a configured source.
- A local project without a tracker source/configuration explicitly creates through SQLite. SQLite's existing projection omits `source`, so an empty source is accepted only for this known local client.
- A created task must have nonempty ID and identifier and match the selected project and source. A mismatched or missing result returns HTTP 409 `creation_unconfirmed`, without attempting its runtime-target patch.
- A runtime-target patch must confirm the same ID, identifier, project, source and requested target. Failure or a foreign result is unconfirmed; partial creation remains possible and is not rolled back or automatically retried.
- Unscoped requests preserve existing single-tracker behavior. List/detail/search/update/delete routing is not changed. No provider settings or home directories are changed.

## Independent behavioral verification

`TestPostIssueProjectCreationFailsClosed` invokes the real HTTP handler with an on-disk SQLite catalog, a counted global tracker, and deterministic configured-adapter fixtures. Cases cover missing registry, failed factory, missing assigned configuration, unregistered project, foreign project/source responses, nil result, foreign runtime-target update, and local successful creation. Assertions check HTTP codes, zero global calls, configured mutation counts, no patch of an unconfirmed task, and actual local row counts.

- Native Windows full API and orchestrator suites: passed (`go test ./internal/orchestrator ./internal/api -count=1`; API 62.747 seconds).
- Isolated Linux Docker targeted race checks: passed for this handler and existing runtime-target persistence/partial-effect tests (`go test -race ./internal/api ./internal/orchestrator -run 'TestPostIssueProjectCreationFailsClosed|TestCreateIssue' -count=1`).
- Existing runtime-target tests independently reopen SQLite to verify persistence and preserve a partially created task when the target update fails.

These fixtures verify handler routing and confirmation boundaries. They do not verify live GitHub, Linear, Azure or Jira credentials, remote issue creation, desktop click-through behavior, or the complete task-to-PR lifecycle. A remote adapter that cannot return Orchestra's exact selected catalog identity will receive an unconfirmed result until its mapping is verified.
