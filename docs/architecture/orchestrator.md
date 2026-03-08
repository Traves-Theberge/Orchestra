# Core Orchestrator

The `orchestrator` package is the beating heart of the Orchestra platform. It operates as an asynchronous, non-blocking state machine that constantly reconciles the state of the real world (your tracker) with the state of your executing agent fleet.

## 🧠 The State Machine (`state.go`)

At the core is the `Service` struct, which maintains the live snapshot of operations:

```go
type Service struct {
	mu               sync.RWMutex
	running          []RunningEntry
	retrying         []RetryEntry
	// ... (dependencies like tracker, registry, db)
}
```

### Thread Safety & Concurrency
Because the orchestrator is accessed simultaneously by the HTTP API (for UI reads), the Execution Worker (for launching agents), and the Refresh Worker (for polling trackers), the `Service` is heavily guarded by a `sync.RWMutex`. 

This guarantees that the Desktop UI never reads a torn state, and agents never step on each other's toes when claiming issues.

## 🔄 The Reconciliation Loop (`reconcile.go`)

The orchestrator operates on a tick-based loop (every 300ms). During each tick, it performs a "reconciliation":

1.  **Evaluate Backlog**: It scans the list of issues that are in "Active States" (e.g., `Todo`, `In Progress`).
2.  **Concurrency Checks**: It checks the `MaxConcurrent` and `MaxConcurrentByState` thresholds to see if there is "room" in the fleet to spawn a new agent.
3.  **Claiming**: If an issue is eligible, the orchestrator atomically "claims" it.
4.  **Dispatch**: The claimed issue is handed off to the `Dispatch` system, which provisions a workspace and invokes the Agent Adapter.

## 🛡️ Resilience & Backoff

What happens when an agent crashes or a workspace fails to mount? The orchestrator never hangs.

1.  **The Retry Queue**: Failed sessions are immediately moved to the `retrying` array.
2.  **Exponential Backoff**: The system uses an exponential backoff algorithm (`retryBaseDelay` up to `retryMaxDelay`) to prevent a failing agent from rapidly spamming the tracker or API.
3.  **Terminal States**: If an issue fails `maxRetryAttempts` times, it is marked as a hard failure and requires human intervention via the Desktop UI.

## 💾 State Recovery

Because the Go backend is designed to be stateless-first, it must be resilient to sudden process deaths (e.g., a server restart or crash).

The orchestrator uses `RestoreStateFromDB` on boot. It reads the local SQLite warehouse to rebuild the `running` and `retrying` queues based on the last known checkpoints, ensuring that no agent tasks are lost in the ether.
