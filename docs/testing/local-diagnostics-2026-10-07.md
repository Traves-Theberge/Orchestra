# Local Diagnostics verification receipt

Status: integrated and behaviorally verified, including an isolated Windows packaged runtime. This receipt does not certify a release installer.

Scope: built-in backend-local metadata collection, persistence, authenticated
queries, retention/settings, Overview/Runs/Logs/Usage, task Timeline, and waterfall.
Plan: [implementation plan](../superpowers/plans/2026-10-07-local-diagnostics.md).

## Independently observed checks

| Check | Observed result |
| --- | --- |
| `go test ./internal/diagnostics -count=1` | Passed after review fixes, 3.094 s. |
| `go test -p 1 ./...` (backend) | Passed final complete suite. API 83.044 s; app 23.483 s; chat 16.053 s. Full output in the local evidence directory. |
| `go build -o orchestrad.exe ./cmd/orchestrad` | Passed after final lifecycle fixes. |
| `go vet ./internal/diagnostics ./internal/api ./internal/workspacechat ./internal/app` | Passed. |
| `npm test -- --maxWorkers=2` | 136 files passed, 970 tests passed, 2 skipped; 117.51 s after UI review fixes. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; standard existing chunk-size/Vite configuration warnings. |
| `node scripts/diagnostics-smoke.mjs` | Passed real backend/production renderer: auth/defaults, reused native turns, concurrent spans/logs, approval/cancellation/failure, exact 30/36 reported token totals, sanitized export, disabled collection, restart persistence, paused refresh, retained navigation, severity paging, task Timeline, and clear preserving conversation history. External renderer requests blocked; zero attempts and zero renderer errors. |
| `node scripts/launch-electron.mjs scripts/electron-smoke.cjs --diagnostics` | Passed production renderer/preload/managed backend with external requests blocked; screenshot captured in the isolated profile. |
| Existing authenticated operations smoke | Passed against spawned isolated backend on port 4012, including SSE, auth, missing/method/media errors and workspace controls. |
| Diagnostics/App lint | Zero errors; nonblocking existing/fast-refresh/TanStack warnings. Full lint still fails on two unchanged HTML-rendering files. |
| Real installed Codex startup | Codex CLI 0.161.0 `initialize` and `account/read` passed with an isolated unsigned-in profile. No model request sent. |
| Windows packaged runtime | Passed isolated `electron-builder --dir` runtime using installed Electron 41.10.7, unchanged production main/preload and built renderer, and bundled backend. Actual `app.isPackaged=true`, HTTP metadata and Settings verified; zero external renderer requests. Scope and archive verification below. |

Initial checks exposed unfinished integration, an obsolete navigation selector,
an ambiguous Settings selector, and an incorrect expected clear status (204).
These were resolved and the full smoke rerun passed. Existing shell fixtures
exceeded short timeouts under parallel contention; the final complete backend
suite passed with package concurrency bounded to one.

## Storage and review evidence

The recorder tests exercise inherited IDs, idempotent completion, unknown crash
recovery, clear/disable fencing, credential-like metadata rejection, retention
independent of metrics, 1 MiB budget cleanup, bounded export/detail, 10,000-trace
queries, saturation, actual SQLite write faults, and recovery. Review added
authoritative operation outcomes and consistent log filters, lost-terminal
uncertainty reconciliation, severity filtering before paging, model aggregates,
and schema-v1 migration preserving unknown model identity.

Agent-observed repeated loss/failure/fence tests passed 20 times. Benchmarks:
collection 10.9 microseconds/operation with zero drops over 1,000 iterations;
10,000-trace query 260 ms over 20 iterations under concurrent workspace load.
These are environment measurements, not guaranteed production budgets. The
Windows race detector cannot run here: CGO is disabled and no C compiler is
installed. Deterministic concurrent/fencing tests remain executable.

Review also corrected paused Refresh, retained navigation state, deep collapse,
running duration display, the dropped-counter label, shutdown completion ordering,
failed-clear and disable-generation races, preserved callback generation identity,
and cancelled/unknown outcomes after task finalization discards. Final independent
review reports no remaining Important findings; targeted lifecycle checks passed
three repeated independent runs, with shutdown/callback checks also passing twenty
controller-run repetitions.

Controller benchmark: 13.0 microseconds per collected operation (20 iterations,
zero dropped records); 10,000-trace query 300 ms (20 iterations). Browser synthetic
history check: 10,000 traces paged to 100 records; 1,000-span waterfall rendered
23 DOM rows, with a 110 ms query and 350 ms inspector render in the recorded run.
These seeded traces measure scale, not provider execution. Keyboard selection,
reduced motion, and the actual task-detail Timeline were exercised in the browser.

## Reference pattern receipt

Both pinned reference revisions and observations are recorded in the
implementation plan. Orchestra adapts correlation/attempt identity and honest
pending/unknown outcomes; it uses a Go OTel provider and SQLite rather than the
references' runtime implementations. Source inspection establishes patterns only;
the checks above independently exercise Orchestra. Neither reference application
was run in this environment. Associated pinned T3 `CodexAdapterV2.ts` and tests
were additionally inspected: queued acknowledgement differs from started work;
explicit completed/interrupted/failed/cancelled terminals retain provider and run
identity. Orca mutation and journal implementation/tests retain retry request IDs,
delivery uncertainty, and fence-specific latest observations. Orchestra adapts
these patterns without changing dispatch authority or retrying actions in telemetry.

## Evidence and boundaries

Local evidence: `.superpowers/sdd/2026-10-07-local-diagnostics/evidence/` contains
`smoke.json`, `backend-full.log`, API test output, local sanitized export, and
Overview/waterfall/large-waterfall/task-Timeline screenshots. Screenshots were
visually inspected. Raw evidence contains synthetic project paths and belongs
to the test harness; the diagnostic export itself excludes those paths.

The renderer uses five-second bounded polling rather than a new resumable stream;
history remains queryable on reconnect. Timelines use positioned DOM bars rather
than SVG, with TanStack virtualization and keyboard controls. Backend resource
statistics report heap and goroutines, not unobserved CPU or Electron process
statistics. Cost estimates and hidden provider internals remain unavailable.
Detailed project/task filters use retained detail, while unscoped metrics survive
detail expiry; hourly aggregates are displayed as daily chart buckets.

TUI tests cannot compile on Windows because existing `manager.go` uses Unix-only
`Setpgid`/`syscall.Kill`; no TUI files were changed. Repository-wide lint errors
in unchanged `HtmlRenderDocument.tsx`/`HtmlRenderFrame.tsx` predate this change.
Race detection remains unavailable without CGO/a C compiler. These do not certify
untested operating systems or live external provider inference.

The user requested removing chart attribution from product UI. It is absent from
Diagnostics; the full MIT notice remains in source and bundled
`dist/licenses/evilcharts.txt`.

Provider fixture executions exercise actual owned processes and protocol
boundaries. They do not certify live model inference or unavailable provider
internals. Real installed Codex evidence above covers local startup only.

The packaging artifact uses the smoke entrypoint to isolate the profile, then
requires the unchanged production main. Initial archives failed because the test
harness changed during archive creation, truncating its payload; this was a
verification artifact defect. The final build uses stable copied inputs and
verifies exact bytes and JavaScript syntax for the harness and all five production
Electron scripts before launch. A scoped selector error in the harness was also
corrected; production Settings controls were present.

To avoid copying unused browser dependencies, the final runtime verification
package was built from an isolated staging directory containing the unchanged
production Electron files, built renderer, license, and bundled backend. Its
package metadata has an empty dependency manifest and a smoke entrypoint; no
shipping configuration or production runtime code was changed for this staging.
This verifies packaged runtime behavior, not release dependency packaging or an
installer. No installer was installed, published, or certified.

## October 8 descriptive evidence and usability refinement

The running development backend was refreshed to the new build after observing
no active tasks; project identities were preserved. Settings, overview and trace
endpoints return 200. A fresh real GET /api/v1/state records method GET, route
template /api/v1/state, status 200, measured duration and shared label/description.
Older records retain absent HTTP fields; no historical protocol evidence is
invented. Raw paths, query strings, headers, tool arguments and results remain
excluded. HTTP metadata stays on its request span rather than leaking into child
operations. Non-task requests show API activity; HTTP details omit unrelated
provider/model/token fields and blank correlation rows.

The backend emits human-readable label/description fields for fixed lifecycle
operations, available through lists, detail, exports and CLI JSON. The read-only
CLI diagnostics family supports overview, traces, exact trace, logs, settings,
export and collection check. Actual authenticated CLI smoke verified all seven,
HTTP descriptions and fields, and disabled collection after restart. Availability
does not imply successful task execution (execution_verified remains false).
Both authored and embedded CLI skills/reference files are synchronized.

Production browser smoke passed with real local backend and built renderer:
HTTP metadata, actual owned provider fixture processes, reused turns, approval,
cancellation, failure, exact 30/36 token totals, privacy/export, disable/restart,
refresh/navigation, 10,000-trace paging, 1,000-span virtualization, task correlation
and clear preserving conversations. Zero external renderer requests and zero
renderer errors. Dark/light screenshots were visually inspected: colored grid
bars and themed tooltip; no initial width(-1)/height(-1) chart warnings observed.
Focused desktop tests passed (21 cases, plus the added HTTP applicability case
in the six-case waterfall suite); TypeScript and production build passed.

Pinned reference continuity: T3 Code 737993303d36e10674c54b95e5bd3826682c99c7
provider adapter event boundaries and Orca 3284b4c70c901402831bb4ccc5576ea083d2e5ae
mutation/journal identity and uncertainty patterns were considered. The cached
reference slices contain no matching human-description registry or diagnostic
CLI family; typed HTTP capture and descriptors are an Orchestra adaptation.
Behavior was independently tested; reference code is not E2E evidence.

Fresh refinement backend checks passed with bounded package concurrency: diagnostics 4.646 s, API 105.035 s, CLI 2.030 s, command 10.464 s. The newly added HTTP applicability regression passed in the six-case waterfall suite.

Final Windows runtime evidence: electron-builder --dir exited 0; all archived production scripts and harness matched source bytes and parsed successfully. Generated Orchestra Desktop.exe launched with --require-packaged, reported packaged=true, localSettings=true, bundledUI=true, GET /api/v1/state HTTP200 with measured duration, externalRequests=0, renderer bridge/state=true, and ELECTRON_SMOKE_PASSED (isolated profile orchestra-electron-smoke-wliuxx).

Windows startup console follow-up: background OMP usage/version and provider credential probes now use a native CREATE_NO_WINDOW launcher; Electron managed-backend spawn sets windowsHide. A Windows subprocess regression reproduced console inheritance before the change and passed after it while preserving captured output. Fresh backgroundcommand, harnesssetup, usage tests and vet passed; managed-backend Node tests passed16/16 and main.cjs parsed. The live backend was rebuilt/refreshed with project identities preserved; actual usage refresh returned HTTP200 and OMP status ok. No unrelated interactive OMP sessions were terminated. This follow-up does not claim a newly built release installer.

Development console follow-up (2026-10-08): a fresh Vite development renderer
against the user's local backend rendered one chart SVG with zero sizing warnings,
including Overview → Runs → Overview navigation. The previously reported stack
references an earlier hot-reloaded chart implementation; no further chart changes
were required for this reproduction.

The event-stream reset reproduced independently: over 45 seconds the browser
observed two opens and one error. The global REST timeout cancelled healthy SSE
subscriptions after 30 seconds. Live GET /api/v1/events now preserves client
cancellation and caller deadlines without adding the REST deadline. Other requests,
including once=1 snapshot requests, retain the 30-second timeout and existing auth.
The real HTTP regression failed at 30.01 seconds before the fix and passed after it.
The auth matrix now requests a single SSE frame instead of relying on that timeout
to finish its authenticated subscription. Focused event/auth/deadline tests passed
(52.296 s), API vet and backend build passed, and 29 desktop diagnostics/sync tests
passed. Desktop tests emitted existing act warnings in the inactive-view test.
The live backend and staged resource were refreshed with project identities
preserved. A fresh browser observed one open, zero errors and nine snapshots over
45 seconds. Evidence: .superpowers/sdd/2026-10-07-local-diagnostics/evidence/dev-console-followup.json.

Pinned reference review for this HTTP lifecycle correction considered T3 Code
737993303d36e10674c54b95e5bd3826682c99c7 ProviderAdapter.ts event subscriptions
with explicit close, and Orca 3284b4c70c901402831bb4ccc5576ea083d2e5ae
mutation-request.ts bounded unavailable retries preserving request identity.
Neither inspected slice implements Orchestra's HTTP timeout middleware. Orchestra
retains its existing SSE reconnect/polling recovery and Kanban semantics; the local
adaptation scopes the finite REST deadline away from live subscriptions. Reference
runtimes were not exercised; the local behavioral checks above establish the claim.

Message-send console follow-up: the actual OMP RPC session was launched with
plain exec.CommandContext and had an external console host. Closing that console
killed the process that owned the conversation. Native OMP/Antigravity sessions,
model lookups, Codex usage probes, shell commands and their cancellation helpers
now use CREATE_NO_WINDOW; shell process-group cancellation remains intact.
The remaining noninteractive API, Git/workspace, worktree, automation, MCP,
device-login, studio and session-log subprocesses also use backgroundcommand.
Explicit interactive terminal/PTY launch paths retain their existing behavior.

Native Windows fixture turns reproduced console attachment before the change
(OMP exit41; Antigravity failed initialization) and completed after it. Shell
console detection also failed before the fix and passed after it. Fresh focused
shellcommand, backgroundcommand, agents, workspacechat and usage package tests
passed, as did vet and a rebuilt backend. The backend was refreshed only after
checking task and conversation inactivity, preserving project/conversation IDs;
an actual OMP session then reported idle after a completed turn.

The console-owning parents in the new Windows regression checks also contributed
to the user's terminal disruption: CREATE_NEW_CONSOLE with HideWindow can still
be displayed through Windows Terminal. These test parents now use CREATE_NO_WINDOW.
All three console regressions passed again (backgroundcommand 0.987s, agents
2.878s, shellcommand 1.495s). The broader backend suite was interrupted during the
terminal flood and is not claimed passing for this follow-up. The running backend
and test run were stopped with no active turn, and the newly spawned Windows
Terminal host was cleared while older terminal sessions were left alone. A fresh
desktop app list showed no Windows Terminal, and no recent OpenConsole process
remained. The backend remains stopped following containment; rebuilt standard and
staged backend binaries contain the fixes for the next launch.

Reference continuity: the pinned Orca wsl-transcript-fs-process-spawn.ts uses
windowsHide for a piped background helper; T3 Code's pinned cli/uninstall.ts does
the same for its detached Windows cleanup helper, while ProviderAdapter.ts keeps
explicit stream ownership/close. Neither inspected slice exposes Go launch flags.
Orchestra adapts the pattern with CREATE_NO_WINDOW and retains cancellation,
captured pipes, provider conversation identity and Kanban semantics. References
were inspected locally at the revisions recorded above; no reference runtime
verification is claimed.

## Diagnostics UI polish (2026-10-08)

The request explorer now bounds the request list and displays its selected
waterfall beside it on wide screens. Compact layouts stack the inspector below
a short scrollable list. Operation search retains matching operations and their
ancestor path. A five-tick time ruler, separate duration column, status colors,
copyable correlation IDs, and linked span logs support request investigation.
Search, outcome and time presets share one filter bar with removable filter chips,
custom time bounds and a complete reset. Overview, logs, usage and settings use
consistent panels and scrollable tables. Diagnostics is available through Ctrl+K.
Missing historical HTTP metadata and unreported token usage remain explicit.

The new preset/reset and nested-operation-search regressions failed before
implementation and passed afterward. The final full desktop suite passed:
137 files, 976 tests, 2 skipped. TypeScript and the production build passed.
Targeted lint has no errors; existing fast-refresh and TanStack Virtual compiler
warnings remain. The build retains existing chunk-size/dynamic-import warnings.

A live-backend Edge browser check navigated via Ctrl+K, opened all diagnostic
views, selected real request spans, and captured 1440x960 and 1024x900 layouts.
The selected waterfall is visible without scrolling past the complete request
list. All checked views have no horizontal page overflow; the browser recorded
no renderer errors or negative chart-size warnings. Dark and light variants were
captured. Settings/history were not mutated in the live profile.
Screenshots: [overview](screenshots/diagnostics/overview.png) and
[waterfall](screenshots/diagnostics/waterfall.png).

Reference review: T3 Code 737993303d36e10674c54b95e5bd3826682c99c7
ChatComposer controls and ProviderAdapter explicit identities, and Orca
3284b4c70c901402831bb4ccc5576ea083d2e5ae mutation-request retry identity and
source-context-model were inspected. Neither inspected renderer provides a
comparable local trace waterfall. Orchestra keeps its backend-scoped identity,
bounded queries, Kanban semantics and explicit partial-evidence states; the UI
adapts the readable controls and uncertainty presentation rather than copying
reference architecture. Reference runtimes were not exercised; the independent
Orchestra checks above establish the local UI claims, not universal E2E coverage.

Final commit checks also passed for the affected backend packages: diagnostics,
api, app, cli, cmd/orchestra, backgroundcommand, shellcommand, agents,
workspacechat and usage. API checks include the live stream surviving the REST
request timeout. A fresh orchestrad build passed. The temporary visible-launch
helper is intentionally untracked and excluded from the deliverable.
