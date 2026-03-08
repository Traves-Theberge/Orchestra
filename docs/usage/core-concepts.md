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
- **Tools**: During a turn, the agent can call built-in tools like `linear_graphql` or `update_issue`.
- **Termination**: A turn ends when the agent submits a final result or hits a timeout.

## 3. Sessions
A **Session** is the historical record of an agent's work on a specific issue. It aggregates all turns, log lines, and token usage into a single observable record.
