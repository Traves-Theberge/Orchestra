# CI cost controls

Desktop smoke verifies relevant pull requests and changes merged to main on Linux. A weekly Monday 07:00 UTC Linux run checks dependency drift. The previous daily Linux/Windows matrix consumed runner minutes even without code changes.

For Windows acceptance, manually run **orchestra-desktop-smoke**, select the branch and enable **native**. This adds Windows to the Linux matrix, including the native backend and Electron smoke checks. It does not publish a release. A Linux pass does not prove Windows acceptance; explicitly request native validation before a release or after platform-specific changes.

Jobs time out after 20 minutes, superseded runs cancel, and diagnostic reports expire after three days. Download needed evidence before expiry. Dependency security and binary protection workflows remain enabled.

Run the cost-policy regression from `apps/desktop` after installing its dependencies:

```sh
node --test scripts/ci-budget.test.mjs
```

The contract verifies the schedule and opt-in native matrix, not actual native execution. Review account billing and observed workflow runtime after deployment; savings depend on development volume. Do not compensate for reduced automatic coverage by dispatching native validation after every merge.

The workflow's existing path filters can leave a required check pending on unrelated PRs. If branch protection is introduced, use an always-running lightweight gate or revise those filters before requiring this check.

## Security failures found during rollout

The first cost-control PR run exposed existing dependency-security failures: npm reported 20 findings at the unchanged low threshold, and backend scans reported reachable Go/toolchain vulnerabilities. The tracked desktop PNG icon also failed the binary policy because its path was absent from the allowlist.

Desktop dependencies now use patched MCP SDK, KaTeX and concurrently versions, with scoped typography selector-parser and Electron downloader proxy overrides. Regression fixtures exercise the KaTeX inherited-option issue, Markdown math rendering and proxy bootstrap compatibility. A clean install and audit reported zero npm vulnerabilities; renderer tests passed 1,168 cases (two skipped), and typecheck/build passed. Native packaging was not run by those checks.

Backend/TUI toolchain declarations and the root workspace use Go 1.26.9; backend x/net uses 0.60.0. Windows/Linux backend scans found no reachable or imported-package vulnerabilities. An unused required-module advisory for unmaintained x/crypto/openpgp remains outside the imported package graph. TUI Linux scan, build and test compilation passed; Linux test execution needs a Linux host. The concurrent Windows backend suite stalled after timeout/file-lock failures; both affected packages passed isolated serial reruns. Do not report that initial full suite as passing.

Binary protection allows only the exact tracked desktop icon path when its MIME type is image/png. Its regression checks accept that asset and reject an unexpected binary and a non-PNG binary substituted at the allowed path. MIME detection is not full image validation. The policy regression runs before the repository scan; other binary paths remain blocked.

To investigate a recurrence, run the dependency fixtures and audit in apps/desktop, govulncheck in each Go module, and scripts/check-binary-protection.test.sh followed by the full scanner. Preserve failure reports before retrying. Do not lower security thresholds or broadly allowlist asset directories to obtain a green run.

## Windows backend test failures

Run 38175135983 passed Linux backend/race checks but exposed Windows failures in checkout identity, checkpoint containment, archive admission and HTTP rewind fixtures. Windows temporary paths can contain 8.3 directory aliases while Git and `EvalSymlinks` return long names. Resolve existing ancestors before hashing checkout IDs or comparing containment, including when the final store directory does not exist. Archive admission still requires an absolute CWD and the selected workspace identity; compare its resolved path to the admitted checkout. Fixtures asserting canonical output must construct canonical expected paths rather than relax the assertion.

The ignore checker must reject an already-cancelled context before reading buffered pipe replies. Git for Windows may launch a child that retains its pipes after the launcher is killed. Process-death fixtures must close stdin and wait for termination before testing the fallback; waiting without closing stdin can hang on that surviving child.

Rewind fixtures can spend enough time in Windows checkpoint work to exhaust the real per-IP token bucket through repeated status polls. Use distinct transport peers for observation polls and keep the dedicated rate-limit tests and production limits unchanged. A 429 during polling does not establish a rewind failure.

Local Windows verification passed the complete workspace (4.800s), lifecycle (6.359s) and checkpoint (35.839s) packages, affected API and rate-limit tests (9.457s), catalog path test (1.724s), and archive tests (5.485s). The backend executable build passed. An intermediate checkpoint run stalled while testing process death and was stopped; the fresh full package passed after stdin closure was added. The entire backend suite and Linux/race checks still require verification on the repaired head; this Windows host has no C compiler for local Go race mode.

For a recurrence, preserve the hosted job log, filter for `--- FAIL:` and rerun those names with `go test -p 1 ./internal/<package> -run '<test name>' -count=1`. For checkout/store failures, compare the original path, `filepath.EvalSymlinks` result, and nearest existing ancestor. For a stalled pipe test, inspect surviving Git launcher children before retrying. Do not skip platform tests or raise timeouts to hide these differences.
