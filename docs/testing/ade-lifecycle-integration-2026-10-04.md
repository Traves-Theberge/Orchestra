# Lifecycle integration status and remaining acceptance work

## Integrated

Task retention [#174](https://github.com/Traves-Theberge/Orchestra/pull/174)
and anchored review submissions [#175](https://github.com/Traves-Theberge/Orchestra/pull/175)
are merged to main. Their [retention receipt](ade-task-board-retention-2026-10-04.md)
and [review receipt](ade-pr-review-commit-2026-10-04.md) record pinned T3/Orca
observations, adaptations, failures found during review and independent passing
checks. These supersede the corresponding open items in earlier audit receipts;
they do not complete the full ADE lifecycle package.

At integration, GitHub reported no open PRs and zero open Dependabot alerts.
Only main remains locally and remotely after verified source comparisons and
merged-branch cleanup. The older ADE branch matched its #173 squash source
exactly. No unique branch changes were discarded.

## Next executable slices

Each slice must inspect both pinned references under the
[reference registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md)
before implementation and record its own behavioral evidence.

| Priority / area | Implementation and acceptance gate |
| --- | --- |
| Task finalization and publication | Resolve task-owned repository/worktree/branch; remove shared-root fallbacks and implicit history rewriting. Require successful ordinary publication before reporting fresh PR content. Inject divergent remotes, missing worktrees and failed pushes; keep failures visible without claiming delivery. |
| Stop/delete retention | Audit explicit stop/delete and cleanup hooks independently. Separate stopping execution from deleting unpublished/ignored Git work. Verify dirty, ignored, missing and foreign-owned checkouts with real temporary Git fixtures. |
| Durable sessions and retries | Persist waiting retries, mutation receipts and immutable launch identity/configuration. Reopen after each admission/dispatch/settlement boundary and reconcile unknown outcomes without duplicate execution. Test upgrades against an owned copy of persisted data; preserve user account homes. |
| Settings, harnesses and usage | Trace registered harness discovery through provider/model selection to actual CLI launch. Distinguish requested from verified effective settings; enforce supported policy/budget options. Run isolated provider canaries and reconcile usage/reset observations against the same session identity. |
| PR and tracker workflow | Fence repository configuration revisions and reconcile hosted checks/approvals before completion. Verify project-specific GitHub, Linear, Azure and Jira routing without global fallthrough, including permissions, reconnects and duplicate events. Exercise a disposable issue-to-worktree-to-PR-to-review scenario per supported integration. |
| Automations | Persist schedule occurrences and deduplication identity. Test restart, missed occurrence, cancellation and blocked-provider recovery with controlled time; verify UI/API/CLI show the same outcome. |
| Native UI and workspace audit | Walk every page/tab through loading, empty, error and recovery states. Verify chat/terminal/file-pane resizing, registered-provider selection and workspace restoration in Electron. Fix and independently exercise the Windows Studio bridge socket-path failure observed in native CI. |
| Trusted Windows launch | Acquire the user-selected personal-name hardware-token certificate, verify its trusted signing identity, then sign/timestamp and verify every packaged executable/native sidecar. Test the actual signed artifact under Smart App Control without changing policy. Certificate purchase/identity verification and real signed launch remain external prerequisites. |

Native Electron CI establishes renderer/preload/managed-backend startup and
navigation. It does not establish trusted installation, real provider turns,
full session recovery or the complete hosted task lifecycle. Existing signing
scripts and unsigned artifacts cannot substitute for that final signed launch.
