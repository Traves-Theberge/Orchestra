# Workspace Management

The `workspace` package in the Orchestra backend is responsible for creating, isolating, and managing the ephemeral filesystem environments where agents perform their work.

## 🗂️ The Isolation Model

When an agent begins a task, it never works directly on the host machine's primary repository. Instead, Orchestra provisions a dedicated, sandboxed workspace.

### The Provisioning Lifecycle (`service.go`)

1. **Path Resolution**: The `WorkspacePath` function generates a unique directory path based on the `WorkspaceRoot` configuration and the specific `issueIdentifier` (e.g., `~/.orchestra/workspaces/OPS-123`).
2. **State Validation**: `EnsureIssueWorkspace` checks if the path exists. If it exists but isn't a directory, or if it's stale, it aggressively cleans it up.
3. **Directory Creation**: A fresh directory is created with `0o755` permissions.
4. **Safety Markers**: The system places a hidden `.orchestra` marker file in the workspace root. **Path Guard** mechanisms enforce that destructive operations (like deleting a workspace) will immediately fail if this marker is missing, preventing accidental deletion of user data outside the sandbox.

## 🪝 Lifecycle Hooks (`hooks.go`)

To bridge the gap between a blank directory and a fully functional development environment, Orchestra implements a robust hook system.

Hooks are arbitrary shell scripts defined in your global `workspace.json` or project-specific `ORCHESTRA.md`. They run at precise moments during the session lifecycle:

*   **`after_create`**: Fired immediately after the workspace directory is created. **Use Case**: Cloning the git repository, checking out the specific branch, and running `npm install` or `go mod download`.
*   **`before_run`**: Fired right before the agent CLI is invoked. **Use Case**: Setting up local environment variables or starting background database containers.
*   **`after_run`**: Fired immediately after the agent CLI exits. **Use Case**: Capturing test coverage reports or tearing down temporary containers.
*   **`before_remove`**: Fired before the orchestrator deletes the workspace directory. **Use Case**: Pushing a final backup to a remote server or cleaning up registered cloud resources.

### Hook Execution
Hooks are executed via `os/exec` inside the workspace directory. They are subject to strict timeouts to prevent hanging the orchestrator.

## 📦 Artifact Management

The `workspace` service also provides APIs for the Desktop UI to inspect the results of an agent's work. The `ListArtifacts` function recursively walks the workspace directory (ignoring internal folders like `.git` and `.orchestra`) to build the file tree presented in the Issue Inspector, allowing operators to download generated code, logs, or analysis reports.
