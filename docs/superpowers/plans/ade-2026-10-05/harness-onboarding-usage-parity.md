# Harness onboarding and usage parity plan

## Scope and source receipt

Orchestra needs one trustworthy path from harness detection through account setup to usage observation. A registered runner, an installed executable, a signed-in account, a working provider session, a local usage log, and a reported quota window are distinct facts. The UI must name the evidence for each and never turn an unknown into a green check.

Pinned Orca revision [`3284b4c70c901402831bb4ccc5576ea083d2e5ae`](https://github.com/stablyai/orca/tree/3284b4c70c901402831bb4ccc5576ea083d2e5ae): inspected `AgentsPane.tsx`, `AgentDetectionCatalog.tsx`, `AgentCatalogRow.tsx`, `AccountsPane.tsx`, `onboarding/AgentStep.tsx`, `stats/UsageOverviewPane.tsx`, `status-bar/UsageRosterPanel.tsx`, and adjacent tests. Orca separates detected agents, enabled agents, default launch selection, command/argument/environment overrides, installed-agent refresh, provider account ownership, account sign-in, usage history, and a consolidated quick-usage roster. Its managed Claude/Codex account flows include process and credential isolation; copying a button without that backend ownership would misrepresent parity. No running Orca session was inspected in this pass.

Pinned T3 Code revision [`737993303d36e10674c54b95e5bd3826682c99c7`](https://github.com/pingdotgg/t3code/tree/737993303d36e10674c54b95e5bd3826682c99c7): inspected `ProviderAuthenticationSection.tsx`, `ProviderSetupSection.tsx`, `ChatGptUsageButton.tsx`, and `UsagePage.tsx`. T3 models authentication as provider- and environment-scoped phases, separates unavailable in-app sign-in from an authenticated state, and renders usage from distinct sources. Orchestra keeps its Go backend, Kanban tasks, and existing four-provider usage scanner; it does not copy T3's environment RPC or claim managed accounts before implementing credential isolation.

Provider documentation checked: [Codex authentication](https://developers.openai.com/api/docs/guides/workload-identity-federation), [Claude CLI auth status](https://code.claude.com/docs/en/cli-reference), [Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/), and [OpenCode auth commands](https://opencode.ai/v2/docs/cli/commands/). These document setup commands, not Orchestra's observed account state. Recheck provider CLI help before wiring a command to an automated sign-in flow.

## Current Orchestra baseline

| Area | Existing behavior | Gap |
| --- | --- | --- |
| Harness overview | Lists registered runners, command templates, default provider, native-chat capability | Installed executable and authentication both read “not observed”; no guided per-harness setup or verified sign-in action |
| Usage page | Four local-log scanners (Claude, Codex, Gemini, OpenCode), summaries, sessions and model/project breakdowns | No onboarding connection to each harness; Antigravity and 8gent have no verified scanner |
| Quota windows | Backend fetches Claude and Codex windows, reports Gemini/OpenCode unavailable | Bar presents account actions without account identity; other harnesses cannot be shown as quota percentages |
| Quick bar | Two provider buttons, refresh, per-provider popovers | No consolidated roster, no honest account-state action, no direct drill-in to the corresponding harness setup |

## Implementation sequence and gates

1. **Evidence model and discovery:** Add backend read-only harness setup observations for every registered/known harness. Distinguish configured, executable detected, auth observed/unknown, and chat capability; scope observations to the backend host and configured executable. Test missing binary, configured override, command timeout, and no secret leakage.
2. **Onboarding UI:** Add per-harness setup steps in the Agent Hub: installation guide, backend detection refresh, provider-native sign-in guidance, auth recheck, and a truthful ready state. Launch an interactive sign-in only through a provider-supported flow on the correct host; retain unknown where there is no safe probe. Test all supported harnesses and failure/remote cases.
3. **Managed account contracts:** Design and implement host-owned account identity, add/select/reauth/remove, credential storage, and runtime binding for providers that support multiple accounts. Do not label a system default as an observed account. Test process and credential isolation, rollback, and active session behavior.
4. **Usage source parity:** Keep local token logs separate from provider quota windows and managed-account usage. Add only verifiable provider sources; label unsupported sources. Test account switching, stale snapshots, backoff, refresh, and reset time.
5. **Quick usage roster:** Replace individual pseudo-account popovers with an Orchestra-styled consolidated roster, useful unknown/unavailable states, refresh, usage history, and exact setup/account navigation. Test keyboard and pointer interaction, narrow widths, profile changes, and cached errors.
6. **End-to-end verification:** Exercise setup and usage with real installed providers where available, using a separate test account; record unsupported or unavailable providers and do not mark full parity until every claimed flow has behavioral evidence.

This plan is a work ledger, not a claim that all gates have passed.

## 2026-10-05 progress

- Gate 1 is implemented for five active task harnesses. Backend discovery checks provider executables on PATH or a configured absolute executable path. Codex and Claude CLI statuses are probed with deadlines; a custom binary is never used for authentication probing. The endpoint, auth route, and observation logic have tests.
- Gate 2 has a backend-host terminal sign-in path where the backend PTY is available, and copy-and-run sign-in guidance on Windows where the current terminal adapter is unavailable. Codex has an in-panel app-server device-code flow for remote/headless hosts, with a one-time code, completion polling, and cancellation. Auth evidence is verified only for the known Codex and Claude CLIs; opening a terminal or starting device sign-in does not itself mark an account ready. Antigravity and 8gent retain setup guides and unknown auth status.
- Gate 5 has a consolidated four-source status-bar roster, on-demand local 30-day token totals, explicit quota labels, and usage-history navigation. Refresh updates both local scans and quota windows. The existing Claude/Codex quota windows are retained. The roster has been visually inspected in the running preview; the preview backend token is invalid, so authenticated E2E observation remains open.
- Gates 3, 4, and 6 remain open. In particular, Orchestra has no isolated managed accounts, account binding to task/native-chat processes, or per-account quota attribution. The [managed-account contract](./managed-account-contract.md) defines the backend and verification boundary for that slice. See [the behavioral handoff](../../../testing/ade-harness-onboarding-usage-2026-10-05.md) for the exact implementation and verification receipt.
