# Windows ADE baseline receipt

Status: build and startup verified on this working checkout; package 00 remains in progress. This is not task-lifecycle or release certification.

## Environment and scope

- Base revision: `bea2d11f3dfb1b59a37db04405c38b7dedddc0e8`, with uncommitted baseline fixes and planning documents. Results apply to this dirty checkout, not the unchanged revision or a fresh clone.
- Windows amd64; Node `v24.19.0`; Go `go1.26.7 windows/amd64`.
- API and Electron checks use disposable home/database directories. No real provider was launched and no hosted PR was created or published.
- Linux/macOS runtime verification and the new CI matrix have not run in this session.

## Reference receipt

The [mandatory reference registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md) pins T3 Code `737993303d36e10674c54b95e5bd3826682c99c7` and Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`. For this baseline, T3's `ProviderAdapter.ts` and Orca's `agent-project-model-override.ts` were re-inspected. Runtime inspection of those reference applications was unavailable.

T3's typed provider boundary informed the restored embedded assistant tools: arguments are validated and existing typed API operations own their effects. Orca's native filesystem handling and distinction between discovered and effective configuration informed native home/path handling and explicit capability limits. These are adapted patterns; no reference implementation was copied and reference tests do not prove Orchestra behavior.

No portable credential-writer equivalent was established in the inspected sources. Orchestra independently uses atomic replacement, restrictive Unix modes and explicit Windows ACLs. Native Windows agents use subprocess execution with child-tree cancellation; interactive PTY sessions return an unsupported capability error until ConPTY is implemented. Git for Windows supplies the shell prerequisite; WSL aliases are not accepted as native shell support.

## Fixes and results

| Boundary | Observed result |
| --- | --- |
| Missing embedded orchestration tools | Restored read/create/update/stop/project/agent tools; four boundary tests cover validation, payload preservation and backend errors. Source is no longer hidden by the binary ignore glob. |
| Backend compilation/config writes | Removed Unix-only handler assumptions; atomic private writer has creation/replacement/failure coverage. Native Windows build passed. |
| Shell, paths and logs | Git shell resolution, spaced executable paths, process-tree cancellation, Git path normalization and live hardlink log fallback verified by backend tests. |
| Full backend | `go test ./...` passed; [captured output](evidence/ade-baseline-2026-10-03/backend-tests.txt). `go build -o orchestrad.exe ./cmd/orchestrad/` and `go vet ./...` passed. Three added shell-helper tests also passed after the full run. |
| Desktop | Typecheck passed. Full Vitest run: 66 files, 477 tests passed, two existing migration tests skipped. Final App smoke rerun after the refresh-ref fix: 27 passed, the same two skipped. Production build passed. |
| Native Electron | Production renderer, actual preload bridge, managed backend, authenticated state request, local images and console-error checks passed. [Launch screenshot](evidence/ade-baseline-2026-10-03/launch.png). Relative asset URLs, data-font CSP and Windows Electron environment handling fixed. |
| API smoke | `npm run smoke:ops:go` passed. This verifies API operations only, not agent execution. |
| Evidence gate | Two Node tests passed. Missing/empty/malformed/stale/failed/skipped/wrong-revision reports fail closed. `npm run release:gate` failed as expected because qualifying reports do not exist. No release pass is claimed. |
| Lint | Follow-up passed: 0 errors, 130 warnings; full renderer suite now 68 files / 481 passed / two existing skips. See [lint receipt](ade-lint-handoff-2026-10-03.md). |
| Race testing | Blocked locally: race instrumentation requires CGO and no C compiler is available on PATH. Ubuntu race CI remains a required follow-up. |

## Run it

From `apps/backend`, run `go build -o orchestrad.exe ./cmd/orchestrad/` on Windows (`orchestrad` on Unix). From `apps/desktop`, run `npm ci`, then `npm run smoke:electron` for the isolated production startup check. `npm run dev` launches the development UI. The backend must be built before the production smoke; staging alone does not compile it.

The Electron launcher removes `ELECTRON_RUN_AS_NODE` rather than setting an empty value, which still enables Node mode on Windows. The smoke fails on renderer errors, broken images, bridge/state failures or timeout. This checks unpackaged production assets using the real Electron main process; an installed distributable still needs separate validation.

## Test isolation incident

The first newly unblocked API test run set `HOME` but not Windows `USERPROFILE`, causing native home discovery to reach global provider files. Subsequent runs set both in an API-wide `TestMain` fence and per-test fixtures; GitHub CLI credentials are also isolated. The first run affected legacy Claude/Gemini settings and several fixture resources under Claude/Codex/OpenCode/shared skill locations. Prior contents are unknown, so no speculative restoration or deletion was attempted.

The user now uses Antigravity. Its installed extension uses an Antigravity-specific directory under `.gemini` and separate roaming IDE settings; this inspection does not establish whether another component consumes legacy Gemini settings. No Antigravity configuration file was identified as directly modified by the tests. Impact remains unresolved. A private manifest and copies of ten known affected files are retained at `%LOCALAPPDATA%/Orchestra/diagnostics/baseline-2026-10-03`; their contents are not included in the repository. Older backups have not been substituted for current settings.

## Next acceptance boundary

Build an isolated repository/provider fixture and walk Backlog creation, explicit assignment/admission, planning, execution, review and revision while recording task/run identity and actual workspace configuration. Include cancellation and backend restart before claiming reliable lifecycle behavior. Antigravity adapter support must be investigated explicitly; selecting Gemini, Claude or Codex in Orchestra does not demonstrate an Antigravity integration. Then verify persisted PR linkage and the real native chat session boundary, following the reference gate for each package.
