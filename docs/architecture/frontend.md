# Frontend Architecture

The Orchestra frontend is a high-density "command center" built with **Electron** and **React**. It is optimized for high information density and real-time observability.

## 🏗️ Technology Stack

- **Electron**: Provides native filesystem access and a secure IPC bridge.
- **React (Vite)**: The UI rendering layer.
- **Tailwind CSS**: Utility-first styling for rapid, consistent layout development.
- **shadcn/ui**: High-quality accessible components (Cards, Tables, Dialogs).
- **Zustand / Hooks**: Lightweight state management for local UI states.

## 🔒 Security Model (The Bridge)

Orchestra follows Electron security best practices:
- **`nodeIntegration: false`**: The renderer process cannot access raw Node.js APIs.
- **Preload Script**: A secure, typed bridge (`window.orchestraDesktop`) allows the React app to perform specific actions (e.g., saving configs, selecting folders) without exposing the entire system.

## 📊 High-Density UI Patterns

The UI is designed for professional operators who need to monitor multiple sessions at once:
- **Proportional Scaling**: The main content area defaults to **0.6 (60%) zoom** to maximize visible data.
- **SSE Live Sync**: The UI never requires manual refreshes for operational data. State is synchronized via a persistent EventSource stream from the backend.
- **Micro-Typography**: Carefully tuned font sizes and line heights ensure text remains readable even at high densities.

## 🧭 Key Views

### 1. Operations Surface
Combines the **Queue** and **Activity Feed**. It uses an asynchronous rendering pattern to ensure that massive log streams don't block the main UI thread.

### 2. Knowledge Base (Wiki)
An integrated Markdown renderer powered by **`react-markdown`**. It features nested navigation, search, and interactive **D3.js** system diagrams.

### 3. Agent Control Plane
A direct mapping of the filesystem to the UI. It includes a custom **JSON Validator** and **Formatter** to ensure configuration integrity.

---

> **Design Goal**: "Pro-tool" aesthetic. Information should be accessible with zero unnecessary clicks.
