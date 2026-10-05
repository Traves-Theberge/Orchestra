# Agents sidebar scope handoff

## Reference observations

T3 Code revision `737993303d36e10674c54b95e5bd3826682c99c7`: inspected [SidebarChrome.tsx](https://github.com/pingdotgg/t3code/blob/737993303d36e10674c54b95e5bd3826682c99c7/apps/web/src/components/sidebar/SidebarChrome.tsx), including sidebar Settings/Usage navigation and utility-page Back behavior. These navigation controls live in the sidebar. This source does not contain Orchestra's global-versus-project Agents configuration comparison or an equivalent scope selector, so the exact removal is Orchestra-specific.

Orca revision `3284b4c70c901402831bb4ccc5576ea083d2e5ae`: inspected [agent-project-model-override.ts](https://github.com/stablyai/orca/blob/3284b4c70c901402831bb4ccc5576ea083d2e5ae/src/main/native-chat/agent-model-catalog/agent-project-model-override.ts) and its adjacent tests. Account defaults and workspace configuration are distinct; a project config can override the account default. Tests cover linked worktree roots, repository ancestry boundaries, loose folders, and skipping the account home itself. These sources have no equivalent Agents dashboard comparison toolbar. The relevant adaptation is accurate project scope presentation, rather than copying a toolbar.

Neither reference app was launched for this slice. Reference source/tests establish patterns only.

## Orchestra adaptation

Removed the dashboard's duplicate `vs Global only` project selector and scope-toggle toolbar. The existing Agents sidebar retains the Global/project dropdown. Dashboard configuration hooks, panel scope labels, MCP project read-only notice and overview project identity now derive from the same `activeAgentScope`/`activeAgentProjectId` state used by that sidebar. Previously the dashboard had separate `agentHubScope`/`agentHubProjectId` presentation state, so sidebar reads and panel labels could disagree.

Overview row navigation updates that same active scope through the existing unsaved-change navigation guard. The guard dialog, provider/category navigation and Kanban model remain intact. No account configuration files, provider selection contracts or backend behavior were changed. Legacy hub store fields remain for compatibility; this dashboard no longer treats them as a second authority.

## Behavioral verification

- `npm run test -- src/features/agents/AgentsDashboard.test.tsx src/features/agents/panels/OverviewPanel.test.tsx`: 2 files, 8 tests passed.
- The added dashboard test exercises the exact store action used by the sidebar dropdown: project selection changes the provider read arguments and overview project text, shows the MCP project read-only notice, and switching back to Global clears that notice and project read argument. It also verifies the duplicate controls are absent.
- Existing OverviewPanel tests continue to verify row navigation behavior.
- `npm run typecheck`: passed after the implementation changes.

These are renderer tests with mocked configuration reads, not a native-app E2E claim. Visible app screenshot/interaction verification is deferred to the parent integration task.

## Additional requested shell cleanup

Removed the AppShell informational `role="status"` strip (including `SSE Live`). The existing error alert, sidebar, content area and usage footer remain. Runtime synchronization callbacks/store status are untouched; the command palette's SSE/polling control and Settings backend connection profiles remain available. No replacement banner was added. There was no separate existing visible live-SSE indicator found in the inspected usage footer, so this change does not claim that such an indicator exists elsewhere.

The reference observations above informed retaining sidebar utility navigation and separate workspace/account responsibilities. Neither inspected reference source establishes an equivalent global SSE strip; this explicit user-requested shell removal is an Orchestra presentation decision, not copied reference code.

`AppShell.test.tsx` adds two renderer cases covering absence of the status strip while preserving content/footer/sidebar and actionable errors. Combined run of AppShell, AgentsDashboard, OverviewPanel and App smoke tests: 37 passed, 2 skipped, 1 failure. The failure is the existing App smoke project-add scenario expecting a `Browse filesystem` button while the concurrent parent task introduces a project source picker; the parent was notified to update that scenario. The three focused shell/Agents/Overview files all passed. Native app rendering remains unverified by these mocked renderer tests.

Parent integration verification: after updating the concurrent project-source smoke scenario, the combined AppShell, AgentsDashboard, CreateProjectDialog and App smoke run passed: 4 files, 39 passed, 2 skipped. Parent reran TypeScript checking successfully. Native visual verification is still pending.
