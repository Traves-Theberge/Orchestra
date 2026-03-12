# Orchestrator Core

In-memory orchestration state machine for issue execution, retries, and dispatch.

## Files
- `state.go`: Main orchestrator service with state tracking, claims, retries, persistence hooks, and provider dispatch.
- `reconcile.go`: Reconciles running issues with tracker state updates.
- `dispatch_test.go`: Validates dispatch, claim, retry, and usage accounting behavior.
- `refresh_test.go`: Exercises refresh-cycle correctness and error handling.
- `reconcile_test.go`: Confirms reconcile transition/removal behavior.
- `soak_test.go`: Long-running concurrency soak test for orchestrator stability.
- `state_test.go`: Snapshot and refresh-coalescing unit tests.
