# Existing task metadata persistence handoff

Scope: the existing authoring columns and runtime target in the SQLite tracker, plus their typed WorkItem read model. This implements a portion of [03.2](../superpowers/plans/ade-2026-10-03/03-agent-configuration.md). It does not complete model/limit transfer, effective configuration, workspace materialization or provider execution.

## Reference receipt

Reviewed the mandatory [pinned registry](../superpowers/plans/ade-2026-10-03/reference-patterns.md) and relevant sources before changing code:

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts) carries explicit typed model/runtime policy and identities at session/thread/turn boundaries. Associated [ChatView.logic tests](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/ChatView.logic.test.ts), inspected in the configuration review, verify selection/context behavior rather than treating a UI value as proof of server ownership.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [agent-project-model-override.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts) and [tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.test.ts) distinguish persisted configuration presence from known effective behavior and use disposable native paths.

Adaptation: restore typed data across the task storage/read boundary, and prove persistence through actual SQLite reopen and every query projection. An attachment field records authoring context; its presence does not claim provider delivery or workspace materialization. Guidance remains metadata, not effective provider policy.

Deliberate differences: retain Go/SQLite and the existing Kanban states. No new execution-config schema or provider selection logic is introduced. Neither inspected reference supplies a directly corresponding SQLite tracker authoring-column patch; the shared SQL projection/validation implementation is independent and no source was copied. Source/test inspection was available; reference runtime verification was not performed.

## Changed behavior

- `internal/tracker/work_item.go` adds typed acceptance criteria, attachment references, agent guidance, source template and authoring-session identity. `RuntimeTarget` already existed.
- `internal/tracker/sqlite/client.go` uses one shared column projection across detail, list/filter, candidate/state, ID and search reads, eliminating silent loss of migrated authoring fields and runtime target.
- `UpdateIssue` now accepts runtime target. Authoring JSON accepts both decoded typed values and existing pre-encoded Studio JSON strings, validates shape, and normalizes null collections to empty collections before executing its single SQL UPDATE.
- Review correction: criteria elements must be strings (null elements cannot become empty strings). Attachments must be objects with only string-valued `kind`, `path`, `url` and `label` fields. File attachments require a nonblank path and no URL; link attachments require a nonblank URL and no path. Missing/invalid kinds, null elements/fields and unknown fields are rejected. These rules match draft attachment semantics without importing Studio into the tracker; whole-field null clearing remains supported.
- Malformed stored authoring JSON returns a field-specific read error; it is not silently reported as empty successful data.
- Unknown update keys now return `unsupported issue update field` before mutation. This intentionally changes SQLite's former ignore-and-success behavior. Existing tracker tests pass, but callers that relied on ignored fields must remove them or implement explicit mapping. Other tracker adapters retain their existing behavior.

No migrations, new model/effort/limit schema, Studio manager/API edits, orchestrator or runner changes were made in this slice. Tests use only disposable real SQLite files, and close handles before temporary-directory cleanup.

## Verified acceptance

- `go test ./internal/tracker/...`: passed, including all tracker packages and the new SQLite tests.
- A new real SQLite test creates a task with empty durable defaults, writes populated metadata, closes and reopens the database, then checks detail by ID/identifier, list, candidate, state, IDs and search paths. The update result is also checked against requested values.
- Legacy Studio JSON-string payloads round-trip alongside typed metadata payloads.
- Invalid criteria, attachment/guidance shapes, malformed JSON and unknown mixed-patch fields return errors without changing the task title. Null metadata clears to empty collections.
- Expanded post-review regressions cover null criteria/attachment elements, missing/invalid kinds, missing/blank/nonstring path or URL, conflicting path/URL, unknown attachment fields and null optional fields, always mixed with a title change to verify no partial write.
- Corrupt stored guidance produces a visible field-specific read error.
- `go test ./internal/tracker/sqlite -count=1` and `git diff --check`: passed after the explicit requested-value assertion.

## Remaining boundaries

The current `tracker.Client.CreateIssue` signature does not accept authoring metadata or runtime target. This patch verifies its migrated empty defaults and subsequent metadata updates; it does not claim atomic create-with-metadata. `orchestrator.Service.CreateIssue` still assigns a supplied runtime target only to its returned object. Persisting that creation argument belongs to the orchestrator slice and remains necessary.

Studio model/max-turn suggestions still need a typed task configuration design. Dispatch still needs effective configuration and admission/restart identity. Hosted and memory trackers require separate mappings. Push transactional/idempotent receipts, provider capability enforcement, instruction/config materialization and native Antigravity canaries remain unverified. Passing these SQLite tests establishes this storage boundary only.
