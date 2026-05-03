# Agent E2E Status Matrix

Per-agent pass/fail tracking for the full Kanban lifecycle (issue #147). Run
the matrix end-to-end whenever the dispatch path, worktree machinery, or any
agent runner changes.

The companion script `scripts/e2e-kanban.sh` automates issue creation,
SSE tailing, and log following so each row below takes minutes instead of
hours.

## How to use this doc

1. Run `scripts/e2e-kanban.sh setup` once to verify backend reachability and
   list registered projects.
2. For each agent in the matrix, run `scripts/e2e-kanban.sh run <provider>
   <project_id>`. The script seeds an issue, prints the worktree path, and
   tails the SSE stream until you Ctrl-C.
3. Walk the issue through the Kanban states in the desktop UI; tick the
   matching boxes in this doc as you go.
4. When all four agents pass, mark this doc green and close #147.

## Matrix

Status legend: ✅ pass · ❌ fail · ⏸ blocked · — not yet run

| Step                         | Claude | Codex | OpenCode | Gemini |
|------------------------------|:------:|:-----:|:--------:|:------:|
| 1. Issue creation            |   —    |   —   |    —     |   —    |
| 2. Dispatch (Todo → InProg)  |   —    |   —   |    —     |   —    |
| 3. Execution                 |   —    |   —   |    —     |   —    |
| 4. Review (PR creation)      |   —    |   —   |    —     |   —    |
| 5. Completion (Done)         |   —    |   —   |    —     |   —    |
| 6. Failure paths             |   —    |   —   |    —     |   —    |

Last run: _not yet run_ · Last runner: _n/a_

## Detailed checklist (per agent)

Copy this block under each agent heading below as you run it. Tick each box,
note any deviations, and link back to filed bug issues.

### 1. Issue creation
- [ ] Created via Kanban `+` button (or `scripts/e2e-kanban.sh run`)
- [ ] Lands in **Todo** with the correct provider tagged
- [ ] Project assignment is correct
- [ ] Issue identifier generated (`PROJ-N`)

### 2. Dispatch (Todo → In Progress)
- [ ] Card moves to **In Progress** (auto-claim or manual move)
- [ ] Worktree created at `${ORCHESTRA_WORKSPACE_ROOT}/<project>/<branch>`
- [ ] `base_sha` and `branch_name` recorded on the issue
- [ ] Agent process visible in `ps aux | grep <provider>`
- [ ] Right credentials/model/env passed to the agent (check session log)
- [ ] SSE event stream populates the inspector

### 3. Execution
- [ ] Project-scoped instructions loaded (`CLAUDE.md` / `AGENTS.md` / etc.)
- [ ] Tool calls resolve (tracker bridge, file ops, terminal)
- [ ] Plan tab populates from agent output
- [ ] Diff tab shows real file changes
- [ ] Token usage / rate limits update in the status bar

### 4. Review (In Progress → Review)
- [ ] Agent finishes, card auto-moves to **Review**
- [ ] **Create PR** pushes worktree branch and opens GitHub PR
- [ ] **View PR** opens the PR in the in-app browser
- [ ] PR title/body reflect the agent's actual work

### 5. Completion (Review → Done)
- [ ] Card marked **Done**
- [ ] Worktree cleaned up (or retained per config)
- [ ] Issue history shows the full timeline
- [ ] No orphaned agent processes (`ps aux | grep -E '(claude|codex|opencode|gemini)'`)

### 6. Failure paths
- [ ] Stop running session → state returns to Todo cleanly
- [ ] Tool error during run → surfaces in session log, worker keeps going
- [ ] Rate limit during run → backs off, doesn't crash

## Per-agent results

### Claude

_Not yet run._

### Codex

_Not yet run._

### OpenCode

_Not yet run._

### Gemini

_Not yet run._

## Filed bugs

_None yet._ Add a bullet here for each failure with a link to the GitHub
issue. If the same failure shows up across two or more agents, file a
meta-issue under the orchestrator path instead of one-per-agent.
