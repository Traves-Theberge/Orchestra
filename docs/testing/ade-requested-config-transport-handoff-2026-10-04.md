# Requested configuration transport and running-state recovery

This extends [task requested configuration persistence](ade-requested-config-handoff-2026-10-04.md) through the existing orchestrator entry model. It preserves admitted model/turn requests rather than substituting later task edits. The fields remain requested intent, not provider-confirmed effective configuration.

## Reference receipt

Before editing, inspected the pinned registry and the following behavior:

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: previously inspected [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) separates app thread/run/attempt/provider identities and carries explicit model selection and runtime policy on each relevant adapter operation. Re-inspected [ProviderSelectionTransition.test.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderSelectionTransition.test.ts): unsupported negotiated ACP model changes reject, while supported changes and option-only changes are classified explicitly. Orchestra retains the admitted request through entry transitions; the independently owned dispatch guard must reject options its runner cannot honor. Deliberate difference: no new attempt/config identity, adapter negotiation, or effective-model claim is added here.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected [journal-dispatch-observation.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.test.ts) before editing, and traced its [implementation](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.ts). Observations are selected within an execution fence and retain unknown/pending/accepted and recovered distinctions; absence produces no observation. The prior model-override implementation/tests also show workspace config presence does not establish an effective model. Orchestra adopts preservation and scoped, truthful recovery reporting. Deliberate difference: existing `runs` snapshots are not Orca-style fenced write-ahead submission journals and cannot establish delivery or deduplicate effects.

Reference runtimes and tests were not run. Source observations do not certify Orchestra E2E reliability, and no reference code was copied.

## Changes and behavioral verification

- `RunningEntry` and `RetryEntry` carry `RequestedModel` and nullable `RequestedMaxTurns`, matching WorkItem JSON names.
- Admission copies the task request. Failure retry, due-retry release, and stall retry retain that request without replacing it from later tracker values. Stall retry also retains its existing provider, runtime target, assignee, and disabled-tool policy, which were previously dropped.
- Snapshot, lookup, claim, and test setters copy mutable turn pointers and disabled-tool slices so callers cannot alter internal admission state through returned references.
- Existing running-state SQLite save/reload now includes requested model/turns, runtime target, and disabled tools. Idempotent `runs` migrations add requested columns and a JSON tool-policy column. Turn values retain the 1..100-or-null database constraint. Invalid stored tool JSON or non-string entries reject recovery without installing a partial in-memory state.

Windows `go test ./internal/orchestrator ./internal/db` passed after final source changes: orchestrator 3.917s and DB cached (the initial DB run passed in 4.979s). Package vet passed. Tests cover real candidate admission, mutation of input/snapshot/lookup/claim references, actual failure/retry transitions after replacing tracker settings, stall transitions, real file-backed SQLite close/reopen after changing task configuration, and invalid persisted policy rejection.

The SQLite test proves the existing DAO's running-entry boundary independently; it is not a process-crash or provider-resume test. Root integration and Linux race verification must be recorded against the final shared source snapshot separately.

## Final shared Linux verification

Built final image `sha256:e2a1d7bcbafb22b43327609c1d174d92e3db981de010d1f7683ae799c8703f2b`, tag `orchestra-backend-test:transport-20261004-020538`, after the owners reported stable requested-option guards, PR snapshot/reviewed-head merging, stricter fixture baseline proof, and bounded command-output buffering. Go 1.26.8 Linux/amd64, CGO enabled, UID/GID 10001, execution network `none`, image-owned source, and only an owned Docker-managed Go cache volume were used. No host source, home, credentials, or Docker socket was mounted. Selected source hashes were independently compared against the host snapshot and matched.

- Build exited 0. Full `test-backend all` exited 0: all backend unit packages followed by all backend race packages passed. Unit API 80.560s, app 9.078s, orchestrator 3.588s, Studio 3.681s, fixture producer 32.130s, agents 3.488s. Race API 224.269s, app 24.709s, orchestrator 9.966s, Studio 12.368s, fixture producer 34.518s, agents 5.605s. Unchanged packages report cached results from the same owned cache; changed packages ran freshly.
- Focused `go test -race ./internal/agents -run 'TestCommandRunner|TestCommandOutputStreams' -count=1 -v` exited 0 in 4.352s. Slow-callback regression `-race -count=10` exited 0 in 13.459s, with all ten repetitions passing. Default test timeouts were unchanged.
- The first new PR API fixture run in image `136cc4fe...` failed with a nil warehouse pointer. The root owner fixed explicit router warehouse injection and added a missing-DB 503 response. The rebuilt `1f9c625d...` image's focused snapshot/merge route tests passed in 2.613s, and its full unit/race suites also passed. That image preceded the final runner/fixture changes, so it is historical evidence; the final full suite above includes those changes.

Reviewable final logs and process/image outcomes are archived in [evidence/ade-launch-review-2026-10-04](evidence/ade-launch-review-2026-10-04): `docker-build-final.txt`, `docker-backend-all.txt`, `docker-runner-race.txt`, `docker-runner-repeat.txt`, `docker-pr-focused.txt`, and `docker-outcomes.txt`. Container inspection, source/hash verification, and cleanup diagnostics remain outside Git at `C:\Users\trave\AppData\Local\Orchestra\diagnostics\requested-transport-docker-20261004-020538`; earlier failure and historical-run logs remain at `015218` and `015722` sibling directories. No environment dump or credential material was archived in Git.

All owned scratch containers were removed after their test commands completed. The reused owned cache volume was label-verified and removed after final verification. Images and logs remain. Native audit and unrelated Docker resources were untouched. These are backend unit/race and local fixture results, not whole ADE or hosted-provider/PR E2E certification.

## Recovery limits

Queued `RetryEntry` records are still not stored by the existing DAO. A restart while a task is waiting to retry can lose its frozen request and re-admit from current task metadata. This remains a blocking gap for a comprehensive retry/restart claim.

The existing snapshot schema still lacks durable run/attempt/config identities, a versioned effective-config snapshot, checkpoints, delivery receipts, and provider-confirmed model state. It omits other workspace/prompt fields and generates composite row IDs from issue/provider; those IDs must not be treated as new run identities. Running-entry reload preserves the added fields only for successfully persisted rows. Persistence is invoked by the existing refresh loop and is not a crash-atomic admission write-ahead journal.

The app originally warned and continued when restore failed, allowing subsequent re-admission from changed task settings. The [requested-options guard package](ade-requested-options-guard-handoff-2026-10-04.md) independently changes that caller to fail startup and verifies its boundary. Provider enforcement and API/helper visibility remain distinct from comprehensive crash recovery and provider-confirmed effective configuration.
