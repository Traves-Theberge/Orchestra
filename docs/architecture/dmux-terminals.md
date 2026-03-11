# Dmux Architecture: Interactive Terminals & HITL

Orchestra implements a sophisticated terminal multiplexing system called **Dmux**, which bridges the gap between automated agent execution and real-time human interaction.

## Core Components

### 1. Backend PTY Manager (`internal/terminal`)
The backend manages persistent Unix Pseudo-Terminals (PTYs) using the `creack/pty` library.
- **Session Persistence**: Terminal sessions are mapped to specific Issue Identifiers. They remain active even if the desktop client disconnects.
- **Log Buffering**: Each session maintains a 10KB circular buffer of the most recent output, allowing clients to see immediate history upon re-attachment.
- **ANSI Stripping**: The manager provides clean, plaintext output for event parsing while preserving the full ANSI stream for terminal rendering.

### 2. PTY-based Agent Runners
Agent runners (like `CommandRunner`) have been refactored to execute agent commands directly inside a persistent PTY session.
- **Real-time Monitoring**: Every character output by the agent is streamed to the connected WebSockets.
- **Interactive Injection**: Because the agent and the human share the same PTY, a user can type directly into an active agent session to provide passwords, confirm actions, or debug environment issues.

### 3. WebSocket Protocol
Orchestra uses a bidirectional WebSocket protocol for terminal communication:
- **Client -> Server**: Raw keystrokes or control messages (e.g., `{"type": "resize", "rows": 24, "cols": 80}`).
- **Server -> Client**: Raw binary streams from the PTY `stdout`/`stderr`.

### 4. Terminal Multiplexer (Frontend)
The desktop application uses `xterm.js` for high-performance rendering and `react-mosaic-component` for pane management.
- **Tiled Layouts**: Users can watch up to 16 agent sessions side-by-side.
- **Dynamic Mounting**: The "Logs" tab in the Issue Inspection view automatically mounts a live terminal if the task is currently `In Progress`.

## Human-In-The-Loop (HITL) Workflow

1. **Trigger**: An agent starts a task and spawns a PTY.
2. **Observation**: The user opens the "Live Console" or the issue's "Logs" tab to watch the session.
3. **Intervention**: If the agent gets stuck (e.g., waiting for a `sudo` password or a manual git resolution), the user clicks into the terminal and types the required input.
4. **Resumption**: The agent receives the input through the shared PTY and continues its automated loop.

## API Specification

### WebSocket: Terminal Stream
`GET /api/v1/terminal/{session_id}?project_id={project_id}`

**Parameters:**
- `session_id`: Unique identifier for the session (e.g., `issue-OPS-123` or `project-1`).
- `project_id` (Optional): The ID of the project to set as the working directory for new sessions.

**Messages:**
- **Raw Data**: Binary data is treated as terminal input/output.
- **Control JSON**: `{"type": "resize", "rows": number, "cols": number}`
