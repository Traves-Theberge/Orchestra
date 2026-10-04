# Project registration error handling

Project registration failures previously resolved successfully from the action hook, causing the Add Project dialog to close even when the backend rejected access. The hook now rejects failed registration, and the existing dialog keeps the entered path and shows an actionable error. Native folder-picker failures also appear in the dialog with manual path entry as a fallback. This change does not redesign project or worktree creation.

## Reference inspection

Both pinned revisions from the required source registry were considered before implementation:

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: [useNewProject.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/hooks/useNewProject.ts) distinguishes command failure from successful creation, reports errors visibly, and returns false on failed creation. [ProjectService.test.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/project/ProjectService.test.ts) checks rejected commands and injected database failure with transaction rollback. Those backend guarantees are outside this renderer-only change.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [useAddRepoLocalFolderFlow.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/sidebar/useAddRepoLocalFolderFlow.ts) tracks completed, cancelled, paused and skipped outcomes, waits for registration before handing off to a workspace, and clears busy state in finally. [Its tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/sidebar/useAddRepoLocalFolderFlow.test.ts) verify local-folder handoff and ignoring stale scan results; the inspected tests do not establish picker exception handling.

Orchestra adopts the separation of failure from successful registration and guaranteed busy-state cleanup. Deliberate differences: existing local-folder-only dialog, inline errors rather than a new toast flow, and promise rejection rather than a new command receipt protocol. No reference application was executed; this is source inspection, not reference or Orchestra E2E certification.

## Changes and verification

- `apps/desktop/src/hooks/use-project-actions.ts`: missing backend configuration and invalid empty paths reject; registration errors retain the existing global error report and rethrow to the caller.
- `apps/desktop/src/features/projects/CreateProjectDialog.tsx`: failed registration retains the entered path and open dialog; picker failure/unavailability reports a manual-entry fallback; controls remain disabled while an operation is pending.
- Focused tests in the adjacent `CreateProjectDialog.test.tsx` and `use-project-actions.test.ts` prove rejected API registration is not mistaken for success, missing backend configuration rejects, the dialog preserves a failed path and permits a successful retry, and picker exceptions/unavailability remain visible.

Verification on 2026-10-04: two focused Vitest files passed, five tests total; `npm run typecheck` passed; scoped ESLint passed. Tests use mocked registration/picker failures, not a hosted provider or the Windows native picker. Real repository access and managed-backend allowed-root forwarding require the separate launcher/backend verification. Broader project source choices and worktree lifecycle remain outside this change.
