# Agent Adapters

Orchestra connects to diverse AI models through a standardized adapter layer defined in the `internal/agents` package. This ensures the core orchestrator remains decoupled from the specific implementation details of any single provider.

## 🔌 The Command Runner

The foundation of the adapter layer is the `CommandRunner`. Because most modern AI coding agents are distributed as CLI tools (e.g., `claude`, `gemini`, `opencode`), the `CommandRunner` acts as a highly resilient subprocess manager.

### Key Responsibilities:
1.  **Execution & Quoting**: Safely injects the orchestrator's prompt into the configured CLI command using shell quoting (`{{prompt}}`).
2.  **Stream Interception**: Captures both `stdout` and `stderr` from the agent process in real-time using asynchronous scanners.
3.  **Protocol Parsing**: Evaluates incoming streams to detect Server-Sent Events (SSE) and raw JSON lines. It standardizes these into an internal `Event` struct.
4.  **Telemetry Extraction**: Deeply parses the output to extract `TokenUsage` (input, output, and total tokens), aggregating it continuously throughout the run.
5.  **Lifecycle Management**: Enforces strict timeouts and handles graceful cancellation if the orchestrator aborts a turn.

## 🛑 Blocking Event Detection

A critical feature of the `CommandRunner` is its ability to detect when an agent is "stuck" waiting for human intervention. 

The orchestrator is designed for **autonomous** execution. Therefore, if a CLI tool pauses to prompt the user (e.g., "Do you want to run this command? (y/n)"), the `CommandRunner` detects this via the `detectBlockingEvent` function.

If it detects methods indicating `approval` or `needsInput`, it immediately forcefully terminates the subprocess and returns a specific failure state to the orchestrator. This prevents silent hangs.

## 🧩 The Registry

The `Registry` (`internal/agents/registry.go`) maps provider identifiers to their respective implementations:

*   **`ProviderClaude`**: Wraps the CommandRunner configured for the Anthropic `claude` CLI.
*   **`ProviderGemini`**: Wraps the CommandRunner configured for the `gemini` CLI.
*   **`ProviderOpenCode`**: Wraps the CommandRunner configured for the `opencode` CLI.
*   **`ProviderCodex`**: A specialized adapter (`codex_appserver.go`) that communicates over a specific JSON-RPC protocol tailored for Codex.

By maintaining this registry, Orchestra can seamlessly switch between providers mid-session or dynamically assign different issues to different models based on configuration.
