# Diagnostics usability and CLI implementation plan

> Coordinate the independent backend metadata and CLI work through the dispatching-parallel-agents workflow; execute UI and integration checks inline; existing user authorization covers implementation and verification. Do not commit or publish.

**Goal:** Make diagnostics understandable to users and inspectable by the Orchestra CLI, then verify the actual Windows packaged runtime.

**Architecture:** Preserve the existing metadata-only recorder and authenticated read APIs. Add typed HTTP protocol evidence at the backend boundary and shared descriptions; keep historical missing fields absent. Improve renderer presentation. Add a read-only CLI command family using the established origin/auth/redaction/versioned-envelope contract.

**Files:** renderer `presentation.ts`, `DiagnosticsPage.tsx`, `RunInspector.tsx`, `TraceWaterfall.tsx`, and `EvilChartsMetrics.tsx`; CLI `diagnostics.go`, behavioral tests, existing dispatch/help; both authored and embedded CLI skill/reference copies; verification receipt and smoke harness.

- [x] Correct HSL chart colors, replace the default tooltip with the app tooltip, widen EvilCharts grid bars, display measured totals, and verify dark/light rendering without external assets.
- [x] Explain views, counts, statuses and fixed operation/event names. Classify HTTP events without task identity as API activity; keep exact identifiers available in technical details. Preserve raw accessibility identities for existing inspector interactions.
- [x] Write failing CLI tests for authenticated route selection, exact trace identity, bounded filters, unavailable/old backend, credential redaction, malformed/oversized responses, and a read-only collection-health check.
- [x] Implement `orchestra diagnostics overview|traces|trace <trace-id>|logs|settings|export|check [--json]`. Filters: project/task/provider/status/severity/search/since/until/limit/offset; enforce command-specific flags and API bounds. No mutations, automatic discovery of credentials, or network redirects.
- [x] `check` observes settings and overview: enabled/disabled collection, dropped records and queue/storage health. Report disabled collection or historical gaps explicitly; availability is not proof of successful execution. Missing routes/auth/store fail nonzero.
- [x] Run CLI tests/build/help and actual CLI against an isolated authenticated backend; update skill and embedded instructions only for executable commands. Existing pinned Orca/T3 observation patterns remain applicable: retain exact identity and conservative outcomes, do not infer execution from snapshots.
- [x] Rebuild Windows verification package from stable inputs. Verify archived scripts before launch, then run production main/preload/renderer with bundled backend and isolated profile. Record precise failures and passing evidence.
- [x] Run focused desktop tests/typecheck/build, real browser smoke and Electron smoke. Update the verification receipt with results and remaining limits.

Verification: authenticated production browser and CLI smoke passed; dark/light chart screenshots inspected, no negative initial-size warnings; focused desktop tests and typecheck/build passed. Windows archive integrity and isolated packaged runtime launch passed; release installer remains outside verification scope.

- [x] Record typed HTTP method/route-template/status/duration and shared label/description at the backend boundary; preserve honest missing historical fields and avoid protocol inheritance into child operations.
