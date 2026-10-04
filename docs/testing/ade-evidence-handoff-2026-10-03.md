# Scoped ADE evidence validation

This package 01 slice provides a shared report schema, semantic validator, source identity helper and independent acceptance CLI. The fixture producer is documented in [the harness handoff](ade-harness-handoff-2026-10-03.md). Neither command certifies the application lifecycle.

## Reference receipt

Re-inspected T3 Code `737993303d36e10674c54b95e5bd3826682c99c7` [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) and [RunFinalizationService.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/RunFinalizationService.ts). Typed outcomes and checkpoint/workspace/current-run checks distinguish provider results from finalized effects. Re-inspected Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae` [fenced dispatch observation tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.test.ts): missing observation is not accepted delivery, and different execution fences retain independent outcomes.

Adaptation: report status preserves failed/blocked/skipped/unsupported evidence, with simulated/real mode and boundary scope on each named scenario. Independent acceptance selects the required scenarios, environment and boundaries; a report cannot select its own acceptance requirements. Exact source-tree identity and artifact presence are checked separately. Deliberate deviation: no common evidence-report schema was established in those inspected reference sources. This format is independently designed for Orchestra's existing Go/JSON Schema tooling; no reference implementation was copied or run.

## Contract

`packages/protocol/schemas/ade/evidence.v1.schema.json` defines versioned source/environment/fixture/scenario records. `internal/testsupport/evidence.Decode` validates structure, duplicate IDs, non-pass reasons and consistency between overall/scenario outcomes. A valid failed report remains valid evidence; it cannot pass `Check`.

Acceptance requires an explicit current clock, complete environment scope, required named scenarios, desired execution modes/boundaries and matching revision plus SHA-256 source fingerprint. Missing, stale, future, wrong-platform, wrong-runtime, simulated-for-real or inconsistent evidence is rejected. Minimum artifact counts can be required. `CheckArtifacts` requires referenced files to exist inside the report directory; it does not interpret artifact contents as proof of correctness.

The shared fingerprint reads Git's sorted cached/untracked nonignored paths, includes deletion, leaf-symlink identity and regular-file executable bits, and hashes length-prefixed records using the `orchestra-source-v2` domain. HEAD is compared separately. Git commands use an allowlisted environment with ambient Git overrides and global/system configuration disabled. Parent containment is checked through resolved existing ancestors, including when a tracked directory has been deleted; an ancestor symlink cannot redirect a fingerprint read outside the source root. Leaf symlinks contribute their target path without reading external target contents. Ignored generated outputs are excluded. Consequently, any nonignored source/document change invalidates the earlier report. Keep generated evidence outside the source tree, and regenerate after changes. This does not identify ignored runtime inputs or prove a running process used a particular binary; those boundaries still need fixture/version evidence. The filesystem scan is not an atomic snapshot or an arbitrary-code sandbox; concurrent mutations between checks and reads are outside this helper's guarantee.

## Commands

From `apps/backend`:

```powershell
go run ./cmd/ade-fixture --source-root ../..
go run ./cmd/ade-evidence --checkout ../.. --report <printed-report-path> --profile ../../packages/test-fixtures/ade/acceptance.windows.example.json
```

The example profile deliberately accepts only the five simulated-provider fixture scenarios on Windows amd64 with the stated Go version. Adjust a reviewed profile for an intended environment before running it. Do not copy a report's self-description to create a release acceptance profile. Changing required mode to `real`, requesting a missing lifecycle/UI scenario, changing source, or removing an artifact must reject this fixture report.

The existing parity release script remains separate; the new ADE command is not silently substituted as a full ADE release pass. Package 01 still needs backend/desktop integration, durable database assertions, GitHub fixtures, process-tree recovery, real-provider canaries and repeated-pass evidence.

## Verification

Targeted evidence tests verify all five report outcomes, malformed/unknown/missing fields, misleading overall pass, duplicate scenarios, independent scenario/mode/boundary/environment/source/freshness acceptance, artifact containment, and dirty/untracked/deleted/ignored source fingerprint behavior. The fixture producer tests validate persisted passing and deliberately failed-check reports against the same schema.

Additional fingerprint regressions verify that ambient `GIT_DIR`, `GIT_WORK_TREE`, index/object-directory overrides and injected/global Git configuration cannot redirect selected source or hide untracked content, and that deleted tracked parents retain explicit deletion identity. Symlink ancestor/leaf behavior and executable-mode behavior have platform-specific tests: the Windows host lacked symlink privilege and does not expose POSIX chmod execution bits, so those two tests were explicitly skipped rather than certified on that host.

Final command results and any current-tree receipts are recorded in the wave integration handoff after source edits settle. No user configuration, production database, hosted PR or real provider was used.
