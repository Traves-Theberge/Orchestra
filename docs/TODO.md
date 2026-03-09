# Remaining Tasks & Missing Features

This document tracks all unfinished features, known bugs, and architectural gaps discovered during the comprehensive code review.

## 🔴 High Priority: Missing Features

### 1. Model Context Protocol (MCP) Extensions
- [x] **Dynamic Tool UI**: The UI now displays active MCP servers and their discovered tool schemas with interactive tooltips.
- [x] **MCP Resource Support**: Backend now discovers, lists, and injects `resources.json` into agent workspaces, allowing models to read remote data sources.
- [x] **Configurable Tool Selection**: Operators can now selectively toggle specific tools (system or MCP) on or off per-issue in the Issue Inspector "Tools" tab.

### 2. Multi-Agent Coordination
- [x] **UI Override**: Added a "Provider Selector" to the Issue Inspector allowing operators to manually swap agent providers (Claude, Gemini, etc.) mid-session.
- [x] **Parallel Races**: Implemented a "Race Mode" where multiple agents work on the same issue simultaneously in isolated workspaces. Added a "Promote to Winner" feature to finalize the best result.
- [x] **Agent Handoffs**: Added the `request_handoff` tool allowing models to explicitly delegate tasks to other providers (e.g. "handoff to Gemini for large context").

### 3. Stability & Scalability
- [x] **DB Persistence for MCP**: MCP server configurations are now stored in the SQLite database and can be managed (add/remove) directly from the Agents tab UI.
- [x] **Artifact Cleanup**: Implemented a background Garbage Collector that periodically (every 1h) sweeps the workspace root and removes orphaned directories not tied to any active or pending sessions.

## 🟡 Medium Priority: Enhancements

### 4. Developer Experience
- [x] **Real-time Log Search**: Added a search/filter bar to the live SSE log stream in the Issue Inspector, allowing operators to isolate specific events or errors.
- [x] **Diff Highlighting**: Improved the `Prism` renderer for `diff` files with line-level background coloring (green/red) for better contrast.
- [x] **Keyboard Shortcut Mapper**: Added a UI section in Settings to view and manage global shortcuts like `⌘ K` and sidebar toggles.

### 5. Analytics
- [x] **Cost Calculation**: Mapped token usage to real-world USD costs per provider (Claude, Gemini, Codex) in the Analytics Dashboard.
- [x] **Project Health Scores**: Calculated a "Stability Score" for projects based on agent success/retry ratios, visible in Project Grid and Detail views.

## 🟢 Low Priority: Visual Polish
- [x] **Animated D3 Transitions**: Added smooth entry/exit animations and transitions to the architecture graph nodes and links.
- [x] **Skeleton Refinement**: Implemented realistic ghost-card skeletons for the Kanban board loading states.
- [x] **Theme Sync**: The app now automatically detects and responds to system-level (OS) light/dark mode changes.
