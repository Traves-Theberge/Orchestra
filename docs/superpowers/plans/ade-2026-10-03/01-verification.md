# Integrated verification harness

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 00. Outcome: reproducible tests exercise desktop, API, real filesystem/Git and controlled providers together, with independent evidence for real provider and hosted integration canaries.

## Files and boundaries

Existing: `packages/test-fixtures/`, `apps/desktop/scripts/smoke-ops-flow.mjs`, `apps/desktop/src/App.smoke.test.tsx`, `scripts/e2e-kanban.sh`, backend runner registry, Studio fake runner, session logger, API router and existing test helpers.

Proposed: `packages/test-fixtures/ade/` fixture descriptions, backend `internal/testsupport/` recording provider and controllable GitHub server, desktop `scripts/e2e-ade.mjs` harness and `e2e/` tests, evidence JSON schema, and a Windows-compatible replacement/companion for the shell-only lifecycle script. Reuse current infrastructure where it meets the required boundary.

## 01.1 Define scenarios and evidence

- [ ] Encode the current intended core lifecycle as named scenarios: create, queue/plan, execute, review, revise, verify, complete. Record current failures rather than enforcing proposed behavior that has not been implemented yet.
- [x] Define report statuses passed, failed, blocked, skipped and unsupported, plus simulated/real execution mode. Include environment/version/SHA and run identities.
- [ ] Define failure artifacts: screenshots/video where available, app/backend/provider logs, database assertions, Git status/refs and process ownership. Redact credentials and fixture secrets.
- [x] Add report-schema validation and reject absent expected scenarios. Separate fresh evidence from historical results.

## 01.2 Provision disposable environments

- [x] Create a small Git repository with a deterministic code change and runnable check, plus a local bare remote. Avoid the Orchestra working tree as a mutation fixture.
- [ ] Allocate unique worktree/data roots and ports per test run. Write an ownership manifest; cleanup must verify the resolved path lies inside the fixture root.
- [ ] Start the real backend and renderer/desktop under test with isolated config/home directories. Wait for readiness signals with deadlines and stop owned child processes on failure.
- [ ] Capture baseline project-root status so tests detect writes outside the task checkout.

## 01.3 Add controlled providers and hosted API behavior

- [ ] Implement a recording adapter with scripted events, tool calls, usage, questions, delayed completion, failure, stale completion and cancellation. Record the exact launch request.
- [x] Make the fixture actually modify the task worktree and run its verification command. A synthetic success event without file effects is insufficient for the lifecycle fixture.
- [ ] Add a controllable GitHub API fixture for PR creation/linking, head updates, reviews, checks, merge, rate-limit and partial-failure cases. Keep local Git push verification separate from API simulation.
- [ ] Exercise Studio draft mutations through its real API/MCP boundary with a fake authoring provider. Existing direct fake-manager tests are complementary.

## 01.4 Exercise the application boundary

- [ ] Use stable accessible selectors/test IDs for task creation, board actions, inspector, configuration save and PR review. Prefer semantic actions over coordinates.
- [ ] Add a renderer/backend integrated lane and an Electron lane for IPC, terminals and webviews. Label their coverage boundaries separately.
- [ ] Run a manual collaborative-browser session using T3 preview tools when available and retain screenshot evidence. Automated CI can use the repository's Playwright dependency; manual browser control follows the active tool instructions.
- [ ] Assert persisted task state, launch request, actual diff, revision feedback and retained artifacts after each UI action. Reconnect and re-read the database/API; do not rely only on text appearing in the UI.

## 01.5 Establish real canaries and CI reporting

- [ ] Add an opt-in real-provider mode requiring a disposable repo, configured provider and bounded test task. Record prerequisites as blocked when absent. Do not silently substitute a fake provider.
- [ ] Add a hosted GitHub canary mode with a disposable target and explicit configured authorization; never use a production repo by default.
- [ ] Produce one row per OS/provider/tracker/runtime combination. Start with local SQLite and an available provider; preserve other rows as unknown.
- [ ] Connect scenario reports to readiness checks. Publish detailed failure artifacts and a clear simulated/real summary.

## Validation and exit

- [ ] A deliberately broken fixture produces a failed report and artifacts.
- [ ] Killing the backend, dropping the stream and sending stale output are reproducible scenarios.
- [ ] The deterministic happy-path fixture can run ten times without shared state or orphaned processes; any current product defect remains a failed scenario until fixed.
- [ ] UI, database, Git and recording-provider assertions agree for passing scenarios.
- [ ] The harness correctly distinguishes blocked native/provider tests from passing simulations.

Handoff: command reference, fixture ownership rules, report schema, a baseline failure list and the exact evidence coverage. Subsequent packages add acceptance scenarios to this harness rather than inventing separate incompatible reporters.

## First implementation wave

The [harness receipt](../../../testing/ade-harness-handoff-2026-10-03.md) and [evidence receipt](../../../testing/ade-evidence-handoff-2026-10-03.md) describe implemented local fixture boundaries. Unique owned worktrees, isolated child environments, scripted failures/cancellation and exact request recording are implemented. Backend/renderer lifecycle, GitHub simulation, restart/recovery and real-provider canaries remain open. Fixture success never substitutes for those gates.
