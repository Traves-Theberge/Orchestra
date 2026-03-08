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
- `GET /api/v1/issues`: Polls the active tracker for issues, optionally filtered by state or project.
- `GET /api/v1/issues/{issue_identifier}`: Retrieves deep context for a specific issue.
- `PATCH /api/v1/issues/{issue_identifier}`: Updates issue metadata or moves it between states (which can trigger agent execution).

### Workspaces & Projects
- `GET /api/v1/projects`: Lists locally managed repositories.
- `GET /api/v1/projects/{project_id}/tree`: Reads the active filesystem tree for an agent's workspace.
- `POST /api/v1/workspace/migrate`: Initiates a cross-tracker or configuration migration.

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
