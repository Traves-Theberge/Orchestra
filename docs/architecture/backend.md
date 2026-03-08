# Backend Architecture

The Orchestra backend is a high-performance control plane written in **Go**. It serves as the single source of truth for issue state, agent execution, and telemetry.

## 🏗️ Core Packages

### 1. `orchestrator`
The "brain" of the system.
- **State Machine**: Manages the transitions of issues through the standard pipeline (`Todo` -> `Running` -> `Completed`).
- **Turn Manager**: Handles the lifecycle of a single agent turn, including timeout enforcement and cancellation.
- **SSE Publisher**: Broadcasts real-time events to the desktop application.

### 2. `agents`
The provider abstraction layer.
- **Registry**: Maps provider IDs (e.g., `claude`, `gemini`) to their respective runners.
- **Command Runner**: A generic adapter that executes CLI-based agents, captures their stdout/stderr, and parses structured JSON results.
- **Codex App-Server**: A specialized adapter for the high-performance Codex protocol.

### 3. `workspace`
Filesystem isolation layer.
- **Provisioning**: Creates ephemeral directories for each session.
- **Lifecycle Hooks**: Executes user-defined scripts (e.g., `after_create`) to prepare the environment for the agent.

### 4. `db`
The persistent storage layer.
- **SQLite Schema**: A lightweight, file-based database that stores project metadata, session history, and token usage analytics.

## 🔄 Data Flow

1.  **API Layer**: Receives requests from the Desktop app (e.g., "Start Session").
2.  **Service Layer**: Resolves business logic (e.g., checking if max concurrent agents limit is reached).
3.  **Runner Layer**: Dispatches the turn to the configured agent CLI.
4.  **Telemetry Layer**: Captures logs and usage metrics, persisting them to the database and streaming them to the UI.

---

> **System Priority**: The backend is designed to be **stateless-first**. If the process restarts, it can rebuild the active operational state by scanning active workspaces and the database.
