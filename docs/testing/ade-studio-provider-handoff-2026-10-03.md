# Studio provider selection boundary

Unknown or empty runner selections now return an unsupported-runner error before scratch worktree creation. Explicit recognized Claude/Claude Code, Codex, OpenCode and Gemini aliases remain mapped; whitespace and case are normalized. Antigravity is rejected until its distinct production adapter exists. No fallback silently substitutes Claude.

## Reference receipt

Before implementation, inspected T3 Code `737993303d36e10674c54b95e5bd3826682c99c7` [ProviderAdapter.ts](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts): typed provider/session/turn identity, policy and failure boundaries. Inspected Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae` [project override source](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts): discovered configuration does not establish effective selection. Supplemental test inspection covered T3 [selection transition rejection](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderSelectionTransition.test.ts) and Orca [workspace override tests](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.test.ts).

Adaptation: explicit unsupported selection fails before acquiring workspace/session ownership. No exact Studio runner alias switch was established in those inspected files; validation is independently implemented in Orchestra. Recognized provider names do not prove installed binaries, account capability or MCP integration. No reference application or real provider was run.

## Verification

`go test ./internal/studio -run 'TestSpawnRejectsUnknownRunnerBeforeWorkspace|TestStudioProviderAliases' -count=1` passed. The rejection test supplies an absent repository and asserts the provider validation error, no session and no dispatched turn. Alias tests cover existing recognized selections.

This change does not fix execution-worker provider fallback, effective configuration persistence, native permissions or Studio streaming. Those require separate boundary changes and acceptance evidence.
