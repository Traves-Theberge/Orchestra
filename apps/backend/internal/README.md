# Internal Packages Index

`internal/` contains all core backend implementation code, organized by domain package.

## Subdirectories
- `agents/`: Agent runner implementations and registry.
- `api/`: HTTP and websocket handlers.
- `app/`: Runtime bootstrapping/wiring.
- `config/`: Configuration types and loaders.
- `db/`: SQLite models and data access.
- `logfile/`: Session log persistence helpers.
- `logging/`: Logger setup.
- `mcp/`: MCP client/registry support.
- `observability/`: Event pubsub utilities.
- `orchestrator/`: Core run state machine and scheduling logic.
- `presenter/`: Snapshot-to-API payload formatting.
- `prompt/`: Prompt template rendering.
- `runtime/`: Runtime identity and host safety helpers.
- `specs/`: Spec and PR template validators.
- `staticassets/`: Embedded UI assets.
- `telemetry/`: Log ingestion and token extraction.
- `terminal/`: PTY terminal session manager.
- `tools/`: Tool execution adapters.
- `tracker/`: Tracker client abstractions and providers.
- `utils/`: Git and GitHub utility clients.
- `workflow/`: Workflow frontmatter/store handling.
- `workspace/`: Workspace lifecycle, hooks, migration, and path safety.
