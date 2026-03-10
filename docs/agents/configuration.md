# Agent Configuration

Orchestra provides a unified interface for tuning the technical parameters of your autonomous agents.

## 🏗️ Configuration Hierarchy

Settings are applied in the following order of precedence:

1.  **Project Overrides**: `ORCHESTRA.md` or `.claude/settings.json` located in the issue's workspace.
2.  **User Global Configs**: Standard CLI dotfiles in your home directory (e.g., `~/.claude.json`).
3.  **Platform Defaults**: Default templates managed in the **Agents** tab.

## 🤖 Supported Providers

### Claude Code
Configured via `.claude` or `~/.claude/settings.json`.
- **Primary Model**: `claude-3-7-sonnet`
- **Temperature**: `0.2` (Default for high reasoning)
- **Max Tokens**: `4096`

### Gemini CLI
Configured via `.gemini` or `~/.gemini/settings.json`.
- **Primary Model**: `gemini-2.0-flash`
- **Context Limit**: Optimized for massive codebase analysis.
- **Output Format**: Uses `--output-format stream-json` for real-time telemetry and tool execution updates.
- **Event Mapping**: Standardizes `init`, `message`, `tool_use`, and `result` events into the Orchestra Activity Feed.

## 🛠️ Global Control Plane

Use the **Agents** tab to manage these files directly from the UI:

- **JSON Validation**: The editor will highlight syntax errors before you save to prevent agent crashes.
- **Auto-Formatting**: Click **Format JSON** to ensure your configurations remain clean and maintainable.
- **Path Mapping**: The UI shows the absolute path of the file being edited (e.g., `/home/user/.claude.json`).

---

> **System Note**: When you save a configuration in the UI, it is written directly to the filesystem. The changes take effect on the very next agent turn.
