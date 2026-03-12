# Workspace Services

Workspace lifecycle operations, path security, hooks, migration, and artifact/diff helpers.

## Files
- `service.go`: Creates/removes workspaces and provides operational helpers for file and run context.
- `service_test.go`: Tests workspace lifecycle edge cases and hook integration behavior.
- `path_guard.go`: Safe path validation/normalization to prevent path escape and unsafe symlink traversal.
- `path_guard_test.go`: Verifies rejection of unsafe paths and acceptance of valid paths.
- `hooks.go`: Runs workspace hook commands with timeout and output capture.
- `hooks_test.go`: Covers successful hook execution and timeout failures.
- `migration.go`: Computes/applies workspace migration plans (dry-run and apply).
- `migration_test.go`: Tests migration planning and execution correctness.
