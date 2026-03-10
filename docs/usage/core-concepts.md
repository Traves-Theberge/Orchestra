# Core Concepts

Understanding the primary entities and workflows within the Orchestra platform.

## 1. Workspaces
A **Workspace** is an isolated, ephemeral directory where an agent performs its work. 
- **Provisioning**: When an issue is claimed, the orchestrator clones the repository into a new workspace.
- **Isolation**: Changes in one workspace do not affect other active tasks or your main source code.
- **Persistence**: Workspaces are preserved until the issue is `Completed` or `Failed`.

## 2. Agent Turns
A **Turn** represents a single execution cycle of an agent.
- **Context Injection**: Each turn includes the issue description, current file state, and active **Skills**.
- **Tools**: During a turn, the agent can call built-in tools like `linear_query` or `update_issue`.
- **Termination**: A turn ends when the agent submits a final result or hits a timeout.

## 3. Sessions
A **Session** is the historical record of an agent's work on a specific issue. It aggregates all turns, log lines, and token usage into a single observable record.

## 4. The Agentic Core Loop
Orchestra operates on a continuous feedback loop:
1. **Refresh**: The backend polls connected trackers (Linear, GitHub) for updated issue state.
2. **Claim**: Issues matching repository policies are claimed by an available agent worker.
3. **Provision**: A secure, isolated workspace is created, and repository state is cloned.
4. **Execute**: The agent runs multiple **Turns**, utilizing MCP tools and local capabilities.
5. **Observe**: Real-time telemetry is streamed to the Desktop UI and persisted to the Data Warehouse.
6. **Finalize**: Once the agent submits a result, the workspace is cleaned up, and the issue state is updated in the tracker.

## 5. Data Warehouse & Telemetry
Every interaction within Orchestra is recorded for long-term auditability:
- **Unified History**: A combined timeline of issue metadata changes (status, priority) and raw agent telemetry.
- **Token Analytics**: Automatic tracking of input/output tokens per provider for cost estimation.
- **Log Persistence**: Full agent session logs are archived and accessible even after a workspace has been reclaimed.

