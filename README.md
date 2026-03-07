# Orchestra

Orchestra is a professional **Agentic Orchestration Platform** designed to automate and manage autonomous coding agent sessions at scale, it transforms issue execution into a repeatable, isolated, and observable daemon workflow for modern engineering teams.

## 🚀 Overview

Orchestra bridges the gap between issue trackers and autonomous coding agents. It continuously polls for new work, creates deterministic per-issue workspaces, and orchestrates agent runs based on repo-defined policies.

### The Problem
Traditional agent execution often relies on manual scripts, lacking isolation, observability, and structured management. Orchestra solves these problems by providing a managed platform that treats agent sessions as first-class, repeatable workflows.

### Core Philosophy
- **Isolated Workspaces**: Every issue gets its own sandbox to prevent side effects.
- **In-Repo Policy**: Workflows and agent prompts are defined in `WORKFLOW.md`, ensuring consistency across the team.
- **Repeatability**: Turns manual agent scripts into a managed daemon process.
- **Observability**: Structured logs, event streaming, and a desktop dashboard for tracking concurrent agent runs.

## ✨ Key Features

- **Pluggable Tracker Adapters**: Generic interface for integrating with any issue tracker (Linear, GitHub, or custom internal implementations).
- **Dynamic Workflows**: Hot-reloadable `WORKFLOW.md` for updating prompts and runtime limits without service restarts.
- **Advanced Orchestration**: Bounded concurrency (global and per-state thresholds), prioritization, and exponential backoff retries.
- **Workspace Lifecycle**: Automated directory sanitization, isolation invariants, and customizable hooks (`after_create`, `before_run`, etc.).
- **Agent Runner Protocol**: Standardized JSON-RPC handshake for integrating any compatible coding agent app-server.
- **Workspace Migration**: Built-in support for planning and executing workspace transfers between storage roots.

## 📂 Project Structure

Orchestra is organized as a monorepo:

- **`apps/backend`**: The core orchestration engine written in Go (chi, zerolog).
- **`apps/desktop`**: An Electron-based desktop application (React, Vite, Lucide, shadcn/ui) for monitoring and managing agent sessions.
- **`packages/protocol`**: Shared protocol definitions and JSON schemas for agent communication.
- **`packages/config-spec`**: Centralized configuration specifications and defaults.
- **`ops/`**: Deployment configurations including Docker Compose and systemd units.
- **`SPEC.md`**: The authoritative technical specification for the Orchestra service.

## 🛠️ Getting Started

### Prerequisites
- **Go**: 1.24+
- **Node.js**: Latest LTS
- **Tracker Integration**: Configure your preferred tracker adapter in `WORKFLOW.md`.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/traves-theberge/orchestra.git
   cd orchestra-main
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
   ```

## ⚙️ Configuration (WORKFLOW.md)

Orchestra is configured via a `WORKFLOW.md` file in the root of your target repository.

```yaml
---
tracker:
  kind: memory # Or your custom implementation
  # project_slug: PROJ
polling:
  interval_ms: 30000
agent:
  max_concurrent_agents: 10
hooks:
  after_create: |
    git clone ...
    npm install
---

# Agent Prompt Template
You are an autonomous coding agent.
Issue: {{ issue.identifier }} - {{ issue.title }}
...
```

## 📡 API & Observability

Orchestra exposes a REST API (default port `4010`) for status and control:

- `GET /healthz`: Service health check.
- `GET /api/v1/state`: Current orchestrator snapshot (running, claimed, retrying).
- `GET /api/v1/events`: Server-Sent Events (SSE) stream for real-time updates.
- `GET /api/v1/{id}`: Detailed information for a specific issue session.
- `POST /api/v1/refresh`: Manual trigger for tracker polling.
- `POST /api/v1/workspace/migrate`: Execute a planned workspace migration.

## 📄 License
This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) and [NOTICE](NOTICE) files for details.

This project is based on OpenAI's [Symphony](https://github.com/openai/symphony) project.
