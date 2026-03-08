# Agent Configurations, Skills, and Tools

This document defines the global configuration patterns for agents within the Orchestra platform, including support for Codex, Claude Code, OpenCode, and Gemini.

## 1. Global Agent Configuration

Orchestra uses a centralized configuration model driven by environment variables and `ORCHESTRA.md` (or `WORKFLOW.md`) files.

### Provider Settings

| Provider | ID | Default Command |
| :--- | :--- | :--- |
| **Codex** | `codex` | `codex exec --skip-git-repo-check --json {{prompt}}` |
| **Claude Code** | `claude` | `claude -p {{prompt}} --output-format json` |
| **OpenCode** | `opencode` | `opencode run {{prompt}} --format json` |
| **Gemini** | `gemini` | `gemini run {{prompt}} --json` |

### Environment Overrides

- `ORCHESTRA_AGENT_PROVIDER`: Set the active global provider.
- `ORCHESTRA_AGENT_COMMAND_<PROVIDER>`: Override the execution command for a specific provider.
- `ORCHESTRA_AGENT_MAX_TURNS`: Global limit on agent iterations per session (Default: 3).

## 2. Skills (Knowledge & Guidance)

Skills are located in the `.codex/skills/` directory. They are Markdown files with YAML front-matter that provide agents with specialized domain knowledge and tool-use guidance.

### Skill Structure (`.codex/skills/<name>/SKILL.md`)

```markdown
---
name: skill-name
description: Brief summary of what this skill enables.
---

# Skill Title

Detailed instructions, examples, and tool-use patterns.
```

### Current Skills
- `linear`: Guidance for using `linear_graphql` for issue management.
- `commit`: Standards for atomic, high-quality commits.
- `debug`: Strategies for systematic root-cause analysis.
- `land`: Workflow for landing/merging validated changes.

## 3. Tools (Runtime Capabilities)

Tools are runtime functions exposed to agents during their session.

### Built-in Tools
- `tracker_query`: Inspect high-level tracker state.
- `update_issue`: Transition issues and update metadata.
- `linear_graphql`: Execute raw GraphQL operations against the tracker.

### Model Context Protocol (MCP)
*Note: MCP integration is planned for Phase 4 to allow agents to connect to external service hosts dynamically.*

## 4. Documentation Strategy (`.md` Files)

Orchestra prioritizes "Documentation as Code." Agents are expected to:
1. **Read `ORCHESTRA.md`**: Understand project-specific rules and workflow overrides.
2. **Consult `.codex/skills/`**: Leverage specialized expertise for complex tasks.
3. **Update Specs**: Keep `docs/specs/` in sync with implementation changes.
