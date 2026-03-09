---
name: linear
description: |
  Native Linear integration using internal tracker tools. Supports issue
  querying, state transitions, and audit logging.
---

# Linear Integration (Native)

Orchestra now uses a high-performance native tracker for Linear. Do not use raw GraphQL tools.

## 🛠️ Primary Tools

Use the following system tools to interact with Linear issues:

1. **`tracker_query`**:
   - **Use Case**: Search for issues, fetch specific issue details, or list issues in a specific state.
   - **Identifier**: Always use the human-readable identifier (e.g., `MT-123`).

2. **`update_issue`**:
   - **Use Case**: Change the state, priority, or assignee of a Linear issue.
   - **Audit logging**: Changes are automatically recorded in the "Activity" history.

## 🔄 Common Workflows

### Querying an Issue

To get the full context of an issue, including its current state and history:

```json
{
  "tool": "tracker_query",
  "arguments": {
    "identifier": "PROJECT-123"
  }
}
```

### Changing Issue State

To move an issue along the workflow (e.g., to "In Progress" or "In Review"):

```json
{
  "tool": "update_issue",
  "arguments": {
    "identifier": "PROJECT-123",
    "state": "In Progress"
  }
}
```

### Finding Project Workspaces

To find issues related to a specific project or state:

```json
{
  "tool": "tracker_query",
  "arguments": {
    "state": "Todo"
  }
}
```

## 📜 Usage Rules

- **Zero GraphQL**: Do not attempt to use `linear_graphql`. It has been removed.
- **State Names**: Use standard Linear state names (e.g., `Todo`, `In Progress`, `Done`, `Canceled`).
- **Identifiers**: Always prefer the ticket identifier (e.g., `MT-1`) over internal database IDs.
- **Activity**: Remember that every `update_issue` call creates a transparent audit trail visible to the user in the Activity tab.
