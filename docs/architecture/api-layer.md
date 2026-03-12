# API Layer Architecture

The Orchestra API provides a RESTful interface for the Desktop application to interact with the Go control plane. It is built using `go-chi/chi` for fast, lightweight routing and middleware.

## 🧭 Routing Structure (`internal/api/router.go`)

The `NewRouter` function mounts several critical middleware components:
- **RequestID & RealIP**: For traceability.
- **Recoverer**: Prevents panics from crashing the server.
- **RequestLogger**: Uses `zerolog` to structured-log every incoming request and its duration.
- **CORS**: Configured to strictly allow local connections (`http://localhost:*`, `http://127.0.0.1:*`) for the Electron frontend.
- **contentTypeGuard**: Enforces `application/json` for all `POST` requests (except file uploads/specific webhooks).
- **Timeout**: Global 30-second timeout for all requests to ensure responsiveness.

## 📡 Key Endpoints

### System & State
- `GET /healthz`: Standard health check.
- `GET /api/v1/state`: Returns the `SnapshotPayload` representing the real-time operational state of the orchestrator (running tasks, retry queues, metrics).
- `GET /api/v1/events`: Establishes a Server-Sent Events (SSE) connection for live telemetry.
- `GET /api/v1/search`: Performs a global search across issues, projects, and history.
- `POST /api/v1/refresh`: Triggers a manual synchronization with the issue tracker (Linear).

### Issue Management
- `GET /api/v1/issues`: Lists current tracker issues.
- `POST /api/v1/issues`: Manually injects a new task into the orchestrator.
- `GET /api/v1/issues/{issue_identifier}`: Retrieves deep context for a specific issue.
- `PATCH /api/v1/issues/{issue_identifier}`: Updates issue metadata (state, assignee, priority).
- `DELETE /api/v1/issues/{issue_identifier}`: Removes an issue and its local data.
- `GET /api/v1/issues/{issue_identifier}/logs`: Streams live session logs.
- `GET /api/v1/issues/{issue_identifier}/history`: Returns the chronological audit trail of all lifecycle events.
- `GET /api/v1/issues/{issue_identifier}/diff`: Shows the current workspace git diff.
- `GET /api/v1/issues/{issue_identifier}/artifacts/*`: Accesses generated artifacts and reports.
- `POST /api/v1/issues/{issue_identifier}/pr`: High-fidelity bridge to create GitHub pull requests.
- `DELETE /api/v1/issues/{issue_identifier}/session`: Terminates a specific execution session.

### Terminal & Interaction
- `GET /api/v1/terminal/{session_id}`: WebSocket upgrade for bidirectional PTY interaction.
- `GET /api/v1/agents`: Lists all supported agent providers.

### Workspaces & Projects
- `GET /api/v1/projects`: Lists locally managed repositories.
- `POST /api/v1/projects`: Registers a new local project root.
- `GET /api/v1/projects/{project_id}/tree`: Reads the workspace filesystem tree.
- `GET /api/v1/projects/{project_id}/file`: Retrieves raw content for a specific file.
- `GET /api/v1/projects/{project_id}/git/status`: Real-time git status overview.
- `GET /api/v1/projects/{project_id}/git/diff`: Project-level diff summary.
- `POST /api/v1/projects/{project_id}/git/commit`: Creates a new commit in the workspace.
- `POST /api/v1/projects/{project_id}/git/push`: Pushes branch to remote.
- `POST /api/v1/projects/{project_id}/git/pull`: Pulls remote changes.
- `POST /api/v1/projects/{project_id}/refresh`: Forces a background project filesystem scan.

### Model Context Protocol (MCP) & Configuration
- `GET /api/v1/mcp/tools`: Global registry of available MCP tools.
- `GET /api/v1/mcp/servers`: Lists configured tool servers.
- `POST /api/v1/config/agents/items`: Saves modified SKILL or dotfile configuration.
- `POST /api/v1/config/agents/new`: Scaffolds new behavioral skills.

### Analytics & Auth
- `GET /api/v1/warehouse/stats`: Aggregate token usage and cost metrics.
- `GET /api/v1/sessions`: Lists historical session records.
- `GET /api/v1/github/login`: Initiates OAuth flow for PR permissions.

## 🔒 Security
- **Local-Only**: The server prefers binding to `127.0.0.1`.
- **Bearer Tokens**: When exposed publicly, all `/api/v1/*` routes (except health and auth callbacks) are protected by `requireBearerToken` using the `ORCHESTRA_API_TOKEN` secret.
- **Path Validation**: All file-based operations are scoped strictly within `project_roots` or the `workspace` root using `ValidateProjectPath`.
