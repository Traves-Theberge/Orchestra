# ADE execution plan

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


This plan turns the [review](../../../architecture/ade-review-2026-10-03.md) into twelve core work packages and two dedicated interface tracks. Native provider chat is a primary interface; Kanban gives the work overview; a shared API, CLI and MCP control layer lets human operators and capable models drive and observe many orchestrations. PR review and agent configuration are core workflows. Every capability requires evidence before it is called working or reliable. Planning does not authorize shipping changes or using production repositories for tests.

Status: package 00 and 01 remain in progress. Current fixes and final test scope are recorded in the [launch/review handoff](../../../testing/ade-launch-review-2026-10-04.md): Linux backend unit/race and renderer suites passed; the full native Windows lane is incomplete because Application Control blocked two binaries. Configuration request transport/validation and commit-bound PR review have partial implementations; they do not complete packages 02/03/05. Antigravity protocol preparation remains unwired. Real project access and registration failure handling are now verified at their narrow boundaries in the [audit launcher handoff](../../../testing/ade-audit-launch-handoff-2026-10-04.md). Remaining package gates and provider/lifecycle evidence remain open. Paths below are relative to the repository root; proposed files are identified in each plan.

User direction on 2026-10-04: repository issues are the Kanban tasks, worktrees are their execution checkouts, T3-style terminals/native chat sit in one central workspace control UI, and Orca CLI supplies the base command/observation model. [07.0](07-task-workspace.md) decomposes project sources, issue creation/linkage and explicit worktree preparation. UI/UX changes must retain these identities and expose capability/state truth rather than implying an unsupported provider, terminal or remote action works.

Three parallel reference reviews are complete: [CLI and central workspace authority](../../../testing/ade-cli-workspace-reference-2026-10-04.md), [settings and UX](../../../testing/ade-settings-ux-reference-2026-10-04.md), and [terminal/workspace behavior](../../../testing/ade-terminal-workspace-reference-2026-10-04.md). Each separates source observations, implementation gaps and unexecuted acceptance scenarios. Their actions are integrated into 03 (configuration ownership/read failures), 07.0/07.6 (onboarding and terminals) and C2 (shared CLI/control). The CLI receipt must be paired with the terminal receipt for both-reference coverage.

Next implementation order: canonical repository/worktree resource contracts and fail-visible capability/path checks; actual Windows terminal transport and ownership; scoped settings with safe read/save; explicit project-source/worktree composer; central task/worktree navigation and terminal layout; durable CLI/control receipts and recovery. UI/UX styling can proceed in parallel against those contracts, without advertising unsupported execution. These reviews are not an implementation-complete or E2E pass.

## Execution order and dependencies

| ID | Work package | Requires | Deliverable |
| --- | --- | --- | --- |
| 00 | [Reproducible baseline](00-baseline.md) | None | Clean build, portable execution boundaries, meaningful CI gates |
| 01 | [Integrated verification harness](01-verification.md) | 00 | Controlled repo/provider/GitHub fixtures and evidence reports |
| 02 | [Run contracts and persistence](02-run-contracts.md) | 01 | Stable task/run/attempt identity, action policy and persisted state |
| 03 | [Agent configuration end to end](03-agent-configuration.md) | 02 | Settings to task to workspace to actual provider, with provenance |
| 04 | [Truthful lifecycle and safe finalization](04-task-lifecycle.md) | 02, 03 | Proven planning/execution/revision, checks, commit/push and cleanup |
| C1 | [Native agent chat](c1-native-chat.md) | 02, 03; planning/execution boundary from 04 | Persistent real provider sessions, typed messages/tools/questions and coordinator threads |
| 05 | [PR review and task linkage](05-pr-review.md) | 04 | Persisted PR association, anchored feedback, fresh review/merge state |
| 06 | [Kanban and attention](06-kanban-attention.md) | 04, 05 | Clear runtime/verification/delivery signals and actionable inbox |
| 07 | [Task workspace](07-task-workspace.md) | 03, 05, 06, C1 | Task-scoped native chat/editor/terminal/browser/review and restored layouts |
| 08 | [Recovery and provider capabilities](08-recovery.md) | 04, 05, 07, C1 | Idempotent effects, durable requests, tested crash/reconnect behavior |
| C2 | [Orchestration API CLI and MCP](c2-orchestration-control.md) | 08, C1 | Model-independent control and observation of independently scoped orchestrations |
| 09 | [Supervised workflows and budgets](09-supervised-workflows.md) | 08, C2 | Bounded DAGs, handoffs, decisions, integration review and spend controls |
| 10 | [Remote execution](10-remote-execution.md) | 08, C2; 09 for remote DAG claims | Proven environment ownership and remote task/workspace behavior |
| 11 | [Scheduled automation and release evidence](11-automation-release.md) | 09, C2; 10 for remote schedules | Durable scheduled runs and capability-specific release gates |

Implement sequentially by default. A package can be split into small changes, but its dependency gates cannot be bypassed. No multi-agent execution is required by this plan. Preparation for a later package can begin without claiming that package is complete.

The first usable milestone is packages 00 through 05 plus C1: a reproducible app with real native chat, a demonstrated task lifecycle, preserved agent configuration and a coherent PR revision loop. C1 can begin once 04's planning/execution boundary passes, without waiting for PR polish. Packages 06 and 07 connect that experience to Kanban and task workspaces. Package 08 and C2 make it a durable programmable orchestrator; packages 09 through 11 expand workflows, remote execution and automation.

The control service begins with the stable commands in 02 and session API in C1. C2 completes its public CLI/MCP and multi-orchestration ownership after recovery is proven; it does not introduce a second scheduler. Native chat and orchestration observation are core deliverables, not optional polish.

## Defaults for implementation

These are proposed defaults to make the plan executable. Record any change before implementing the affected contract.

1. SQLite remains the authoritative local store; the Go backend owns execution, run state and task mutations. Keep existing API consumers compatible through additive fields and adapters.
2. Preserve the five main board columns. Represent canceled/closed outcomes separately from completed delivery. Define completion policy per project: accepted local result or merged PR. Projects without a chosen policy cannot silently infer Done from an exit code.
3. Task configuration precedence is explicit task override, then project override, then environment/provider default, then repository/native defaults where applicable. Adapter capability validation precedes launch. Freeze effective configuration at admission; revisions can explicitly adopt a new version.
4. Provider permissions are never silently widened. Unsupported options produce a clear validation error or an explicitly accepted alternative, not an automatic fallback.
5. Default publish policy is explicit user action. If automatic commit/push is enabled for a project, show that policy and track its results separately. Planning does not publish changes.
6. Default cleanup retains work until the completion policy is met and retention checks pass. Missing checkout never falls back to committing the project root.
7. Supported-platform claims are earned individually. Windows is a required development target for this checkout; Linux/macOS results remain unknown until exercised there. Real providers and remote targets get separate evidence rows.
8. PR approvals and verification attach to the head SHA they evaluated. A later change makes them stale. Hosted review submissions and local agent revision requests remain explicit actions.
9. Native chat drives the selected real provider/session. Coordinator threads call the shared orchestration tools; workers can use different models/providers. Any external model/client able to use the CLI/API/MCP can coordinate without a special vendor-specific integration, while worker execution still requires a supported adapter and demonstrated capabilities.

## How to execute a package

- [ ] Read the package, its prerequisite receipts, and the relevant current source. Reconcile drift in the plan before editing code.
- [ ] Record the exact defect or intended behavior and select the smallest step that can demonstrate it.
- [ ] Add a behavioral test at the relevant boundary for changes to orchestration, API, configuration or UI behavior. Avoid tests that only duplicate implementation.
- [ ] Implement the scoped step and run its targeted checks. Run broader checks at the package gate, or earlier when failures warrant it.
- [ ] Exercise the real app boundary required by the gate; mocked component tests cannot substitute for Electron or provider evidence.
- [ ] Save evidence and update checkboxes only for verified work. Record failures as failed and missing prerequisites as blocked, never passed or omitted.
- [ ] Leave a handoff containing changed files, command results, artifacts and unresolved failures. Follow repository commit/PR instructions only when that action is requested.

## Evidence format and acceptance

Package 01 creates the report format. Every receipt includes checkout revision, dirty-change identifier if applicable, OS/runtime versions, provider/version/model, tracker/runtime target, fixture identity, scenario, commands, expected/observed results, relevant task/run/attempt IDs and SHA, duration and artifact paths. Redact credentials before saving.

Each claimed core environment requires ten consecutive deterministic lifecycle passes and three real-provider lifecycle passes, plus the specified injected failure/recovery cases. These are initial acceptance thresholds, not statistical guarantees. A passing simulation is labeled simulated. Missing, skipped, stale, malformed or unsupported evidence cannot satisfy a claimed capability's gate.

Do not claim web-only tests prove Electron IPC/webview behavior, fake providers prove native permissions, or HTTP smoke proves task execution. Do not require unrelated unsupported capabilities for a narrow release: declare the supported scope and require all evidence within it.

## Initial work queue

Antigravity is the user's current provider target. Local `agy` 1.2.16 discovery passed; follow [the Antigravity integration steps](antigravity-adapter.md) for protocol fixtures, a distinct adapter, configuration and native chat. No Antigravity model run or adapter is yet verified.

Continue from the verified baseline fixes; do not repeat completed module/portable-file/desktop-assertion work. The immediate product queue is project onboarding and issue-owned worktree preparation (07.0), terminal/workspace/session capability truth, settings-to-admission persistence (03), and the shared Orca-style control contract (C2). Preserve the separate real-provider and lifecycle evidence gates. A visible app and passing tests do not prove execution, publication or recovery.

The review is a finding record. These documents are implementation plans. Neither is an E2E certification.
