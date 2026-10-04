# Studio draft patch handoff

Scoped implementation of configuration review slice 1. Draft PATCH now validates every field before storage, applies all fields with one atomic SQLite UPDATE, and publishes the resulting draft only after success. The route retains its existing POST/204 contract; canonical state is obtained through GET or the draft event. This does not complete package 03 or establish task/provider E2E reliability.

## Mandatory reference receipt

- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: inspected [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) and the relevant model-transition/local-versus-server cases in [ChatView.logic.test.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/ChatView.logic.test.ts). Model selection and runtime policy are explicit typed request inputs; local presentation alone is insufficient to prove server ownership. Orchestra adopts validated draft values and reloads actual stored state in acceptance tests. No source copied.
- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected [agent-project-model-override.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts) and its [tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.test.ts). Workspace config can invalidate knowledge of an account default; discovering config does not reveal its effective model. Orchestra treats `max_turns:null` as absence of a requested draft limit, without inventing an effective provider setting.

Neither inspected reference defines an equivalent Studio draft/SQLite patch transaction. Orchestra deliberately implements that boundary with a whitelisted single UPDATE, preserving its Go/SQLite ownership and existing Kanban model. Neither reference app was run; these are source observations, not runtime certification.

## Changed behavior

- Allowed scalar fields must have their correct string type. Unknown fields fail before writes.
- `max_turns` accepts integers 1 through 100, matching the existing global setting bound. JSON numeric validation uses exact rational integrality, rejecting fractional precision that floating point would round away; integral decimal/exponent representations such as `5.0` and `0.5e1` are accepted. Omission retains the old value; explicit null clears it. GET exposes canonical null after clearing. Direct `SetMaxTurns` also rejects values outside the bound.
- `acceptance_criteria` replaces the complete string array, including empty arrays. Null and non-string entries are rejected.
- `attachments` replaces the complete typed array. File items require a path and no URL; link items require a URL and no path. Unknown item fields and kinds fail validation. This stores references; it does not grant file access or fetch links.
- A missing draft returns an error instead of silently accepting a zero-row update. A storage error changes no patch field because all assignments belong to one SQL statement.
- The Max turns input sends explicit null when cleared and declares the integer range in HTML. The desktop API draft type accepts null.

Implementation: `internal/studio/draft_patch.go`, manager patch/setter, `internal/db/studio.go` atomic helper, Studio API decoder, draft JSON type, desktop AgentGuidance/client type. No global provider/account configuration was read or changed.

## Verification

Passed on Windows:

- `go test ./internal/studio ./internal/api -run 'TestDraftPatch|TestStudio' -count=1`: invalid combined patches leave snapshots unchanged; typed list edits and clears reload; a real disposable SQLite file survives close/reopen with values and later null; an injected SQLite BEFORE UPDATE abort leaves all fields unchanged; HTTP rejects fractional/invalid/trailing/null requests and GET returns cleared lists/null.
- `go vet ./internal/studio ./internal/db ./internal/api`.
- `npm run typecheck`.
- `npx vitest run src/features/studio/draft/fields/AgentGuidance.test.tsx`: clear action retains null in serialized JSON.
- Focused ESLint: zero errors, one existing unused `AgentConfig` import warning in the API client.

All databases were disposable. HTTP tests use the production Studio route/manager and a fake attached runner; they do not prove authenticated native provider behavior.

## Remaining limits

No draft revision/conflict protocol, optimistic renderer rollback or stale-session fencing was added. POST remains 204 for compatibility rather than returning a revisioned snapshot. Full-field list replacements can overwrite another client's intervening list edit. Existing direct scalar manager setters remain separate operations; template application remains a multi-operation flow. Requested draft configuration still needs its separate Push/task/admission/runner transfer and enforcement work. No claim is made that a stored model/limit controls a task or native provider.
