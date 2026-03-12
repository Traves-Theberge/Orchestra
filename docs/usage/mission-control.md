# Mission Control

Mission Control represents the Human-In-The-Loop (HITL) heart of the Orchestra platform. It provides the necessary tools for engineers to monitor, intervene, and validate autonomous agent work in real-time.

## 📟 Real-time Terminal (Dmux)

Orchestra features a built-in Terminal Multiplexer (**Dmux**) that connects directly to the agent's execution environment.

### Persistent PTYs
Unlike traditional log viewers, Dmux sessions are persistent Unix PTYs. 
- **Watch**: View the agent's raw CLI output as it happens.
- **Intervene**: Click into any terminal pane to take direct keyboard control. This is useful for providing one-time credentials, debugging stuck processes, or manually running a quick command.
- **Re-attach**: You can close the desktop app and come back later; the PTY remains running on the backend, allowing you to re-attach without losing state.

## 📋 Operational Plan & Checklists

Every time an agent begins a task, Orchestra parses its initial "thought" or "plan" event to generate a dynamic UI checklist.
- **Visual Progress**: See exactly which step of the plan the agent is currently executing.
- **Verification**: Ensure the agent's strategy aligns with your expectations before it gets too deep into the code.

## 🛠️ Task Capability Control

You can now prune an agent's toolset before it starts a task. In the **Create Task** dialog, you can toggle specific capabilities:
- **Shell Access**: Disable if you want the agent to only read/write files without executing code.
- **Internet Access**: Restrict agents from calling external MCP tools if necessary.
- **Refinement**: If an agent previously failed by "looping" on a specific tool, you can disable that tool for the retry.

## 🌉 PR Planning Bridge

Orchestra transforms Pull Request creation from a "black box" into a collaborative step.

1. **Autonomous Proposal**: When an agent finishes a task, it proposes a PR title and description.
2. **Human Review**: A **PR Review Dialog** appears, allowing you to edit the title, refine the body, and choose the target branch.
3. **Execution**: Once you click "Create Pull Request," Orchestra calls the GitHub API using your verified credentials.

## 🔬 Hook Diagnostics

Workspace lifecycle hooks (`after_create`, `before_run`) are critical for setting up the environment (e.g., `npm install`). 
- If a hook fails, you can click the **status badge** in the Issue Detail view to see the **raw execution transcript**.
- This eliminates the "Silent Failure" problem where agents fail because the environment wasn't ready.
