# API Layer Architecture

The Orchestra API provides a RESTful interface for the Desktop application to interact with the Go control plane. It is built using `go-chi/chi` for fast, lightweight routing and middleware.

## 🧭 Routing Structure (`internal/api/router.go`)

The `NewRouter` function mounts several critical middleware components:
- **RequestID & RealIP**: For traceability.
- **Recoverer**: Prevents panics from crashing the server.
- **RequestLogger**: Uses `zerolog` to structured-log every incoming request and its duration.
- **CORS**: Configured to strictly allow local connections (`http://localhost:*`, `http://127.0.0.1:*`) for the Electron frontend.
- **contentTypeGuard**: Enforces `application/json` for all `POST` requests (except file uploads/specific webhooks).

## 📡 Key Endpoints

### State & Telemetry
- `GET /api/v1/state`: Returns the `SnapshotPayload` representing the real-time operational state of the orchestrator (running tasks, retry queues, metrics).
- `GET /api/v1/events`: Establishes a Server-Sent Events (SSE) connection, streaming live log lines and lifecycle events (`run_started`, `run_failed`) directly to the UI.

### Issue Management
- `GET /api/v1/issues`: Polls Linear for issues, optionally filtered by state or project.
- `GET /api/v1/issues/{issue_identifier}`: Retrieves deep context for a specific issue.
- `PATCH /api/v1/issues/{issue_identifier}`: Updates issue metadata or moves it between states (which can trigger agent execution).
- `DELETE /api/v1/issues/{issue_identifier}`: Removes an issue and all associated sessions.
- `GET /api/v1/issues/{issue_identifier}/logs`: Retrieves live session logs with graceful handling for missing files.
- `GET /api/v1/issues/{issue_identifier}/history`: **NEW** - Returns chronological audit trail of all issue events and state changes.
- `GET /api/v1/issues/{issue_identifier}/diff`: Shows workspace diff for the issue.
- `GET /api/v1/issues/{issue_identifier}/artifacts`: Lists generated artifacts and files.
- `POST /api/v1/issues/{issue_identifier}/pr`: Creates GitHub pull request from issue changes.
- `GET /api/v1/terminal/{session_id}`: **NEW** - Bidirectional WebSocket stream for interactive agent terminals.

### Workspaces & Projects
- `GET /api/v1/projects`: Lists locally managed repositories.
- `GET /api/v1/projects/{project_id}`: Retrieves project statistics and metadata.
- `GET /api/v1/projects/{project_id}/tree`: Reads the active filesystem tree for an agent's workspace.
- `GET /api/v1/projects/{project_id}/git`: Returns git commit history and statistics.
- `POST /api/v1/projects/{project_id}/git/commit`: Creates git commit with message.
- `POST /api/v1/projects/{project_id}/git/push`: Pushes changes to remote repository.
- `POST /api/v1/projects/{project_id}/git/pull`: Pulls latest changes from remote.
- `POST /api/v1/workspace/migrate`: Initiates a project or configuration migration.

### Model Context Protocol (MCP)
- `GET /api/v1/mcp/tools`: Lists all available MCP server tools and schemas.
- `GET /api/v1/mcp/servers`: Retrieves configured MCP servers from database.
- `POST /api/v1/mcp/servers`: Registers new MCP server with hot-reload.
- `DELETE /api/v1/mcp/servers/{id}`: Removes MCP server and updates registry.

### Agent Control Plane
- `GET /api/v1/config/agents/items`: Returns a categorized list of core configs and skills (`.claude`, `SKILL.md`).
- `POST /api/v1/config/agents/items`: Saves a modified configuration back to the disk.
- `POST /api/v1/config/agents/new`: Scaffolds a new skill or dotfile based on the selected provider.

### Knowledge Base
- `GET /api/v1/docs`: Recursively walks the `docs/` folder to build a navigation tree.
- `GET /api/v1/docs/*`: Serves raw Markdown files to the frontend renderer.

## 🔒 Security
- **Local-Only**: Bound to `127.0.0.1` by default.
- **Bearer Tokens**: If exposed to `0.0.0.0`, the router dynamically wraps destructive endpoints (`POST /api/v1/refresh`, `POST /api/v1/workspace/migrate`) with a strict `requireBearerToken` middleware checking against `ORCHESTRA_API_TOKEN`.
