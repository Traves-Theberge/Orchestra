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
- **High-Fidelity Mission Control**: A professional desktop dashboard for real-time monitoring and human-in-the-loop intervention.

## ✨ Key Features

- **Dmux Terminal Multiplexer**: Unified terminal management system using `creack/pty` and `xterm.js`. Watch and interact with agent sessions in real-time with up to 16 concurrent tiled terminal panes.
- **Human-In-The-Loop (HITL)**: Take direct control of an agent's terminal session. Agents run inside persistent PTYs, allowing you to interject, provide credentials, or debug manually without stopping the automation.
- **Autonomous Report Promotion**: Automatic discovery and promotion of `ORCHESTRA_REPORT.md` artifacts as verified executive summaries in the UI for rapid review.
- **Interactive Plan Checklist**: Dynamic real-time checklist parsed from agent thought events to track operational progress.
- **PR Planning Bridge**: Review and refine Pull Request titles, bodies, and branches before they are submitted to GitHub.
- **Hook Diagnostics**: Direct visibility into workspace lifecycle hook outputs (`after_create`, `before_run`, etc.) for rapid debugging of environment failures.
- **Model Context Protocol (MCP)**: Native integration for external tool servers. Agents automatically discover and utilize MCP tools and resources dynamically.
- **Deep Wiki & Knowledge Base**: Fully integrated documentation hub within the desktop app featuring D3 architecture graphs and searchable markdown.
- **Agent Control Plane**: Direct UI management for global configurations and behavioral skills. 
- **Orchestra Data Warehouse**: A persistent SQLite-backed analytics layer for long-term session history, token tracking, and cost calculation rollups.

## 🏗️ Architecture & Mechanics

Orchestra operates as a distributed system with a decoupled execution engine and a React/Electron monitoring dashboard.

### 1. The Backend Core Loop
The Go backend runs primary concurrent workers:
- **Refresh Worker**: Synchronizes tracker state with local snapshots and identifies candidates.
- **Execution Worker**: Claims runnable issues, fetches active MCP tools, and dispatches them to the agent registry.
- **Telemetry Watcher**: Background sweeper that ingests agent logs and stores them in the SQLite warehouse.
- **PTY Manager**: Manages persistent Unix PTYs for interactive HITL sessions.

### 2. Supported Agents
Orchestra natively connects to the industry's leading CLI-based agents:
- **Claude Code** (`claude`)
- **Gemini CLI** (`gemini`)
- **OpenCode** (`opencode`)
- **Codex** (`codex`)

## 📂 Project Structure

Orchestra is organized as a monorepo:

- **`apps/backend`**: The core orchestration engine written in Go (chi, zerolog, sqlite).
- **`apps/desktop`**: An Electron-based desktop application (React, Vite, Lucide, Tailwind, shadcn/ui).
- **`packages/protocol`**: Shared protocol definitions and JSON schemas.
- **`docs/`**: Comprehensive Markdown knowledge base.

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

## 📡 API & Observability

Orchestra exposes a REST API (default port `4010`) for status and control:

- `GET /api/v1/state`: Current orchestrator snapshot (running, claimed, retrying).
- `GET /api/v1/events`: Server-Sent Events (SSE) stream for real-time updates.
- `GET /api/v1/mcp/tools`: Discover available tools from connected MCP servers.

## 📄 License & Attribution

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) and [NOTICE](NOTICE) files for details.

### Third-Party Licenses
Orchestra incorporates components and architectural patterns from:
- **Unfirehose**: Data Warehouse ingestion and token rollup logic.
- **Symphony**: Project structure and agent execution patterns.

Rewritten and extended by [Traves Theberge](https://github.com/traves-theberge).
