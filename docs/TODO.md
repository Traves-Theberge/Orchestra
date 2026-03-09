# Remaining Tasks & Missing Features

This document tracks all unfinished features, known bugs, and architectural gaps discovered during the comprehensive code review.

## 🔴 High Priority: Missing Features

### 1. Model Context Protocol (MCP) Extensions
- [x] **Dynamic Tool UI**: The UI now displays active MCP servers and their discovered tool schemas with interactive tooltips.
- [x] **MCP Resource Support**: Backend now discovers, lists, and injects `resources.json` into agent workspaces, allowing models to read remote data sources.
- [x] **Configurable Tool Selection**: Operators can now selectively toggle specific tools (system or MCP) on or off per-issue in the Issue Inspector "Tools" tab.

### 2. Multi-Agent Coordination
- [x] **UI Override**: Added a "Provider Selector" to the Issue Inspector allowing operators to manually swap agent providers (Claude, Gemini, etc.) mid-session.
- [ ] **Parallel Races**: Implement a mode where two agents (e.g., Claude and Gemini) work on the same issue in parallel, and the human picks the best result.
- [ ] **Agent Handoffs**: Add a mechanism for an agent to explicitly request a handoff to another model (e.g., "This requires massive context, send to Gemini").

### 3. Stability & Scalability
- [x] **DB Persistence for MCP**: MCP server configurations are now stored in the SQLite database and can be managed (add/remove) directly from the Agents tab UI.
- [ ] **Artifact Cleanup**: Workspaces are currently cleaned up on completion, but there's no "Garbage Collector" for stalled workspaces if the backend crashes.

## 🟡 Medium Priority: Enhancements

### 4. Developer Experience
- [ ] **Real-time Log Search**: Add a search/filter bar to the live SSE log stream in the Issue Inspector.
- [ ] **Diff Highlighting**: Improve the `Prism` renderer for `diff` files to support better addition/removal color contrast.
- [ ] **Keyboard Shortcut Mapper**: A UI section in Settings to customize the `⌘ K` and other pro-tier shortcuts.

### 5. Analytics
- [ ] **Cost Calculation**: Map token usage to actual USD costs per provider (Claude vs. Gemini) in the Analytics Dashboard.
- [ ] **Project Health Scores**: Calculate a "Stability Score" for projects based on agent success/retry ratios.

## 🟢 Low Priority: Visual Polish
- [ ] **Animated D3 Transitions**: Add smooth transitions when nodes are added/removed from the architecture graph.
- [ ] **Skeleton Refinement**: Add more accurate skeleton shapes for the Kanban board during initial load.
- [ ] **Theme Sync**: Detect system-level (OS) light/dark mode changes and update the UI automatically.
