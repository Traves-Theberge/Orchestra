# Requested execution option guard

This configuration slice preserves explicit authoring intent and rejects execution settings that current adapters cannot apply. It is not a durable effective-configuration snapshot, model confirmation, provider authentication test, or complete ADE end-to-end verification. The separate requested-config transport handoff covers scheduler/retry/DAO field propagation.

## References inspected before implementation

T3 Code, revision `737993303d36e10674c54b95e5bd3826682c99c7`: [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts), [ProviderSelectionTransition.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderSelectionTransition.ts), and [transition tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderSelectionTransition.test.ts). Typed turn/session inputs carry selection and policy; unsupported ACP model transitions reject, while negotiated support permits them. Implementation was inspected in the preceding dispatch slice and the tests were inspected again for this slice.

Orca, revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [agent-project-model-override.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts) and [its tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.test.ts). Workspace configuration presence means account defaults cannot establish an effective model; linked-worktree and repository-boundary tests preserve that uncertainty. Implementation was inspected in the preceding slice and the complete tests were inspected again here.

Adaptation: validate requested settings against an explicit runner contract before workspace effects, and validate again at execution. Do not pretend provider-name discovery applies a model. Preserve the existing Kanban scheduling model.

Deliberate differences: Orchestra currently has no negotiated capability catalog or durable immutable launch contract. An optional Go runner interface validates requested models without execution effects. No real adapter opts in. Remote placement cannot inherit a local runner's model support. Explicit max-turn requests all reject, including 1, because native-versus-Orchestra budget semantics and retry counting remain unresolved. The inspected Orca detector does not itself implement this rejection contract; the adaptation follows its default-model uncertainty boundary. Neither reference runtime was launched, and reference tests were not executed.

## Implementation and observable behavior

- `agents/types.go`: `TurnRequest.RequestedModel` and `RequestedMaxTurns` retain intent. `RequestedModelValidator` is an explicit adapter opt-in; successful validation is not an observed-model claim.
- `agents/registry.go`: `ValidateTurnOptions` provides preflight validation; `RunTurn` validates its selected runner again before invoking a runner or transport wrapper. Nonempty model requests without local runner opt-in, remote model requests, all explicit max-turn budgets, nil runners and missing transports fail. `HasProvider`, `Providers` and `SetCommand` now use the registry mutex.
- `app/provider_selection.go` and `run.go`: copy requested options from the claimed entry, validate before project lookup/worktree/hooks, report `requested_config_unsupported`, and forward exactly those options to execution. Existing bounded retry behavior remains; options do not become an applied-model claim.
- `app/run.go`: restoration errors now stop startup before API/background workers; the owned warehouse connection closes when `Run` returns. Continuing after failed restoration could otherwise lose stored configuration and re-admit a task using changed authoring values.

No provider defaults, account configuration, approval flags, timeout, sandbox behavior or turn-budget behavior changes. Absent requested options retain existing behavior. Current built-in adapters continue using their own unknown/default model.

## Verification

Windows Go 1.26.7:

- Registry requested-option tests pass: unsupported/blank model, explicit 1/8/0 budgets, fixture-only supported model preserved, rejected model, replacement runner unable to inherit capability, remote capability not inherited, missing runtime, concurrent lookup/reconfiguration.
- Production tick tests pass with a real disposable Git repository/SQLite project: explicit model and 1/8 budgets cause zero recording-runner calls, unchanged Git worktree list, no hook marker, explicit failure and stored rejection.
- Actual `Run` startup test passes, 4.421 seconds: isolated HOME/USERPROFILE/application directories, persisted corruption injected by bypassing constraints only in the disposable fixture, startup returns the restoration error.
- `go vet ./internal/agents ./internal/app`: passed after final production edits.
- `go test ./internal/agents ./internal/app -count=1`: passed after final edits, agents 25.696 seconds and app 19.923 seconds. Local command output: `apps/backend/requested-options-tests.log`.

Native race testing is unavailable in this environment (`CGO_ENABLED=0`). The concurrent registry test is meaningful under a Linux container race run; this receipt does not claim that run until evidence is recorded separately. No real provider inference or full UI-to-provider task lifecycle was exercised.

Remaining boundaries: the mutable registry can change after app preflight; execution checks again but workspace effects may already exist if configuration changes in between. This slice does not freeze command bindings. Retry and successful-turn counters remain mixed. Unsupported requested options must be cleared or supported by a future verified adapter before such a task can execute. Several later lifecycle payloads still use the global provider name.
