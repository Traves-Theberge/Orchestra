# Frontend Layout & Shell

The Orchestra frontend is architected around a persistent "App Shell" that manages top-level navigation, global state indicators, and layout boundaries, ensuring the primary content areas can render asynchronously without disrupting the operator's context.

## 🏗️ Core Shell Components (`components/app-shell`)

The layout is split into a persistent sidebar and a dynamic main content area topped by a persistent header.

### 1. The Sidebar Navigation (`sidebar-nav.tsx`)

The sidebar is the primary routing mechanism for the application.

- **State-Driven Routing**: Instead of URL-based routing, the sidebar updates the global `activeSection` state. This triggers `App.tsx` to conditionally render different sub-dashboards (e.g., `showDashboard`, `showIssues`).
- **Collapsible Design**: Designed for high-density environments, the sidebar can collapse from 240px down to a minimal 68px icon-only rail.
- **Keyboard Accessibility**: Fully accessible via keyboard. Users can navigate the list using `ArrowUp`/`ArrowDown` and trigger sections with `Enter`.

### 2. The Top Bar (`top-bar.tsx`)

The Top Bar acts as the global contextual header and control surface.

- **Dynamic Context**: It receives `sectionLabel` and `sectionTitle` from the parent shell to reflect the currently active view.
- **Connection Telemetry**: It hosts the "Live / Polling" connection status indicator, letting the operator know if Server-Sent Events (SSE) are currently active or if the app has fallen back to standard HTTP polling.
- **Global Search**: Features an integrated search bar that allows operators to find specific issues by identifier (`OPS-123`) across the entire workspace.
- **Feedback Surface**: It handles transient global notifications (e.g., "Workspace Syncing" or "Connection Failed") directly in the header to avoid blocking modal dialogs.

## 📏 Layout Philosophy

- **Flex-Stretching**: The main content area (`App.tsx`) uses a combination of `flex-1` and `min-h-0` to ensure that child components stretch to fill the viewport precisely, preventing unwanted page-level scrolling.
- **Independent Scrolling**: Scrolling is handled exclusively by `OverlayScrollbarsComponent` wrappers placed *inside* individual panels (like the Activity Feed or the Kanban columns) rather than scrolling the entire page. This ensures the Top Bar and Sidebar are always visible.
- **High-Density Scaling**: The primary content `div` applies a fixed CSS `zoom` scale (e.g., `zoom: 0.7` or `0.6`) combined with an `origin-top-left` transform. This physically shrinks the rendered elements, providing a "pro-tool" density that can display vast amounts of telemetry data on a single screen without relying on tiny font sizes.
