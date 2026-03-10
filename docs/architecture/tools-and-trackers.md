# Tools & Linear Integration

In the Orchestra architecture, agents are not just text generators; they are active operators capable of interacting with the outside world through a controlled interface. The `tools` and `linear` (formerly `tracker`) packages define these capabilities.

## 🎯 The Tool Executor (`internal/tools`)

When an agent needs to perform an action (like looking up an issue or changing its state), it outputs a structured tool-call request. The `LinearToolExecutor` parses this request, validates the schema, and routes it to the appropriate backend subsystem.

### Built-in System Tools

Currently, Orchestra injects the following core capabilities into every agent's context:

1.  **`linear_query`**:
    *   **Purpose**: Allows the agent to query the Linear state machine.
    *   **Use Case**: An agent can ask "What are all the issues currently in the 'In Review' state?" or "Get me the specific details for issue OPS-12."
2.  **`update_issue`**:
    *   **Purpose**: Mutates the state of an issue in Linear.
    *   **Use Case**: Once an agent finishes writing code, it calls `update_issue` with `{ "state": "In Review", "assignee_id": "human-reviewer" }`. This signals the orchestrator that the turn is complete.
3.  **Issue History Audit**:
    -   **Purpose**: Records every change made to an issue's metadata.
    -   **Use Case**: The orchestrator automatically logs changes to `state`, `priority`, and `assignee` in a dedicated `issue_history` table, providing a permanent audit trail for agent sessions.

## 📡 The Linear Client (`internal/tracker`)

The `LinearToolExecutor` (formerly `TrackerToolExecutor`) does not communicate with Linear via generic wrappers. It relies on the high-performance `linear.Client` interface.

### Supported Backends

*   **Linear Client**: A high-performance native client for Linear. It ensures 1:1 state parity and implements the full history logging protocol.
*   **Offline / Test Clients**: Memory or SQLite implementations used for self-hosted instances or automated testing, ensuring the orchestrator can run entirely offline if needed.

## 🔗 Future: Model Context Protocol (MCP)

Currently, tools are hardcoded into the Go backend. 
*See the [Platform Roadmap](/roadmap/status) for plans to integrate MCP (Model Context Protocol), which will allow agents to dynamically discover and use external tools hosted on entirely different servers.*
