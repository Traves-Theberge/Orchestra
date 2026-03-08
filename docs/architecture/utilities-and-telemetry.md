# Utilities & Telemetry

The Orchestra backend relies on a suite of utilities to ensure that all data flowing into the platform is secure, observable, and deeply integrated with the underlying workspaces.

## 📡 The Telemetry Watcher (`internal/telemetry`)

While the `CommandRunner` intercepts live streams during active turns, the `watcher.go` service acts as an asynchronous background sweeper. It periodically scans the host machine's home directory (e.g., `~/.claude/logs`, `~/.codex/sessions`) to ingest historical data.

### Key Features:
- **Log Aggregation**: Reads `.jsonl` and `.log` files produced directly by the agent CLIs, ingesting them into the Orchestra SQLite Warehouse.
- **Offset Tracking**: Remembers how many bytes it has read from each file (`ingest_offsets` table) to ensure it only processes new data on subsequent sweeps.
- **PII Sanitization**: Before any log line is saved, it runs through `sanitizePII`. This function uses regular expressions to detect and redact:
  - Email addresses
  - IP addresses
  - API keys, tokens, and passwords (replaced with a stable SHA-256 hash hash `[REDACTED:a1b2c3d4]`).

## 👁️ Observability & PubSub (`internal/observability`)

The `pubsub.go` package implements an in-memory event bus. It is the core engine powering the real-time "live sync" in the Desktop UI.

- **Channels**: Clients (the HTTP SSE endpoint) subscribe to a specific channel (e.g., `events`).
- **Publishing**: When the orchestrator executes a turn or the `CommandRunner` receives a chunk of stdout, it broadcasts an `Event` envelope to the bus.
- **Delivery**: The PubSub system pushes these envelopes down all active HTTP SSE connections, ensuring the UI reflects changes within milliseconds without polling.

## 🧰 The Git Utility (`internal/utils/git`)

Orchestra does not rely on agents to perfectly report their source control actions. Instead, it uses the `git.go` utility to independently verify the state of a workspace.

- **Stats Collection**: Uses `exec.Command("git", ...)` to extract author names, commit hashes, timestamps, and commit messages.
- **Automation**: Exposes helper functions for `git pull` and `git push`, allowing the orchestrator to automatically sync workspaces before and after agent execution, reducing the cognitive load on human operators.
