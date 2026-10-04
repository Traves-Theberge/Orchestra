# Model independent orchestration API CLI and MCP

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 08 and C1; uses package 02 command/run contracts. Outcome: native chat, human operators and external agent models can control and observe many independently scoped orchestrations through one backend control plane.

The user requirement is an Orca-style programmable orchestration interface with T3-style native chat. The coordinator is a selectable provider/model using tools; it is not hardcoded to one vendor. The backend scheduler enforces execution rules independently of what the model says.

An external model can use CLI/API/MCP without Orchestra hosting that model's conversation. Internally hosted native coordinator chat requires a supported session adapter. Worker execution independently requires a supported provider adapter. This distinction permits model-independent control without promising that every model implements native resume, tools or approval behavior.

## Files and boundaries

Existing: `apps/backend/cmd/orchestra/main.go` and tests, which currently expose start/check/check-pr-body; API router, orchestrator/DB, MCP infrastructure, tracker tools including the basic request_handoff tool; native chat and task workspace contracts.

2026-10-04 partial delivery: the CLI now also exposes read-only `status`, `project list/show`, and `task list/show`, with explicit backend credentials, JSON scope, exact identity resolution and transport safeguards. The repo-versioned `orchestra-cli` skill describes those commands and current task semantics. See [observation handoff](../../../testing/ade-cli-observation-handoff-2026-10-04.md) and [skill handoff](../../../testing/ade-orchestra-cli-skill-2026-10-04.md). This does not complete mutation, orchestration, terminal, worktree or durable receipt requirements below.

Proposed: `internal/orchestration/` control service, durable orchestration/worker/message/gate DAOs; typed HTTP/SSE API, `internal/cli/` client/commands and `internal/mcp/orchestration/` tools; desktop orchestration view/cards. Names below are proposed public commands, not existing functionality.

## C2.1 Define orchestration ownership

- [ ] Define Orchestration ID/namespace, goal, coordinator thread/provider instance, project/environment references, lifecycle and member task/worker IDs.
- [ ] Distinguish orchestration, task run, attempt and provider session. Multiple orchestrations can share a project while retaining separate worktree/process/config ownership.
- [ ] Define scoped capabilities for coordinator/worker/human actors. A worker reports its own dispatch and cannot complete another worker or mutate unrelated runs.
- [ ] Add explicit list/get/create/archive operations; reject ambiguous mutation targets instead of relying on a global currently selected run.

## C2.2 Expose one command service

- [ ] Implement typed commands for create orchestration/task, dispatch, inspect, send/steer, stop, answer request, report worker result, resolve gate and attach artifact/PR.
- [ ] Route chat tools, HTTP, CLI and MCP through this same service with identical validation, receipts, state-version checks and authorization.
- [ ] Preserve package 08 idempotency and effect/recovery behavior across clients. Transport retries cannot duplicate work.
- [ ] Audit actor, orchestration/task/dispatch IDs, accepted intent and completed effect separately.
- [ ] Start with explicit tasks/dispatch; package 09 adds DAG scheduling and budget admission.

## C2.3 Add the human and agent CLI

User clarification on 2026-10-04: use Orca CLI as the base interaction model, including project/worktree/terminal operations, with one central UI controlling the same workspaces. This means adopt its explicit selectors, owning-host routing, JSON receipts and observation semantics; the installed `orca` runtime does not become Orchestra's backend by renaming a binary. Shared operations must remain usable without the desktop window.

The [CLI/workspace receipt](../../../testing/ade-cli-workspace-reference-2026-10-04.md) traces pinned Orca commands into runtime authority and records current Orchestra CLI/terminal gaps. Pair it with the [two-reference terminal/workspace review](../../../testing/ade-terminal-workspace-reference-2026-10-04.md) before implementation; the Orca-only receipt explicitly does not pass the two-reference gate by itself.

- [ ] Define `orchestra repo add|list|show`, `worktree create|list|show`, and `terminal list|show|create|read|send|close` around the same project/worktree/session service as the UI. Names are proposed, not existing commands. Add archive/removal only after retained-work/ownership policy is verified.
- [ ] Require stable selectors and execution-environment routing; ambiguous names reject. Terminal handles belong to one runtime/session epoch. A stale handle prompts re-list/reconciliation, not dual-send to old and new handles.
- [ ] Separate terminal input accepted, provider turn started, and completed result. Wait/send receipts must report the observed stage; timeouts cannot turn into an implicit resend or success claim.
- [ ] Distinguish opening a new terminal session from spawning an agent and from creating a new worktree. Agent/session creation needs request identity before side effects; retries must not duplicate a PTY, checkout or agent.
- [ ] Reflect Windows terminal capability truth: unsupported PTY transport rejects before launch and is disabled/explained in the UI/CLI. A shell-command runner is not a substitute for interactive terminal support.

- [ ] Add `orchestra orchestration create|list|show`, `task create|list|show`, `worker dispatch|show|stop`, `message send`, `request list|answer`, and `events watch|wait` namespaces, retaining existing start/check commands.
- [ ] Require `--orchestration`, task/dispatch IDs for mutations. Support `--json`, endpoint/environment selection, command IDs and expected state version. Output one parseable response to stdout; diagnostics go to stderr.
- [ ] Define stable exit codes for invalid input, denied action, conflict, backend unavailable and operation failure. Accepted asynchronous work returns a receipt; add wait/show to inspect the final outcome.
- [ ] Implement watch with durable cursor, filters and reconnect; implement wait with an event predicate and timeout, not repeated shell sleeps.
- [ ] Add CLI integration tests against the real backend for interleaved commands across two orchestrations.

## C2.4 Add MCP and coordinator tools

- [ ] Expose the command/observation subset as typed MCP tools/resources under an explicitly scoped connection. Keep tool schemas and CLI/API semantics aligned.
- [ ] Attach the tool bridge to coordinator provider sessions using package 03 materialization and provider capabilities. Record tools the provider actually receives.
- [ ] Supply workers with dispatch/task IDs, goal, configuration and report/question tools. Validate callback identity and reject stale dispatch reports.
- [ ] Replace assignee-only handoff with an explicit command carrying the portable handoff artifact, workspace ownership and pending request state.
- [ ] Test coordinator tool calls from at least two supported providers/models over the same control service; inability to call tools is an unsupported coordinator capability.

## C2.5 Observe many orchestrations

- [ ] Add run-list/overview with filters for project, environment, coordinator, active/blocked/failed and attention count.
- [ ] Show worker activity, dependencies, decisions, finalization and verification from persisted projections. Deep-link into the exact native worker chat/workspace.
- [ ] Support per-orchestration and aggregate event feeds; paginate history to avoid loading every worker transcript on the overview.
- [ ] Reconnect clients and reconcile state using cursor/versioned snapshots. A stopped coordinator thread must not erase or automatically cancel independently owned worker tasks unless policy says so.
- [ ] Load-test many simulated orchestrations with bounded workers/event rates and slow observers. Record the tested concurrency, event throughput, memory, refresh latency and fairness; do not publish an unlimited-scale claim. One busy orchestration must not starve others or flood every client with all transcripts.

## Validation and exit

- [ ] Create two orchestrations; use different coordinator models and workers; issue simultaneous CLI/chat/MCP commands and observe isolated, consistent results.
- [ ] Duplicate commands, stale completion, unauthorized cross-run changes and disconnected watch/wait scenarios behave predictably.
- [ ] A worker question appears in native chat and can be answered from CLI exactly once, with persisted resolution visible to both.
- [ ] No UI must stay open for CLI-driven control or durable observation.
- [ ] Public command docs/examples execute against the fixture backend; advertised native coordinator support has real-provider evidence.

Handoff: CLI reference and examples, API/MCP schemas, capability/authorization matrix, two-orchestration evidence and versioning rules. No runtime-global reset command is part of the initial interface.
