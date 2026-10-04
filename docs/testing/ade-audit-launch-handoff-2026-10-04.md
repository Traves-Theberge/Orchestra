# Repeatable native audit launcher

From `apps/desktop`, run:

```powershell
npm run audit:dev
```

This starts owned Vite on 5174, waits for its own readiness announcement and HTTP response, then opens the real Electron application with an isolated persistent profile and managed backend on 4014. A native backend binary must already exist in a supported repository build/staging location. Missing binaries and occupied ports fail visibly; the launcher does not attach to another server. The selected absolute binary path is printed. `ORCHESTRA_BACKEND_BIN` can pin a specific absolute binary instead of selecting the newest existing build.

The default profile is `%LOCALAPPDATA%/Orchestra/audit-dev` on Windows. It is retained when the app closes; relaunches preserve its database and desktop state. It has separate `desktop`, `home`, `roaming`, `local` and `tmp` directories. HOME/USERPROFILE, APPDATA/LOCALAPPDATA and temporary/XDG paths are isolated before either child starts. Known credential/config-path environment overrides are removed rather than copying account settings or credentials. No automatic login or native provider dispatch occurs.

To reopen the previously created three-task manual audit profile, close the previous audit application first and use:

```powershell
$env:ORCHESTRA_AUDIT_ROOT = Join-Path $env:LOCALAPPDATA 'Orchestra/audit-2026-10-04'
npm run audit:dev -- --port 5174 --backend-port 4014
```

Unset `ORCHESTRA_AUDIT_ROOT` to return to the default profile. Custom roots must be absolute dedicated directories, excluding the account home or filesystem root. `--port` accepts 5173 or 5174 because these are the development origins allowed by the backend. `--backend-port` selects an explicit free port; normal managed-main fallback to another port is rejected by audit readiness validation.

For a hidden startup check that exits after renderer/bridge/authenticated-state assertions:

```powershell
npm run audit:dev -- --smoke
```

Window close waits for the owned managed backend to settle. Launcher shutdown targets only process trees it spawned, then stops owned Vite. Audit profile/data are never deleted. Windows cleanup uses `taskkill /PID <owned PID> /T /F`; Unix cleanup targets each detached child group. The bootstrap observes backend spawn only to await shutdown; production main and its managed helper are unchanged. It defers its settlement observation until the production quit listener has initiated stopping, avoiding concurrent SIGTERM calls.

## Windows folder picker correction

The user's live audit exposed a missing `audit-dev/home/Desktop` target when Windows opened the native project folder picker. Both launcher and direct Electron bootstrap now provision empty Desktop, Documents, Downloads, Music, Pictures and Videos directories beneath the isolated home. The same directories were created in the running audit profile; no restart or account configuration change was needed. Dismiss the existing error and reopen the picker. A project elsewhere on disk can be selected by entering its absolute path.

Before this correction, re-inspected T3 Code's pinned [DesktopBackendManager implementation](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/desktop/src/backend/DesktopBackendManager.ts) and associated test setup: per-instance runtime ownership includes explicit environment/bootstrap context. Re-inspected Orca's pinned model-override implementation/tests linked below: workspace and account-home configuration are distinct. Neither inspected implementation/test provides Windows known-folder provisioning. Orchestra's independent adaptation preserves its isolated home while supplying the directory targets used by shell dialogs; it does not copy account folders or point the audit home at the account profile. No reference runtime was launched or source copied.

Verification: both changed scripts passed `node --check`; all six directories exist in the live isolated profile. The reported missing Desktop target is repaired. Native dialog retry and actual project selection remain user-audit checks; startup smoke alone did not cover the folder picker. This small filesystem correction did not rerun the broader backend/renderer suites.

## Required reference receipt

### Real project access and project/worktree model follow-up

The audit launch now captures the real user home separately as `ORCHESTRA_AUDIT_BROWSE_ROOT`, used only as the default native open-dialog destination. The backend receives explicit `ORCHESTRA_PROJECT_ROOTS` through the managed-main environment allowlist. The audit launcher preserves caller-supplied roots; otherwise it allows the real user home and its isolated home, matching normal home-scoped local project access. Provider HOME/USERPROFILE and account settings remain isolated. Existing project registrations from another profile are not imported automatically; select their real repository folder to register them in this audit profile. Repositories outside configured roots still require explicit root configuration. The underlying lexical path guard still needs canonical/symlink authorization work.

An authenticated native-backend probe registered a fresh local Git fixture under `%LOCALAPPDATA%/Orchestra/diagnostics/project-access-probes/6b9b3bb0983e4391a9b652349270cee2`, outside audit HOME. Tree, marker-file and Git-status reads returned 200; an outside-root registration returned 403. Relaunch retained the project identity and readable marker file. The verified temporary database row was removed. Automatic approval review rejected the combined recursive fixture-cleanup command as blocked by policy; the diagnostic Git fixture is retained. No account credentials were printed or global provider/Git configuration modified. Live launcher session remains on 4014/5174, with real-user browse root and isolated provider home. Syntax/diff checks passed. Actual native picker navigation remains a user-audit check.

Redacted probe results, source hashes and readiness output are archived in [project-access evidence](evidence/ade-project-access-2026-10-04/probe.json) and [native readiness](evidence/ade-project-access-2026-10-04/native-readiness.txt). A preliminary verification command mistakenly read `GET /projects/{id}` statistics as project metadata and emitted a nonterminating PowerShell exception; it was not counted as identity proof. The corrected terminating-error check used the project catalog, verified matching ID/canonical root, read the marker after restart and removed only that temporary row.

The user's repository-issue/worktree clarification is carried into [07.0's executable slices](../superpowers/plans/ade-2026-10-03/07-task-workspace.md). Current source inspection found path-only registration and automatic worktree creation from HEAD; the full source chooser and explicit worktree composer are planned, not implemented. [Registration error propagation](ade-project-registration-errors-2026-10-04.md) separately proves five focused tests and typecheck/lint.

Pinned T3 Code `737993303d36e10674c54b95e5bd3826682c99c7` inspected sources/tests:

- [Shared project-source operations](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/packages/client-runtime/src/operations/projects.ts): connection-gated creation, provider readiness, source choice → repository → confirmation, destination resolution and URL normalization. The mobile source route/logic tests were also inspected; this does not establish identical web screenshot layout.
- [ProjectService](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/project/ProjectService.ts) and tests: normalized workspace identity, project/workspace locks and command receipts, rejected identity/ownership conflicts, atomic event/row failure rollback.
- [ManagedProjectFolders](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/project/ManagedProjectFolders.ts) and tests, plus `useNewProject.ts`: named repository folders under managed data, owned cleanup, explicit destination reporting and partial initial-commit warning. Adopt truthful partial outcomes; do not automatically edit global Git identity.
- [WorktreeBaseBranchPicker](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/WorktreeBaseBranchPicker.tsx): select a future base without changing the main checkout, scoped by environment and cwd. `useHandleNewThread.ts` retains explicit branch/worktree/environment choices.
- [WorktreeSetupTracker](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/project/WorktreeSetupTracker.ts) and tests: per-thread progress/cancellation stages are memory-only; durable workspace path/activity is separate. `GitManager.ts`/tests and GitWorkflowService sources distinguish local checkout from PR worktree preparation and reject a branch already checked out at the main root.

Pinned Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae` inspected sources/tests:

- [AddRepoStartSteps](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/sidebar/AddRepoStartSteps.tsx), browse authority and local-folder flow/tests: source choice, local/SSH/runtime path ownership, actual native folder selection, stale-result fences and nested repository review. Its pinned start menu differs from the supplied screenshot's exact provider list.
- [Local registration](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/ipc/repos/local-repo-registration.ts) and `repos-local-add-and-project-setup.test.ts`: Git-root canonicalization, Windows-normalized dedup and linked-worktree-to-repository dedup; plain-folder mode remains distinct.
- [Clone lifecycle](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/ipc/repos/repo-clone-lifecycle.ts) and creation handlers: owned destination/operation locks, progress/cancel, cleanup before retry and registration only after clone success. New repository creation establishes an initial commit for worktrees.
- [NewWorkspaceComposerCard](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/NewWorkspaceComposerCard.tsx) and project/name/agent/advanced sections: project identity separate from host checkout, base/source separate from branch reuse, available agent catalog, setup provenance/decision and parent lineage.
- [Worktree creation handler](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/ipc/worktrees/create/register-worktree-create-handlers.ts), renderer create slice and `worktrees-local-create-flow.test.ts`: execution-host routing, explicit linked-source metadata, bounded conflict-only naming retries, setup/agent partial outcomes and ask-policy rejection before Git mutation.

Orchestra adopts project/environment/worktree/session separation, explicit capability/failure states and ownership-aware operations while preserving repository-issue Kanban tasks. Its Go/SQLite/API contracts will be independently implemented; no reference code was copied or reference suite/runtime executed for these flows. Opening installed Orca via CLI only confirmed runtime availability; it did not exercise project/worktree creation. The immediate access/registration fixes are independently verified as described above; remaining source-choice/worktree scenarios are acceptance gates in 07.0.

T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`, previously inspected [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts), separates runtime instance/session identity and working-directory policy. Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, previously inspected [agent-project-model-override.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts) and its tests, explicitly distinguishes workspace versus account home/config boundaries. These patterns support owned runtime identity and isolated filesystem context; neither inspected source specifies an equivalent Electron/Vite audit launcher. Orchestra's launcher is independent script code using its existing production startup boundary, with no reference source copying. Neither reference app was run. This receipt establishes source consideration, not provider or ADE E2E certification.

## Verification on Windows

- Both script syntax checks and `npm run audit:dev -- --help` passed.
- Hidden real Electron startup passed with isolated `audit-dev` profile, Vite 5173/backend4014, then again with default Vite5174/backend4014. Renderer mounted, real preload bridge returned config, and authenticated production backend `/api/v1/state` returned valid counts. Second launch reused the same retained profile successfully.
- The first shutdown exposed a concurrent SIGTERM warning from the production listener; the bootstrap was corrected to observe that listener's settlement. The subsequent default-port smoke exited zero without that warning. Log retained locally at `apps/desktop/audit-dev-smoke.log` (ignored generated output).
- Explicit temporary listeners occupying Vite5174 and backend4014 each caused launcher exit 1 with a clear collision message. The listeners remained listening; unrelated processes were not terminated.
- A nonexistent absolute backend override caused exit 1 before Vite/Electron startup.
- After smoke termination, bind checks confirmed owned ports 5173, 5174 and 4014 were released.

No account provider configuration was copied or written. The existing `audit-2026-10-04` profile was inspected for layout only and not launched or edited. These checks prove isolated native startup and controlled smoke/window-close cleanup, not authenticated provider execution, task orchestration, PR lifecycle, global Windows process-tree cancellation reliability, or Linux/macOS behavior. Existing audit profiles intentionally retain any data/config a user later writes into them.
