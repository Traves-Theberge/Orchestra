# Managed backend launch failure boundary

Scope: Electron managed-backend startup and child cleanup. Windows security policy, certificates, executable trust and the currently running audit app are untouched.

## Reference receipt

Read the mandatory [pinned source registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md). Initial inspection before implementation covered T3's ProviderAdapter open/close errors retaining causes and Orca's mutation-request bounded failure handling; the more directly corresponding lifecycle sources and tests below were then inspected before finalizing the implementation.

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: [DesktopBackendManager.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/desktop/src/backend/DesktopBackendManager.ts) maps spawn errors to a typed error preserving their causes, owns each process in a run scope, uses bounded health probes and SIGTERM with forced termination after a grace period. Its [tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/desktop/src/backend/DesktopBackendManager.test.ts) inject denied spawn and hung HTTP requests and verify the original cause. Orchestra adopts immediate failure observation, bounded readiness and ownership-specific cleanup. Deliberate differences: plain CommonJS/Node promises instead of Effect scopes; preserve the original native error for the existing local startup dialog rather than replacing its message; retain Orchestra's single attempt and 20-second readiness budget instead of adopting T3's restart manager.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [mutation-request.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.ts) and its [tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/mutation-request.test.ts) preserve meaningful failure/recovery information across bounded operations. [agent-browser-bridge-process.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/browser/agent-browser-bridge-process.ts) settles bounded navigation waits and removes timers/listeners; [raw-process tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/browser/agent-browser-bridge-raw-process.test.ts) distinguish helper exit from descendants holding pipes. Orchestra adopts explicit settlement and removal of temporary wait resources. These inspected sources do not provide the same Electron-managed Go backend startup contract; no retry identity, browser helper architecture or source code is copied.

Neither reference runtime was launched. Reference source inspection does not prove Orchestra E2E behavior. Existing Kanban/provider configuration is unchanged.

## Implementation

- `electron/main.cjs` observes the child immediately after spawn, before attaching output handlers or awaiting readiness. Existing Windows environment and CSP changes belonging to the integration wave are preserved.
- `electron/managed-backend.cjs` preserves the first native launch error, races health readiness against child failure/exit and a timeout, and aborts health requests and polling on settlement. A failed startup stops only its owned child; no-PID failed launches are never killed. Cleanup failure is logged without replacing the original launch error.
- The same bounded termination helper is used by existing normal teardown; SIGTERM escalates to SIGKILL after the existing 1.2-second grace. Cleanup succeeds only for an already exited/no-PID child or an observed child exit. After SIGKILL it waits up to one further second for exit; refused signals or a child still alive after that budget reject cleanup. Startup logs that cleanup failure while preserving its original launch error. Temporary exit observer/timer are removed on success and failure.

## Verification

Executed from `apps/desktop`:

- `node --test electron/managed-backend.test.cjs`: **13 passed**, no skips. Covers denied launch before readiness, real nonexistent executable yielding ENOENT, failure during hung health request, health timeout with child cleanup, early signal exit, healthy launch, force-kill escalation followed by observed exit/observer removal, thrown and false-return cleanup failures, refused force kill, accepted signals without eventual exit, preserving the startup error when cleanup fails, and real owned Node child shutdown that resolves only after exit.
- `node --check electron/main.cjs` and `node --check electron/managed-backend.cjs`: passed.
- `git diff --check -- apps/desktop/electron/main.cjs apps/desktop/electron/managed-backend.cjs apps/desktop/electron/managed-backend.test.cjs docs/testing/ade-managed-backend-handoff-2026-10-04.md`: passed; Git reports LF/CRLF normalization notices. The latest whole-tree check independently flags a trailing blank line in another agent's `docs/operations/docker.md:62`; it was not edited by this slice.

The denied-launch regression injects the native error event; it does not reproduce or bypass Smart App Control. The real missing-executable regression creates no executable or process. The real shutdown regression spawns only an owned Node process running an empty interval and terminates it, with fallback test cleanup. No global provider config or production data is accessed by these tests.

## Remaining boundaries

Native main-process changes need a fresh Electron launch to verify the real startup dialog and integrated smoke. The working audit app was deliberately not restarted. The earlier observed successful smoke predates this fix and cannot validate it.

The existing `before-quit` listener invokes `void stopManagedBackend()` without preventing quit or awaiting completion. That permits Electron to continue quitting while cleanup is pending; code inspection alone does not establish it caused the observed old app/backend persistence after CloseMainWindow. No broader quit redesign was made in this slice. A separate quit regression should demonstrate process exit and owned-child termination before changing that flow.

This boundary improves reporting and cleanup; it cannot make unsigned executables trusted by Windows. The CodeIntegrity policy blocks established in the preceding investigation remain a signing/environment concern.
