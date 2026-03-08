# System Overview

Orchestra is split into three primary layers that work in concert to manage autonomous agents.

```diagram-architecture
```

## 1. The Control Plane (Go)
The core logic resides in a high-performance Go backend. It is responsible for **State Orchestration**, **Workspace Provisioning**, and **Telemetry Aggregation**.

### Key Responsibilities:
- **Session Lifecycle**: Tracks every agent turn from `claimed` to `completed`.
- **Isolation**: Manages ephemeral filesystems where agents safely execute code.
- **Provider Switching**: A unified interface for communicating with multiple AI providers.

## 2. The Interactive Desktop (Electron)
A high-density "command center" designed for human operators.

### Key Responsibilities:
- **Observability**: Real-time log streaming and diff visualization.
- **Intervention**: UI for humans to correct agent paths or approving actions.
- **Configuration**: Direct UI-to-Filesystem mapping for system tuning.

## 3. The Agent Adapters
Orchestra supports multiple state-of-the-art agent CLIs (Claude, Gemini, Codex, OpenCode). Each is treated as a pluggable component within the **Agent Registry**.

## 🔌 Model Context Protocol (MCP)
Orchestra serves as an **MCP Host**. It can connect to external **MCP Servers** via JSON-RPC over `stdio`. 

When an agent turn begins, the orchestrator:
1.  **Discovers Tools**: Polls all configured MCP servers for their available capabilities.
2.  **Standardizes Specs**: Injects these external tools alongside built-in system tools into the agent's context.
3.  **Proxies Calls**: When an agent calls an MCP tool, the Go backend transparently routes the request to the correct external server and returns the result.
