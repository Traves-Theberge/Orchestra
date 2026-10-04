# Desktop baseline lint handoff

Package: [00 baseline](../superpowers/plans/ade-2026-10-03/00-baseline.md). Scope: renderer lint errors and the behavior those errors exposed. This work does not certify provider execution, PR publication, browser automation, or an ADE lifecycle.

## Reference receipt

Sources were inspected before implementation at the registry revisions:

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: [ProviderAdapter](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) distinguishes typed provider/session/run identities and errors. [ChatComposer](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/chat/ChatComposer.tsx) keeps composer context and draft behavior in dedicated state helpers. The associated [ChatView logic tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/ChatView.logic.test.ts) assert state/context transitions and distinguish locally pending submission from server ownership.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [project model override](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts) scopes configuration to filesystem/workspace identity and distinguishes configuration presence from a known effective model. Its [tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.test.ts) exercise disposable file paths. [Dispatch observation tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.test.ts) fence observations and distinguish pending/unknown/accepted.

Adaptation: local form state is reset at explicit file/project/section identity boundaries. Async diff results are fenced by effect lifetime so a stale response cannot overwrite the selected file. Errors in structured tool output are contained by a real React error boundary. Configuration panel tests use in-memory props and mock save callbacks, never actual provider files.

Deliberate deviations: Orchestra retains its existing React/Zustand renderer and Kanban navigation. It does not adopt either reference's provider/session persistence in this lint patch. No equivalent rule-by-rule renderer lint cleanup was identified in the inspected sources; React lifecycle and ESLint fixes are independent implementation. No reference source was copied. Runtime reference inspection was unavailable; observations are from pinned code/tests only.

## Changes

- Removed directives naming plugins absent from the actual ESLint configuration; no configured rule was disabled.
- Replaced config content synchronization effects with keyed editor boundaries; opening a PR dialog creates a fresh form.
- Replaced sidebar and browser URL prop-copy effects with conditional state resets before rendering children; existing back navigation remains local.
- Corrected browser callback dependencies and moved the Studio event-source factory ref update into an effect.
- Removed redundant Operations Queue memoization and corrected a `const` declaration.
- Deferred the initial client timestamp to a cancellable timer, preserving the initial zero value.
- Debounced terminal buffer search by 50 ms, with cleanup and empty-query status clearing.
- Preserved ANSI CSI/OSC stripping using dynamically constructed control delimiters instead of a control-character regex literal.
- Replaced ineffective JSX try/catch with a React error boundary that recovers on new output.
- Prevented an old Git diff response from overriding a newly selected file.

## Independent verification

- `npm run lint`: passed, **0 errors / 130 warnings**, down from 25 errors / 134 warnings. Warnings remain visible and are outside this cleanup's scope.
- `npm run typecheck`: passed after all renderer changes and regressions.
- Final full suite: **68 files passed, 481 tests passed, two existing skips**.
- New targeted regressions: config identity reset, malformed output containment/recovery, ANSI escapes (three files / 11 tests passed); delayed diff response after selection change (GitTab file / 13 tests passed).

`git diff --check` also passed. Parent integration validation owns packaged build/native launch. Passing renderer tests establish these local behaviors only; no real-provider lifecycle or hosted PR action was exercised here.
