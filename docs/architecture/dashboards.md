# Dashboards & Views Architecture

The Orchestra frontend relies on a series of specialized dashboards and views, each designed for a specific operational context. By separating these concerns, the UI remains highly performant and contextually relevant.

## 🎛️ Operations Dashboard (`panels.tsx`)

The default landing view is designed for real-time monitoring and high-level fleet management.

- **Dashboard Overview**: Displays aggregate metrics (`MetricCard`) such as Active Sessions, Pending Retries, and Token Usage. It also houses the `Agent Distribution` graph and `Active Workspaces` list.
- **Operations Queue**: A live, sortable table showing all running and retrying agent sessions. Built with `shadcn/ui` table primitives, it allows operators to instantly jump to specific issues.
- **Activity Feed (`TimelineCard`)**: A real-time, chronological stream of all system events (e.g., `run_started`, `hook_completed`, `run_failed`). It uses Server-Sent Events (SSE) to update instantly without polling.

## 📋 Task Board (`KanbanBoard`)

A visual, drag-and-drop interface for managing issue states.
- **State Mapping**: Maps standard Linear states to visual columns (e.g., `Todo`, `In Progress`, `Done`).
- **Interactive Triggers**: Dragging an issue into the `In Progress` column triggers a backend API call to update the issue state, which automatically provisions a workspace and dispatches an agent.

## 📂 Project Management (`ProjectGrid` & `ProjectDetailView`)

Views dedicated to managing isolated workspaces.
- **Grid View**: Displays all tracked local repositories with key metrics.
- **Detail View**: Provides deep inspection of a specific workspace, including:
  - **File Explorer**: A recursive tree view of the current workspace directory.
  - **Git History**: A timeline of all commits made by agents in that workspace.

## ⚙️ Agent Control Plane (`AgentsDashboard`)

A dedicated IDE for managing agent configurations.
- **Categorization**: Splits configurations into "Core" (dotfiles) and "Skills" (Markdown guidance).
- **Pro Editor**: Features JSON validation, auto-formatting, and Markdown previews.
- **Scope Context**: Allows operators to switch between editing Global defaults and Project-specific overrides.

## 📊 Analytics Warehouse (`AnalyticsDashboard`)

A historical archive and metrics viewer.
- **Recharts Integration**: Uses `recharts` to render a stacked area chart showing token burn trajectories over time (Input vs. Output tokens).
- **Session Archive**: A paginated, searchable table of all completed agent sessions, allowing operators to drill down into past performance and logs.

## 📖 Knowledge Base (`DocsDashboard`)

The integrated Deep Wiki.
- **Triple-Column Layout**: Features a nested file explorer, a high-fidelity Markdown renderer (`react-markdown` + `Prism`), and an auto-generated Table of Contents.
- **Interactive Diagrams**: Supports embedding `d3.js` visualizations directly from Markdown source.
