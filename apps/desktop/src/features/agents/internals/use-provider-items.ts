import { useMemo } from 'react'
import type { ProviderFileEntry } from '@core/api/client'
import type { FileResourceItem } from '../panels/FileResourcePanel'
import type {
  CodexConfigState,
  GeminiConfigState,
  OpenCodeConfigState,
} from '../hooks/use-provider-domain-config'
import type { Provider } from '../types'

export interface ProviderItems {
  config: FileResourceItem[]
  instructions: FileResourceItem[]
  context: FileResourceItem[]
  agents: FileResourceItem[]
  skills: FileResourceItem[]
  commands: FileResourceItem[]
  rules: FileResourceItem[]
}

const EMPTY_ITEMS: ProviderItems = {
  config: [],
  instructions: [],
  context: [],
  agents: [],
  skills: [],
  commands: [],
  rules: [],
}

export function useProviderItems(
  isClaudeOrEightgent: boolean,
  provider: Provider,
  codex: CodexConfigState,
  gemini: GeminiConfigState,
  opencode: OpenCodeConfigState,
): ProviderItems {
  return useMemo(() => {
    if (isClaudeOrEightgent) return EMPTY_ITEMS

    return {
      config: provider === 'codex'
        ? toResourceItems(provider, codex.config)
        : provider === 'gemini'
          ? toResourceItems(provider, gemini.settings)
          : toResourceItems(provider, opencode.config),
      instructions: provider === 'codex'
        ? toResourceItems(provider, codex.instructions).sort(compareStackItems)
        : toResourceItems(provider, opencode.config),
      context: toResourceItems(provider, gemini.context).sort(compareStackItems),
      agents: provider === 'codex'
        ? toResourceItems(provider, codex.subagents)
        : toResourceItems(provider, opencode.agents),
      skills: provider === 'codex'
        ? toResourceItems(provider, codex.skills)
        : toResourceItems(provider, opencode.skills),
      commands: provider === 'gemini'
        ? toResourceItems(provider, gemini.commands)
        : toResourceItems(provider, opencode.commands),
      rules: provider === 'codex'
        ? toResourceItems(provider, codex.rules)
        : [] as FileResourceItem[],
    }
  }, [isClaudeOrEightgent, provider, codex, gemini, opencode])
}

function toResourceItems(provider: Provider, entries: ProviderFileEntry[]): FileResourceItem[] {
  return entries.map((entry) => ({
    key: entry.path,
    name: buildResourceName(provider, entry),
    path: entry.path,
    content: entry.content,
  }))
}

function buildResourceName(provider: Provider, entry: ProviderFileEntry): string {
  const path = entry.path
  const parts = path.split('/')
  const base = parts[parts.length - 1] ?? path
  const parent = parts[parts.length - 2] ?? ''

  if (provider === 'codex') {
    if (base === 'SKILL.md') return parent || base
    return base
  }

  if (provider === 'gemini') {
    return base
  }

  if (provider === 'opencode') {
    if (base === 'SKILL.md') return parent || base
    return base
  }

  return base
}

function compareStackItems(a: FileResourceItem, b: FileResourceItem): number {
  return stackWeight(a) - stackWeight(b) || a.path.localeCompare(b.path)
}

function stackWeight(item: FileResourceItem): number {
  const lowerPath = item.path.toLowerCase()
  if (lowerPath.endsWith('agents.md')) return 10
  if (lowerPath.endsWith('agents.override.md')) return 20
  return 30
}
