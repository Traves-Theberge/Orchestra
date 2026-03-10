# Getting Started

Welcome to **Orchestra**. This guide will get you from zero to your first autonomous agent session in under 5 minutes.

## 1. Backend Initialization

Orchestra relies on a Go-based control plane. Ensure your backend is running and reachable.

1.  Navigate to the **Settings** tab.
2.  Verify the **API Endpoint** (default is usually `http://127.0.0.1:4000`).
3.  Click **Test Connection** to ensure the desktop app can talk to the orchestrator.

## 2. Agent Authentication

To run agents like Claude or Gemini, you must provide your API tokens.

1.  Go to the **Agents** tab.
2.  Select **Settings** -> **Agent Tokens**.
3.  Enter your tokens for your preferred providers. These are **encrypted at rest** using your system's native secure storage (Keychain/SecretService).

## 3. Discovering Tasks

Orchestra syncs natively with Linear (with support for local test clients).

1.  Click the **Refresh** button in the Top Bar.
2.  Newly discovered issues will appear in the **Tasks** (Kanban) board under the `Todo` column.

## 4. Your First Turn

To start an autonomous session:

1.  Open the **Tasks** tab.
2.  Drag an issue from `Todo` to `In Progress`.
3.  The orchestrator will automatically provision a workspace and dispatch the default agent.
4.  Monitor the live logs in the **Activity Feed** or by clicking the issue to open the **Inspector**.

---

> **Tip**: Use `⌘ K` to quickly find and jump to any issue identifier once it has been discovered.
