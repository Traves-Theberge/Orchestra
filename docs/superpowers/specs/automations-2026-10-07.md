# Automations (spec, 2026-10-07)

Scheduled agent runs modeled on Orca's automations, adapted to Orchestra.
**Automations are their own entity.** They may optionally be linked to a
project (where the agent runs) and/or a task (context + back-link), but they
do not live inside the Tasks pipeline or a project chat.

## Concepts

- **Automation**: a saved prompt + harness/model + optional project/task link
  + schedule. Runs automatically until paused.
- **Run**: one execution of an automation (scheduled or manual). Executed with
  the workspace chat engine (`internal/workspacechat`): one chat session + one
  message per run, so harness, model, effort, native sessions, reasoning
  events and stop all work unchanged.
  - No project: runs in the Maestro scope (`workspacechat.OrchestratorScope`).
  - Project, `workspace_mode = "project"`: runs at the project root.
  - Project, `workspace_mode = "new_worktree"`: a fresh worktree per run named
    `auto-<slug40>-<YYYYMMDDTHHMM>` from `base_branch` (default: project
    default branch), via the existing worktree jobs service.
  - Linked task: the prompt is prefixed with the task identifier, title and
    description; the run records `task_id` so the task can show its runs.
- Native approval requests during an unattended run are **auto-denied** (the
  run never blocks on a human). Recorded in the run's output/error.
- Turn timeout for runs: 30 minutes (chat default is 10).

## Schedule

`schedule` object:
- `kind`: `"hourly" | "daily" | "weekdays" | "weekly" | "cron"`
- `time`: `"HH:MM"` (daily/weekdays/weekly); hourly uses `minute` (0-59)
- `day`: 0-6, Sunday=0 (weekly)
- `cron`: 5-field cron (`min hour dom mon dow`; supports `*`, lists, ranges,
  steps) when kind = cron
- `timezone`: IANA name; default = backend local zone

Presets compile to cron internally. Server computes `next_run_at`.

Missed runs: only the latest due occurrence is considered. If it is within
`grace_minutes` (default 720; 0 = no grace) it runs once, otherwise a
`skipped_missed` run is recorded. Then `next_run_at` advances.

Scheduler: 60 s ticker started in `app.Run`, non-overlapping evaluation, plus a
catch-up pass at startup. At most one active run per automation (a due run
while one is active records `skipped_busy`). Identical consecutive skip
reasons fold into one row (`occurrence_count`).

Precheck (optional): shell command run in the target directory before a
scheduled run; exit 0 proceeds, non-zero records `skipped_precheck`. Default
timeout 60 s. Manual "Run now" skips the precheck.

Retention: keep the latest 100 finished runs per automation; never prune
active runs.

## Run status

`queued -> starting -> running -> succeeded | failed | cancelled`
plus terminal skips: `skipped_precheck | skipped_missed | skipped_busy |
skipped_unavailable` (harness/project unavailable).
`trigger`: `"scheduled" | "manual"`.

## API (all under the protected router; mirror existing JSON/error style)

```
GET    /api/v1/automations                      -> { automations: Automation[] }
POST   /api/v1/automations                      body AutomationInput -> Automation (201)
GET    /api/v1/automations/{id}                 -> Automation
PATCH  /api/v1/automations/{id}                 body AutomationInput (partial) -> Automation
DELETE /api/v1/automations/{id}                 -> 204 (deletes runs; never deletes worktrees)
POST   /api/v1/automations/{id}/run             -> AutomationRun (202, trigger=manual)
POST   /api/v1/automations/{id}/pause           -> Automation
POST   /api/v1/automations/{id}/resume          -> Automation
GET    /api/v1/automations/{id}/runs            -> { runs: AutomationRun[] } newest first
GET    /api/v1/automation-runs?status=&limit=   -> { runs: AutomationRun[] } all automations
GET    /api/v1/automation-runs/{run_id}         -> AutomationRun
POST   /api/v1/automation-runs/{run_id}/cancel  -> AutomationRun
POST   /api/v1/automations/schedule/preview     body {schedule} -> { valid, description, next_runs: string[3], error? }
```

`AutomationInput`:
```json
{
  "name": "Weekday repo audit",
  "prompt": "…",
  "provider": "claude",
  "model": "",                 // optional, provider default when empty
  "reasoning_effort": "",      // optional
  "project_id": "",            // optional
  "task_id": "",               // optional (issue id)
  "workspace_mode": "project", // "project" | "new_worktree" (ignored without project)
  "base_branch": "",
  "schedule": { "kind": "weekdays", "time": "09:00", "timezone": "America/Edmonton" },
  "grace_minutes": 720,
  "precheck": { "command": "", "timeout_seconds": 60 },
  "enabled": true
}
```

`Automation` = AutomationInput fields + `id`, `created_at`, `updated_at`,
`next_run_at` (RFC3339 or ""), `last_run_at`, `last_run_status`,
`schedule_description` (e.g. "Weekdays at 09:00 (America/Edmonton)"),
`project_name`, `task_identifier`, `task_title`.

`AutomationRun`:
```json
{
  "id": "", "automation_id": "", "automation_name": "", "run_number": 3,
  "title": "Weekday repo audit run 3", "trigger": "scheduled",
  "status": "succeeded", "scheduled_for": "", "started_at": "", "finished_at": "",
  "project_id": "", "workspace_id": "", "workspace_path": "", "branch": "",
  "chat_project_id": "", "chat_session_id": "",   // open the conversation
  "task_id": "", "provider": "", "model": "",
  "output": "", "output_truncated": false, "error": "",
  "precheck": { "exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0 },
  "usage": { "input_tokens": 0, "output_tokens": 0, "total_tokens": 0 },
  "occurrence_count": 1
}
```

Events: publish run lifecycle on the existing pubsub/SSE bus as
`AUTOMATION_RUN_UPDATED` with the run JSON as payload.

Backend implementation notes (additive clarifications, contract unchanged):
- Errors use the standard envelope `{error:{code,message}}`: 400
  `invalid_automation` (validation, message says which field), 404
  `automation_not_found`, 409 `automation_conflict` (Run now while a run is
  active), 503 `automations_unavailable`.
- `AutomationRun` also carries `created_at` / `updated_at`. `precheck` and
  `usage` are always objects (zero values when nothing ran / no usage).
- Auto-denied approval notes ("Approval request auto-denied: <method>") are
  appended to `error`, even when the run succeeded; use `status` for color.
- `GET /automation-runs?status=` accepts one status, a comma list, or the
  groups `active` / `skipped`; `limit` defaults to 200 (max 1000).
- `grace_minutes: 0` ("No grace") still runs an occurrence picked up by the
  normal tick (up to 2 minutes late); anything later is `skipped_missed`.
- `schedule/preview` always returns 200; invalid input gives
  `{valid:false, error, next_runs:[]}`. `next_runs` are RFC3339 in the
  schedule's timezone. Other timestamps are RFC3339 UTC.
- new_worktree branch name = worktree name; on a name collision the run
  number is appended.

## Desktop UI (Orca automations UI, Orchestra styling)

- Sidebar section **Automations** (lucide `CalendarClock`), between Tasks and
  Agents.
- List: dense grid table, sticky Name; columns Name | Schedule | Link
  (project / task chips) | Next run ("abs (relative)" or "Paused") | Last run
  (dot, red on failure, "Never ran") | Status (Enabled / Paused) | Agent |
  kebab (Run now, Edit, Pause/Resume, Delete; also on right-click). Search,
  filter pills (Status, Last run, Agent), sort by Name / Last run, ↑/↓/Enter.
  Toolbar: search, filters, refresh, "Runs", primary "+ New automation".
- Empty state: "Start from a template": Weekday repo audit (weekdays 09:00,
  grace 12h), Release readiness (Thu 14:00, 24h), Daily change review (daily
  16:30, 3h), Hourly maintenance check (hourly :15, 30m) + "Add new".
- Editor dialog (two columns): left = inline large name + prompt textarea;
  right 320px rail = Agent (HarnessPicker provider/model/effort), Project
  (optional), Task link (optional), Workspace (Project root / New worktree +
  base branch), Schedule (cadence select + time/day/minute, Custom cron with
  5-cell breakdown and live preview via /schedule/preview showing next 3
  runs), Timezone, Grace (No grace, 30m, 1h, 3h, 12h, 24h, 48h), Precheck
  (command + timeout). Footer: "Once saved, runs automatically until paused."
  + Cancel / Create (Save changes). "Use template" popover in the header.
- Detail (drill-in, "← All automations"): tabs Overview | Runs; Overview
  metrics (Next run, Last run, Schedule, Agent, Project, Task, Workspace,
  Grace, Precheck, Tokens) + prompt "Show more"; toolbar Run now, Edit,
  Pause/Resume, Delete (confirm: "Deletes the automation and its run
  history. Worktrees created by runs are kept.").
- Runs dashboard (all automations): 4 stat cards (Succeeded/Failed · 24h /
  7d), search, status filter; status badges Queued / Starting / Running /
  Succeeded / Failed / Cancelled / Skipped (precheck/missed/busy/unavailable),
  trigger column.
- Run page: header with status + trigger + times, markdown output (fallback:
  precheck output, then error), Rerun, Cancel while active, "Open
  conversation" (navigates to the chat session; Maestro when no project),
  link to task when present.
- OS notification + sound when a run finishes or fails (reuse
  use-notifications).
- Calm visual language: 11px uppercase captions, 13-14px body, muted
  foreground, red only for failures, lucide icons, minimal motion.

## Packages (match Orca, stablyai/orca)

Desktop, same libraries Orca's automations UI uses:
- `radix-ui` (umbrella package, Orca ^1.6.7) for Dialog, Select, Popover,
  DropdownMenu (row kebab + context menu), ToggleGroup (Workspace / Session
  toggles). Wrap as shadcn-style primitives in `src/ui/` if missing.
- `sonner` 2.x for toasts (save errors, "Run started", run finished/failed).
  Mount one `<Toaster />` at the app root.
- `@monaco-editor/react` + `monaco-editor` (already installed) for the prompt
  editor.
- `cmdk` for searchable comboboxes (Agent, Project, Task pickers).
- `zod` 4.x for client-side validation of the editor form and API responses.
- `@tanstack/react-virtual` (installed) for long run lists.
- `lucide-react` (installed), `class-variance-authority`, `clsx`,
  `tailwind-merge` for variants and class merging (shadcn conventions).

Backend: Orca hand-rolls its cron and schedule logic
(`src/shared/automation-cron-occurrence.ts`, `automation-schedules.ts`) with
no cron library. Do the same in Go (`internal/automations/schedule.go`), with
no new Go dependencies.
