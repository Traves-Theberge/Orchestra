# ADE verification harness: first executable slice

Package 01 remains in progress. This slice introduces reusable disposable Git/check boundaries and a controlled provider runner; it does not establish application E2E reliability.

## Reference receipt

Inspected T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) and [RunFinalizationService.test.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/RunFinalizationService.test.ts). The provider boundary carries explicit policy and request/session identities. Finalization tests assert service calls and guard refresh against another checkout or a newer run. Orchestra uses its existing typed `TurnRequest`/`Runner` seam and asserts the actual task diff independently of events. Deliberate deviation: Go's current contract lacks T3's full identity hierarchy; the fixture records the fields that exist without manufacturing future production identities. Real local Git effects supplement service mocks.

Inspected Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [journal-dispatch-observation.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.test.ts) and [worker-list-run-scope.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/worker-list-run-scope.test.ts). They test fenced observations and explicitly distinguish CLI call scope from runtime RPC evidence. Orchestra therefore labels each exercised boundary, records dispatch errors, rejects another fixture's checkout, and never treats emitted completion as proof of a real edit/check. Deliberate deviation: this runner is not a durable journal and does not resolve uncertain dispatch or prove run-scope persistence. Those application behaviors remain later acceptance scenarios.

Neither reference was run interactively in this slice. Their tests inform the design; only Orchestra's independently executed checks below establish the stated coverage. No source code was copied.

## Changes and ownership

- `apps/backend/internal/testsupport/ade/fixture.go`: unique temporary roots, persisted ownership, real repository/bare remote/task worktree, isolated child environment, guarded commands and cleanup.
- `apps/backend/internal/testsupport/ade/runner.go`: production Runner-compatible recorder, scripted tools/events/usage/delays/failure, scoped real file edits and Go verification.
- `apps/backend/internal/testsupport/ade/fixture_test.go`: actual effects, isolation, cancellation, failure, traversal, ownership mismatch and independent roots.
- `packages/test-fixtures/ade/README.md` and `scenarios.json`: reusable command/ownership contract and implemented versus pending scenario catalog.
- `apps/backend/cmd/ade-fixture/main.go` and `main_test.go`: standalone shared-schema report producer with retained artifacts, deliberate broken-check mode, and refusal to write reports into its source repository.

All mutations occur inside a private `orchestra-ade-*` root. The existing Orchestra checkout, developer home/config, live provider settings, and hosted repositories are not fixtures. No global environment mutation occurs in production fixture construction. Tests set harmless sentinel environment variables through `t.Setenv` and verify they are absent from child environments.

## Behavioral verification

`cd apps/backend; go test ./internal/testsupport/ade -v` passed all seven tests on Windows amd64 in 22.891 seconds. The real seed check failed, the edited task check passed, and the seed repository plus bare remote retained their original state. Registry dispatch recorded the request, invoked the tool, and returned the scripted usage only after the real check. Cancellation before execution and during delay suppressed later writes/completion. Ownership mismatch refused deletion; valid cleanup removed only its private root and was idempotent. Typed schema arrays are recorded as independent snapshots. `go vet ./internal/testsupport/ade` also passed.

The Windows host lacked symbolic-link privilege. Traversal and outside-worktree checks ran; the symlink-specific branch was not exercised and logged that limitation. No symlink behavior is certified on this host. No race result, Linux result, real provider call, backend/renderer integration, durable database assertion, hosted PR flow, or ten-run reliability result is claimed.

`go test ./cmd/ade-fixture -v` passed in 30.105 seconds. It independently provisioned a disposable source repository and exercised the passing producer and deliberate failed-check producer. Both reports validated through the shared schema; every referenced artifact existed; execution roots were removed. The failed report retained the real check diagnostic (`got 41; want 42`) and returned an error. A separate case rejected output inside the source repository before creating that directory. These command tests prove report generation, not external acceptance of every claimed product capability.

After tightening temporary-directory ownership, the output-scope test passed again (4.599 seconds) and the added temporary-parent test passed (3.674 seconds); `go vet ./cmd/ade-fixture` passed. An actual standalone `--broken` invocation exited 1 and retained `C:\Users\trave\AppData\Local\Temp\orchestra-ade-evidence-1552751104\report.json` with failed-check artifacts. Concurrent source edits also produced a truthful failed `fixture.source_stability` row. That historical failure receipt cannot serve as acceptance for the later working tree.

Run `go run ./cmd/ade-fixture --source-root ../..` from `apps/backend` to retain a report in a new temporary evidence directory. Add `--broken` for a failing report and nonzero process status. Reports contain current revision/tree fingerprint, environment, exact current request fields, provider events, real check output, seed/task/remote Git assertions, isolated child Git configuration, cancellation/failure receipts, and cleanup refusal/removal facts. Reports and artifacts remain outside the source tree; fixture roots are deleted. The acceptance profile's required scenarios and mode/boundary requirements must come from a consumer rather than this producer's self-description.

## Next package gates

Compose this fixture with the real backend and desktop using shared evidence reports. Add owned-process lifecycle with process-tree cancellation and crash injection, controllable GitHub routes, explicit application transitions/persistence assertions, and repeated independent runs. Keep real-provider and hosted canaries distinct from this simulation. Questions/approvals and stale completion can be injected as events, but their product handling needs its own acceptance tests.
