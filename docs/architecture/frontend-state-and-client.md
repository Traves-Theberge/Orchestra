# Frontend State & Synchronization

The Orchestra frontend is designed to be a "Live Command Center." Operators should never need to press a refresh button to see what an agent is doing. This requires a robust, real-time synchronization layer.

## 📡 The API Client (`orchestra-client.ts`)

The API client provides a strictly-typed, normalized interface to the Go backend.

### Core Features:
- **Type Safety**: All responses from the backend (like `SnapshotPayload` and `EventEnvelope`) are run through normalization functions (`normalizeSnapshotPayload`). This acts as an anti-corruption layer; if the backend returns a missing or incorrectly typed field, the client assigns a safe default (like an empty array or `0`), preventing React from crashing.
- **Error Normalization**: Non-2xx HTTP responses are caught and parsed into a consistent `APIError` class, extracting the specific `code` and `message` so the UI can display clean, actionable toast notifications instead of raw JSON dumps.

## 🔄 Real-Time Synchronization (`runtime-sync.ts`)

The heart of the live dashboard is the `startRuntimeSync` function. It manages a dual-strategy connection to the backend.

### 1. Server-Sent Events (SSE) - "Live Mode"
When the app loads, it immediately attempts to open a persistent HTTP connection to `/api/v1/events`. 
- **`snapshot` event**: Pushes the entire system state (all running agents, the retry queue, token totals).
- **Lifecycle Events**: Pushes granular updates like `run_started`, `run_failed`, or `hook_completed`. These are routed directly into the **Activity Feed** (`TimelineCard`) to provide a real-time narrative of the agent's actions.

### 2. Polling Fallback - "Degraded Mode"
If the backend SSE connection drops (e.g., server restarts, network partition) or if the UI is running against a remote, protected host that blocks SSE streams:
- The sync engine instantly detects the `onerror` event.
- It degrades gracefully into "Polling Mode," executing a silent `GET /api/v1/state` request every 2000ms.
- It simultaneously begins an **Exponential Backoff Reconnection** loop. It tries to re-establish the SSE connection in the background (starting at 3 seconds, backing off up to 30 seconds). If successful, it automatically switches back to "Live Mode" and refetches the full snapshot to ensure no events were missed during the blackout.

## 🧠 Local State Management (`runtime-store.ts`)

Orchestra relies on a mix of local component state (via `useState`) for transient UI interactions (like dropdowns and dialogs) and a centralized store for global application data.

- **Theme State**: Persisted to `localStorage` to ensure the Dark/Light mode preference survives reloads.
- **Profile Configuration**: The currently active backend connection (`baseUrl` and `apiToken`) is heavily cached and managed to ensure the client can seamlessly swap between managing a local daemon and a remote fleet orchestrator.
