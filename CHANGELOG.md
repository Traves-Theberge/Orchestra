# Changelog

All notable changes to the Orchestra project will be documented in this file.

## [0.2.0] - 2026-03-11

### ✨ Mission Control Overhaul
- **Dmux Terminal Multiplexer**: Unified terminal management system using `creack/pty` and `xterm.js`. Supports tiling up to 16 concurrent tiled terminal panes with persistent sessions for re-attachment.
- **High-Density Dashboard Redesign**: Overhauled the Operations, Tasks, Agents, and Warehouse dashboards for professional high-fidelity monitoring.
- **Autonomous Report Promotion**: Symphony-inspired automatic discovery and promotion of `ORCHESTRA_REPORT.md` artifacts as verified executive summaries in the UI.
- **Interactive Plan Checklist**: Dynamic real-time checklist parsed from agent "thought" events to track operational progress.
- **PR Planning Bridge**: New Human-In-The-Loop (HITL) step to review and refine Pull Request titles, bodies, and branches before submission to GitHub.
- **Task Capability Control**: Added the ability to toggle specific tools (e.g., Shell, ReadFile) at task inception via the Create Task dialog.
- **Hook Diagnostics**: Direct visibility into workspace lifecycle hook outputs (`after_create`, `before_run`, `after_run`) for rapid debugging of environment failures.

### 🛡️ UI/UX & Reliability
- **Theme Parity**: Full semantic Tailwind support for Light and Dark modes across all dashboards.
- **Solid Tooltips**: Standardized `AppTooltip` component with 100% opacity and reduced delay (100ms) for a snappier feel.
- **PTY ANSI Stripping**: Backend support for stripping ANSI escape codes to ensure clean JSON event parsing from colored terminal streams.
- **Navigation Bridges**: Added "Jump to Terminal" buttons across all task lists for seamless transition from monitoring to intervention.
- **Jargon Purge**: Replaced internal branding ("Parallel Race", "DNA", "Persona") with standard industry terms like "Global Config" and "Hardware Bridges".

### 🔧 Technical Improvements
- **"Nuclear Reset" Styles**: Fixed persistent highlighting in syntax highlighters by recursively stripping background colors from Prism themes.
- **Semantic Color Sweep**: Removed hardcoded hex values and opacity hacks in favor of system variables (`bg-background`, `border-border`).
- **Unified Button Variants**: Added `icon` size variant to the core `Button` component for consistent high-density UI.

---

## [0.1.0] - 2026-02-15
- Initial public release of the Go re-engineered backend.
- Electron desktop monitoring application.
- Basic support for Claude, Gemini, and Codex.
- Model Context Protocol (MCP) initial integration.
