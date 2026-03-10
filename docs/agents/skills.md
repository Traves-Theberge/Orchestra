# Behavioral Skills

**Skills** are behavior templates that teach agents how to perform specific tasks or use complex tools more effectively.

## 🧠 How Skills Work

When a new agent turn starts, Orchestra scans the `.codex/skills/` directory. All active skills are injected into the agent's system prompt, providing it with:
- **Best Practices**: Coding standards and workflow requirements.
- **Tool Instruction**: How to interact with system tools like `update_issue`.
- **Strategic Guidance**: Step-by-step reasoning patterns for complex tasks.

## 📂 Skill Structure

Skills are defined as Markdown files with YAML front-matter:

```markdown
---
name: linear
description: Deep integration with Linear issue management.
---

# Linear Integration
Use this skill when you need to update issue status or transition through the workflow.
Always use the `update_issue` tool for these operations.
```

## 🛠️ Managing Skills

You can edit and preview skills in the **Agents** tab:

1.  **Categorized List**: Skills are listed separately from core dotfiles.
2.  **Live Preview**: Toggle to **Preview** mode to see exactly how the rendered Markdown will appear to the agent.
3.  **Hot Reloading**: Skills are read from disk at the start of every turn. You can tune agent behavior mid-session by saving changes to a skill file.

### Default Skills
- `linear`: Linear-specific guidance.
- `commit`: Standards for high-quality git commits.
- `debug`: Framework for systematic root-cause analysis.
- `land`: Landing/merge workflow standards.
