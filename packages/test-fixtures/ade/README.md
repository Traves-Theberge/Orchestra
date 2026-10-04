# Disposable ADE fixtures

The first executable fixture is `apps/backend/internal/testsupport/ade`. Backend tests can call `ade.NewFixture(ctx)` and register `ade.NewRecordingRunner(fixture, steps...)` through `agents.Registry.SetRunner`.

The fixture provisions a private temporary root containing a real Go repository, local bare `origin.git`, a separate `task-1` Git worktree, isolated home/config/cache/temp roots, and `ownership.json`. Its initial `Answer()` implementation returns 0; the real `go test ./...` check expects 42 and fails. A scripted runner must edit the task checkout to return 42 and pass the actual check. A completion event alone cannot satisfy that scenario.

Prerequisites: Git and a local Go toolchain on PATH. No network, provider login, hosted GitHub target, or developer repository is needed. Child commands use an allowlisted environment and never inherit provider credentials or Git overrides. Both HOME and USERPROFILE point at the fixture home. Do not use process-wide `os.Setenv` to launch fixture children.

Run:

```powershell
cd apps/backend
go test ./internal/testsupport/ade -v
```

Produce a persistent shared-schema report and artifacts outside the source tree:

```powershell
cd apps/backend
go run ./cmd/ade-fixture --source-root ../..
go run ./cmd/ade-fixture --source-root ../.. --broken
```

The command prints the absolute `report.json` path. Its default directory is a new `orchestra-ade-evidence-*` directory in the system temporary location; it retains reports/artifacts and removes the owned execution fixture. `--output-dir` accepts a new directory outside the source repository whose parent exists. It refuses existing directories and outputs inside the source tree. `--broken` deliberately edits Answer to return 41, persists the actual failed check, writes a valid failed report, and exits nonzero. An expected injected provider failure passes its own failure-handling scenario; the deliberately broken happy path is a failed scenario.

The report's five scenario IDs are `fixture.real_change_and_check`, `fixture.environment_isolation`, `fixture.cancelled_dispatch`, `fixture.failed_dispatch`, and `fixture.cleanup_ownership`. Select expected IDs/modes/boundaries independently in the acceptance profile. The producer does not assert native lifecycle or release readiness. Its source metadata uses the shared `evidence.Fingerprint` implementation before and after execution; concurrent source changes produce failed evidence. Moving reports into the repository or editing code afterwards changes the fingerprint and makes previous results unsuitable as current-tree acceptance.

Every caller must defer `fixture.Close()` or register it with `t.Cleanup`. Cleanup compares the private ownership record to the on-disk manifest and refuses a changed root/manifest. Changing exported manifest fields cannot redirect deletion. Writes reject traversal and resolved symlinks outside the task worktree. This is bounded test support, not an arbitrary-code sandbox: callers must not execute untrusted commands, mutate owned paths concurrently with ownership checks, or treat arbitrary symlink races as safe.

The runner records each exact current `agents.TurnRequest`, with snapshots of JSON-compatible tool/resource maps, check output, result, and error. It supports scripted events (including externally supplied stale session IDs), tool execution, usage, delay, cancellation, deterministic file edits, and injected failures. It intentionally does not invent future run/attempt identities absent from the production request contract.

Evidence mode is **simulated provider** with **real filesystem, Git, and check subprocess** boundaries. API, desktop, database persistence, production provider protocol, hosted PR review, child-process-tree cancellation, questions/approval response handling, and crash recovery remain unverified. Future integrated harnesses must consume the shared evidence contract under `packages/protocol/schemas/ade`, supply independently expected scenario IDs, and report unavailable real-provider prerequisites as blocked rather than replacing them with this runner.
