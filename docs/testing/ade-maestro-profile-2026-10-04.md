# Maestro owned profile

Orchestra is the application. Maestro is its persistent top-level agent identity, independent of the supported harness or model chosen for a conversation.

## Reference receipt

- T3 Code `737993303d36e10674c54b95e5bd3826682c99c7`: [CodexAdapterV2](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts) and [CodexDeveloperInstructions](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/server/src/provider/CodexDeveloperInstructions.ts) attach orchestration instructions conditionally when control tools exist. T3 places instructions in collaboration settings per turn. No equivalent provisioning of an app-owned control profile was found in the inspected source.
- Orca `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: [provider skill paths](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/docs/reference/agent-skill-provider-paths.md) and [skill installation destinations](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/skills/skill-install-destinations.ts) support explicitly scoped, conflict-preserving installation. Codex workspace skills use `.agents/skills`. No dedicated Maestro profile or app-owned AGENTS.md equivalent was established.

## Adaptation and deviations

The backend embeds Maestro's base AGENTS.md and the current repository Orchestra CLI skill, reference and UI metadata. It provisions missing assets in the already validated `<WorkspaceRoot>/.orchestra/orchestrator` profile. Skills land under `.agents/skills/orchestra-cli`. Existing regular files are preserved, including user customizations; default content is not silently upgraded over an existing file. Symlink redirects and non-regular asset targets fail closed. No provider home, account or authentication file is edited.

The native Codex request includes the profile's actual AGENTS.md and SKILL.md content as developer instructions at thread creation/resume. This explicit delivery avoids relying exclusively on native skill discovery. Supporting references remain local readable files. Unlike T3, existing active threads do not receive a per-turn instruction update: profile changes apply when a native thread starts or resumes. Native Codex resume field compatibility was previously inspected using installed app-server schemas; this slice does not independently exercise live signed-in inference.

The global default agent selector says Maestro. Custom agent selection and harness registration remain separate capabilities. A shared persona does not make an unsupported harness able to run native control tools. Gemini, Claude, Grok, Cursor and Omp parity is not established by these changes.

## Behavioral verification

- Profile tests provision all assets, retain edited instructions and skills on repeated provisioning, and include those edits in generated developer instructions.
- The embedded-skill equality test compares all three assets byte-for-byte with `.codex/skills/orchestra-cli` so executable CLI guidance cannot silently diverge in the packaged backend.
- Redirected skill-directory rejection is tested where OS symlink permission is available; environments without permission explicitly skip that scenario.
- The authenticated loopback/native-process/SQLite global control fixture verifies Maestro instruction and skill delivery, native skill-file presence, control callbacks, durable mutation receipts, database reopening and provider-thread resume. It sends no live model inference.
- Focused Maestro and global control tests pass. Agent picker scoped tests pass. Desktop typecheck and production build pass. The full desktop run initially exposed two dashboard overview regressions from harness onboarding integration; the stale assertion and editor exposure after a failed configuration read were corrected. The final full run passes 100 files and 655 tests, with 2 existing skips.

File existence, instruction request delivery and fixtures do not prove that a live model follows a skill or that every requested harness works end to end.
