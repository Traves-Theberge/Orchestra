# Live ORCHESTRA-2 pipeline audit

## Runtime and scope

Tested committed backend `c60d2ecff2ed39ac415b2e755b92766585876c31` on Windows on 2026-10-05. Built from a temporary Git archive to exclude concurrent working-tree edits. Used the persistent `audit-dev` desktop profile and its authenticated CLI connection at loopback port 4014. Credentials are excluded from this receipt.

- Project: `39a7e6acda65060c5e089cad51657f8e`, `C:\Users\trave\Orchestra`.
- Task: `be05b6fa-cc82-406a-b8d7-b97fa7bd7033`, ORCHESTRA-2, review/report only.
- Replan request: `f312720e-63c8-4d1d-b6f4-9e26a788a9df`.
- Native Codex thread: `01a10ce1-07f1-7e51-80f3-308392612631`.
- Checkout: `%LOCALAPPDATA%\Orchestra\audit-dev\desktop\workspaces\39a7e6acda65060c5e089cad51657f8e\orchestra-2`, HEAD `c60d2ec`.

## Observed behavior

1. The initial task was In Progress, explicitly assigned to `agent-CODEX` with provider CODEX, without a plan, worktree or PR. It did not execute without approval.
2. Exact-state/hash CLI replan returned a completed receipt and Todo admission. This was not an approval request.
3. The worker created its actual Git worktree. Its first Codex process failed before planning because the user's `git-safety.rules` contains invalid Starlark. Global settings and rules were not edited.
4. To continue testing, the owned app processes were restarted with a separate audit `CODEX_HOME`, containing a copy of current auth only. This tests an isolated configuration; it does not prove that the user's normal provider configuration now works. Global agent skill discovery still occurred; one unrelated malformed skill generated a warning.
5. Codex started a real native thread/turn and produced an eight-step review plan. A combined read-only PowerShell inspection was rejected by Codex execution policy. The plan acknowledges that limitation; repository inspection was not verified by this planning turn.
6. The plan was persisted in Todo with `plan_gate.status=awaiting_approval`, hash `29d87cd05614013af98b4ce885fc2bf531716dd544c53c488ec8f3c2a88cf9ca`. No approve-plan request was sent. No implementation, commit, push or PR came from the task.
7. Restarted the owned desktop/backend processes again using the same saved app profile. The exact plan hash, full 1,639-character plan, Todo state, feedback, worktree and completed mutation receipt remained readable. After restart the runtime reported zero running and zero retrying workers. Git status in the task checkout was clean.

## Findings and remaining verification

- **Provider retry defect:** after repeated Codex failures, retry metadata selected ANTIGRAVITY despite the task's explicit CODEX provider. Investigation traced this to generic retry rotation; see the separate retry identity handoff. The isolated restart subsequently dispatched CODEX. This must be fixed rather than treated as provider equivalence.
- Workflow prompt loading warned that relative `WORKFLOW.md` was missing in the managed backend cwd and used a fallback. Planning gates still held, but configured workflow loading needs separate verification.
- A separate native Codex read-only probe (`01a10ce3-2225-7fa3-86e9-66d93d5e7363`) attempted only `Get-Content -LiteralPath AGENTS.md`. It was also blocked by policy. Splitting combined commands is therefore insufficient. Process exit zero and a completed turn do not establish successful repository access.
- Native turn usage recorded input 35,483, cached input 29,952, output 410. `control status` after restart reports zero totals; this receipt does not interpret runtime snapshot totals as durable usage history.
- T3 browser preview loaded the web renderer but it used its browser default port 4010 and had no valid connection token. That unauthenticated browser view is not evidence for the authenticated Electron UI. No token was entered into preview arguments or URLs.
- Approval-to-execution, PR creation, reviewer findings/replanning, human PR approval, completion, concurrent tasks and other harnesses remain **unverified in this live journey**. Do not approve the incomplete plan automatically to claim an E2E pass.

## Fix validation

Removed implicit retry provider rotation and added an explicit-provider failure/release/dispatch regression. `go test ./internal/app ./internal/orchestrator` passed. Independently ran `go test ./internal/control ./internal/plangate` against the committed source archive; both passed. Built the committed backend plus the retry fix and restarted the same audit profile with that binary. This does not retest a real failing provider sequence on the new binary; the retry fix's behavioral evidence is the regression test, separate from the earlier live defect observation.

## Reference pattern receipt

Baseline references are T3 Code `737993303d36e10674c54b95e5bd3826682c99c7` and Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, as recorded in the mandatory source registry. T3's typed provider/session/turn identities and finalization boundaries motivate observing exact native events and checkout identity. Orca's mutation identity and scoped dispatch journal patterns motivate retaining the same request receipt and distinguishing admission from observed dispatch. Orchestra deliberately uses a SQLite task/plan approval gate and preserves Kanban Todo while waiting for a human. Neither reference source nor unit tests establish this runtime result. This receipt adds independent, partial Windows runtime evidence; it does not certify the complete pipeline.
