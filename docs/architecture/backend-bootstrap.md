# Backend Bootstrap Sequence

The Orchestra backend initializes through a precise, dependency-ordered sequence designed for stability and observability.

```diagram-architecture
```

## Entrypoint: `cmd/orchestrad/main.go`
The journey begins at the standard Go `main` function. Its sole responsibility is to instantiate the structured logger (`zerolog`) and delegate execution to the core `app` package. If the application fails to start, it performs a fatal exit, ensuring the process manager (like systemd or Docker) can handle the restart.

## The App Runner: `internal/app/run.go`
The `Run` function is the primary orchestrator of the control plane's dependencies. It follows a strict initialization order:

### 1. Configuration Loading
The system reads environment variables and local `.env` files via `config.Load()`. It enforces security boundaries early, throwing a fatal error if the server is bound to a non-loopback address without a valid `ORCHESTRA_API_TOKEN`.

### 2. Database & State Recovery
- Connects to the SQLite `warehouse.db` located in `.orchestra/warehouse.db`.
- Instantiates the `orchestrator.Service` (the state machine).
- Executes a state recovery protocol (`RestoreStateFromDB`) to rebuild the active queue from persisted records if the daemon was unexpectedly restarted.

### 3. Subsystem Wiring
- **Tracker Client**: Initializes the correct provider (GitHub, Linear, Memory, or SQLite) based on the configuration.
- **PubSub**: Starts the event bus for real-time SSE streaming.
- **Agent Registry**: Validates that the requested AI provider (`codex`, `claude`, `gemini`, `opencode`) has a registered adapter and executable command.
- **Workspace Service**: Mounts the ephemeral filesystem manager.

### 4. Background Workers
Once the synchronous setup is complete, the runner spawns several non-blocking goroutines:
- **Refresh Worker**: Periodically polls the issue tracker to sync state.
- **Telemetry Watcher**: Scans local project roots to index Git history and file changes.
- **Execution Worker**: The heart of the autonomous system. It runs on a high-frequency tick (300ms) to detect state changes and dispatch agent turns.

### 5. API Server
Finally, it binds the HTTP router (injected with all dependencies via `api.NewRouterWithPubSub`) and begins listening for traffic.

---
> **Design Note**: The separation of the `main` package from the `app` package allows for easier integration testing, as the entire backend lifecycle can be spun up in-memory without compiling a binary.
