# Studio admission and Codex usage review follow-up

This addresses PR173 review comments 4179771494 and 4179771506 after the user-authorized merge. No provider credentials were used and no signed-in inference turn was requested.

## References inspected before implementation

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) separates session readiness, turns, terminal failures and context usage. Relevant cases in [ProviderSessionManager.test.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderSessionManager.test.ts) simulate process-exit event streams and failed persistence of stopped/error states. These are source observations, not reference runtime verification. The inspected adapter defines context usage rather than the historical Codex billing import addressed here; its typed identity and failure boundaries remain applicable.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [journal-dispatch-observation.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-session-journal/journal-dispatch-observation.ts) and its tests distinguish pending/accepted/unknown observations within a fence. [codex-usage-token-delta.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/codex-usage/codex-usage-token-delta.ts), with relevant last-token payload fixtures in `scanner.test.ts`, treats measured last-response usage as billing increments, cumulative totals as mutable baselines, and copied raw timestamp/token tuples as duplicates. Its magnitude-based stale-regression heuristic reproduces the review counterexample; Orchestra deliberately removes that heuristic.

## Orchestra adaptation and deliberate boundaries

Studio reserves a single turn synchronously before HTTP202. Unknown sessions receive404, closed/busy sessions409, and sessions without a current backend-owned runner503. Draft/session rows survive runner loss and are not falsely interpreted as a resumed process. Execution remains detached from the HTTP request context. The manager publishes any runner error, including failures occurring before the runner emits an event, followed by completion. It owns error publication to avoid duplicate error events. Production runner binding and cancellation state are inspected under its mutex.

This is an in-memory admission reservation, not Orca's durable write-ahead journal. It provides neither restart recovery of an accepted turn nor replay/idempotent message delivery. Durable existing drafts remain readable; restoring a Studio runner to the same draft is separate work. No UI/API acceptance is described as proof of a successful native provider turn.

Codex measured resets such as prior100/20 to total=last60/10 bill all70 measured tokens and install the new baseline. Explicitly older token-record timestamps are ignored before they can roll back that baseline; same-time distinct payloads remain eligible. Raw timestamp/usage deduplication across copied transcripts is retained. Token sizes cannot establish stale identity. Timestamps provide the observed ordering fence; logs with untrustworthy timestamps remain a limitation.

## Behavioral verification

- Manager failure injection checks a detached admitted turn, concurrent rejection, error-before-completion publication, restart rejection, discarded rejection and missing-session rejection.
- Real HTTP handlers plus SQLite and a fake runner verify404/503/409 before acceptance and preservation of the unavailable session's draft.
- Delta regression verifies the70-token measured reset and the next25-token increment from its new baseline.
- A scanner fixture verifies the measured reset, an explicitly older late record and the following cumulative-only increment, yielding180 input/35 output across3 billable observations.
- Existing copied/resumed transcript fixtures retain their accounting expectations with the stale fixture explicitly timestamped as older.

Windows native `go test ./internal/studio ./internal/usage -count=1` and `go test ./internal/api -run '^TestStudio' -count=1` passed under Go1.26.8 with the concurrently updated dependencies. The broader API package also passed. Linux Docker `golang:1.26.8` passed `go test -race ./internal/studio ./internal/usage`; native Windows race requires CGO. These checks do not certify desktop/native-provider E2E reliability.
