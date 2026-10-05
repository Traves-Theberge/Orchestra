# Retry provider identity audit

## Finding

`RecordRunFailure` used to replace a failed running entry's provider with the next registry provider on attempt three and later. The retry queue then carried that value into the next running entry, where dispatch treats a nonempty provider as authoritative. This let generic retry scheduling override a task's explicit provider. In the observed ORCHESTRA-2 case, the reported CODEX failures from invalid global rules were followed by a retry showing ANTIGRAVITY.

The fallback order was also unstable: `agents.Registry.Providers` iterates a Go map, so its order is unspecified. The retry path had no explicit task policy or durable record that the provider changed.

## Pinned reference observations

- Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`, `src/main/native-chat/agent-model-catalog/agent-project-model-override.ts` (O2): workspace configuration can change the effective model from an account default. Its helper treats the presence of a workspace config as uncertainty and avoids inventing an effective model. Source: [pinned Orca file](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts).
- T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`, `apps/server/src/orchestration-v2/ProviderAdapter.ts` (T1): provider identity is explicit on normalized provider events, and session, provider thread, turn, and runtime request are represented as distinct identities. Source: [pinned T3 file](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/ProviderAdapter.ts).

## Orchestra adaptation and deviation

Orchestra keeps the admitted task provider on generic retries, independently of the global default. This follows the references' separation of configured defaults from effective execution identity. Orchestra continues using its Go orchestrator and in-memory retry queue; it does not adopt either reference architecture. Cross-provider fallback would need to become an explicit policy with separate requested and effective provider fields plus an observable transition reason. The pinned references establish design patterns, not Orchestra runtime reliability.

## Change and behavioral verification

Removed implicit provider rotation from `RecordRunFailure`; retries retain the provider of the running entry. Added `TestExplicitProviderSurvivesRepeatedFailureAndRetryRelease`, which gives the service CODEX and ANTIGRAVITY runners with ANTIGRAVITY as the global default, records a third-attempt CODEX failure, releases the retry, and verifies dispatch still resolves to CODEX. `go test ./internal/app ./internal/orchestrator` passed. This verifies backend retry identity in the test process; it does not establish live-provider execution or runtime reliability.
