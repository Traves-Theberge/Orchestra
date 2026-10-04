# Agent configuration end to end

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 02. Outcome: selected agent configuration persists from settings/draft into a task, resolves predictably in its workspace, and is demonstrably used by the launched provider.

Current user environment: Antigravity replaces their direct Gemini/Codex/Claude workflow. Orchestra currently has no Antigravity adapter. Before real-provider acceptance, identify the installed Antigravity product/version, supported automation or session protocol, account/model capabilities and native configuration discovery. Do not infer integration from legacy provider directories or map Antigravity to Gemini by name. Keep any new adapter behind explicit capability validation until its launch, chat, cancellation and configuration boundaries have evidence.

## Files and boundaries

Existing: backend provider config/domain endpoints and project-scope tests; `internal/studio/manager.go`, `internal/studio/types.go`, `internal/db/studio.go`, SQLite tracker client, WorkItem, `internal/agents/types.go`, runner adapters, workspace preparation and `internal/app/run.go`; desktop Agents hooks/panels, Studio draft fields, CreateTaskDialog, task inspector and API types.

Proposed: typed execution-config contract, resolver/capability validator, effective-config DAO, workspace config manifest/materializer and a task Effective configuration panel. Keep credentials outside task snapshots.

October 4 progress: [requested persistence](../../../testing/ade-requested-config-handoff-2026-10-04.md), [dispatch selection guard](../../../testing/ade-dispatch-provider-handoff-2026-10-04.md), and [Studio session isolation](../../../testing/ade-studio-session-handoff-2026-10-04.md). SQLite restart and API list/detail preserve requested model/turns. Runtime-target create now persists or returns a visible partial-creation error. Effective configuration, capability/model negotiation, durable Push recovery and workspace materialization remain open.

## 03.1 Define requested and effective configuration

The [settings/UI reference audit](../../../testing/ade-settings-ux-reference-2026-10-04.md) compares pinned T3 scoped defaults and Orca runtime/capability settings with current Orchestra. These are additional executable prerequisites for the settings surface, not completed runtime guarantees:

- [ ] Label embedded API-key assistant preferences, native provider account/project files and orchestration launch defaults as distinct owners/scopes. Show project/environment context before editing.
- [ ] Replace read-error-to-empty-default fallbacks with unavailable/stale/error states. Disable save of unknown native configuration until a successful read or explicit create flow; preserve existing user data on retry.
- [ ] Show per-field inherited source and reset, requested admission values, adapter-supported values and separately observed effective state. Do not label executable discovery or a configured model as verified execution.
- [ ] Drive model/provider/runtime controls from backend capabilities; distinguish Antigravity integration from legacy Gemini configuration and show why unsupported requested model/budget choices cannot launch.
- [ ] Unify settings navigation/search and accessible section names while retaining app-wide appearance preferences separately from execution policy. Expose path/storage ownership where it changes the effect of Save.
- [ ] Verify failed reads (401/403/timeout/500), scoped reset, project/worktree switching and active-run configuration immutability before appearance polish. Native account writes and provider canaries require their own authorized boundary tests.

- [ ] Specify typed provider/account reference, model, effort where supported, limits, approval/sandbox policy, tool restrictions, instructions/skills/hooks/MCP references and runtime target.
- [ ] Define per-field precedence and provenance, including explicit unset/inherit versus an empty value. Treat native provider defaults separately when not discoverable.
- [ ] Define supported capabilities per adapter; reject incompatible model/policy/options before dispatch with a user-visible reason.
- [ ] Specify configuration freeze at admission, versioning for revisions, and behavior when defaults change while queued or running.

## 03.2 Repair draft and task persistence

- [x] Transfer Studio model/turn fields into typed requested task configuration during Push. Existing `agent_guidance` remains readable; this does not certify effective launch settings.
- [ ] Extend SQLite task SELECT/scan paths to return configuration, guidance and criteria. Verify list/detail/dispatch objects all carry equivalent values.
- [ ] Make draft push idempotent and recover partial create/update failure without duplicating the task. Persist the authoring-to-task association before discarding the draft.
- [ ] Add save/reload/restart tests for each field and hosted-tracker mapping. Hosted issues need local execution metadata when their native schema cannot carry it.

## 03.3 Resolve and persist launch configuration

Partial safety progress: [requested transport](../../../testing/ade-requested-config-transport-handoff-2026-10-04.md) and [option guards](../../../testing/ade-requested-options-guard-handoff-2026-10-04.md) preserve admitted intent/restrictions and prevent silently ignored options. Running-state restart has tests; waiting retry persistence, a versioned effective snapshot and verified adapter enforcement remain open. Unsupported model/turn requests currently stop dispatch and require clearing or a future supporting adapter.

- [ ] Resolve settings only on the backend owning the workspace. Capture effective values, sources, version/hash and adapter support before admitting a run.
- [ ] Extend TurnRequest or an associated typed launch configuration to carry model/effort/policies/limits. Remove unconditional approval widening and conflicting hardcoded limits from dispatch.
- [ ] Teach each adapter to apply supported values through native protocol/CLI/config. Do not equate filtering Orchestra tool specs with denying all native tools.
- [ ] Record observed provider model/config metadata where available and show unknown where it cannot be confirmed. Test exact request values with the recording adapter.

## 03.4 Materialize workspace configuration

- [ ] Inventory native discovery rules for each provider using its current official docs during implementation. Build a provider-specific materialization manifest instead of copying whole config directories.
- [ ] Define behavior for tracked, ignored and uncommitted project configuration. Preserve worktree ownership and user files; detect collisions before writes.
- [ ] Materialize approved instruction/config references or pass explicit native options. Record source version/hash and destination; do not copy account secrets or mutate global config to configure one task.
- [ ] Test new and reused worktrees, existing native config, missing referenced files, rejected writes and cleanup. Config preparation failure prevents launch.

## 03.5 Expose configuration at the task boundary

- [ ] Show requested/effective configuration and where each value came from in task details. Add a workspace badge identifying the active run/config version.
- [ ] Make task overrides editable only under the defined policy; changing defaults must not silently mutate an active run.
- [ ] Make retry/revision actions explicitly retain configuration or resolve a new version. Provider handoffs must validate transferable options.
- [ ] Display save/validation/materialization errors; verify reload returns the persisted value rather than optimistic local state.

## 03.6 Prove the whole chain

- [ ] Exercise Agents save, Studio authoring, task reload, worktree creation, launch and backend restart in the integrated fixture.
- [ ] Run two tasks with conflicting models/tool policies and assert isolation. Change project defaults mid-run and verify documented behavior.
- [ ] Exercise an actual permitted and denied tool request with each supported real provider. Record native version, effective model and policy evidence; UI text alone does not prove application.
- [ ] Cover ignored/uncommitted config, retries/revisions, unavailable accounts, invalid model and remote config as separate scenarios; remote claims remain blocked until package 10.

## Validation and exit

Run provider-scope, Studio, SQLite round-trip, resolver and runner tests, desktop config/task tests and package 01 configuration scenarios. Check API/schema compatibility.

- [ ] No field silently disappears between draft, saved task, dispatch and workspace.
- [ ] Recording-provider assertions match the effective config and real-provider canaries confirm the supported native behavior.
- [ ] Retry/restart preserves configuration identity; concurrent tasks stay isolated.
- [ ] Unsupported configuration is explicit and cannot silently widen permissions.

Handoff: precedence table, per-provider capability matrix, materialization rules and evidence. Native semantics require versioned evidence; a single provider pass does not certify all providers.

## Confirmed implementation gaps

The [configuration boundary review](../../../testing/ade-config-boundary-handoff-2026-10-03.md) traces the actual Studio ? SQLite ? admission ? TurnRequest paths. It confirms dropped model/turn settings, omitted task metadata, unconditional approval widening, unsupported clear semantics and partial-Push duplicate risk. Use its six ordered slices and acceptance matrix when implementing this package; these findings are not repaired by renderer lint fixes or protocol fixtures.

## Implemented preparation slices

Atomic [Studio draft saves](../../../testing/ade-studio-patch-handoff-2026-10-03.md), existing [SQLite task metadata reads](../../../testing/ade-task-metadata-handoff-2026-10-03.md), [Orchestra tool denial](../../../testing/ade-tool-policy-handoff-2026-10-03.md) and [Studio unknown-runner rejection](../../../testing/ade-studio-provider-handoff-2026-10-03.md) are implemented. These repairs do not complete package 03: model/turn transfer, durable effective configuration, admission freeze, runtime-target creation, provider-native policy and workspace materialization remain open.
