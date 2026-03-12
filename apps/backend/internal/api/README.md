# API Layer

HTTP, SSE, and websocket endpoints exposed by the backend daemon.

## Files
- `router.go`: Route registration, middleware stack, auth gating, CORS, and shared API error helpers.
- `auth.go`: Bearer token middleware and loopback host safety checks.
- `health.go`: Health check endpoint implementation.
- `static.go`: Embedded dashboard HTML root route handler.
- `static_test.go`: Root dashboard route behavior tests.
- `events.go`: SSE runtime event stream and envelope normalization.
- `state.go`: Issue/state/search/refresh/artifact/agent/MCP/GitHub PR handlers.
- `state_test.go`: Contract and behavior tests for state and issue APIs.
- `projects.go`: Project/session/git/file-tree/file-content/warehouse endpoints.
- `workspace_migration.go`: Workspace migration plan/apply endpoints.
- `workspace_migration_test.go`: Migration endpoint validation tests.
- `docs.go`: Docs listing/content endpoints with traversal safeguards.
- `github_auth.go`: GitHub CLI/OAuth login and callback handlers.
- `terminal.go`: Terminal websocket endpoint with auth/origin checks and PTY session wiring.
- `terminal_auth_test.go`: Tests for terminal auth combinations and rejection behavior.
- `openapi.go`: Serves OpenAPI YAML spec from docs path.
- `contract_test_helpers.go`: Fixture/schema helpers for API contract tests.
- `security_and_events_test.go`: Security middleware and SSE behavior regression tests.
