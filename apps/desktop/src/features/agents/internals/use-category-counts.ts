import { useMemo } from 'react'
import type { ClaudeConfigState } from '../hooks/use-claude-config'
import type {
  CodexConfigState,
  GeminiConfigState,
  OpenCodeConfigState,
} from '../hooks/use-provider-domain-config'
import type { Provider } from '../types'

export function useCategoryCounts(
  isClaudeOrEightgent: boolean,
  provider: Provider,
  claude: ClaudeConfigState,
  codex: CodexConfigState,
  gemini: GeminiConfigState,
  opencode: OpenCodeConfigState,
): Record<string, number> {
  const claudeCounts = useMemo((): Record<string, number> => {
    if (!isClaudeOrEightgent) return {}
    return {
      settings: 1,
      instructions: claude.instructionsExists ? 1 : 0,
      hooks: claude.hooks.length,
      mcp: claude.providerMcpServers.length + claude.orchestraMcpServers.length,
      rules: claude.rules.length,
      skills: claude.skills.length,
      agents: claude.subagents.length,
    }
  }, [isClaudeOrEightgent, claude])

  const legacyCounts = useMemo((): Record<string, number> => {
    if (isClaudeOrEightgent) return {}

    if (provider === 'codex') {
      return {
        config: codex.config.length,
        approvals: 1,
        models: 1,
        environment: codex.config.length > 0 ? 1 : 0,
        profiles: codex.config.length > 0 ? 1 : 0,
        instructions: codex.instructions.length,
        agents: codex.subagents.length,
        skills: codex.skills.length,
        hooks: codex.hooks.length,
        mcp: codex.providerMcpServers.length + codex.orchestraMcpServers.length,
        rules: codex.rules.length,
      }
    }

    if (provider === 'gemini') {
      return {
        settings: gemini.settings.length,
        models: 1,
        permissions: 1,
        context: gemini.context.length,
        commands: gemini.commands.length,
        mcp: gemini.providerMcpServers.length + gemini.orchestraMcpServers.length,
      }
    }

    return {
      config: opencode.config.length,
      models: 1,
      instructions: opencode.config.length,
      agents: opencode.agents.length,
      commands: opencode.commands.length,
      skills: opencode.skills.length,
      mcp: opencode.providerMcpServers.length + opencode.orchestraMcpServers.length,
      permissions: 1,
    }
  }, [isClaudeOrEightgent, provider, codex, gemini, opencode])

  return isClaudeOrEightgent ? claudeCounts : legacyCounts
}
