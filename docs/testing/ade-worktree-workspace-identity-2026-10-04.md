# Exact Git workspaces and background creation handoff

## Reference observations

Pinned T3 Code revision: `737993303d36e10674c54b95e5bd3826682c99c7`. Inspected `apps/server/src/mcp/WorktreeMcpService.ts` and its tests, plus selected workspace path handling. Its handoff checks absolute project paths, active thread/project binding, repository availability, existing branches and base references before creating a worktree; subsequent thread binding remains distinct from checkout creation. Tests cover unavailable/archived threads, occupied branches, create failure and binding races.

Pinned Orca revision: `3284b4c70c901402831bb4ccc5576ea083d2e5ae`. Inspected `src/main/git/worktree-create-preparation.ts`, `worktree-create-git-executor.ts`, `worktree-create-preparation-real-git.test.ts`, `worktree-created-disk-witness.test.ts`, runtime path selection and host-qualified workspace metadata. Orca separates Git preparation/materialization from agent/session attachment, pins a settled base commit, uses request-owned preparation locks and verifies checkout identity. Its tests use real Git for materialization and hook ordering; witness tests distinguish conflicting object stores from unreadable evidence. Path/host/session identities are qualified rather than guessed from branch names.

## Orchestra adaptation

`internal/workspace` exposes project-qualified stable IDs derived from canonical Git-registry paths. `primary` means the registered checkout; `is_main_worktree` separately marks Git's main checkout. Explicit `workspace_id` project Git requests resolve against the current authorized registry and reject missing, stale or cross-project IDs without falling back to primary. The client carries the same scope to project chat requests; GitHub PR identity and worktree inventory remain project scoped.

`POST /projects/{project_id}/worktree-jobs` records a canonical UUID and immutable request payload before background setup. `GET .../{request_id}` reads the same receipt. Two Git jobs may run concurrently, with at most 32 pending jobs and a two-minute setup deadline. Creation validates a new branch and absent destination, resolves the chosen base reference to a commit SHA, records the checkout boundary, then creates one isolated worktree with a request-owned Git lock. Completion requires exact project/path/branch/head/lock and a clean tracked checkout. The completed receipt is durable before unlocking. Process interruption becomes `unknown`; recovery observes an owned clean lock without repeating Git creation.

Creating a workspace does **not** create a Kanban task, enqueue execution, start an agent or send a prompt. Provider/model values are requested metadata; the API validates enabled provider inventory when supplied. An optional existing task ID requires exact owning-project validation. Native conversation creation belongs to the separate explicit dialog integration after confirmed checkout completion.

## Deliberate deviations and limitations

This package supports local Windows/local Git only. It does not implement Orca remote hosts, speculative preparation pools, automatic fetch, setup hooks, or destructive failed-setup cleanup. Git hooks are disabled for creation and existing paths are preserved. References must already resolve locally; a remote-tracking reference is not evidence of a fresh fetch. Unknown outcomes retain their destination and require receipt reconciliation.

Workspace IDs survive backend restart, branch changes and application updates because project plus canonical path is stable. They are not incarnation UUIDs: deleting/replacing a repository at the same registered path is not independently detected. External concurrent filesystem/Git mutation is not transactionally isolated. A checkout that loses its ownership witness before an interrupted receipt is confirmed remains unknown. Completed but subsequently unavailable workspaces are reported without an openable workspace object. No hosted GitHub/provider or full desktop E2E claim follows from these tests.

## Behavioral verification

Native Windows disposable real-Git and SQLite tests passed for exact base SHA creation, unchanged primary branch/head, zero issue/session side effects, UUID replay and payload conflicts, existing destination/branch protection, unavailable base rejection, exact existing-task validation, and restart reconciliation accepting only the request-owned clean lock. Production HTTP router verification passed POST 202, polling to a real checkout, scoped Git access, durable replay, unknown-field rejection and cross-project receipt rejection. Added both job routes to bearer-auth coverage (189 enumerated routes).

The workspace resolver tests passed exact linked-checkout stage/history behavior, distinct registered versus main checkout, allowed-root/cross-project rejection, and stale-workspace rejection without primary fallback. Desktop typecheck and the client/Git suite passed: 146 tests across 17 files. Client coverage verifies Git/chat scope, unscoped inventory/hosted PR requests and retained creation UUID/payload. Native dialog rendering and signed-in provider delivery require separate verification by the integration owner.
