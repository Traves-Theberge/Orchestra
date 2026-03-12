# Telemetry Ingestion

Parses agent logs and records normalized events/tokens.

## Files
- `watcher.go`: Polls log sources, extracts metadata/token usage, and writes normalized telemetry records.
- `watcher_test.go`: Validates token extraction across supported log formats.
