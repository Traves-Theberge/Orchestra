# Native settings ownership and failed-read handoff

## References and adaptation

Both pinned references were inspected before edits. T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: `apps/web/src/components/settings/ProjectDefaultsSettings.tsx` owns environment/project/checkout targets, identifies inherited sources, checks model choices against provider availability and disables disconnected controls. `ConnectionsSettings.logic.ts` and its tests keep failed state visible with retry. Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: `src/renderer/src/components/settings/AgentsPane.tsx` separates runtime placement, agent detection/defaults and permissions; `AgentLaunchDefaultsEditor.tsx` commits validated drafts and explicitly resets overrides. Its model override detection/tests distinguish configuration presence from effective model observation. Source locations and revision links are recorded in [the original audit](ade-settings-ux-reference-2026-10-04.md).

Orchestra adopts explicit read failure and scope ownership first. Native file configuration remains separate from conversation requests and observed provider settings. We do not copy account authentication or introduce an unsupported WSL/remote placement selector. Neither reference runtime was exercised for this settings slice.

## Implemented

- Provider configuration read failures no longer become editable successful empty defaults. Claude and common Codex/Gemini/OpenCode reads retain prior data, publish a separate read failure and require a successful retry before the Agents dashboard shows editors. Dismissing a mutation error cannot clear the read failure.
- Reads are fenced by backend URL/credentials and global/project identity, with concurrent reload sequence protection. A new target remains loading until its own read settles; late previous-target reads cannot populate it.
- Claude permissions, model and hooks now read and write the selected project/global scope consistently. These are requested file configuration values, not provider-effective model observations.
- Project MCP mutations are blocked because the current write API targets account files. The dashboard explains the limitation. Global MCP editing remains available. Adding a project server cannot silently alter a global provider file through these hooks.
- Independent native Codex launch settings use `codex app-server`; batch task flags are not inherited. `ORCHESTRA_NATIVE_COMMAND_CODEX` is forwarded to the managed backend. Explicit empty disables native launch.

## Verification and limits

Nine focused configuration hook/dashboard tests pass: separately injected 401/403/timeout/500 failures, retry, retained previous Claude data, correct project read/write targeting, blocked project MCP mutation, delayed old-project response, and editor withholding/retry action. Scoped hook lint passes; existing dashboard lint warnings remain. The wider desktop suite passed 526 tests with two skips before subsequent model-catalog integration; final validation is recorded in the integration handoff.

All failure tests use mocked endpoints and touch no provider account files. Native signed-in HTTP canary separately checked settings file hashes before/after; those checked files stayed unchanged.

Remaining: per-resource availability instead of withholding an entire pane; scoped mutation completion fences; dirty edits retained across failed refresh/unmount; strict backend snapshot/version checks before native file writes; reset-to-inherited and worktree/task/admitted-run provenance; legacy model/effort lists and Gemini configuration labeling. Global account configuration editing should not be described as an Orchestra-only preference.
