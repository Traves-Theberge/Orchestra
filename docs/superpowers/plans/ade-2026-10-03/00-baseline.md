# Reproducible baseline

## Mandatory reference gate

Before implementing this package, complete its assigned Orca and T3 Code inspection in [reference-patterns.md](reference-patterns.md). Record pinned source revisions, observed behavior, the Orchestra adaptation, deliberate deviations and acceptance scenarios. Consider both references and document any missing equivalent. Attach the reference receipt and independent Orchestra verification to the handoff; reference code or tests cannot establish our E2E reliability.


Current status: in progress; see the [Windows baseline receipt](../../../testing/ade-baseline-2026-10-03.md) for verified fixes, reference observations, remaining gates and the test-isolation incident.

Requires: none. Outcome: a fresh checkout builds, launches and reports meaningful failures on each declared platform. This package fixes prerequisites; it does not certify task execution.

## Files and boundaries

Existing: `.gitignore`, `apps/desktop/package.json`, `apps/desktop/src/features/embedded-agent/EmbeddedAgentProvider.tsx`, embedded-agent `tools/`, `features/agents/AgentsDashboard.test.tsx`, `features/agents/components/ProjectSelector.test.tsx`, backend `internal/api/agent_providers.go`, `internal/api/unsandbox_config.go`, `internal/agents/command_runner.go`, `internal/terminal/manager.go`, `internal/workspace/hooks.go`, `internal/logfile/`, `internal/utils/git/`, desktop `scripts/release-readiness.mjs`, `.github/workflows/`, existing E2E docs.

Proposed: platform-specific config writer and process-launch helpers with tests; a backend/desktop CI workflow and readiness-script tests. Inspect existing helpers before creating duplicates.

## 00.1 Restore the source dependency

- [x] Search Git history and existing tool families for the missing `createOrchestraTools` implementation. Recover it if available; otherwise implement its required issue/project operations using the existing typed API client and tool registration conventions.
- [x] Test representative read/create/update operations, backend errors and invalid arguments. Do not replace the module with an empty object merely to make the bundle pass.
- [x] Narrow the broad `**/*orchestra*` ignore rule to intended binary/runtime targets. Verify source files remain discoverable and binaries/credentials still remain excluded. Review dependency lockfiles and establish a tracked reproducible lockfile policy without committing unrelated generated files.
- [x] Run desktop typecheck and build. Verify the assistant tool inventory remains consistent with the restored implementation.

## 00.2 Make config writes portable

- [x] Replace process-global `syscall.Umask` changes in HTTP handlers with a reusable writer that creates files with appropriate permissions, writes atomically and preserves an existing value on failure. Use platform-specific implementation where filesystem semantics require it.
- [x] Preserve restrictive Unix permissions. Define Windows access handling explicitly; do not claim POSIX mode bits establish Windows ACL restrictions.
- [x] Test creation, replacement, invalid path and write-failure cases using disposable data. Keep tests independent of the developer's actual credential files.
- [ ] Verify native Windows backend compilation, then Linux/macOS build/test results in their own environment. Do not present cross-compilation as runtime verification.

## 00.3 Fix process and filesystem assumptions

- [x] Inventory `sh`, `/bin/bash`, Unix path expectations, signal handling and PTY assumptions in runners, hooks and terminal manager.
- [x] Select a supported shell/process strategy per OS. Use argument-safe launches; make unavailable optional integrations explicit. Determine whether Windows requires a ConPTY implementation or a clearly documented supported subprocess path for each terminal feature.
- [ ] Replace shell-script test fixtures with portable fixture executables where practical. Do not skip core execution tests on the primary OS to obtain green results.
- [x] Normalize Git-reported paths before comparison. Ensure latest-log lookup has a supported fallback when symlinks are unavailable. Fix config discovery tests to use isolated home directories and platform-correct environment handling.
- [ ] Verify timeout/cancellation terminates child process trees and logs remain accessible on each supported platform. Record terminal functionality separately if an adapter remains unsupported.

## 00.4 Triage desktop failures and establish gates

- [x] Reproduce the two provider-routing and two Global-only selection failures. Check intended behavior against current UI. Fix regressions or update stale assertions with behavior-based tests, without deleting coverage.
- [x] Add CI for backend and desktop code changes, not only TUI paths. Include typecheck, tests and builds; add race testing for higher-risk backend work on supported runners.
- [x] Change release-readiness behavior so a required missing/stale/malformed evidence report fails a release gate. A developer inspection mode can report unknown, but must not return a release pass. Test missing directory, empty directory, bad JSON, failed/skipped scenarios and revision mismatch.
- [x] Reconcile E2E docs to Backlog creation and the actual plan/execute/review states. Mark historical rows unverified instead of retroactively green.

## Validation and exit

From backend: `go test ./...` and `go build -o orchestrad ./cmd/orchestrad/`. From desktop: `npm run typecheck`, `npm run test`, `npm run build`, `npm run smoke:ops:go`; also exercise packaged Electron launch after staging its backend. Run TUI checks when its build/runtime contract changes.

- [ ] Fresh checkout with documented dependencies passes the declared-platform build/test gates.
- [ ] Electron connects to the intended backend; unavailable prerequisites produce a visible diagnostic.
- [x] API smoke passes and is labeled API smoke only.
- [x] Required missing evidence cannot produce release success.

Handoff: exact fixes, platform matrix, launch screenshot/log, remaining unsupported terminal/runtime paths, and commands. Keep existing user data untouched; no migrations or production Git writes belong here.
