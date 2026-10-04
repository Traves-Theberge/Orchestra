# Studio review corrections — 2026-10-04

PR 173 findings: [session/project mismatch](https://github.com/Traves-Theberge/Orchestra/pull/173#discussion_r4179771484) and [hidden execution overrides](https://github.com/Traves-Theberge/Orchestra/pull/173#discussion_r4179771520).

## Reference receipt

Inspected T3 Code at `737993303d36e10674c54b95e5bd3826682c99c7`: `apps/server/src/orchestration-v2/ProviderAdapter.ts` scopes session, thread, turn and runtime request identities separately. Relevant `apps/web/src/components/chat/ChatComposer.tsx` paths derive provider/model context from the active thread and gate submission when project selection is required. Configuration selection belongs to the actual conversation context.

Inspected Orca at `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: `src/main/native-chat/agent-model-catalog/agent-project-model-override.ts` and its tests scope workspace model overrides to repository roots, including linked worktrees, and distinguish requested/account defaults from effective configuration. Neither inspected reference contains Orchestra's Studio task-draft modal or explicit draft turn-budget editor; this correction uses Orchestra's independent task-authoring contract.

Orchestra adaptation: capture project and backend credentials when the modal binds its authoring session; retain the matching project list and prevent rebinding an active draft through local/global project selection or backend changes. Closing and reopening releases the UI binding without automatically deleting the durable backend draft. Restore the visible model and Max turns fields so template/agent overrides can be explicitly cleared. Warn that currently registered harnesses reject explicit turn budgets.

Deliberate difference: an active Studio project is fixed instead of silently creating another provider session or discarding the previous draft. Existing Studio resume/history and provider-process cleanup on modal close are not implemented by this correction.

## Verification

Renderer regressions in `StudioModal.test.tsx` verify displayed and submitted ownership remain on the original project/backend after local/global selection and backend changes, reopening permits another project, and an initially unbound modal permits project selection. StudioSection is mocked at its boundary; these tests establish modal target ownership, not provider execution or backend task publication reliability.

`DraftPanel.test.tsx` exercises the rendered draft panel with inherited model/turn values and verifies clearing produces `suggested_model: ''` and `max_turns: null` without invoking Push. `AgentGuidance.test.tsx` verifies the explicit null survives serialization.

Targeted Vitest: three files, five tests passed. ESLint passed for the five changed Studio TypeScript files; `git diff --check` passed. Full TypeScript checking passed before the concurrent dependency migration, then reported a missing `@huggingface/transformers` import in the untouched Whisper worker after that dependency was removed. The dependency owner must rerun full checking after resolving the worker migration. No native runtime or signed-in-provider E2E claim is made. Windows App Control and the broader durable Studio resume workflow remain separate verification boundaries.
