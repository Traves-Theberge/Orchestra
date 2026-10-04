# Requested task configuration persistence

This slice preserves Studio model and turn settings as task authoring intent. It does not certify that a runner honors either setting. Existing Kanban states and dispatch behavior are unchanged.

## Reference receipt

Inspected before implementation using the pinned [registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md):

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts), [ProviderSelectionTransition.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderSelectionTransition.ts), and its [tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderSelectionTransition.test.ts). Adapter inputs carry explicit model selection and runtime policy at session/thread/turn boundaries. An ACP model change is rejected unless negotiated session capabilities can apply it; option-only changes are separately classified. The test assertions distinguish selection intent from supported application. Orchestra adopts typed requested fields without asserting application. Deliberate difference: this slice stops at persisted task metadata; capability resolution, launch snapshots, and provider negotiation remain later work.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [agent-project-model-override.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts) and its [tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.test.ts). Workspace config presence makes an account default insufficient to name the effective model. Tests cover linked worktrees, repository ancestor boundaries, loose folders, account-home exclusion, and Claude default uncertainty. Orchestra deliberately stores `requested_model`, not an effective-model claim, and does not inspect or mutate global provider settings in this slice.

These are source observations. Neither reference application was launched, and their tests were inspected rather than run. No reference code was copied. Their runtime reliability does not establish Orchestra reliability.

## Adaptation

- Nullable SQLite columns `requested_model` and `requested_max_turns` are added idempotently. Existing tasks inherit the unset defaults. Turn values must be integral and between 1 and 100, matching existing Studio save validation; this value is the Studio request, with no claim about native-provider versus Orchestra attempt semantics.
- WorkItem exposes `requested_model` and nullable `requested_max_turns`. All SQLite task projections share the columns, so detail, list, candidate, state-filtered, ID-filtered, and search reads preserve them.
- SQLite PATCH validates requested fields before its single update. Exact JSON numbers are validated without float rounding; explicit null clears and omission preserves the setting. Studio Push transfers both fields alongside existing authoring metadata.
- Runtime-target creation previously changed only the returned object. Service creation now writes the target through the selected tracker and verifies the returned persisted field. Storage errors or silent unsupported-field behavior return an error identifying the created task rather than claiming success.

## Independent behavioral verification

On Windows, `go test ./internal/tracker/sqlite ./internal/studio ./internal/orchestrator` passed. `go vet` for the same packages passed. A subsequent focused `go test ./internal/orchestrator -run TestCreateIssue -count=1` passed after adding failure injection.

- `requested_config_test.go`: real file-backed SQLite close/reopen and every task read path; unset defaults, omitted-field preservation, explicit null clears, typed Studio pointer input, integer bounds, exact JSON number integrality, invalid mixed-field patches leaving title and config unchanged.
- `push_requested_config_test.go`: actual Studio Manager, real project foreign key, real SQLite tracker, draft patch, Push, database close/reopen, and independent task reload preserving model, turns, authoring-session identity, and Backlog state.
- `create_runtime_target_test.go`: real Service creation through SQLite followed by database close/reopen; injected storage failure and tracker silent-ignore both fail truthfully while exposing the partial creation boundary.

The native race command was attempted but did not execute: `-race requires cgo; enable cgo by setting CGO_ENABLED=1`. No global environment settings were changed. Linux container race evidence is recorded separately below with its source state.

### Fresh Linux container verification

After the requested-config, API exact-number decoding, provider dispatch guard, and PR push-safety owners reported stable backend source, built a fresh test image `sha256:55b1e93925a1ed64db277d2273ab9ea8d38147cf5ab0212c3ad9fa99bab28094` (tag `orchestra-backend-test:requested-20261004-011448`). The image used Go 1.26.8 Linux/amd64, CGO enabled, UID/GID 10001, image-owned source, execution network `none`, and only a newly owned Docker-managed Go cache volume. There were no host source/home/credential/socket bind mounts.

`test-backend all` completed with exit 0: fresh full `go test ./...` followed by fresh full `go test -race ./...`. Unit API 79.567s, app 8.212s, Studio 5.353s, orchestrator 3.751s, SQLite tracker 5.579s; race API 203.281s, app 16.795s, Studio 13.624s, orchestrator 7.122s, SQLite tracker 12.571s. No timeout changes or retries were used. A subsequent focused `go test -race ./internal/api -run TestCreateGitHubPR -count=1 -v` passed in 3.913s, including divergent-remote, missing-local-branch, and missing-task rejection cases. This verifies backend tests in this Linux image; it is not UI-to-provider-to-PR E2E evidence.

Logs and container/image environment evidence are outside Git at `C:\Users\trave\AppData\Local\Orchestra\diagnostics\requested-config-docker-20261004-011448`: `build.txt`, `all.txt`, `all-exit.txt`, `pr-race.txt`, `pr-race-exit.txt`, `container-inspect.json`, `source-environment.txt`, `host-source-hashes.json`, and `cleanup.txt`. Selected image source hashes matched the host source at snapshot verification. Owned scratch container and cache volume were verified by labels and removed; image and logs remain. Native audit and unrelated Docker resources were untouched.

## Remaining boundaries

Requested configuration is not resolved or frozen for execution and is not passed to the runner by this slice. External tracker support is not certified. API and renderer integration are independently owned and tested by the parent package. Native provider model changes, native turn-budget enforcement, task/workspace effective-config identity, and full ADE E2E remain unverified.

Create and metadata update remain separate effects. A failed runtime-target write leaves a created task and returns its identifier in the error; retrying can still create duplicates. Studio Push likewise lacks a durable transaction/receipt for failure recovery. This slice does not claim atomic cross-effect creation, deduplication, or rollback. Those require the separate mutation-receipt/lifecycle work.
