# Database Layer

SQLite schema, models, and data access utilities.

## Files
- `db.go`: Opens DB connections, initializes schema, and serves issue-history queries.
- `schema.go`: DDL for projects, sessions, events, issues, runs, MCP servers, and indexes.
- `projects.go`: Project/session/event/global-stats models plus all related CRUD/query methods.
- `mcp.go`: MCP server CRUD persistence functions.
