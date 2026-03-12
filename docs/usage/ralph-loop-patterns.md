# Ralph Loop Design Patterns

The **Ralph Loop** is the core reasoning and state-persistence pattern used by Orchestra agents. It treats the issue tracker (Linear/GitHub) as a "high-latency global brain" while the Go workers handle "low-latency local execution."

By using Linear comments as a **Draft Pad**, agents can maintain state across backend restarts, worker crashes, or handoffs between different model providers (e.g., Claude to Gemini).

## 🧠 Core Concept: The Draft Pad

In a Ralph Loop, the agent does not start with a "blank slate" on every turn. Instead, it follows a structured cycle:

1.  **Read**: Load the current issue description and latest comments.
2.  **Think**: Parse the "Draft Pad" from the comments to understand previous progress.
3.  **Act**: Execute tools (Shell, ReadFile, etc.) to make progress.
4.  **Write**: Use the `update_issue` tool to persist the updated plan and "Draft Pad" back to Linear before the turn ends.

## 🛠️ Recommended Prompt Patterns

To implement an effective Ralph Loop, your `ORCHESTRA.md` prompt should instruct the agent to use the following structures.

### 1. The Checklist Pattern
Encourage the agent to maintain a markdown checklist in the issue description or a pinned comment.

```markdown
### 📋 Operational Plan
- [x] Analyze codebase structure
- [x] Identify root cause of issue #123
- [/] Implement fix in `auth_service.go` (In Progress)
- [ ] Run regression tests
- [ ] Create Pull Request
```

**Orchestra Benefit**: The Desktop UI will automatically parse this checklist and display it in the **Operational Plan** widget in real-time.

### 2. The Stateful Handoff Pattern
Instruct the agent to summarize its internal state before requesting a handoff or ending a turn.

```markdown
### 🔄 Turn State
- **Current Goal**: Fixing the circular dependency in the API layer.
- **Last Action**: Successfully refactored `router.go`.
- **Blockers**: None.
- **Next Step**: Update `internal/api/state.go` to match the new interface.
```

## 🚀 Optimizing the Loop

### Minimize "Context Drift"
Since every turn rebuilds the prompt from the tracker state, ensure your agent only persists *essential* reasoning state. Avoid dumping large raw outputs into the Draft Pad; instead, summarize results and point to local artifacts.

### Autonomous Recovery
If an agent fails (e.g., a tool timeout), the next attempt will read the last "Draft Pad" entry. This allows the agent to recognize where it failed and attempt an alternative strategy without repeating the work it already successfully completed.

### Multi-Agent Synchronization
When using **Parallel Multi-Agent** mode, both agents will read the same Draft Pad. This allows them to effectively "collaborate" on the same task, with one agent picking up exactly where another left off.

---

> **Tip**: Use the **Interactive Plan Checklist** in the Orchestra Desktop app to monitor the agent's Ralph Loop progress without having to switch tabs to Linear.
