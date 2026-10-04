// apps/desktop/src/widgets/agents/hooks/useClaudeConfig.ts
import { useState, useEffect, useCallback } from 'react'
import type { Project } from '@core/api/types'
import type {
  BackendConfig,
  ProviderPermissions, ProviderModelConfig, ProviderHook,
  ProviderMCPServer, MCPServer, MCPTool,
  ClaudeFileEntry,
} from '@core/api/client'
import {
  fetchClaudeSettings, updateClaudeSettings,
  fetchClaudeInstructions, updateClaudeInstructions, deleteClaudeInstructions,
  fetchClaudeRules, updateClaudeRule, deleteClaudeRule,
  fetchClaudeSkills, updateClaudeSkill, deleteClaudeSkill,
  fetchClaudeSubAgents, updateClaudeSubAgent, deleteClaudeSubAgent,
  fetchProjects,
  fetchProviderPermissions, updateProviderPermissions,
  fetchProviderModel, updateProviderModel,
  fetchProviderHooks, updateProviderHooks,
  fetchProviderMCPServers, addProviderMCPServer, updateProviderMCPServer, toggleProviderMCPServer, deleteProviderMCPServer,
  fetchMCPServers, fetchMCPTools,
} from '@core/api/client'
import type { Scope } from '../types'
import { useConfigReadFence } from './use-config-read-fence'

export interface ClaudeConfigState {
  // Settings
  settings: Record<string, unknown>
  settingsPath: string
  settingsExists: boolean

  // Instructions (CLAUDE.md)
  instructions: string
  instructionsPath: string
  instructionsExists: boolean

  // File-based resources
  rules: ClaudeFileEntry[]
  skills: ClaudeFileEntry[]
  subagents: ClaudeFileEntry[]
  projects: Project[]

  // Existing provider config (reused)
  permissions: ProviderPermissions
  modelConfig: ProviderModelConfig
  hooks: ProviderHook[]
  providerMcpServers: ProviderMCPServer[]
  orchestraMcpServers: MCPServer[]
  mcpTools: MCPTool[]

  // State
  loading: boolean
  error: string
  readError: string
  saving: string | null

  // Mutations
  saveSettings: (settings: Record<string, unknown>) => Promise<void>
  saveInstructions: (content: string) => Promise<void>
  deleteInstructions: () => Promise<void>
  saveRule: (name: string, content: string) => Promise<void>
  removeRule: (name: string) => Promise<void>
  saveSkill: (name: string, content: string) => Promise<void>
  removeSkill: (name: string) => Promise<void>
  saveSubAgent: (name: string, content: string) => Promise<void>
  removeSubAgent: (name: string) => Promise<void>
  savePermissions: (perms: ProviderPermissions) => Promise<void>
  saveModel: (model: ProviderModelConfig) => Promise<void>
  saveHooks: (hooks: ProviderHook[]) => Promise<void>
  addMCPServer: (name: string, command: string) => Promise<void>
  updateMCPServer: (name: string, server: Partial<ProviderMCPServer>) => Promise<void>
  toggleMCPServer: (name: string, enabled: boolean) => Promise<void>
  deleteMCPServer: (name: string) => Promise<void>
  deleteOrchestraMCPServer: (name: string) => Promise<void>
  reload: () => Promise<void>
  setError: (msg: string) => void
}

export function useClaudeConfig(
  backendConfig: BackendConfig | null,
  scope: Scope,
  projectId?: string,
): ClaudeConfigState {
  // Settings
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [settingsPath, setSettingsPath] = useState('')
  const [settingsExists, setSettingsExists] = useState(false)

  // Instructions
  const [instructions, setInstructions] = useState('')
  const [instructionsPath, setInstructionsPath] = useState('')
  const [instructionsExists, setInstructionsExists] = useState(false)

  // File resources
  const [rules, setRules] = useState<ClaudeFileEntry[]>([])
  const [skills, setSkills] = useState<ClaudeFileEntry[]>([])
  const [subagents, setSubAgents] = useState<ClaudeFileEntry[]>([])
  const [projects, setProjects] = useState<Project[]>([])

  // Existing provider config
  const [permissions, setPermissions] = useState<ProviderPermissions>({ approval_mode: 'default', allow: [], deny: [], ask: [] })
  const [modelConfig, setModelConfig] = useState<ProviderModelConfig>({ model: '', effort: '', temperature: null })
  const [hooks, setHooks] = useState<ProviderHook[]>([])
  const [providerMcpServers, setProviderMcpServers] = useState<ProviderMCPServer[]>([])
  const [orchestraMcpServers, setOrchestraMcpServers] = useState<MCPServer[]>([])
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([])

  // State
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  const scopeStr = scope === 'PROJECT' ? 'project' : 'global'
  const projId = scope === 'PROJECT' ? projectId : undefined
  const readTarget = JSON.stringify([backendConfig?.baseUrl, backendConfig?.apiToken, scope, projId])
  const beginRead = useConfigReadFence(readTarget)
  const [readCompletedTarget, setReadCompletedTarget] = useState('')

  const reload = useCallback(async () => {
    if (!backendConfig) return
    const isCurrent = beginRead()
    setLoading(true)
    setError('')

    try {
      const [
        settingsRes, instructionsRes, rulesRes, skillsRes, subagentsRes,
        projectsRes, permsRes, modelRes, hooksRes,
        provMcpRes, orchMcpRes, mcpToolsRes,
      ] = await Promise.all([
        fetchClaudeSettings(backendConfig, scopeStr, projId),
        fetchClaudeInstructions(backendConfig, scopeStr, projId),
        fetchClaudeRules(backendConfig, scopeStr, projId),
        fetchClaudeSkills(backendConfig, scopeStr, projId),
        fetchClaudeSubAgents(backendConfig, scopeStr, projId),
        fetchProjects(backendConfig),
        fetchProviderPermissions(backendConfig, 'claude', projId, scopeStr),
        fetchProviderModel(backendConfig, 'claude', projId, scopeStr),
        fetchProviderHooks(backendConfig, 'claude', scopeStr, projId),
        fetchProviderMCPServers(backendConfig, 'claude', projId),
        fetchMCPServers(backendConfig),
        fetchMCPTools(backendConfig),
      ])

      if (!isCurrent()) return
      setSettings(settingsRes.settings as Record<string, unknown>)
      setSettingsPath(settingsRes.path)
      setSettingsExists(settingsRes.exists)
      setInstructions(instructionsRes.content)
      setInstructionsPath(instructionsRes.path)
      setInstructionsExists(instructionsRes.exists)
      setRules(rulesRes.items ?? [])
      setSkills(skillsRes.items ?? [])
      setSubAgents(subagentsRes.items ?? [])
      setProjects(projectsRes ?? [])
      setPermissions(permsRes)
      setModelConfig(modelRes)
      setHooks(hooksRes ?? [])
      setProviderMcpServers(provMcpRes ?? [])
      setOrchestraMcpServers(orchMcpRes ?? [])
      setMcpTools(mcpToolsRes ?? [])
      setReadError('')
    } catch (e) {
      if (!isCurrent()) return
      setReadError(e instanceof Error ? e.message : String(e))
    } finally {
      if (isCurrent()) {
        setReadCompletedTarget(readTarget)
        setLoading(false)
      }
    }
  }, [backendConfig, scopeStr, projId, beginRead, readTarget])

  useEffect(() => {
    let cancelled = false
    reload().finally(() => { if (cancelled) return })
    return () => { cancelled = true }
  }, [reload])

  // Mutations
  const saveSettings = useCallback(async (s: Record<string, unknown>) => {
    if (!backendConfig) return
    setSaving('settings')
    try {
      await updateClaudeSettings(backendConfig, scopeStr, s, projId)
      setSettings(s)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, scopeStr, projId])

  const saveInstructions = useCallback(async (content: string) => {
    if (!backendConfig) return
    setSaving('instructions')
    try {
      await updateClaudeInstructions(backendConfig, scopeStr, content, projId, instructionsPath)
      setInstructions(content)
      setInstructionsExists(true)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, scopeStr, projId, instructionsPath])

  const deleteInstructions = useCallback(async () => {
    if (!backendConfig) return
    setSaving('instructions')
    try {
      await deleteClaudeInstructions(backendConfig, scopeStr, projId)
      setInstructions('')
      setInstructionsExists(false)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, scopeStr, projId])

  const saveRule = useCallback(async (name: string, content: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await updateClaudeRule(backendConfig, scopeStr, name, content, projId)
      setRules(prev => {
        const idx = prev.findIndex(r => r.name === name)
        if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], content }; return next }
        return [...prev, { name, content, path: '' }]
      })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, scopeStr, projId])

  const removeRule = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await deleteClaudeRule(backendConfig, scopeStr, name, projId)
      setRules(prev => prev.filter(r => r.name !== name))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, scopeStr, projId])

  const saveSkill = useCallback(async (name: string, content: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await updateClaudeSkill(backendConfig, scopeStr, name, content, projId)
      setSkills(prev => {
        const idx = prev.findIndex(r => r.name === name)
        if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], content }; return next }
        return [...prev, { name, content, path: '' }]
      })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, scopeStr, projId])

  const removeSkill = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await deleteClaudeSkill(backendConfig, scopeStr, name, projId)
      setSkills(prev => prev.filter(r => r.name !== name))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, scopeStr, projId])

  const saveSubAgent = useCallback(async (name: string, content: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await updateClaudeSubAgent(backendConfig, scopeStr, name, content, projId)
      setSubAgents(prev => {
        const idx = prev.findIndex(r => r.name === name)
        if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], content }; return next }
        return [...prev, { name, content, path: '' }]
      })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, scopeStr, projId])

  const removeSubAgent = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await deleteClaudeSubAgent(backendConfig, scopeStr, name, projId)
      setSubAgents(prev => prev.filter(r => r.name !== name))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, scopeStr, projId])

  const savePermissions = useCallback(async (perms: ProviderPermissions) => {
    if (!backendConfig) return
    setSaving('permissions')
    try {
      await updateProviderPermissions(backendConfig, 'claude', perms, projId, scopeStr)
      setPermissions(perms)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, projId, scopeStr])

  const saveModel = useCallback(async (model: ProviderModelConfig) => {
    if (!backendConfig) return
    setSaving('model')
    try {
      await updateProviderModel(backendConfig, 'claude', model, projId, scopeStr)
      setModelConfig(model)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, projId, scopeStr])

  const saveHooks = useCallback(async (h: ProviderHook[]) => {
    if (!backendConfig) return
    setSaving('hooks')
    try {
      await updateProviderHooks(backendConfig, 'claude', h, scopeStr, projId)
      setHooks(h)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, projId, scopeStr])

  const addMCP = useCallback(async (name: string, command: string) => {
    if (!backendConfig) return
    if (scope === 'PROJECT') {
      setError('Project MCP editing is unavailable; switch to Global to edit account MCP settings.')
      return
    }
    setSaving('mcp')
    try {
      await addProviderMCPServer(backendConfig, 'claude', { name, command, args: [] })
      await reload()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, reload, scope])

  const updateMCP = useCallback(async (name: string, server: Partial<ProviderMCPServer>) => {
    if (!backendConfig) return
    if (scope === 'PROJECT') {
      setError('Project MCP editing is unavailable; switch to Global to edit account MCP settings.')
      return
    }
    setSaving('mcp')
    try {
      await updateProviderMCPServer(backendConfig, 'claude', name, server)
      await reload()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, reload, scope])

  const toggleMCP = useCallback(async (name: string, enabled: boolean) => {
    if (!backendConfig) return
    if (scope === 'PROJECT') {
      setError('Project MCP editing is unavailable; switch to Global to edit account MCP settings.')
      return
    }
    setSaving('mcp')
    try {
      await toggleProviderMCPServer(backendConfig, 'claude', name, enabled)
      // Update local state immediately for better UX
      setProviderMcpServers(prev => prev.map(s => s.name === name ? { ...s, enabled } : s))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, scope])

  const deleteMCP = useCallback(async (name: string) => {
    if (!backendConfig) return
    if (scope === 'PROJECT') {
      setError('Project MCP editing is unavailable; switch to Global to edit account MCP settings.')
      return
    }
    setSaving('mcp')
    try {
      await deleteProviderMCPServer(backendConfig, 'claude', name)
      setProviderMcpServers(prev => prev.filter(s => s.name !== name))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, scope])

  const deleteOrchMCP = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving('mcp')
    try {
      const srv = orchestraMcpServers.find(s => s.name === name)
      if (srv?.id) {
        const { deleteMCPServer: delMcp } = await import('@core/api/client')
        await delMcp(backendConfig, srv.id)
        setOrchestraMcpServers(prev => prev.filter(s => s.name !== name))
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }, [backendConfig, orchestraMcpServers])

  return {
    settings, settingsPath, settingsExists,
    instructions, instructionsPath, instructionsExists,
    rules, skills, subagents, projects,
    permissions, modelConfig, hooks,
    providerMcpServers, orchestraMcpServers, mcpTools,
    loading: loading || readCompletedTarget !== readTarget, error, readError, saving,
    saveSettings, saveInstructions, deleteInstructions,
    saveRule, removeRule,
    saveSkill, removeSkill,
    saveSubAgent, removeSubAgent,
    savePermissions, saveModel, saveHooks,
    addMCPServer: addMCP,
    updateMCPServer: updateMCP,
    toggleMCPServer: toggleMCP,
    deleteMCPServer: deleteMCP,
    deleteOrchestraMCPServer: deleteOrchMCP,
    reload, setError,
  }
}
