# Pro Shortcuts

Orchestra is built for speed. Use these keyboard shortcuts and navigation patterns to manage your fleet like a power user.

## ⌨️ Global Keybindings

| Shortcut | Action | Scope |
| :--- | :--- | :--- |
| `⌘ K` / `Ctrl K` | Open Command Palette | Global |
| `⌘ /` / `Ctrl /` | Toggle Sidebar | Global |
| `Esc` | Close Dialog / Clear Search | Global |
| `Enter` | Confirm / Primary Action | Active Dialog |

## 🧭 Navigation Patterns

### Quick-Search & Jump
The **Command Palette** (`⌘ K`) allows you to search for any issue ID (e.g., `OPS-1`) or Project name. Selecting a result will instantly navigate you to that view and open the relevant inspector.

### Sidebar Management
You can collapse the sidebar using the chevron icon at the top or the global shortcut. This provides more room for deep-log analysis in the **Activity Feed** or high-density Kanban views.

## 📋 Table & Board Interactions

- **Click-to-Inspect**: Clicking anywhere on a row in the **Operations Queue** will open the Issue Inspector.
- **Drag-and-Drop**: In the **Tasks** tab, you can drag issues between lanes to manually override their state.
- **Auto-Sync**: The dashboard uses Server-Sent Events (SSE). You do not need to refresh manually to see agent progress; logs and counts update in real-time.

---

> **Note**: Keybindings are currently optimized for macOS. Windows/Linux support uses the `Ctrl` key as the primary modifier.
