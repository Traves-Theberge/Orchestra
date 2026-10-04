# Truthful task lifecycle and safe finalization

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 02 and 03. Outcome: planning, execution, verification, revision and completion are observable, evidence-based operations; failed publishing or cleanup cannot masquerade as success.

## Files and boundaries

Existing: backend `internal/app/run.go`, orchestrator state/reconciliation, `internal/api/state.go`, `internal/workspace/service.go`, `internal/utils/git/git.go`, `internal/utils/git/worktree.go`, session logs and workflow hooks; desktop issue-detail workflow/plan views and Kanban actions.

Proposed: focused run/finalization/verification services and DB records, scoped Git operation helpers, retention policy and fixture scenarios. Keep the dispatcher small enough to test transition decisions independently from external operations.

## 04.1 Make planning and execution explicit

- [ ] Replace ambiguous state mutation as the only control with queue-plan, execute, stop and revise commands from package 02. Preserve legacy API routes as adapters.
- [ ] Prevent a planning run from implicitly committing/pushing. Record the plan as a versioned artifact tied to its run and branch base.
- [ ] Remove the fallback that checks all plan items after provider success. Preserve reported versus verified criterion state with an explicit unknown outcome.
- [ ] Resolve max turns, retries and timeouts from package 03. Define which attempts consume each limit and ensure no unfinished-plan loop bypasses the bound.
- [ ] Test successful empty output, partially reported plans, missing plans and repeated unfinished runs. Do not infer correctness from process exit status.

## 04.2 Execute independent verification

- [ ] Configure verification commands per project/task using structured command plus arguments, workspace identity and timeout. Avoid unescaped shell composition.
- [ ] Record command, exit code, output/artifacts, time and tested SHA. Include inconclusive when launch/environment prerequisites fail.
- [ ] Show stale verification after any head or working-tree change. Define how uncommitted changes are identified so a SHA alone does not falsely identify the tested tree.
- [ ] Define whether failed verification allows Review for triage; it must remain failed and cannot satisfy completion policy.
- [ ] Exercise failed, timed-out and canceled checks in the real Git fixture, plus an agent that falsely claims tests passed.

## 04.3 Track finalization separately

- [ ] Record commit, push, artifact capture and task transition outcomes after provider work finishes. Keep provider duration distinct from finalization duration.
- [ ] Verify task checkout identity before Git operations. Remove fallback commits to project root and avoid staging unrelated files without the configured explicit policy.
- [ ] Make publishing opt-in/default policy visible. If auto-publish is configured, failed commit/push remains a retriable finalization failure with captured diagnostics.
- [ ] Require owned workspace/branch/base/head checks immediately before mutations; use expected-head comparisons where appropriate.
- [ ] Test no changes, commit failure, push rejection, missing checkout, changed branch and task deletion during finalization. Do not restart the agent merely to retry a push.

## 04.4 Make stop and revise safe

- [ ] Cancel the current attempt and owned process tree, then persist stopped state. Preserve its branch, plan, config and artifacts until a deliberate retention decision.
- [ ] Prevent auto-refresh from silently re-admitting stopped/canceled work. An explicit retry/revision creates the intended new attempt/run.
- [ ] Attach feedback and selected configuration version to revision runs. Distinguish re-plan from re-execute in UI/API.
- [ ] Reject stale events after stop. Ensure a canceled run cannot push, mark Done or delete its checkout through delayed finalization.

## 04.5 Decouple completion and cleanup

- [ ] Evaluate completion policy independently of board dragging/provider exit. Store accepted-local, merged-delivery, canceled and closed-unmerged outcomes distinctly.
- [ ] Introduce a retention check that inspects active process ownership, dirty/untracked/ignored valuable files, merge/remote retention and requested policy.
- [ ] Replace unconditional force-removal/branch deletion with guarded removal. Retain the branch or a durable recovery ref when policy requires it; report declined cleanup as retained, not failed task execution.
- [ ] Persist cleanup pending/retained/completed/failed outcomes. Cleanup retry must not repeat completion or publishing.
- [ ] Exercise commit failure immediately before cleanup, an unpushed branch, dirty work and missing path. Verify no writes occur in the parent project root.

## Validation and exit

Run targeted orchestrator/finalization/API/Git/workspace tests and package 01 full lifecycle scenarios, then real-provider canaries for the supported local combinations.

- [ ] Provider completion never manufactures verification or criterion completion.
- [ ] Publishing failure is visible and recoverable without duplicate execution.
- [ ] Stop/revision preserves task ownership, configuration and evidence.
- [ ] Cleanup cannot discard unretained task work and never falls back to project-root mutations.
- [ ] Ten deterministic lifecycle repetitions plus the specified failure injections pass; real-provider rows are recorded separately.

Handoff: explicit lifecycle commands, completion/retention policy and operation receipts. Package 05 adds hosted delivery/review evidence; do not infer merged delivery before that integration is proven.
