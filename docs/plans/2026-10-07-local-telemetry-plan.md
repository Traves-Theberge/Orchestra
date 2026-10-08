# Orchestra local telemetry and Diagnostics plan

Date: 2026-10-07
Status: Implementation underway; behavioral verification tracked in the implementation plan.

## Objective and constraints

Make task execution, application health, errors, performance, and usage inspectable inside Orchestra. All collection, storage, querying, and visualization must operate within the application deployment. No hosted telemetry service, external analytics, separate dashboard, or separately operated collector/database is required. Telemetry assets ship with the app and must not load remote scripts, fonts, or runtime assets.

This document defines the intended behavior. Repository discovery is recorded in [the implementation plan](../superpowers/plans/2026-10-07-local-diagnostics.md); verified capabilities and remaining limitations are recorded separately from design intent.

## Product design

Add a Diagnostics entry to the existing primary navigation, preserving the Kanban workflow. Use existing Orchestra components, typography, colors, and navigation behavior. The proposed sections are:

| Section | Behavior |
| --- | --- |
| Overview | Queue depth, active workers, recent failures, task timing trends, application resource usage, and telemetry collection health. |
| Runs | Search/filter by project, task, time range, outcome, worker, and provider. Select a run to inspect its timeline and linked logs. |
| Logs | Search structured records; filter by severity, component, project, task, run, and time range. Page historical results and optionally follow live records. |
| Usage | Provider/model token totals and local feature-use counts. Show estimated cost only when usage and a configured rate are available. |
| Settings | Enable/disable local collection, choose retention and storage limits, inspect collection gaps, clear diagnostic history, and export a sanitized diagnostic bundle. |

Add a Timeline tab or equivalent entry in task details, using the same run inspector as Diagnostics. A selected span opens a detail panel with timing, outcome, sanitized attributes, and related logs. Navigating back preserves filters and scroll position.

Overview metrics open corresponding filtered runs or logs where correlation is available. All views distinguish empty history, collection disabled, no filter matches, disconnected backend, expired history, partial instrumentation, and storage/export failures.

Waterfalls support nested rows, collapse/expand, zoom, horizontal navigation, retries, concurrent operations, and keyboard selection. Running operations are visibly marked in progress. Missing provider internals are identified as unavailable; timestamps alone must not imply an unobserved cause. Long tasks combine linked operation traces and lifecycle events rather than requiring a single span to remain open across human waits.

Respect reduced motion, provide textual labels as well as color, and keep frequent updates from stealing focus or shifting the user's reading position. Show the last update time and a paused/live control.

## Architecture

Flow: desktop/backend/worker instrumentation -> backend-owned bounded ingestion -> local telemetry store -> backend query/live-update API -> desktop Diagnostics.

- Use OpenTelemetry APIs and data models for traces, metrics, and logs and W3C Trace Context at owned process boundaries. Pin SDK and semantic-convention versions. Add an Orchestra schema version for custom attributes and persisted data.
- Backend instrumentation can use an in-process exporter into the embedded store. Cross-process collection uses an authenticated application-owned ingestion boundary, with OTLP where appropriate. The desktop must not open the database directly.
- Reuse existing backend transport, authorization, streaming, and persistence patterns after inspection. If existing storage is unsuitable, a dedicated backend-owned SQLite telemetry database is the proposed fallback. Choose based on verified concurrency, migration, packaging, and recovery behavior.
- No Jaeger, Grafana, Prometheus server, or external OpenTelemetry Collector is a runtime dependency.
- Use EvilCharts' Recharts components for metric visualizations, adapted to Orchestra styling. Use a dedicated React timeline for traces and virtualized lists for large span/log sets. Inspect existing dependencies before adding new ones.
- Queries are paginated and bounded. Chart queries return bucketed aggregates rather than all raw records. Live updates use resumable cursors and bounded buffers; reconnects fetch persisted history and disclose unrecoverable gaps.
- Durable task state remains authoritative. Telemetry is diagnostic evidence and must not drive orchestration correctness.

## Recording contract

Record service/component identity, application version, timestamps, and applicable opaque project/task/run/worker identifiers. Trace/span IDs accompany correlated logs. Use standardized attributes when applicable and orchestra.* only for application-specific fields.

Instrument task submission, queue wait, worker startup, agent turn, provider request, tool execution, retry/backoff, cancellation, and result persistence. Attempt spans identify their attempt number and outcome. Record human approval waits as explicit lifecycle intervals. Preserve context across owned boundaries and use trace links for resumed work or separate operations.

Provider requests record request duration and available first-response timing, provider/model, and reported token usage. Unknown values remain unknown. Distinguish actual provider usage from estimates. Cost estimates use explicitly configured, versioned local rates with currency; no automatic remote pricing lookup is required.

Application health includes relevant backend/Electron resource use, connection errors, crashes when locally recoverable, and UI/API timings. Inspect available process APIs before selecting measures. Local feature-use events record meaningful actions without collecting raw user content; failure of telemetry collection must never change the result of the user action.

Metrics use bounded dimensions such as component, operation, provider, and outcome. Individual task/run IDs, raw paths, arbitrary URLs, and error messages do not become metric labels. Define bucket boundaries, units, aggregation windows, and denominator semantics for every displayed metric; percentiles must not be calculated by averaging percentiles.

## Privacy and storage policy

- Exclude credentials, authorization headers, prompts, responses, source code, tool arguments/results, command lines, personal information, and raw filesystem paths by default. Sanitize error text and stack traces before persistence. Enforce an attribute allowlist and value/record size limits.
- Collect into backend-local storage only. In remote-backend configurations, state clearly that diagnostics reside on that backend; do not claim all data is on the desktop machine.
- No automatic outbound telemetry. Export is a deliberate user action, produces a sanitized local file, and performs no upload.
- Proposed initial retention: seven days of detailed spans/logs and thirty days of aggregated metrics, with a configurable 250 MiB telemetry budget. Validate these provisional defaults under representative workloads.
- Bound ingestion queues, attributes, events, and batch sizes. Apply age/budget cleanup to telemetry only. Maintain indexes, reclaim physical storage, and disclose evictions or dropped records.
- Start with full collection of defined high-level operations under storage and queue limits. Trace detail can be sampled later, but collection gaps and policies must remain visible. Unsampled metrics are aggregated independently of retained spans.
- Crash recovery marks unfinished records interrupted or unknown based on evidence; it must not invent completion or success. Monotonic clocks measure local durations; preserve source/received timestamps and identify suspected clock skew across processes.

## Delivery sequence and gates

1. **Repository and reference discovery.** Inspect desktop navigation, task details, worker/provider adapters, backend persistence, transport, logging, packaging, and existing diagnostics. For ADE changes, follow docs/superpowers/plans/ade-2026-10-03/reference-patterns.md and consider both pinned Orca and T3 Code sources. Record revisions, observed behavior, adaptations, deviations, and verification in the package handoff; document when a source has no relevant pattern. Deliver an inspected file-level implementation plan and UI sketches.
2. **Standard and storage foundation.** Finalize the field/event registry, schema versions, ingestion, persistence, correlation, privacy filtering, query contracts, and retention. Verify one instrumented operation persists and can be queried after restart with no external services.
3. **First complete task inspection.** Add Diagnostics > Runs, task Timeline, span details, and linked logs. Instrument a real submission/queue/worker/provider/tool/result path and a failure/retry path. Verify live updates and reopen persisted history.
4. **Metrics and usage.** Add Overview and Usage with EvilCharts. Implement independently aggregated counters/histograms and local feature events. Validate values against controlled executions, including unknown token usage and missing price configuration.
5. **Operational controls and hardening.** Add retention settings, clear/export controls, restart recovery, collection health, accessibility, and large-history performance. Verify telemetry faults do not prevent task execution and packaged assets operate offline.

Each phase includes meaningful backend/desktop tests plus real behavioral checks for the capability it introduces. Repository tests do not replace end-to-end verification. Exact commands and performance budgets follow repository discovery, not assumptions.

## Acceptance criteria

- A packaged installation opens Diagnostics and reads existing local history without network access or separately installed services.
- A real run connects desktop/backend/owned-worker operations through task/run identity and trace context; uninstrumented provider internals are explicitly unavailable.
- A waterfall correctly shows sequential and concurrent work, a failed attempt and retry, cancellation, and an approval/resume interval.
- Linked logs and filter/deep-link navigation resolve the selected task/run/span correctly.
- History survives restart. Interrupted runs and collection gaps are presented honestly.
- Metrics and usage match controlled executions; estimates and unknown values are labeled.
- Seeded sensitive values are absent from the stored data, UI, and exported diagnostic bundle.
- Queue saturation, ingestion/store failure, and disk-budget pressure do not block orchestration. Drops are counted and shown without recursive telemetry failures.
- Retention/clear removes telemetry without changing tasks, conversations, or project data; storage remains bounded after cleanup.
- Representative large histories, keyboard navigation, reduced motion, and reconnect behavior pass measured UI verification.
- Exact builds, smoke checks, screenshots, measured overhead, tested limits, and remaining coverage gaps are recorded in the implementation handoff.

## Reference material

- OpenTelemetry Go: https://opentelemetry.io/docs/languages/go/
- OpenTelemetry protocol: https://opentelemetry.io/docs/specs/otlp/
- W3C Trace Context: https://www.w3.org/TR/trace-context/
- EvilCharts: https://evilcharts.com/docs
- SQLite embedded application use: https://www.sqlite.org/whentouse.html

These references support technology selection, not claims of Orchestra implementation or reliability.
