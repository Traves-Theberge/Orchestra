# Parser drain and child stop settlement corrections

This follow-up supersedes the synchronous io.Pipe handoff from [the original drain fix](ade-command-runner-drain-handoff-2026-10-04.md) and immediate false-signal rejection from [managed startup cleanup](ade-managed-backend-handoff-2026-10-04.md). Scope is command_runner.go/tests and managed-backend.cjs/tests only. The live audit app on 4011/5173, security policy, provider settings and production data are untouched.

## Evidence and diagnosis

- `baseline-launch-review-backend.log` records `TestCommandRunnerFlushesSSEDataAtEOF` failing with `exec: WaitDelay expired before I/O complete` under full-suite load. The one-second WaitDelay covered exec's copy goroutines, whose io.Pipe writes waited synchronously on parsing/event callbacks. That design conflated delayed parsing with retained OS pipe handles. The historical log does not identify the exact scheduler ordering for that one run.
- A new deterministic regression pauses the first event callback for 1.2 seconds after the command emits its final SSE payload and exits. A temporary Go overlay restoring the preceding io.Pipe handoff fails this regression with the same WaitDelay error, `seen=false`, and only warmup/event-header output. This proves a concrete design defect capable of producing the recorded failure, without asserting unobserved historical timing.
- `baseline-launch-review-audit.log` records successful readiness and subsequent `backend 47524 refused SIGKILL`. The prior helper equated kill=false with refusal immediately, although the process could already have exited and Node's exit notification could still be queued. It also allowed concurrent callers to send duplicate signals. Released ports alone did not prove when the exit notification arrived; focused regressions explicitly simulate that boundary.

## Pinned reference receipt

Re-read the [mandatory pinned registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md) and relevant lifecycle sources before editing:

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: [DesktopBackendManager.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/desktop/src/backend/DesktopBackendManager.ts) separates exit observation, output-fiber drain, and run-scope shutdown; per-instance lifecycle state and a mutex prevent cross-instance ownership confusion. Associated tests were examined during the preceding managed-backend slice. Adaptation: bound subprocess handle draining separately from callback work and serialize stop ownership for a single child. Deliberate difference: Go condition-variable buffers and a JS WeakMap promise replace Effect fibers/scopes; no restart manager is introduced.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [agent-browser-bridge-raw-process.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/browser/agent-browser-bridge-raw-process.test.ts) explicitly distinguishes helper exit/output completion from descendants retaining output handles. Adaptation: preserve the existing inherited-handle regression while adding independent parser-delay and pending-exit cases. Deliberate difference: Orchestra reports a genuine inherited-handle timeout instead of silently claiming completed output, and an unobserved child exit remains a cleanup failure. No reference source was copied or reference runtime launched.

## Implementation

### Runner

- Exec's stdout/stderr writers now enqueue into thread-safe bounded streams; parser goroutines read concurrently. An event callback can pause without blocking OS output copying.
- A shared lifetime quota caps accepted raw bytes across both streams at the existing MaxOutputSize (5 MB), including bytes already parsed. Overflow cancels the command and remains an explicit output-size error; buffers cannot grow indefinitely while callbacks are delayed.
- Normal exec completion closes the buffers for further writes and lets parsers consume all queued bytes before EOF/SSE flushing. Context cancellation aborts buffers and wakes blocked readers/copy writers. Existing shellcommand process cancellation remains in place.
- WaitDelay remains **one second**. It bounds exec's OS output copying/inherited handles, rather than the separate event callback handoff. No timeout budget was simply enlarged.

### Managed backend stop

- A WeakMap retains one in-flight stop promise per child. Concurrent callers share that operation and signals; completed/exited children remain idempotent.
- False SIGTERM or SIGKILL results now start a bounded exit-observation wait, instead of immediately declaring refusal. An actual exit event or populated exit status settles success; a false signal with no observed exit still fails.
- The deadline yields one poll turn before final classification so an already queued exit notification can settle first. SIGTERM/force-kill grace and post-signal budgets remain unchanged. Original startup errors are preserved when genuine cleanup failure is logged.

## Verification

- Windows focused `go test ./internal/agents -run 'TestCommandRunner|TestCommandOutputStreams' -count=1`: passed, 18.478 seconds.
- Windows old-handoff overlay `TestCommandRunnerSlowCallbackDoesNotTimeoutOutputDrain`: intentionally failed, 5.751 seconds, with WaitDelay and lost SSE data. Source was not rolled back; overlay inputs are temporary files.
- A later Windows repeated run on the current binary was blocked by Application Control before test execution (`go-build3988045982/b001/agents.test.exe`). It is not counted as an assertion failure or passing verification. Security settings were not changed.
- Fresh Linux image `e2a1d7bc` focused `go test -race ./internal/agents -run 'TestCommandRunner|TestCommandOutputStreams' -count=1`: passed, 4.352 seconds, as reported by the Docker verification worker. Includes slow callback, shared quota/abort, earlier fast-exit drain, inherited OS pipe timeout, deadline and cancellation scenarios.
- The same fresh image's slow-callback regression under `-race -count=10`: passed, 13.459 seconds, with all ten repetitions completing in approximately 1.23 seconds each. Worker log: `requested-transport-docker-20261004-020538/slow-callback-repeat.txt` in the local diagnostics directory.
- Node `node --test electron/managed-backend.test.cjs`: **16 passed**, including real owned-child shutdown, concurrent stop/shared promise, idempotent settled stop, false TERM/KILL with pending exit, genuine refused signals and never-exiting child failure.
- Helper syntax and scoped diff checks passed.

Final full backend lanes and a post-fix isolated native audit are owned by the parent/verification worker and are recorded separately. These checks do not certify provider E2E behavior or independently establish the exact cause of every historical log entry.
