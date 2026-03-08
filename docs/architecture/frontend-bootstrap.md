# Frontend Bootstrap & Error Boundaries

The Orchestra Desktop frontend (`apps/desktop`) is built with React, Vite, and Tailwind CSS. It is designed to be highly resilient, preventing the dreaded "white screen of death" that often plagues Electron applications.

## 🚀 The Entrypoint (`main.tsx`)

The bootstrapping process in `main.tsx` is defensive. Before React is even loaded, it wraps the entire initialization sequence in a `try/catch` block.

### Fatal Boot Fallback
If an import fails (e.g., a bad syntax error in a deeply nested component that breaks Vite's HMR or build), the `bootstrap()` function catches it and invokes `renderFatalBootFallback`.

This function injects raw HTML into the DOM, completely bypassing React. It displays a terminal-like error screen with the exact stack trace and provides safe, native browser buttons to "Reload" or "Reset Theme And Reload" (which clears `localStorage`).

## 🛡️ The Crash Boundary (`crash-boundary.tsx`)

If the application successfully bootstraps but a runtime error occurs within the React tree (e.g., trying to map over an undefined array in a panel), the `CrashBoundary` class component catches it.

- It uses the standard React `componentDidCatch` lifecycle method.
- It displays a stylized, shadcn-compatible error dialogue.
- Like the boot fallback, it offers an aggressive "Reset Theme And Reload" button that clears all local UI state (collapsed sidebars, active tabs, themes) to ensure the user can escape a render loop caused by corrupted local storage.

## 🧭 The App Shell (`App.tsx`)

Once past the boundaries, `App.tsx` serves as the primary controller for the interface.

### Key Responsibilities:
1.  **State Initialization**: It establishes the initial connection to the Electron IPC bridge (`window.orchestraDesktop`) to fetch the backend URL and API tokens.
2.  **Theme Management**: It observes the `theme` state and injects the `.dark` class directly onto the document root.
3.  **Layout Routing**: Orchestra does not use a traditional router (like `react-router`). Instead, it uses a state-driven approach (`activeSection`). The `sectionVisibility` object strictly dictates which dashboard or view is rendered in the main content area, keeping the app snappy and avoiding complex route-matching overhead.
4.  **Global Actions**: It holds the top-level handler functions for critical actions like `handleRefresh`, `handleSaveAgentConfig`, and `handleInspectIssueFromList`, passing them down to child components as props.
