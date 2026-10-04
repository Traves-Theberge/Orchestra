# Task metadata API handoff

SQLite authoring metadata now survives the task detail API's manual presentation map. Idle and active details expose requested runtime target, acceptance criteria, typed attachment references, guidance, source template and authoring session ID. List, create and PATCH responses already encode the canonical WorkItem directly; their populated metadata requires no additional presentation layer. Empty detail lists/maps are normalized to JSON arrays/objects. Desktop Issue and update payloads have explicit types for these fields.

Detail lookup now uses exact `FetchIssueByIdentifier` for both idle and active branches. Previously it selected the first fuzzy-search result, which could return another task whose title mentioned the requested identifier. Existing runtime presentation remains in place; authoring values come from the authoritative tracker record. They do not represent a frozen effective run configuration.

## Required reference receipt

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: prior inspection of [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) and relevant [ChatView.logic tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/ChatView.logic.test.ts) establishes typed request configuration and local/server ownership distinctions. Supplementary inspection of [ThreadPullRequestService.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ThreadPullRequestService.ts) shows repository identity matching and snapshot guards. Orchestra applies the relevant identity principle to exact task selection; it does not substitute fuzzy discovery for detail identity.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: prior [workspace model override implementation](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts) and tests distinguish discovered requested context from known effective model. Supplementary [worker run-scope tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/cli/handlers/orchestration/worker-list-run-scope.test.ts) make observation scope explicit. Orchestra projects requested task metadata separately from its existing running/retry payload.

Neither reference defines this Studio/SQLite detail projection. Deliberate adaptation: retain Go API, SQLite task authority, existing Kanban and runtime presentation, with no source copying. Reference applications were not run; observed source patterns do not certify Orchestra E2E behavior.

## Independent verification

`TestIssueAuthoringMetadataHTTPRoundTrip` uses a disposable real SQLite warehouse and production router/orchestrator/tracker. It creates two tasks through POST, changes the earlier task title to mention the later task identifier, PATCHes typed authoring metadata and runtime target, then checks equality in PATCH response, idle detail, list and active detail. Active presentation uses an injected running entry solely to exercise that branch; no real agent execution is claimed. An independent new SQLite client reload confirms persisted values. A partial identifier GET is rejected with 404. Existing `TestGetIssue` tests also pass, preserving runtime presentation.

Commands: `go test ./internal/api -run 'TestIssueAuthoringMetadataHTTPRoundTrip|TestGetIssue' -count=1`, `go vet ./internal/api`, `npm run typecheck`.

## Remaining gaps

CreateIssue's orchestrator still sets a supplied runtime target only on the returned object; this slice does not repair or claim POST target durability. PATCH runtime target persistence is independently verified. POST does not accept the authoring metadata fields; they arrive through Studio transfer or PATCH. Existing task detail controls do not display these new authoring fields; the API/type repair is a prerequisite, not a UI completion. Model/turn configuration transfer, effective admission snapshots, provider enforcement, workspace materialization and restart recovery remain outside this slice. No provider/account files or running native backend were modified.
