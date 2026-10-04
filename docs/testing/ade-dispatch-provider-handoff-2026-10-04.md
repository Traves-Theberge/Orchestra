# Dispatch provider selection guard

Scope: package 03 configuration and C2 dispatch. This slice fixes silent default-provider execution when a task explicitly asks for an unconfigured provider. It does not certify provider installation, authentication, native chat, model selection, or an ADE end-to-end run.

## Required reference inspection before implementation

T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`:

- [ProviderSelectionTransition.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderSelectionTransition.ts) and [its tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderSelectionTransition.test.ts): unsupported ACP model switching produces an explicit rejection; negotiated support permits the transition. Inspected implementation and all three test cases.
- [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts): session/turn input carries complete model selection and runtime policy; selection transition planning is an adapter operation with typed failure boundaries.

Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`:

- [agent-project-model-override.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts) and [its tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.test.ts): a detected workspace configuration layer invalidates an assumed account default; presence does not identify the effective model. Inspected repository-boundary, linked-worktree, account-home and Claude uncertainty cases.

Adaptation: an explicit task provider or agent assignee is authoritative. Reject a missing registry entry before workspace/hook/process effects rather than presenting execution on the global default as satisfying that selection. Preserve the Kanban claim and existing bounded failure/retry mechanism.

Deliberate differences: Orchestra uses its existing Go runner registry, not T3's negotiated session capability contract. Registered custom command runners remain supported. Orca's inspected filesystem detector does not supply a provider dispatch fallback mechanism; its ambiguity principle applies, while the local selection guard is independently implemented. Only the existing `claude-code` Studio/template alias is added; unknown aliases are not invented. Neither reference application was launched, and reference tests were inspected rather than executed.

## Implementation

- `apps/backend/internal/app/provider_selection.go`: trim/case normalization, `claude-code` to `CLAUDE`, task-over-assignee precedence, agent-prefixed assignee selection, configured default for human assignees, fail on empty/unconfigured selected provider.
- `apps/backend/internal/app/run.go`: canonicalize the startup provider lookup; reject dispatch before project lookup/worktree preparation, with explicit `provider_not_configured` failure and the existing retry receipt policy.
- `apps/backend/internal/app/provider_selection_test.go`: ten selection cases, missing-default rejection, and two production tick regressions using a recording runner plus an untouched temporary workspace.

No Antigravity runner is registered. No provider account settings, default selection, approval behavior, model behavior, or attempt contract is changed. Existing automatic retry-provider cascading is outside this slice; unconfigured names cannot match a registry provider for that cascade.

## Behavioral verification

Windows, Go 1.26.7:

- `go test ./internal/app -run 'TestResolveDispatchProvider|TestProcessExecutionTickRejectsUnknownProviderBeforeEffects' -count=1`: passed, 3.985 seconds after final failure-event edit.
- `go test ./internal/app -count=1`: passed, 19.200 seconds after the final failure-event edit.
- `go vet ./internal/app`: passed after the final failure-event edit.
- `git diff --check` for changed app files: passed after the final failure-event edit.

The production tick regressions assert zero recording-runner invocations, no created workspace/hook files, an explicit failure event and stored selection error. They use no real model inference. Linux/race validation and a complete UI-to-real-provider task run are not claimed by this receipt.

Known remaining boundary: several later continuation/finalization event payloads still identify the global `providerName` rather than the selected provider. This guard does not repair that separate observation issue.
