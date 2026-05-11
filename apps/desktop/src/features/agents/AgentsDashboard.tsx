// apps/desktop/src/widgets/agents/AgentsDashboard.tsx
import { useEffect, useState, useMemo } from 'react'
import { useAppStore } from '@core/store'
import { AlertCircle } from 'lucide-react'
import type { BackendConfig, Project } from '@core/api/types'
import type { ProviderFileEntry } from '@core/api/client'
import { Skeleton } from '@ui/skeleton'
import { Button } from '@ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@ui/dialog'
import { OverviewPanel, type ProviderSummary } from './panels/OverviewPanel'
import { ProjectSelector } from './components/ProjectSelector'
import { ScopeToggle } from './components/ScopeToggle'
import { computeClaudeSummary, computeClaudeProjectSummary } from './hooks/use-overview-summary'
import { SettingsPanel } from './panels/SettingsPanel'
import { InstructionsPanel } from './panels/InstructionsPanel'
import { SkillsPanel } from './panels/SkillsPanel'
import { HooksPanel } from './panels/HooksPanel'
import { MCPPanel } from './panels/MCPPanel'
import { RulesPanel } from './panels/RulesPanel'
import { SubAgentsPanel } from './panels/SubAgentsPanel'
import type { FileResourceItem } from './panels/FileResourcePanel'
import { PermissionsPanel } from './panels/PermissionsPanel'
import { CodexInstructionsPanel } from './panels/CodexInstructionsPanel'
import { CodexConfigPanel } from './panels/CodexConfigPanel'
import { CodexApprovalsPanel } from './panels/CodexApprovalsPanel'
import { CodexModelPanel } from './panels/CodexModelPanel'
import { CodexEnvironmentPanel } from './panels/CodexEnvironmentPanel'
import { CodexProfilesPanel } from './panels/CodexProfilesPanel'
import { CodexSubAgentsPanel } from './panels/CodexSubAgentsPanel'
import { CodexSkillsPanel } from './panels/CodexSkillsPanel'
import { CodexRulesPanel } from './panels/CodexRulesPanel'
import { GeminiContextPanel } from './panels/GeminiContextPanel'
import { GeminiSettingsPanel } from './panels/GeminiSettingsPanel'
import { GeminiCommandsPanel } from './panels/GeminiCommandsPanel'
import { GeminiModelPanel } from './panels/GeminiModelPanel'
import { GeminiPermissionsPanel } from './panels/GeminiPermissionsPanel'
import { OpenCodeConfigPanel } from './panels/OpenCodeConfigPanel'
import { OpenCodeInstructionsPanel } from './panels/OpenCodeInstructionsPanel'
import { OpenCodeAgentsPanel } from './panels/OpenCodeAgentsPanel'
import { OpenCodeCommandsPanel } from './panels/OpenCodeCommandsPanel'
import { OpenCodeSkillsPanel } from './panels/OpenCodeSkillsPanel'
import { OpenCodeModelPanel } from './panels/OpenCodeModelPanel'
import { OpenCodePermissionsPanel } from './panels/OpenCodePermissionsPanel'
import { useClaudeConfig } from './hooks/use-claude-config'
import { useCodexConfig, useGeminiConfig, useOpenCodeConfig } from './hooks/use-provider-domain-config'
import { CLAUDE_CATEGORIES, CODEX_CATEGORIES, GEMINI_CATEGORIES, OPENCODE_CATEGORIES, EIGHTGENT_CATEGORIES } from './constants'
import type { Provider, CategoryId, Scope } from './types'

interface AgentsDashboardProps {
  config: BackendConfig | null
}

export function AgentsDashboard({ config }: AgentsDashboardProps) {
  const provider = useAppStore(s => s.activeAgentProvider) as Provider
  const setProvider = useAppStore(s => s.setActiveAgentProvider)
  const category = useAppStore(s => s.activeAgentCategory) as CategoryId
  const setCategory = useAppStore(s => s.setActiveAgentCategory)
  const setAgentCategories = useAppStore(s => s.setAgentCategories)
  const setAgentCategoryCounts = useAppStore(s => s.setAgentCategoryCounts)
  const scope = useAppStore(s => s.activeAgentScope)
  const projectId = useAppStore(s => s.activeAgentProjectId)
  // Agent Hub (overview/scope-toggle) state — separate from legacy activeAgentScope/projectId
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

  useEffect(() => {
    if (agentHubProjectId === null && selectedProjectID) {
      setAgentHubProjectId(selectedProjectID)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectID])

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
  // We always fetch the global snapshot, and additionally fetch the project
  // snapshot when a project is selected in the hub.
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

  useEffect(() => {
    if (!categories.some(item => item.id === category)) {
      setCategory('overview')
    }
  }, [categories, category])

  // Reset to Overview whenever the provider changes
  useEffect(() => {
    setCategory('overview')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  useEffect(() => {
    setAgentCategories(categories.map(c => ({ id: c.id, label: c.label, icon: c.icon })))
  }, [categories, setAgentCategories])

  // Category counts for Claude and 8gent (same structure)
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

  // Legacy category counts
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

  const categoryCounts = isClaudeOrEightgent ? claudeCounts : legacyCounts

  useEffect(() => {
    setAgentCategoryCounts(categoryCounts)
  }, [categoryCounts, setAgentCategoryCounts])

  const providerItems = useMemo(() => {
    if (isClaudeOrEightgent) {
      return {
        config: [] as FileResourceItem[],
        instructions: [] as FileResourceItem[],
        context: [] as FileResourceItem[],
        agents: [] as FileResourceItem[],
        skills: [] as FileResourceItem[],
        commands: [] as FileResourceItem[],
        rules: [] as FileResourceItem[],
      }
    }

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

  const handleSelectCategory = (id: CategoryId) => {
    setCategory(id)
  }

  // Build provider summaries for the Overview panel.
  // For Claude/8gent we compose from useClaudeConfig data; for other providers
  // we render an honest null-stub until provider-specific builders land.
  const emptySummary: ProviderSummary = {
    model: null,
    instructionsLines: null,
    skillsCount: null,
    mcpCount: null,
    hooksCount: null,
    subAgentsCount: null,
  }

  const claudeGlobalBundle = useMemo(() => ({
    settings: { model: (claudeGlobal.settings as { model?: string | null })?.model ?? null },
    claudeMd: claudeGlobal.instructionsExists ? claudeGlobal.instructions : null,
    skills: claudeGlobal.skills.map(s => ({ name: s.name })),
    hooks: claudeGlobal.hooks,
    mcpServers: Object.fromEntries(
      [
        ...claudeGlobal.providerMcpServers.map((s, i) => [s.name ?? `provider-${i}`, s]),
        ...claudeGlobal.orchestraMcpServers.map((s, i) => [s.name ?? `orchestra-${i}`, s]),
      ] as Array<[string, unknown]>,
    ),
    subAgents: claudeGlobal.subagents.map(a => ({ name: a.name })),
  }), [claudeGlobal])

  const overviewSummaryGlobal: ProviderSummary = useMemo(() => {
    if (isClaudeOrEightgent) {
      return computeClaudeSummary(claudeGlobalBundle)
    }
    return emptySummary
  }, [isClaudeOrEightgent, claudeGlobalBundle])

  const overviewSummaryProject: ProviderSummary | null = useMemo(() => {
    if (!isClaudeOrEightgent) return null
    if (!agentHubProjectId) return null
    return computeClaudeProjectSummary(
      claudeGlobalBundle,
      {
        settings: { model: (claudeProject.settings as { model?: string | null })?.model ?? null },
        claudeMd: claudeProject.instructionsExists ? claudeProject.instructions : null,
        skills: claudeProject.skills.map(s => ({ name: s.name })),
        hooks: claudeProject.hooks,
        mcpServers: Object.fromEntries(
          [
            ...claudeProject.providerMcpServers.map((s, i) => [s.name ?? `provider-${i}`, s]),
            ...claudeProject.orchestraMcpServers.map((s, i) => [s.name ?? `orchestra-${i}`, s]),
          ] as Array<[string, unknown]>,
        ),
        subAgents: claudeProject.subagents.map(a => ({ name: a.name })),
      },
    )
  }, [isClaudeOrEightgent, agentHubProjectId, claudeGlobalBundle, claudeProject])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {state.error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center gap-2 shrink-0">
          <AlertCircle size={12} className="text-red-400 shrink-0" />
          <span className="text-[10px] text-red-400 font-medium truncate">{state.error}</span>
          <button onClick={() => state.setError('')} className="ml-auto text-red-400/60 hover:text-red-400 text-xs">&times;</button>
        </div>
      )}

      {/* Top bar: project selector + scope toggle */}
      <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-border/20 bg-card/20 shrink-0">
        {category !== 'overview' && (
          <ScopeToggle
            scope={agentHubScope}
            projectName={selectedProject?.name ?? null}
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
        {/* Detail panel */}
        <div className="flex flex-1 min-h-0">
            <div className="flex-1 min-w-0 min-h-0">
              {category === 'overview' ? (
                <OverviewPanel
                  provider={provider}
                  projectName={selectedProject?.name ?? null}
                  globalSummary={overviewSummaryGlobal}
                  projectSummary={overviewSummaryProject}
                  onNavigate={(nextCategory, nextScope) => requestAgentHubNav(() => {
                    setAgentHubScope(nextScope)
                    setCategory(nextCategory)
                  })}
                />
              ) : state.loading ? (
                <div className="p-6 space-y-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-[300px] w-full" /></div>
              ) : isClaudeOrEightgent ? (
                <>
                  {category === 'settings' && (
                    <SettingsPanel
                      settings={claude.settings}
                      globalSettings={claudeGlobal.settings}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      settingsPath={claude.settingsPath}
                      settingsExists={claude.settingsExists}
                      saving={claude.saving}
                      onSave={claude.saveSettings}
                    />
                  )}
                  {category === 'instructions' && (
                    <InstructionsPanel
                      content={claude.instructions}
                      path={claude.instructionsPath}
                      exists={claude.instructionsExists}
                      saving={claude.saving}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      onSave={claude.saveInstructions}
                      onDelete={claude.deleteInstructions}
                    />
                  )}
                  {category === 'hooks' && (
                    <HooksPanel
                      hooks={claude.hooks}
                      globalHooks={claudeGlobal.hooks}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      onSave={claude.saveHooks}
                      loading={claude.loading}
                      saving={claude.saving}
                      provider="claude"
                    />
                  )}
                  {category === 'mcp' && (
                    <MCPPanel
                      providerServers={claude.providerMcpServers}
                      orchestraServers={claude.orchestraMcpServers}
                      globalProviderServers={claudeGlobal.providerMcpServers}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      onAddProvider={claude.addMCPServer}
                      onUpdateProvider={claude.updateMCPServer}
                      onToggleProvider={claude.toggleMCPServer}
                      onDeleteProvider={claude.deleteMCPServer}
                      onDeleteOrchestra={claude.deleteOrchestraMCPServer}
                      loading={claude.loading}
                      saving={claude.saving}
                      provider="claude"
                    />
                  )}
                  {category === 'rules' && (
                    <RulesPanel
                      items={claude.rules}
                      globalItems={claudeGlobal.rules}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={claude.saving}
                      onSave={claude.saveRule}
                      onDelete={claude.removeRule}
                    />
                  )}
                  {category === 'skills' && (
                    <SkillsPanel
                      items={claude.skills}
                      globalItems={claudeGlobal.skills}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={claude.saving}
                      onSave={claude.saveSkill}
                      onDelete={claude.removeSkill}
                    />
                  )}
                  {category === 'agents' && (
                    <SubAgentsPanel
                      items={claude.subagents}
                      globalItems={claudeGlobal.subagents}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={claude.saving}
                      onSave={claude.saveSubAgent}
                      onDelete={claude.removeSubAgent}
                    />
                  )}
                </>
              ) : (
                <>
                  {category === 'config' && provider === 'opencode' && (
                    <OpenCodeConfigPanel
                      items={providerItems.config}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={domainState.saving}
                      onSave={opencode.saveConfigResource}
                      onCreate={opencode.createConfigResource}
                    />
                  )}
                  {category === 'config' && provider === 'codex' && (
                    <CodexConfigPanel
                      items={providerItems.config}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={domainState.saving}
                      onSave={codex.saveConfigFile}
                      onCreate={codex.createConfigFile}
                    />
                  )}
                  {category === 'approvals' && provider === 'codex' && (
                    <CodexApprovalsPanel
                      permissions={codex.permissions}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={codex.saving}
                      onSave={codex.savePermissions}
                    />
                  )}
                  {category === 'models' && provider === 'codex' && (
                    <CodexModelPanel
                      modelConfig={codex.modelConfig}
                      configContent={codex.config[0]?.content ?? ''}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={codex.saving}
                      onSave={codex.saveModel}
                      onSaveConfig={(content) => codex.saveConfigFile(codex.config[0]?.path ?? '', content)}
                    />
                  )}
                  {category === 'environment' && provider === 'codex' && (
                    <CodexEnvironmentPanel
                      items={codex.config}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={codex.saving}
                      onSave={codex.saveConfigFile}
                    />
                  )}
                  {category === 'profiles' && provider === 'codex' && (
                    <CodexProfilesPanel
                      items={codex.config}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={codex.saving}
                      onSave={codex.saveConfigFile}
                    />
                  )}
                  {category === 'settings' && (
                    provider === 'gemini' ? (
                      <GeminiSettingsPanel
                        items={providerItems.config}
                        scope={agentHubScope}
                        projectName={selectedProject?.name ?? null}
                        saving={domainState.saving}
                        onSave={gemini.saveSettingsFile}
                        onCreate={gemini.createSettingsResource}
                      />
                    ) : null
                  )}
                  {category === 'models' && provider === 'gemini' && (
                    <GeminiModelPanel
                      modelConfig={gemini.modelConfig}
                      settingsContent={gemini.settings[0]?.content ?? ''}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={gemini.saving}
                      onSave={gemini.saveModel}
                    />
                  )}
                  {category === 'models' && provider === 'opencode' && (
                    <OpenCodeModelPanel
                      modelConfig={opencode.modelConfig}
                      configContent={opencode.config[0]?.content ?? ''}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={opencode.saving}
                      onSave={opencode.saveModel}
                    />
                  )}
                  {category === 'instructions' && (
                    provider === 'codex' ? (
                      <CodexInstructionsPanel
                        items={providerItems.instructions}
                        scope={agentHubScope}
                        projectName={selectedProject?.name ?? null}
                        saving={domainState.saving}
                        onSave={codex.saveInstructionFile}
                        onCreate={codex.createInstructionFile}
                      />
                    ) : (
                      <OpenCodeInstructionsPanel
                        items={providerItems.instructions}
                        scope={agentHubScope}
                        projectName={selectedProject?.name ?? null}
                        saving={domainState.saving}
                        onSave={opencode.saveConfigResource}
                        onCreate={() => opencode.createConfigResource()}
                      />
                    )
                  )}
                  {category === 'context' && (
                    <GeminiContextPanel
                      items={providerItems.context}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={domainState.saving}
                      onSave={gemini.saveContextFile}
                      onCreate={gemini.createContextResource}
                    />
                  )}
                  {category === 'skills' && provider === 'opencode' && (
                    <OpenCodeSkillsPanel
                      items={providerItems.skills}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={domainState.saving}
                      onSave={opencode.saveSkillFile}
                      onDelete={opencode.deleteSkillResource}
                      onCreate={opencode.createSkillResourceFile}
                    />
                  )}
                  {category === 'skills' && provider === 'codex' && (
                    <CodexSkillsPanel
                      items={codex.skills}
                      configContent={codex.config[0]?.content ?? ''}
                      configPath={codex.config[0]?.path ?? ''}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={domainState.saving}
                      onSave={codex.saveSkillFile}
                      onDelete={codex.deleteSkillFile}
                      onCreate={codex.createSkillResource}
                      onSaveConfig={codex.saveConfigFile}
                    />
                  )}
                  {category === 'commands' && provider === 'opencode' && (
                    <OpenCodeCommandsPanel
                      items={providerItems.commands}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={domainState.saving}
                      onSave={opencode.saveCommandFile}
                      onDelete={opencode.deleteCommandResource}
                      onCreate={opencode.createCommandResource}
                    />
                  )}
                  {category === 'commands' && provider === 'gemini' && (
                    <GeminiCommandsPanel
                      items={providerItems.commands}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={domainState.saving}
                      onSave={gemini.saveCommandFile}
                      onDelete={gemini.deleteCommandFile}
                      onCreate={gemini.createCommandResource}
                    />
                  )}
                  {category === 'agents' && provider === 'opencode' && (
                    <OpenCodeAgentsPanel
                      items={providerItems.agents}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={domainState.saving}
                      onSave={opencode.saveAgentFile}
                      onDelete={opencode.deleteAgentFile}
                      onCreate={opencode.createAgentResourceFile}
                    />
                  )}
                  {category === 'agents' && provider === 'codex' && (
                    <CodexSubAgentsPanel
                      items={codex.subagents}
                      configContent={codex.config[0]?.content ?? ''}
                      configPath={codex.config[0]?.path ?? ''}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={domainState.saving}
                      onSave={codex.saveSubagentFile}
                      onDelete={codex.deleteSubagentFile}
                      onCreate={codex.createSubagentFile}
                      onSaveConfig={codex.saveConfigFile}
                    />
                  )}
                  {category === 'hooks' && <HooksPanel hooks={domainState.hooks} onSave={domainState.saveHooks} loading={domainState.loading} saving={domainState.saving} provider={provider} />}
                  {category === 'rules' && provider === 'codex' && (
                    <CodexRulesPanel
                      items={codex.rules}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={codex.saving}
                      onSave={codex.saveRuleFile}
                      onDelete={codex.deleteRuleFile}
                    />
                  )}
                  {category === 'mcp' && (
                    <MCPPanel
                      providerServers={domainState.providerMcpServers}
                      orchestraServers={domainState.orchestraMcpServers}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      onAddProvider={domainState.addMCPServer}
                      onUpdateProvider={domainState.updateMCPServer}
                      onToggleProvider={domainState.toggleMCPServer}
                      onDeleteProvider={domainState.deleteMCPServer}
                      onDeleteOrchestra={domainState.deleteOrchestraMCPServer}
                      loading={domainState.loading}
                      saving={domainState.saving}
                      provider={provider}
                    />
                  )}
                  {category === 'permissions' && provider === 'gemini' && (
                    <GeminiPermissionsPanel
                      settingsPath={gemini.settings[0]?.path ?? ''}
                      settingsContent={gemini.settings[0]?.content ?? ''}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={gemini.saving}
                      onSave={gemini.saveSettingsFile}
                    />
                  )}
                  {category === 'permissions' && provider === 'opencode' && (
                    <OpenCodePermissionsPanel
                      configPath={opencode.config[0]?.path ?? ''}
                      configContent={opencode.config[0]?.content ?? ''}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={opencode.saving}
                      onSave={opencode.saveConfigResource}
                    />
                  )}
                  {category === 'permissions' && provider !== 'gemini' && provider !== 'opencode' && (
                    <PermissionsPanel
                      permissions={domainState.permissions}
                      scope={agentHubScope}
                      projectName={selectedProject?.name ?? null}
                      saving={domainState.saving}
                      onSave={domainState.savePermissions}
                      provider={provider}
                    />
                  )}
                  {!category && (
                    <div className="flex items-center justify-center h-full text-muted-foreground/20">
                      <p className="text-sm font-bold uppercase tracking-widest">Select a category</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <Dialog
          open={!!agentHubPendingNav}
          onOpenChange={(o) => { if (!o) setAgentHubPendingNav(null) }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Discard unsaved changes?</DialogTitle>
              <DialogDescription>
                You have unsaved edits in this panel. Switching will discard them.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setAgentHubPendingNav(null)}>
                Keep editing
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const apply = agentHubPendingNav
                  setAgentHubPendingNav(null)
                  setAgentHubDirty(false)
                  apply?.()
                }}
              >
                Discard
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
  )
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
