# Tools & Trackers

In the Orchestra architecture, agents are not just text generators; they are active operators capable of interacting with the outside world through a controlled interface. The `tools` and `tracker` packages define these capabilities.

## 🎯 The Tool Executor (`internal/tools`)

When an agent needs to perform an action (like looking up an issue or changing its state), it outputs a structured tool-call request. The `TrackerToolExecutor` parses this request, validates the schema, and routes it to the appropriate backend subsystem.

### Built-in System Tools

Currently, Orchestra injects the following core capabilities into every agent's context:

1.  **`tracker_query`**:
    *   **Purpose**: Allows the agent to query the orchestrator's state machine.
    *   **Use Case**: An agent can ask "What are all the issues currently in the 'In Review' state?" or "Get me the specific details for issue OPS-12."
2.  **`update_issue`**:
    *   **Purpose**: Mutates the state of an issue in the backing tracker.
    *   **Use Case**: Once an agent finishes writing code, it calls `update_issue` with `{ "state": "In Review", "assignee_id": "human-reviewer" }`. This signals the orchestrator that the turn is complete.
3.  **`linear_graphql`**:
    *   **Purpose**: A raw GraphQL tunnel specifically for interacting with Linear.
    *   **Use Case**: Used for complex tracker operations not covered by standard state updates, such as posting comments, fetching specific project boards, or uploading attachments.

## 📡 The Tracker Abstraction (`internal/tracker`)

The `TrackerToolExecutor` does not communicate with Linear or GitHub directly. Instead, it relies on the `tracker.Client` interface. This is a crucial abstraction that allows Orchestra to work with any issue management system.

### Supported Backends

*   **GraphQL Client**: Primarily used for connecting to Linear. It translates generic orchestrator queries into the specific GraphQL schema required by the host.
*   **GitHub Client**: Interacts with the GitHub Issues API. It maps standard concepts like `state: "Done"` to GitHub's open/closed issue states.
*   **SQLite / Memory Clients**: Local implementations used for self-hosted instances or automated testing, ensuring the orchestrator can run entirely offline if needed.

## 🔗 Future: Model Context Protocol (MCP)

Currently, tools are hardcoded into the Go backend. 
*See the [Platform Roadmap](/roadmap/status) for plans to integrate MCP (Model Context Protocol), which will allow agents to dynamically discover and use external tools hosted on entirely different servers.*
