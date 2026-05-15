// apps/desktop/src/widgets/agents/AgentsDashboard.tsx
import { useMemo, useRef } from 'react'
import { useAppStore } from '@core/store'
import { AlertCircle } from 'lucide-react'
import type { BackendConfig } from '@core/api/types'
import { ProjectSelector } from './components/ProjectSelector'
import { ScopeToggle } from './components/ScopeToggle'
import { useClaudeConfig } from './hooks/use-claude-config'
import { useCodexConfig, useGeminiConfig, useOpenCodeConfig } from './hooks/use-provider-domain-config'
import { CLAUDE_CATEGORIES, CODEX_CATEGORIES, GEMINI_CATEGORIES, OPENCODE_CATEGORIES, EIGHTGENT_CATEGORIES } from './constants'
import type { Provider, CategoryId } from './types'
import { CategoryRouter } from './internals/CategoryRouter'
import { UnsavedNavDialog } from './internals/UnsavedNavDialog'
import { useCategoryBookkeeping } from './internals/use-category-bookkeeping'
import { useCategoryCounts } from './internals/use-category-counts'
import { useProviderItems } from './internals/use-provider-items'
import { useOverviewSummaries } from './internals/use-overview-summaries'

interface AgentsDashboardProps {
  config: BackendConfig | null
}

export function AgentsDashboard({ config }: AgentsDashboardProps) {
  const provider = useAppStore(s => s.activeAgentProvider) as Provider
  const category = useAppStore(s => s.activeAgentCategory) as CategoryId
  const setCategory = useAppStore(s => s.setActiveAgentCategory)
  const scope = useAppStore(s => s.activeAgentScope)
  const projectId = useAppStore(s => s.activeAgentProjectId)
  const projects = useAppStore(s => s.projects)
  const agentHubProjectId = useAppStore(s => s.agentHubProjectId)
  const setAgentHubProjectId = useAppStore(s => s.setAgentHubProjectId)
  const agentHubScope = useAppStore(s => s.agentHubScope)
  const setAgentHubScope = useAppStore(s => s.setAgentHubScope)
  const requestAgentHubNav = useAppStore(s => s.requestAgentHubNav)
  const agentHubPendingNav = useAppStore(s => s.agentHubPendingNav)
  const setAgentHubPendingNav = useAppStore(s => s.setAgentHubPendingNav)
  const setAgentHubDirty = useAppStore(s => s.setAgentHubDirty)
  const selectedProjectID = useAppStore(s => s.selectedProjectID)
  const selectedProject = agentHubProjectId
    ? projects.find(p => p.id === agentHubProjectId) ?? null
    : null

  const bootstrappedProjectIdRef = useRef<string | null>(null)
  // Set-during-render bootstrap: intentional alternative to a useEffect to avoid an extra render.
  // eslint-disable-next-line react-hooks/refs
  if (agentHubProjectId === null && selectedProjectID && bootstrappedProjectIdRef.current !== selectedProjectID) {
    // eslint-disable-next-line react-hooks/refs
    bootstrappedProjectIdRef.current = selectedProjectID
    setAgentHubProjectId(selectedProjectID)
  }

  const isClaude = provider === 'claude'
  const is8gent = provider === '8gent'
  const isClaudeOrEightgent = isClaude || is8gent

  // Claude and 8gent share the same config structure (CLAUDE.md, .claude/settings.json, hooks)
  const claude = useClaudeConfig(
    isClaudeOrEightgent ? config : null,
    scope,
    projectId || undefined,
  )

  // For the Overview panel we need both global and project snapshots.
  const claudeGlobal = useClaudeConfig(
    isClaudeOrEightgent ? config : null,
    'GLOBAL',
    undefined,
  )
  const claudeProject = useClaudeConfig(
    isClaudeOrEightgent && agentHubProjectId ? config : null,
    'PROJECT',
    agentHubProjectId || undefined,
  )

  const codex = useCodexConfig(
    provider === 'codex' ? config : null,
    scope,
    projectId || undefined,
  )
  const gemini = useGeminiConfig(
    provider === 'gemini' ? config : null,
    scope,
    projectId || undefined,
  )
  const opencode = useOpenCodeConfig(
    provider === 'opencode' ? config : null,
    scope,
    projectId || undefined,
  )

  const domainState = provider === 'codex'
    ? codex
    : provider === 'gemini'
      ? gemini
      : opencode
  const state = isClaudeOrEightgent ? claude : domainState

  const categories = useMemo(() => {
    switch (provider) {
      case 'claude':
        return CLAUDE_CATEGORIES
      case 'codex':
        return CODEX_CATEGORIES
      case 'gemini':
        return GEMINI_CATEGORIES
      case 'opencode':
        return OPENCODE_CATEGORIES
      case '8gent':
        return EIGHTGENT_CATEGORIES
      default:
        return CLAUDE_CATEGORIES
    }
  }, [provider])

  const categoryCounts = useCategoryCounts(isClaudeOrEightgent, provider, claude, codex, gemini, opencode)
  useCategoryBookkeeping(provider, category, categories, categoryCounts)

  const providerItems = useProviderItems(isClaudeOrEightgent, provider, codex, gemini, opencode)

  const { globalSummary, projectSummary } = useOverviewSummaries(
    isClaudeOrEightgent,
    agentHubProjectId,
    claudeGlobal,
    claudeProject,
  )

  const selectedProjectName = selectedProject?.name ?? null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {state.error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center gap-2 shrink-0">
          <AlertCircle size={12} className="text-red-400 shrink-0" />
          <span className="text-[10px] text-red-400 font-medium truncate">{state.error}</span>
          <button onClick={() => state.setError('')} className="ml-auto text-red-400/60 hover:text-red-400 text-xs">&times;</button>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-border/20 bg-card/20 shrink-0">
        {category !== 'overview' && (
          <ScopeToggle
            scope={agentHubScope}
            projectName={selectedProjectName}
            onChange={(s) => requestAgentHubNav(() => setAgentHubScope(s))}
          />
        )}
        <ProjectSelector
          projects={projects}
          selectedId={agentHubProjectId}
          onChange={(id) => requestAgentHubNav(() => setAgentHubProjectId(id))}
        />
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 min-h-0">
            <CategoryRouter
              provider={provider}
              category={category}
              isClaudeOrEightgent={isClaudeOrEightgent}
              agentHubScope={agentHubScope}
              agentHubProjectId={agentHubProjectId}
              selectedProjectName={selectedProjectName}
              overviewSummaryGlobal={globalSummary}
              overviewSummaryProject={projectSummary}
              onOverviewNavigate={(nextCategory, nextScope) => requestAgentHubNav(() => {
                setAgentHubScope(nextScope)
                setCategory(nextCategory)
              })}
              state={state}
              domainState={domainState}
              claude={claude}
              claudeGlobal={claudeGlobal}
              codex={codex}
              gemini={gemini}
              opencode={opencode}
              providerItems={providerItems}
            />
          </div>
        </div>
      </div>

      <UnsavedNavDialog
        pendingNav={agentHubPendingNav}
        setPendingNav={setAgentHubPendingNav}
        setDirty={setAgentHubDirty}
      />
    </div>
  )
}
