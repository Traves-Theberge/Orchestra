# Orchestra CLI skill and task-system handoff — 2026-10-04

Delivered a repo-versioned skill at `.codex/skills/orchestra-cli/SKILL.md`, with task-system reference and `agents/openai.yaml`. Installed the same three files at `C:\Users\trave\.codex\skills\orchestra-cli`. SHA-256 comparison confirms installation matches the repository. Automatic skill selection remains enabled by default; a fresh agent session can discover the installed skill, or invoke `$orchestra-cli` explicitly.

The skill uses the actual read-only command surface: `status`, `project list/show`, `task list/show`. It resolves the executable and its help before using commands, selects the intended backend, uses `ORCHESTRA_API_TOKEN` without exposing credentials, and distinguishes ID from human issue identifier. It also documents selected audit-profile connection lookup rather than guessing a port.

## Task semantics

The intended product relationship remains project/repository → issue/task → worktree → provider run/session → PR, with Kanban as task overview. Current local/unlinked tasks are not automatically hosted issues. The skill records current local transitions, admission requirements, requested versus effective settings, nondurable waiting retries, incomplete tracker routing, and legacy destructive effects. It does not advertise creation, dispatch, pause/resume, terminal control, worktree management, or orchestration mutations as implemented.

Status is a backend-wide snapshot. Current presenter entries lack project/source identity and worktree paths; correlation requires exact unambiguous task identity. Per-project requests are separate snapshots and cannot certify complete external-source coverage. An unfiltered task list observes the global tracker, not every project's source. PR merge and task Done are separate facts.

## Reference-pattern receipt

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: project/thread identity, root ownership and provider selection patterns separate requested configuration from execution. Worktree setup observations are not durable execution receipts. Orchestra adapts those distinctions to project, WorkItem and snapshot fields; it deliberately does not manufacture equivalent thread/run/worktree identities. T3 has no corresponding CLI command surface used here.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: explicit selectors, owning runtime/host routing, structured observations and separation of accepted input from provider progress. Orchestra adopts explicit backend/project scope and honest observation reporting; installed Orca handles do not address Orchestra tasks. Runtime-bound discovery, terminal send/wait and durable request receipts remain unavailable.

Detailed inspected source paths and behaviors are recorded in [CLI observation handoff](ade-cli-observation-handoff-2026-10-04.md), [CLI/workspace reference](ade-cli-workspace-reference-2026-10-04.md), and [two-reference terminal review](ade-terminal-workspace-reference-2026-10-04.md). Neither reference inspection nor passing reference tests establishes Orchestra E2E reliability.

## Independent verification

- Native Windows `go test ./internal/cli ./cmd/orchestra`, `go vet ./internal/cli ./cmd/orchestra`, and executable build/help passed. HTTP fixtures exercise authentication, exact identity, ambiguity rejection, project validation, filtering, redirects, response shape/size, cancellation, and redaction. See the observation handoff for coverage.
- The staged executable independently queried the running native audit backend at `http://127.0.0.1:4014`: status, project list and global task list each exited 0 with schema version 1 and correct declared scope. Snapshot showed zero running/retrying entries, zero registered projects and zero tasks. This verifies live authenticated observation of an empty catalog; it does not verify populated hosted tasks or live provider execution.
- Skill-creator validation passed for both repository and installed copies, using UTF-8 mode on Windows. All three installed files match the canonical repository files. `git diff --check` passed.
- An independent agent evaluated six supplied-fixture requests without network calls or mutations: ambiguous #42, pause/worktree inspection, task creation with model/budget, PR merge-to-Done, terminal continuation, and all-project/runtime inspection. Initial evaluation identified authentication and aggregate-scope mismatches; both were corrected and independently rechecked. Final skill also clarifies profile selection, status correlation and snapshot completeness. This is a decision-guidance evaluation, not execution evidence for those unsupported actions.

Evidence: [live observations](evidence/ade-orchestra-cli-2026-10-04/live-observations.json) and [working-tree source hashes](evidence/ade-orchestra-cli-2026-10-04/source-hashes.json). Source hashes identify this uncommitted implementation snapshot; no new commit is claimed. Credentials and account settings were not written to evidence.

## Remaining work

Typed task mutation commands need consistent project/source routing, explicit effect semantics, request identity and reconciliation before dispatch/worktree/terminal orchestration can be exposed. Windows interactive PTY, populated multi-source observations, provider turns, restart recovery, and complete ADE workflows remain separately unverified. No new full-suite or race certification is claimed for this slice.

Update the canonical skill and task reference whenever executable commands or shared task behavior change. `AGENTS.md` now carries that maintenance requirement. Refresh the installed copy from validated repository files after subsequent edits.
