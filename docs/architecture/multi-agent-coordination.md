# Multi-Agent Coordination

Orchestra is designed to be provider-agnostic. While most platforms lock you into a single model, Orchestra can coordinate multiple agents (Claude, Gemini, Codex) to solve a single issue.

## 🏗️ The Coordination Model

Coordination happens at the **Session** level. Orchestra supports both sequential cascading and **Parallel Execution**.

### 1. Provider Resolution
When a turn starts, the system resolves which agent to use in the following order:
1.  **Session sticky-provider**: If the session is already running or retrying, it continues with its previously assigned provider.
2.  **Assignee Override**: If the issue is assigned to a specific worker (e.g., `agent-gemini`), that provider is used.
3.  **Parallel Multi-Agent**: Users can manually trigger multiple agent providers for the same issue to compare outputs or split sub-tasks.

### 2. The Operational Plan Checklist
To maintain cohesion during coordination, Orchestra parses the agent's initial `thought` event into an **Interactive Plan Checklist**.
- **Shared State**: All agents working on the issue contribute to the same checklist.
- **Visual Progress**: Real-time `- [ ]` to `- [x]` transitions in the UI allow operators to see exactly which stage of the coordination the agents are in.

## 🔄 Automated Cascading (Failover)

To make autonomous execution more robust, Orchestra implements an **Agent Cascading** logic within the `RecordRunFailure` lifecycle.

### How it works:
If an issue fails repeatedly (exceeds 3 retry attempts) with a specific model:
1.  **Detection**: The orchestrator detects the failure threshold.
2.  **Rotation**: It queries the `AgentRegistry` for other available providers.
3.  **Switch**: It automatically switches the `Provider` for that specific session to the next one in the "ring" (e.g., switching from Claude to Gemini).
4.  **Fresh Context**: The next retry attempt will launch using the new model, providing a "second opinion" on the problem.

## 📡 Tool Standardization

Multi-agent coordination is made possible by the **Tool & MCP Layer**. Regardless of which model is running, Orchestra injects a standardized `tools.json` into the workspace.

- **Unified Schema**: Both Claude and Gemini receive the same tool definitions for `update_issue` and `linear_query`.
- **Protocol Proxy**: The backend handles the specific prompting requirements for each model, ensuring they can all call the same Go-backed tools without provider-specific logic in the core orchestrator.

---

> **Tip**: You can monitor which agent is currently "owning" an issue by looking at the **Operations Queue** on the Dashboard or the **Session Details** in the Warehouse.
