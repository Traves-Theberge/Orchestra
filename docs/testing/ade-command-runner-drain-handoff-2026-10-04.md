# Command runner output drain correction

## Failure and scope

Linux Docker's full backend unit run failed `TestCommandRunnerReturnsInputRequiredFromNestedNeedsInputPayload`: the command exited successfully but its final input-required event was not observed. The prior Windows nested-event test passed 50 repetitions, which did not establish Linux correctness or eliminate the race.

`RunTurn` used `Cmd.StdoutPipe` / `StderrPipe`, launched parser goroutines, then called `cmd.Wait()` before joining those parsers. Go's documented contract requires finishing reads before Wait because Wait closes these pipes. Fast child exit could therefore discard unread event bytes; the scanner treated the resulting closed-pipe error as ignorable and returned success.

Scope is `internal/agents/command_runner.go` and its focused tests. Previous deadline normalization and other wave changes are preserved. No provider/global settings, runtime audit app, Docker setup, or production data were changed.

## Reference receipt

Re-read the [pinned registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md) and these sources before implementation:

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: [DesktopBackendManager.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/desktop/src/backend/DesktopBackendManager.ts) separates process exit observation from output draining, bounds drain time, and preserves failure causes. Its tests were inspected during the immediately preceding backend lifecycle slice. Orchestra adopts separate process/parser settlement with a bounded inherited-handle wait. Deliberate difference: Go exec and caller-owned io.Pipe streams instead of Effect streams/scopes.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: re-inspected [agent-browser-bridge-raw-process.test.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/browser/agent-browser-bridge-raw-process.test.ts). It explicitly checks that a helper's exit/full output settles even when a descendant retains stdout/stderr handles. Orchestra independently tests the corresponding inherited-pipe boundary and uses exec.WaitDelay instead of waiting indefinitely. Deliberate difference: Orchestra reports a drain timeout as a failed command turn, preserving captured parent output; the inspected Orca test expects a successful JSON helper response. No source code was copied.
- Primary [Go exec documentation](https://pkg.go.dev/os/exec#Cmd.StdoutPipe) supplies the exact pipe ownership/order contract, and WaitDelay supplies the bounded exit/inherited-pipe mechanism.

No reference runtime was launched; reference tests are behavioral design evidence, not Orchestra verification. Kanban and native-provider contracts are unchanged.

## Implementation and regression scenarios

- Assign caller-owned io.Pipe writers to `cmd.Stdout` / `cmd.Stderr`. Exec's copy goroutines finish delivering bytes before Wait returns; then close the caller writers and join event parsers. Closing these writers sends EOF without dropping parser-buffered bytes.
- Set `cmd.WaitDelay` to one second so a descendant retaining inherited OS output handles cannot hold completion indefinitely after the shell exits. A WaitDelay error remains visible, wrapped as a wait-command error.
- A command-context cancellation closes both readers, releasing blocked copier writes and preserving the existing cancellation, timeout and input/approval error precedence.
- The new gated fast-exit regression pauses the first event callback, allows the process to write its nested input-required event and exit, then resumes parsing. It verifies the actual returned blocking error and captured event, not just the payload classifier.
- A POSIX regression launches a short-lived background descendant retaining output handles, verifies bounded WaitDelay failure and retained parent output. Windows explicitly skips this POSIX shell inheritance case.

## Verification

- Windows `go test ./internal/agents -run TestCommandRunner -count=1`: passed, 10.441 seconds.
- Windows `go test ./internal/agents -run TestCommandRunnerDrainsNestedInputEventAfterFastExit -count=20`: passed, 9.743 seconds. Scoped diff check passed.
- Windows temporary Go overlay restoring only the prior StdoutPipe/Wait ordering: new gated test failed as intended, returning nil error and only `warmup` output (3.353 seconds). The workspace source was never rolled back; overlay inputs live in an isolated temporary directory.
- Docker worker independently copied only the new test file into the old Linux production-code image and ran the gated regression under `-race`: it failed with the same nil error/only warmup output (0.132 seconds). Its initial full race run also reproduced lost usage output (`TestCommandRunnerParsesJSONUsageAndEvents`, expected 16 tokens, got zero), corroborating a generic stream drain defect.
- Linux final-source unit/race verification is coordinated with the Docker verification worker; pending its rebuilt image, not claimed passed here.

These are runner subprocess boundary checks. They do not establish provider E2E reliability or child-tree termination: WaitDelay bounds inherited output handles but does not kill an escaped descendant. Parent command cancellation retains the existing exec.CommandContext shell kill behavior.
