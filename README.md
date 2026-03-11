# Orchestra

Orchestra is a professional **Agentic Orchestration Platform** designed to automate and manage autonomous coding agent sessions at scale. It transforms issue execution into a repeatable, isolated, and observable daemon workflow for modern engineering teams.

## 🚀 Overview

Orchestra bridges the gap between issue trackers and autonomous coding agents. It continuously polls for new work, creates deterministic per-issue workspaces, and orchestrates agent runs based on repo-defined policies.

### The Problem
Traditional agent execution often relies on manual scripts, lacking isolation, observability, and structured management. Orchestra solves these problems by providing a managed platform that treats agent sessions as first-class, repeatable workflows.

### Core Philosophy
- **Provider Agnostic**: Run Claude, Gemini, Codex, or OpenCode natively. 
- **Extensible Intelligence**: First-class support for the Model Context Protocol (MCP) to dynamically discover and consume external tools.
- **Isolated Workspaces**: Every issue gets its own sandbox to prevent side effects.
- **Repeatability**: Turns manual agent scripts into a managed daemon process.
- **Observability**: Structured logs, event streaming, and a high-density desktop command center for tracking concurrent agent runs.

## ✨ Key Features

- **Multi-Agent Coordination**: Support for **Parallel Races** (running multiple models concurrently on the same issue) and **Automated Cascading** (falling back to a different model if one fails repeatedly).
- **Interactive Dmux Terminals**: Built-in high-performance terminal multiplexer (using `xterm.js` and `creack/pty`) that allows you to watch and interact with agent sessions in real-time. Supports up to 16 concurrent tiled terminal panes.
- **Human-In-The-Loop (HITL)**: Take direct control of an agent's terminal session. Agents run inside persistent PTYs, allowing you to interject, provide credentials, or debug manually without stopping the automation.
- **Model Context Protocol (MCP)**: Native integration for external tool servers (JSON-RPC over stdio). Agents automatically discover and utilize MCP tools and resources dynamically.
- **Deep Wiki & Knowledge Base**: Fully integrated documentation hub within the desktop app featuring D3 architecture graphs, dynamic Table of Contents, and searchable markdown.
- **Agent Control Plane**: Direct UI management for global `.claude`, `.gemini`, `.codex` configurations and behavioral skills. 
- **Native Tracker Parity**: Built-in high-performance adapters for Linear and GitHub, plus a local SQLite tracker with 1:1 state parity.
- **Audit & History Timeline**: Automatic logging of all issue transitions (state, priority, assignee) for clear task genealogy.
- **Workspace Isolation**: Automated directory sanitization, path guarding (traversal/symlink protection), and lifecycle hooks (`after_create`, `before_run`).
- **Orchestra Data Warehouse**: A persistent SQLite-backed analytics layer for long-term session history, token tracking, and cost calculation rollups.

## 🏗️ Architecture & Mechanics

Orchestra operates as a distributed system with a decoupled execution engine and a React/Electron monitoring dashboard.

### 1. The Backend Core Loop
The Go backend runs primary concurrent workers:
- **Refresh Worker**: Synchronizes tracker state with local snapshots and identifies candidates.
- **Execution Worker**: Claims runnable issues, fetches active MCP tools, and dispatches them to the agent registry.
- **Telemetry Watcher**: Background sweeper that ingests agent logs, strips PII, and stores them in the SQLite warehouse.
- **Garbage Collector**: Reclaims abandoned workspace directories periodically.

### 2. Supported Agents
Orchestra natively connects to the industry's leading CLI-based agents:
- **Claude Code** (`claude`)
- **Gemini CLI** (`gemini`)
- **OpenCode** (`opencode`)
- **Codex** (`codex`)

### 3. Communication Protocols
- **Agent-Server**: Stateless JSON-RPC over `stdin`/`stdout` handling initialization, thread management, and automated action approvals.
- **Desktop-Backend**: Real-time observability via **SSE (Server-Sent Events)** and detailed **Activity Feeds** for per-issue audit trails.

## 📂 Project Structure

Orchestra is organized as a monorepo:

- **`apps/backend`**: The core orchestration engine written in Go (chi, zerolog, sqlite).
- **`apps/desktop`**: An Electron-based desktop application (React, Vite, Lucide, Tailwind, shadcn/ui) for monitoring and managing agent sessions.
- **`packages/protocol`**: Shared protocol definitions and JSON schemas for agent communication.
- **`docs/`**: The comprehensive Markdown knowledge base (Architecture, Usage, Agents, Roadmap).

## 🛠️ Getting Started

### Prerequisites
- **Go**: 1.24+
- **Node.js**: Latest LTS

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/traves-theberge/orchestra.git
   cd orchestra
   ```

2. Build the Backend:
   ```bash
   cd apps/backend
   go build -o orchestra-server ./cmd/orchestra
   ```

3. Setup Desktop App:
   ```bash
   cd apps/desktop
   npm install
   npm run dev
   ```

## ⚙️ Configuration (WORKFLOW.md & Environment)

Orchestra is configured via a `WORKFLOW.md` file in the root of your target repository, or via environment variables.

```yaml
---
tracker:
  kind: memory
agent:
  provider: gemini # Options: codex, claude, opencode, gemini
  max_concurrent_agents: 10
mcp:
  servers: "github=npx @modelcontextprotocol/server-github"
hooks:
  after_create: |
    git clone ...
    npm install
---
```

## 📡 API & Observability

Orchestra exposes a REST API (default port `4000`) for status and control:

- `GET /api/v1/state`: Current orchestrator snapshot (running, claimed, retrying).
- `GET /api/v1/events`: Server-Sent Events (SSE) stream for real-time updates.
- `GET /api/v1/mcp/tools`: Discover available tools from connected MCP servers.
- `POST /api/v1/issues/{id}/race`: Initiate a Parallel Race between multiple agents.
- `GET /api/v1/docs`: Fetch the platform's Deep Wiki knowledge base tree.

## 📄 License & Attribution

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) and [NOTICE](NOTICE) files for details.

### Third-Party Licenses
Orchestra incorporates components and architectural patterns from the following projects:
- **Unfirehose**: The Data Warehouse ingestion and token rollup logic is based on [unfirehose-nextjs-logger](https://github.com/TimeHexOn/unfirehose-nextjs-logger). See [licenses/UNFIREHOSE_LICENSE](licenses/UNFIREHOSE_LICENSE) for the original AGPL-3.0 license and permacomputer preamble.
- **Symphony**: This project is based on OpenAI's [Symphony](https://github.com/openai/symphony) project.

Rewritten and extended by [Traves Theberge](https://github.com/traves-theberge) in Go, TypeScript, and Electron.
