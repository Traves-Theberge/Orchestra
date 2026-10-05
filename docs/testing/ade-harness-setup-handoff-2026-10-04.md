# ADE harness setup panel handoff — 2026-10-04

## References inspected

- Orca is pinned at [`3284b4c70c901402831bb4ccc5576ea083d2e5ae`](https://github.com/stablyai/orca/tree/3284b4c70c901402831bb4ccc5576ea083d2e5ae). Inspected [`AgentStep.tsx`](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/onboarding/AgentStep.tsx), its [test](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/onboarding/AgentStep.test.tsx), [`use-onboarding-flow.ts`](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/onboarding/use-onboarding-flow.ts), [`onboarding-settings-hydration.ts`](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/renderer/src/components/onboarding/onboarding-settings-hydration.ts), `agent-catalog-entries-primary.ts`, `IntegrationsStep.tsx`, and `AgentSkillSetupPanel.tsx` at that revision.
- T3 Code is pinned at [`737993303d36e10674c54b95e5bd3826682c99c7`](https://github.com/pingdotgg/t3code/tree/737993303d36e10674c54b95e5bd3826682c99c7). Inspected [`AddProviderInstanceDialog.tsx`](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/settings/AddProviderInstanceDialog.tsx) at that exact commit.

Orca's agent step uses its full catalog, places detected agents first, provides a popular fallback when detection finds none, and keeps the rest in an expandable section. It permits choosing a catalog item that is not installed and gives an install-help link; it does not claim that selection installed or authenticated the agent. The chosen default is hydrated from and persisted to global settings. Its integrations step handles GitHub install/auth/recheck separately, while skill setup is an explicit user-triggered terminal action. The pinned catalog gives Antigravity its own `agy` identity, separate from Gemini's `gemini` identity.

T3's pinned add-provider dialog has an explicit provider/driver step, identity and instance step, provider config step, and a separate authentication step after creating the instance. The pattern is useful for sequencing installation/configuration/authentication with visible state. There is no Antigravity string in this pinned dialog; it does not establish Antigravity support. Its multiple instances, remote environments, and account management exceed Orchestra's present local single-backend config model and are not copied here.

## Orchestra adaptation

`HarnessSetupPanel` presents the current six app harness choices plus any additional IDs reported by the backend registry. “Registered” means `GET /api/v1/agents` returned an ID; it does not prove executable discovery, installation, or account authentication. Those states remain explicitly “not observed.” Per-project chat mode comes from the workspace-chat providers API and is shown as native session or transcript replay only when returned by the backend.

The panel allows the user to enter a verified command template for a known or registered harness and save it through the existing `POST /api/v1/config/agents` contract. It sends only the selected command key, keeps the fetched default provider unchanged, and re-fetches configuration before a write to detect a changed command or default. The existing handler merges nonempty command entries and has no version/CAS or delete operation; the preflight reduces stale writes but cannot close the race between read and write. The UI therefore does not offer command removal. Changing the default submits no command changes and requires a currently registered provider.

Codex batch commands are shown separately from the actual native-session capability returned for workspace chat. No native command editor was added because the current client/API exposes no such field. Antigravity is distinct from Gemini and links to its official CLI documentation, but the UI does not invent login steps, invocation flags, or claim its existing protocol scaffolding is runnable. Provider-native settings and command-authoring panels remain in the Agents hub.

A coordinated read-only local CLI probe (reported by the native-runtime owner) observed `agy.exe --version` as `1.2.16` and `--help` entries for `--agent`, `--mode` (`accept-edits|plan`), stream-json input/output, conversation resume, and sandbox. The panel lists those as CLI-documented controls only; the Antigravity runner/canary remains unverified, so they are not exposed as Orchestra settings.

## Behavioral verification

- `npm run typecheck` passed in `apps/desktop`.
- Focused `HarnessSetupPanel` and helper tests passed (6 tests), covering registered-native status, honest unknown authentication, save of a single command key, detection of concurrent edits, and separate unregistered Antigravity onboarding.
- After dashboard integration and its failed-read regression fix, the full desktop suite passes: 100 files, 655 tests passed, 2 existing skips. Dashboard coverage confirms a forbidden configuration read withholds the setup editor and retains the retry path.

## Remaining verification

The backend provider list and chat-mode API are observations, not executable probes. CLI presence, authentication, native runtime stability, and provider-specific install flows remain unverified by this panel. A future setup action should be added only alongside a supported, user-triggered detection/auth integration and an API write contract with an explicit concurrency fence.
