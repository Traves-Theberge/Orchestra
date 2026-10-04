# Launch configuration and reviewed-head merging

This batch continues the pinned T3 Code/Orca reference rule and preserves Kanban. The linked receipts identify inspected source/tests, independent adaptations and unavailable runtime verification. Changes remain uncommitted.

## Implemented boundaries

- [Requested configuration transport](ade-requested-config-transport-handoff-2026-10-04.md): admitted model/turn requests, runtime target and tool restrictions survive in-memory retries and running-state SQLite reopen. Copies prevent mutation through snapshots. Invalid stored policy rejects restoration. Waiting retry entries still lack durable persistence; this is not complete crash recovery or a versioned effective configuration.
- [Requested-option validation](ade-requested-options-guard-handoff-2026-10-04.md): unsupported settings fail before workspace/hooks and again before runner invocation. No production adapter declares model selection support; explicit turn budgets all reject until their semantics/enforcement are implemented. Empty requests retain legacy defaults, whose model remains unknown. Restoration errors stop startup. Registry reconfiguration/read operations lock.
- [Reviewed-head merge guard](ade-pr-reviewed-head-merge-handoff-2026-10-04.md): a full expected head SHA is required and sent to GitHub's atomic merge precondition. A head conflict or `merged:false` cannot become success.
- [PR snapshot and UI](ade-pr-snapshot-ui-handoff-2026-10-04.md): display a commit-pinned diff with metadata recheck, send its SHA when merging, surface errors, reject stale loads and update confirmed merged state.
- [Runner and child shutdown](ade-drain-stop-settlement-handoff-2026-10-04.md): bounded output queues separate callback delays from OS pipe draining, and concurrent backend stops share exit observation. The one-second pipe drain deadline remains unchanged.
- Fixture production now requires the actual failing `got 0; want 42` baseline assertion. Previously any compiler/policy/timeout failure could satisfy that prerequisite. Independent producer test cases now own separate unchanged two-minute budgets; a slow earlier case no longer consumes the later case's deadline. Unexpected failures include report/baseline diagnostics.

## Verification and additional failures

Desktop typecheck/build passed. Full renderer suite: 69 files, 489 passed, two existing skips. Focused API client/review checks: 31 passed; scoped lint: zero errors, one existing API-client warning.

Native utility snapshot/merge checks passed. Initial snapshot API runs were blocked twice by Windows Application Control. Container testing then exposed an incorrectly wired test router; the fixture now passes the warehouse separately, and the new endpoint fails visibly without storage. Corrected native API checks passed (7.010s). The corrected producer command suite passed (67.611s).

An earlier aggregate native backend run failed: policy blocked API/fixture test executables, shared producer context exhausted, and runner output drain returned ErrWaitDelay under concurrent load. Its result is a failure, not a pass. A native audit startup reached readiness and released its owned ports, but cleanup logged a refused SIGKILL. The new runner and managed-child cleanup fixes are verified separately before final integration below. No security policy was altered.

Final native `go test ./...` exited 1: Application Control blocked the agents and presenter executables before execution. Every other test package passed, including API (108.586s), app (32.513s), fixture producer (70.300s) and orchestration (4.696s). This lane remains incomplete. Native `go vet ./...` and the staged backend build passed. Focused Windows runner tests passed separately; a later repeat was policy-blocked.

The final isolated native Electron audit reached renderer/preload/authenticated backend readiness and exited 0 without the previous cleanup warning. Its owned 4014/5174 listeners were released; the user's manual 4011/5173 audit remained running. Managed backend helper tests passed 16/16. This smoke establishes startup and owned shutdown, not a real provider/task/PR lifecycle.

Final Linux image `sha256:e2a1d7bcbafb22b43327609c1d174d92e3db981de010d1f7683ae799c8703f2b` includes the corrected runner, API fixture and producer assertions. Full unit and full race tests passed, exit 0. Focused runner/stream race tests passed (4.352s), and the slow-callback regression passed ten repetitions under race (13.459s). Containers use image-owned source, no network, non-root execution and an owned compiler cache; unchanged packages may reuse that cache. Older source-specific fixture reports and container images do not certify this batch's final source.

Final native and container logs are archived in [the evidence directory](evidence/ade-launch-review-2026-10-04/README.md). They record passing checks and the incomplete Windows lane separately.

The final test container and its compiler-cache volume were removed after verifying their ownership labels. Image/log evidence is retained. Unrelated containers and the live manual audit were untouched; final diff checks passed.

## Remaining work

Version and persist immutable effective launch configuration and command binding; enforce model/policy/budget through verified adapters; separate retry and execution-turn counts; persist waiting retries and durable mutation receipts. Anchor hosted reviews to commits, reconcile checks/approvals, fence repository configuration changes, and connect confirmed PR outcomes to task completion/revision. Real Antigravity, hosted PR lifecycle, ConPTY and full ADE E2E remain unverified.

The user's manual audit remains on 4011/5173 with its older backend. The isolated launcher smoke uses 4014/5174. Close/relaunch the manual profile using the [audit launcher instructions](ade-audit-launch-handoff-2026-10-04.md) to load the updated staged backend. Account provider configuration is untouched.
