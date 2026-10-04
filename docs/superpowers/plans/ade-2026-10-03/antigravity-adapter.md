# Antigravity integration steps

User requirement: Antigravity is the current provider target, replacing their direct Gemini/Claude/Codex workflow. Keep the underlying orchestration model independent of the provider. This preparation does not bypass packages 01–04 or certify an adapter.

Read the [ACP research and execution sequence](../../../architecture/antigravity-acp-research-2026-10-03.md) and [SDK/CLI/cloud alternatives](../../../architecture/antigravity-research-2026-10-03.md). Google's official ACP runtime is the preferred richer native-chat candidate because pinned T3 uses negotiated sessions/models/approvals rather than CLI text streaming. Authentication and interoperability still need direct proof. CLI control replies/rich input remain unsupported; the public Python SDK requires a separately demonstrated authentication/deployment boundary.

## Current executable progress

- [x] Unwired CLI NDJSON decoder fixture: typed init/step/result, identity fences, cumulative usage and incomplete/error classification.
- [x] Unwired ACP v1 I/O fixture: initialization/capability negotiation, exact new/load/resume, text updates, offered approval/question replies, correlated RPC responses, cancel request versus observed settlement, connection loss and no automatic replay. See [code/tests/source handoff](../../../testing/antigravity-protocol-handoff-2026-10-03.md).
- [ ] Pinned runtime acquisition and unauthenticated startup/capability trace.
- [ ] Official account setup and observed entitlement/model catalog.
- [ ] Persisted task/workspace/account/session/configuration bindings and requested-versus-observed model/policy.
- [ ] Production adapter registration, native chat UI and durable decisions/events.
- [ ] Real-provider resume/cancel/concurrency, task lifecycle, PR review/revision and recovery acceptance.

Fixture completion covers simulated transport behavior only. It does not complete integration step 1 or certify provider reliability.

## Observed prerequisites

On 2026-10-03, local read-only `agy --version` and `agy --help` succeeded: version `1.2.16`, executable `%LOCALAPPDATA%/agy/bin/agy.exe`. No model request, account migration or settings write was initiated.

Google's [transition announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/) ended consumer Gemini CLI request serving on June 18, 2026; enterprise/API-key exceptions remain. Consumer acceptance should target Antigravity.

The official [headless interface](https://www.antigravity.google/docs/cli/headless/) documents streamed input/output, conversation IDs, per-turn results and explicit conversation resume. Local help confirms those switches plus model, effort, plan/accept-edits modes and sandboxing. The [authentication guide](https://www.antigravity.google/docs/cli/install/) identifies `~/.gemini/antigravity-cli/settings.json`; legacy `~/.gemini/settings.json` is a distinct file. Authentication and effective permissions still need independent runtime verification.

## Mandatory reference gate

Before implementation, inspect T3 T1/T4 and Orca O2/O3/O1 from [the pinned registry](reference-patterns.md), including associated implementations/tests. Follow typed provider/session identities, requested-versus-observed configuration, journaled dispatch uncertainty and durable mutation receipts. Record any gaps and deliberate differences. These baseline observations do not constitute the native-chat package's complete reference receipt.

## Executable sequence

1. **Prove the selected transport in isolation.** Fixture boundaries now pass; next follow the ACP acquisition/discovery/login/turn sequence in the research. Capture exact session resume, offered permission/question choices and cancellation settlement in a disposable profile/workspace. For CLI evaluation, retain explicit conversation identity and per-turn/cumulative counters. Save redacted traces, exit status and timing; exercise missing authentication, invalid model, malformed input and missing executable. Acceptance: actual capabilities and outcomes follow observed protocol, not binary presence or exit code alone.
2. **Add a distinct adapter.** Register `antigravity` throughout backend provider discovery, typed desktop API and selection UI after transport acceptance. Preserve historical Gemini records; do not rename stored provider identity into a different protocol. Normalize selected-transport sessions, updates, decisions and terminal outcomes into the shared contract. Retain provider identity and expose unsupported capabilities. Add recording-process tests for decoding, duplicate/stale replies, incomplete streams and cancellation. Acceptance: unsupported capability or incomplete response is visible and cannot mark a task delivered.
3. **Apply task/workspace configuration.** Carry explicit model and only supported effort/mode/policy settings through negotiated transport configuration. Validate combinations before dispatch and report observed configuration separately. Materialize only approved workspace resources after checking current official discovery rules; never modify global settings for a task. Exercise two tasks with different configurations, restart/reload and an existing worktree. Acceptance: independent scopes and persisted provenance; unknown defaults remain unknown. Do not auto-enable permission-bypass modes.
4. **Connect native chat and task execution.** Use the same adapter/session contract for task chat and execution. Persist conversation association, ordered messages and uncertain submissions. Prove cancel/restart/resume and provider failures without duplicate work. Keep orchestration tool calls behind the shared backend command boundary. Acceptance: one scoped conversation per selected task/session and trustworthy visible state through recovery.
5. **Earn provider acceptance.** Run the package 01 fixture scenarios and package 04 lifecycle/revision gates using this adapter, then PR linkage tests in 05. Record real-provider results separately from simulated ones. Model catalog presence alone does not prove a selected model ran. Retain the roadmap's repeated-pass thresholds before reliability claims.

Each integration step must produce changed files, command results, traces and a reference receipt. Unwired decoder/I/O fixtures and read-only CLI discovery are verified; authenticated startup, configuration/model application, production adapter/native UI and lifecycle acceptance remain open.
