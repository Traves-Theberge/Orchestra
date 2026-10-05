# Agent resource CLI handoff — 2026-10-04

## Scope

Added Orchestra CLI `agent` and `skill` list/show/create/update/delete/receipt wrappers over the authenticated project agent-catalog API. The command reads file text only from an explicitly supplied `--content-file`; it has no direct filesystem write path. Mutations use one canonical request UUID, update/delete require the latest SHA-256 content hash, and the CLI never retries a mutation. Timeout, transport failure, malformed body, or server error is reported as an unknown outcome with the same receipt ID to inspect.

CLI origin and authentication follow the existing observation boundary: `--base-url` or `ORCHESTRA_BASE_URL`, bearer token from `ORCHESTRA_API_TOKEN`, HTTPS or loopback HTTP only, 10-second deadline, redirects disabled, response-size bound, response-body errors not printed, and credential redaction. Resource IDs are exact native IDs (including nested slash IDs) encoded in a query value. `effective` is read-only; `__orchestrator__` is global-only. Agent and skill list commands filter their requested kind from the shared catalog response.

The persistent native orchestrator's `orchestra_resources` tool shares the API service with strict keys `operation`, `project_id`, `workspace_id`, `harness`, `scope`, `kind`, `resource_id`, `request_id`, `expected_hash`, `format`, and `content`. It supports `list/get/create/update/delete/receipt`, with list metadata-only and get returning raw content/hash. `orchestra_config` is limited to Orchestra's own `workspace.json`; it does not authorize provider credentials/account settings. Both tool and CLI use the same exact native resource ID, expected-hash, and receipt semantics.

## Reference receipt

- Orca pinned revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [mutation-request.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.ts) preserves one mutation request ID across bounded retries for a known `runtime_unavailable` condition and retains the earlier sent request ID when a later attempt fails before carrying it. That supports stable identity and explicit recovery. Orchestra deliberately does not retry HTTP authoring mutations: the backend persists a receipt before a file effect, and a timeout/5xx can leave the operation unknown; the CLI tells the user to inspect the receipt first. No source was copied. The pinned handler's directory was inspected; a directly adjacent test for this helper was not located.
- T3 Code pinned revision `737993303d36e10674c54b95e5bd3826682c99c7`: searched the pinned source tree for an Orchestra-style CLI agent/skill resource CRUD command. No comparable CLI writer was found in the reviewed tree. The closest relevant pattern remains typed provider/resource boundaries in T3's provider adapter, not a command-line authoring receipt. Orchestra therefore uses its own typed project API and durable SQLite-backed receipt. No T3 source was copied.

Neither reference was run as a live application in this package. Source observations do not prove Orchestra provider loading or agent selection.

## Behavioral verification

`internal/cli/resources_test.go` uses local HTTP fixtures to check authenticated scoped catalog/list and show requests, exact nested IDs, agent-versus-skill filtering, exact raw content read from an explicit file, one-request-only behavior on a server error, stable request ID in the unknown-outcome message, receipt lookup, and fail-closed argument validation including the reserved global-only scope. `cmd/orchestra/main_test.go` verifies `agent` and `skill` dispatch and help coverage.

Validated on Windows with `go test ./apps/backend/internal/cli ./apps/backend/cmd/orchestra -count=1`, `go vet ./apps/backend/internal/cli ./apps/backend/cmd/orchestra`, and `go run ./apps/backend/cmd/orchestra --help`. The tests exercise a local fixture API; actual catalog route behavior is covered by the agent-catalog API/service package tests, not by a live provider-account E2E. Resource catalog discovery does not establish that a harness can select or enforce a returned agent.
