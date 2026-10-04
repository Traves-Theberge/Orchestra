# Kanban visibility and attention workflow

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Requires: 04 and 05. Outcome: the existing board answers what is running, what is blocked, what has been checked, what is ready for review and what action is needed.

## Files and boundaries

Existing: `features/kanban/KanbanBoard.tsx` and tests, issue-detail actions, `layout/AppCommandPalette.tsx`, `hooks/use-notifications.ts`, core issue/runtime/UI slices, runtime sync; backend task projections/action policy, PubSub and DB.

Proposed: extracted card/filter/action components, board preference slice/storage, durable human-request/attention records and inbox API/UI. Package 08 completes provider-specific response/recovery mechanics; initial records must already survive reconnect.

## 06.1 Build truthful task projections

- [ ] Compose task lifecycle, current run status, verification and PR delivery from authoritative records. Include last update/version and stale/unknown status.
- [ ] Display waiting for input, interrupted, retries/exhaustion and dependency blocking distinctly. A missing running snapshot must not automatically mean queued or finished.
- [ ] Show concise provider/model, current activity, elapsed runtime and next action; leave detailed trace/cost in task inspection.
- [ ] Add fixtures for missing/legacy projections, partially finalized work and failed hosted refresh.

## 06.2 Use backend actions consistently

- [ ] Replace duplicated drag transition maps with the package 02 action contract. Route button, drag, keyboard and inspector actions through the same command.
- [ ] Add explicit plan/execute/retry/stop/revise actions with human-readable consequences. Show why an action is unavailable.
- [ ] On command failure or state-version conflict, retain authoritative state and surface the error; refresh before retry.
- [ ] Prevent duplicate submits and verify repeated commands use the same idempotency key.

## 06.3 Add a durable attention inbox

- [ ] Persist actionable records for human questions/approvals, failed checks, retry exhaustion, conflicts and review requests. Distinguish unread from unresolved.
- [ ] Link each record to task/run/attempt/workspace and the originating request. Resolve the underlying action, not just a notification.
- [ ] Build Needs attention as a saved board view and inbox drawer with deep links and reason summaries. Group noisy repeated failures without losing history.
- [ ] Make sounds/system notifications preferences over durable records. Opening/dismissing a toast must not resolve the request.
- [ ] Test stream drops, page reload, backend restart and an action resolved from another client.

## 06.4 Improve board navigation and persistence

- [ ] Add search and provider/label/priority/project filters; saved views for Running, Needs attention, Ready for review and Failed/interrupted.
- [ ] Persist per-user/project view preferences, column order, density and card order. Keep task priority distinct from purely visual ordering.
- [ ] Add keyboard card navigation and action/move menus. Preserve focus on updates and provide accessible labels/announcements.
- [ ] Keep the five columns; use a cancellation filter/outcome rather than mislabeling canceled work Done. Avoid adding an execution-state column for every transient event.
- [ ] Validate empty/error/loading states and hundreds of tasks. Add virtualization only if measured rendering requires it.

## Validation and exit

Run card/action/preference/inbox tests and integrated board scenarios. Capture desktop screenshots at normal and narrow widths, plus keyboard-only operation evidence.

- [ ] A human can find and resolve a blocked task from the board without searching logs.
- [ ] Card state, inspector state and API policy agree after refresh/reconnect.
- [ ] Preferences survive reopening; rejected commands never leave misleading optimistic state.
- [ ] Failed/stale verification and hosted PR data remain visible.

Handoff: state/action mappings, attention record semantics, screenshots and accessibility checks. No board styling pass substitutes for runtime correctness.
