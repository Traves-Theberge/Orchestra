# Managed harness accounts: implementation contract

This is the remaining parity slice after [host setup and quick usage](./harness-onboarding-usage-parity.md). The source audit used pinned [Orca `3284b4c`](https://github.com/stablyai/orca/tree/3284b4c70c901402831bb4ccc5576ea083d2e5ae) account/settings/usage components and pinned [T3 Code `7379933`](https://github.com/pingdotgg/t3code/tree/737993303d36e10674c54b95e5bd3826682c99c7) provider authentication and usage components. The active implementation deliberately has no managed-account UI because a UI-only account selector would be false.

## Ownership and state

- The backend host owns provider credentials. Desktop preferences may remember a selected opaque account ID but must not copy tokens, keychain records, or credential directories. Remote backend selection scopes all account reads and actions to that host.
- A managed account has `{id, provider, label, auth_state, created_at, last_verified_at}` plus an internal credential-root reference. The public API never returns credential paths or tokens. `system_default` is a separate observed host context, not a synthetic managed account.
- Account IDs are immutable. The active account is provider-scoped and versioned so concurrent selection can reject a stale write. The selected account is snapped into each new task run/native-chat session. Existing sessions retain their account binding until explicitly restarted or reauthenticated.
- Authentication is provider-specific. Codex can use an isolated `CODEX_HOME`; Claude must use a verified isolated provider configuration/credential flow. OpenCode, Antigravity, and 8gent require evidence of isolation before offering managed accounts. Unsupported providers keep host CLI auth guidance and an unknown account identity.
- Do not create an isolated Codex home for the same ChatGPT account automatically. [An Orca field report](https://github.com/stablyai/orca/issues/5370) describes competing refresh-token sessions between its private `CODEX_HOME` and the user's canonical home; its `codex login status` still reported healthy. Validate this boundary with real provider behavior before offering import or account duplication.

## Required runtime path

1. Create an empty provider credential context under a backend-owned private directory. Launch the provider's own interactive login against exactly that context. Never import the host default credentials without an explicit import operation.
2. Verify authentication using that same context. Keep status `unknown` for probe failures or providers without a reliable probe; a local status command is not proof that a model request works.
3. Persist an opaque account record only after a successful, attributable login. Roll back an abandoned credential context; keep a failed reauthentication from deleting the previously usable account.
4. On account selection, pass the context into **every** provider process path: batch command runner, structured Codex app-server, native chat resume, model catalog, and provider quota fetcher. Do not change global process environment variables to switch accounts.
5. Attribute quota snapshots to `{backend_host, provider, account_id, source}`. Invalidate cached windows immediately on account switch. Keep local usage-log totals separately sourced and do not assign them to an account unless the log contains a verified account identifier or was produced inside the isolated context.
6. On removal, block new sessions using the account, show the impact on active sessions, revoke through provider-supported APIs where available, then delete only the owned credential context. Never delete host-default credentials from managed-account removal.

## API and UI acceptance

- `GET /agents/accounts` returns scoped account summaries plus source freshness; `POST` begins a provider-specific login session; `POST /{id}/verify` rechecks it; `PUT /agents/accounts/active/{provider}` selects it with a version precondition; `DELETE /{id}` removes it after active-session checks. The Codex routes are implemented under `/api/v1/agents/accounts`; other providers remain outside this API.
- Agent Hub shows detection, sign-in, and managed accounts as distinct stages. The quick-usage roster displays the exact selected account and its quota source only when both are observed. Account switching shows loading/unknown immediately, never the previous account's percentages.
- Prove isolation with two fixture accounts whose provider processes report distinct identities; prove that a task and a resumed native chat retain their bound account after the global selection changes. Inject failed login, stalled CLI, stale selection, backend reconnect, and quota fetch errors. Validate with a real provider account separately from fixtures before claiming parity.

Implementation status: Codex managed account homes, device sign-in, verify/reauth/select/remove, run and conversation binding, and Codex quota attribution are implemented in the Go backend and Agent Hub. Fixture tests cover two isolated homes, stale selection, persisted selection, and conversation binding. Real two-account sign-in and quota E2E verification remain outstanding. Claude, OpenCode, Antigravity, and 8gent do not offer managed-account selection in Orchestra yet; their host CLI setup remains separate. See [the implementation receipt](../../../testing/ade-managed-accounts-2026-10-05.md).
