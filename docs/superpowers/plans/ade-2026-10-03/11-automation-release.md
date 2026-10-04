# Scheduled automation and release evidence

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 09 and C2; 10 for remote schedules. Outcome: scheduled work creates durable ordinary orchestrations with the same limits and evidence, and release gates reflect exactly the capabilities verified.

## Files and boundaries

Existing: embedded-agent `hooks/use-scheduler.ts`, scheduler tools/UI, DB, orchestration CLI/MCP, attention inbox and desktop `scripts/release-readiness.mjs`.

Proposed: backend schedules/occurrences DAO and scheduler, schedule API/CLI/native chat tools, report aggregator and supported-capability manifest. The current renderer timers are not a durable scheduler.

## 11.1 Define schedules and occurrence identity

- [ ] Persist target orchestration template, project/environment, coordinator/provider config policy, time zone, cadence, concurrency and budget policy.
- [ ] Define unique occurrence keys, daylight-saving behavior, missed-run behavior and overlap policy. Default missed-run handling must be explicit rather than unlimited catch-up.
- [ ] Record queued/started/skipped/failed occurrences with reasons. A schedule definition does not prove its job ran.
- [ ] Test repeated scheduler ticks and two scheduler instances against one DB; one occurrence cannot admit duplicate orchestration runs.

## 11.2 Execute through the shared control layer

- [ ] Create ordinary scoped orchestration commands through C2 using idempotency keys. Apply package 09 admission and gates without bypasses.
- [ ] Support create/list/show/edit/pause/resume/run-now/delete through UI, CLI and MCP. Resolve project/time zone on the owning environment.
- [ ] Keep schedules running when the UI is closed under package 08 process semantics. Pausing a schedule and canceling a running occurrence are distinct commands.
- [ ] Migrate or clearly label existing in-memory reminders; do not silently claim old timers survive restart.

## 11.3 Report automation outcomes

- [ ] Link occurrence to its coordinator chat, tasks/workspaces, verification and PRs. Failures/approval needs create durable attention records.
- [ ] Retain template/config version and actual run outcome, including unknown cost and late effect reconciliation.
- [ ] Exercise downtime, clock changes, overlap, unavailable provider/environment and budget exhaustion in fixtures.
- [ ] Run an authorized real scheduled canary with the UI closed and verify one resulting orchestration and recoverable attention.

## 11.4 Gate capability claims and releases

- [ ] Build a manifest naming supported OS/provider/tracker/runtime and native chat/session operations. Require evidence only for claimed capabilities, and display the remainder as unsupported/unknown.
- [ ] Aggregate deterministic, Electron, real-provider, hosted-review and recovery reports by revision/config/version. Reject stale or unrelated reports.
- [ ] Require the core repeated-run thresholds and all applicable failure cases; missing/skipped/blocked claimed scenarios cannot pass.
- [ ] Exercise release-readiness against malformed, missing, stale, partial and fully passing report sets. Ensure the gate's output states what was actually tested.
- [ ] Publish limitations and evidence links with the release artifact; do not publish a blanket reliability percentage unsupported by sample size.

## Validation and exit

- [ ] Schedule restart/tick retries cannot create duplicate occurrences or workers.
- [ ] Scheduled execution uses the same configuration, approval, budget, PR review and recovery rules as manual work.
- [ ] One real canary demonstrates operation with the UI closed; unsupported remote modes remain explicitly blocked.
- [ ] The release gate fails when required evidence is missing and passes only for the documented supported scope.

Handoff: schedule/time-zone semantics, occurrence evidence, supported manifest and reproducible release gate command.
