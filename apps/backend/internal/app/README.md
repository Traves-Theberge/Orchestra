# App Runtime Wiring

Bootstrap and lifecycle wiring for the backend runtime.

## Files
- `run.go`: Composes config, DB, tracker, agents, MCP, API router, workers, and retry loops into the running service.
- `run_test.go`: Verifies lifecycle event publication, retry handling, tracker selection, and refresh behavior.
