# Supervised workflows and enforced budgets

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 08 and C2. Outcome: a selectable coordinator model can supervise bounded multi-task workflows through the shared CLI/API/MCP, with deterministic scheduling, handoffs, decision gates and integration review.

## Files and boundaries

Existing: blocker checks and scheduler, tracker WorkItem, configuration/run contracts, control-plane service/CLI/MCP from C2, budget DAO/utilization, native coordinator chat and task workspace.

Proposed: DAG/dependency policy, worker dispatch/result records, decision gate and heartbeat records, admission/budget reservation service and workflow templates. Reuse current blocker semantics rather than building a second unrelated scheduler.

## 09.1 Add parent workflows and DAG authoring

- [ ] Persist parent/child task relationships and dependency edges within an orchestration namespace. Reject cycles and cross-namespace changes without explicit linkage.
- [ ] Define dependency conditions: prerequisite execution, verified output, accepted review or merged delivery. A completed subprocess cannot automatically satisfy all conditions.
- [ ] Add task graph editing through UI and CLI/API with state-version checks. Display why a task is blocked.
- [ ] Test missing dependencies, canceled prerequisites, graph changes mid-run and deterministic unblocking.

## 09.2 Separate coordination from scheduler rules

- [ ] Let a coordinator suggest decomposition/provider roles through tools; the backend validates capabilities, limits and dependencies before admission.
- [ ] Store role/model/provider routing policy for planner, implementer and reviewer. Snapshot the chosen effective configuration on each run.
- [ ] Define worker heartbeat, timeout, report and escalation protocols using dispatch IDs. Stale completion cannot satisfy a newer dispatch.
- [ ] Support human intervention in coordinator native chat and scoped CLI commands; keep the worker ownership policy explicit if the coordinator disconnects.

## 09.3 Add decision gates and handoffs

- [ ] Persist blocking decisions with options, scope, owner and resolution. Expose ask/answer/gate-create/gate-resolve through C2 contracts and native chat.
- [ ] Attach portable handoff artifacts to provider switches and task transitions. Require verified workspace/base/head identity before resuming work.
- [ ] Model failed prerequisite, failed verification and exhausted retries as distinct escalation reasons.
- [ ] Test unresolved gate across restart, answered gate exactly once and late worker result after reassignment.

## 09.4 Enforce resource and budget admission

- [ ] Add project/provider/workflow concurrency and active-worktree limits. Model rate-limit waiting separately from failed execution.
- [ ] Connect existing budget records to admission using atomic reservations where estimates are possible; reconcile estimated versus reported usage.
- [ ] Define hard/soft budget behavior and unknown-cost handling. Token counts and estimated API cost must not be presented as exact subscription spend.
- [ ] Preserve accounting across retries/restarts; release abandoned reservations under a verified recovery policy.
- [ ] Test simultaneous admission at the remaining limit, rate-limit changes and missing/late usage reports.

## 09.5 Integrate completed worker results

- [ ] Introduce an explicit integration task/workspace for combining worker outputs. Detect conflicts and verify the combined result independently.
- [ ] Require review/verification before publishing an aggregate change; retain per-worker provenance and linked PRs/artifacts.
- [ ] Add reusable templates with parameters and supported capability requirements. Version templates so a changed template does not mutate a live run.
- [ ] Add optional bounded comparison runs only after ordinary DAG completion is proven. Limit candidate count/cost and retain a human or explicit policy selection step.

## Validation and exit

- [ ] Run a three-task DAG with different worker configurations, one blocking question and an integration check through native chat and CLI.
- [ ] Start a second orchestration concurrently and verify namespaces, budgets, worktrees and report identities remain isolated.
- [ ] Inject worker crash, canceled prerequisite, conflict, stale completion, rate limit and budget exhaustion; demonstrate recoverable outcomes.
- [ ] Real-provider evidence covers the advertised coordinator/worker combinations; simulated scheduling passes remain labeled simulated.

Handoff: dependency conditions, coordinator/worker protocol, routing/budget policy and integration evidence. Remote claims require package 10.
