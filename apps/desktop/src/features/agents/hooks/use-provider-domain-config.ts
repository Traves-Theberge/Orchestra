import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Project } from '@core/api/types'
import type {
  BackendConfig,
  ProviderPermissions, ProviderModelConfig, ProviderHook,
  ProviderMCPServer, MCPServer, MCPTool, ProviderFileEntry,
} from '@core/api/client'
import {
  fetchProjects,
  fetchMCPTools, fetchMCPServers, deleteMCPServer,
  fetchProviderMCPServers, addProviderMCPServer, updateProviderMCPServer, toggleProviderMCPServer, deleteProviderMCPServer,
  fetchProviderPermissions, updateProviderPermissions,
  fetchProviderModel, updateProviderModel,
  fetchProviderHooks, updateProviderHooks,
  fetchCodexConfigFiles, saveCodexConfigFile, createCodexConfigFile, fetchCodexInstructionFiles, saveCodexInstructionFile, createCodexInstructionFile, fetchCodexSubAgents, saveCodexSubAgent, createCodexSubAgent, fetchCodexSkills, saveCodexSkill, createCodexSkill,
  deleteCodexSubAgent, deleteCodexSkill, fetchCodexRules, saveCodexRule, deleteCodexRule,
  fetchOpenCodeConfigFiles, saveOpenCodeConfigFile, createOpenCodeConfigFile, fetchOpenCodeAgentsFiles, saveOpenCodeAgentFile, createOpenCodeAgentFile, fetchOpenCodeCommandsFiles, saveOpenCodeCommandFile, createOpenCodeCommandFile, fetchOpenCodeSkillsFiles, saveOpenCodeSkillFile, createOpenCodeSkillFile,
  deleteOpenCodeAgentFile, deleteOpenCodeCommandFile, deleteOpenCodeSkillFile,
} from '@core/api/client'
import type { Provider, Scope } from '../types'
import { useConfigReadFence } from './use-config-read-fence'

interface ProviderCommonState {
  projects: Project[]
  permissions: ProviderPermissions
  modelConfig: ProviderModelConfig
  hooks: ProviderHook[]
  providerMcpServers: ProviderMCPServer[]
  orchestraMcpServers: MCPServer[]
  mcpTools: MCPTool[]
  loading: boolean
  error: string
  readError: string
  saving: string | null
  saveFile: (path: string, content: string) => Promise<void>
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

export interface CodexConfigState extends ProviderCommonState {
  config: ProviderFileEntry[]
  instructions: ProviderFileEntry[]
  subagents: ProviderFileEntry[]
  skills: ProviderFileEntry[]
  rules: ProviderFileEntry[]
  saveConfigFile: (path: string, content: string) => Promise<void>
  saveInstructionFile: (path: string, content: string) => Promise<void>
  saveSubagentFile: (path: string, content: string) => Promise<void>
  saveSkillFile: (path: string, content: string) => Promise<void>
  saveRuleFile: (name: string, content: string) => Promise<void>
  deleteSubagentFile: (name: string) => Promise<void>
  deleteSkillFile: (name: string) => Promise<void>
  deleteRuleFile: (name: string) => Promise<void>
  createConfigFile: () => Promise<void>
  createInstructionFile: () => Promise<void>
  createSubagentFile: (name: string) => Promise<void>
  createSkillResource: (name: string) => Promise<void>
}

export interface OpenCodeConfigState extends ProviderCommonState {
  config: ProviderFileEntry[]
  agents: ProviderFileEntry[]
  commands: ProviderFileEntry[]
  skills: ProviderFileEntry[]
  saveConfigResource: (path: string, content: string) => Promise<void>
  saveAgentFile: (path: string, content: string) => Promise<void>
  saveCommandFile: (path: string, content: string) => Promise<void>
  saveSkillFile: (path: string, content: string) => Promise<void>
  deleteAgentFile: (name: string) => Promise<void>
  deleteCommandResource: (name: string) => Promise<void>
  deleteSkillResource: (name: string) => Promise<void>
  createConfigResource: () => Promise<void>
  createAgentResourceFile: (name: string) => Promise<void>
  createCommandResource: (name: string) => Promise<void>
  createSkillResourceFile: (name: string) => Promise<void>
}

function useProviderCommon(backendConfig: BackendConfig | null, provider: Provider, scope: Scope, projectId?: string) {
  const [projects, setProjects] = useState<Project[]>([])
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([])
  const [orchestraMcpServers, setOrchestraMcpServers] = useState<MCPServer[]>([])
  const [providerMcpServers, setProviderMcpServers] = useState<ProviderMCPServer[]>([])
  const [permissions, setPermissions] = useState<ProviderPermissions>({ approval_mode: 'default', allow: [], deny: [], ask: [] })
  const [modelConfig, setModelConfig] = useState<ProviderModelConfig>({ model: '', effort: '', temperature: null })
  const [hooks, setHooks] = useState<ProviderHook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  const projId = scope === 'PROJECT' ? projectId : undefined
  const readTarget = JSON.stringify([backendConfig?.baseUrl, backendConfig?.apiToken, scope, projId])
  const beginRead = useConfigReadFence(readTarget)
  const [readCompletedTarget, setReadCompletedTarget] = useState('')

  const loadCommon = useCallback(async () => {
    if (!backendConfig) return
    const isCurrent = beginRead()
    const [projs, tools, orchestraServers, providerServers, perms, model, providerHooks] = await Promise.all([
      fetchProjects(backendConfig),
      fetchMCPTools(backendConfig),
      fetchMCPServers(backendConfig),
      fetchProviderMCPServers(backendConfig, provider, projId),
      fetchProviderPermissions(backendConfig, provider, projId, scope.toLowerCase()),
      fetchProviderModel(backendConfig, provider, projId, scope.toLowerCase()),
      fetchProviderHooks(backendConfig, provider, scope.toLowerCase(), projId),
    ])
    if (!isCurrent()) return
    setProjects(projs)
    setMcpTools(tools)
    setOrchestraMcpServers(orchestraServers)
    setProviderMcpServers(providerServers)
    setPermissions(perms)
    setModelConfig(model)
    setHooks(providerHooks)
  }, [backendConfig, provider, projId, scope, beginRead])

  const savePermissions = useCallback(async (perms: ProviderPermissions) => {
    if (!backendConfig) return
    setSaving('permissions')
    try {
      await updateProviderPermissions(backendConfig, provider, perms, projId, scope.toLowerCase())
      setPermissions(perms)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, provider, projId, scope])

  const saveModel = useCallback(async (model: ProviderModelConfig) => {
    if (!backendConfig) return
    setSaving('model')
    try {
      await updateProviderModel(backendConfig, provider, model, projId, scope.toLowerCase())
      setModelConfig(model)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save model config')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, provider, projId, scope])

  const saveHooks = useCallback(async (nextHooks: ProviderHook[]) => {
    if (!backendConfig) return
    setSaving('hooks')
    try {
      await updateProviderHooks(backendConfig, provider, nextHooks, scope.toLowerCase(), projId)
      setHooks(nextHooks)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save hooks')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, provider, projId, scope])

  const reloadMcp = useCallback(async () => {
    if (!backendConfig) return
    const [providerServers, orchestraServers] = await Promise.all([
      fetchProviderMCPServers(backendConfig, provider, projId).catch(() => [] as ProviderMCPServer[]),
      fetchMCPServers(backendConfig).catch(() => [] as MCPServer[]),
    ])
    setProviderMcpServers(providerServers)
    setOrchestraMcpServers(orchestraServers)
  }, [backendConfig, provider, projId])

  const addMCPServer = useCallback(async (name: string, command: string) => {
    if (!backendConfig) return
    if (scope === 'PROJECT') {
      setError('Project MCP editing is unavailable; switch to Global to edit account MCP settings.')
      return
    }
    setSaving('mcp')
    try {
      await addProviderMCPServer(backendConfig, provider, { name, command })
      await reloadMcp()
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add MCP server')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, provider, reloadMcp, scope])

  const updateMCPServer = useCallback(async (name: string, server: Partial<ProviderMCPServer>) => {
    if (!backendConfig) return
    if (scope === 'PROJECT') {
      setError('Project MCP editing is unavailable; switch to Global to edit account MCP settings.')
      return
    }
    setSaving('mcp')
    try {
      await updateProviderMCPServer(backendConfig, provider, name, server)
      await reloadMcp()
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update MCP server')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, provider, reloadMcp, scope])

  const toggleMCPServer = useCallback(async (name: string, enabled: boolean) => {
    if (!backendConfig) return
    if (scope === 'PROJECT') {
      setError('Project MCP editing is unavailable; switch to Global to edit account MCP settings.')
      return
    }
    setSaving('mcp')
    try {
      await toggleProviderMCPServer(backendConfig, provider, name, enabled)
      await reloadMcp()
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle MCP server')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, provider, reloadMcp, scope])

  const deleteProviderServer = useCallback(async (name: string) => {
    if (!backendConfig) return
    if (scope === 'PROJECT') {
      setError('Project MCP editing is unavailable; switch to Global to edit account MCP settings.')
      return
    }
    setSaving('mcp')
    try {
      await deleteProviderMCPServer(backendConfig, provider, name)
      await reloadMcp()
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete MCP server')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, provider, reloadMcp, scope])

  const deleteOrchestraMCPServer = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving('mcp')
    try {
      const orchestraServer = orchestraMcpServers.find(server => server.name === name)
      if (orchestraServer?.id) {
        await deleteMCPServer(backendConfig, orchestraServer.id)
        await reloadMcp()
      }
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete Orchestra MCP server')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, orchestraMcpServers, reloadMcp])

  return useMemo(() => ({
    projects,
    mcpTools,
    orchestraMcpServers,
    providerMcpServers,
    permissions,
    modelConfig,
    hooks,
    loading: loading || readCompletedTarget !== readTarget,
    setLoading,
    setReadCompletedTarget,
    error,
    readError,
    setReadError,
    setError,
    saving,
    setSaving,
    loadCommon,
    savePermissions,
    saveModel,
    saveHooks,
    addMCPServer,
    updateMCPServer,
    toggleMCPServer,
    deleteProviderServer,
    deleteOrchestraMCPServer,
  }), [
    projects,
    mcpTools,
    orchestraMcpServers,
    providerMcpServers,
    permissions,
    modelConfig,
    hooks,
    loading,
    readCompletedTarget,
    readTarget,
    error,
    readError,
    saving,
    setSaving,
    loadCommon,
    savePermissions,
    saveModel,
    saveHooks,
    addMCPServer,
    updateMCPServer,
    toggleMCPServer,
    deleteProviderServer,
    deleteOrchestraMCPServer,
  ])
}

export function useCodexConfig(backendConfig: BackendConfig | null, scope: Scope, projectId?: string): CodexConfigState {
  const common = useProviderCommon(backendConfig, 'codex', scope, projectId)
  const [config, setConfig] = useState<ProviderFileEntry[]>([])
  const [instructions, setInstructions] = useState<ProviderFileEntry[]>([])
  const [subagents, setSubagents] = useState<ProviderFileEntry[]>([])
  const [skills, setSkills] = useState<ProviderFileEntry[]>([])
  const [rules, setRules] = useState<ProviderFileEntry[]>([])
  const projId = scope === 'PROJECT' ? projectId : undefined
  const readTarget = JSON.stringify([backendConfig?.baseUrl, backendConfig?.apiToken, scope, projId])
  const beginRead = useConfigReadFence(readTarget)
  const { loadCommon, setLoading, setError, setReadError, setSaving, setReadCompletedTarget } = common

  const reload = useCallback(async () => {
    if (!backendConfig) return
    const isCurrent = beginRead()
    setLoading(true)
    try {
      const [bundle] = await Promise.all([
        Promise.all([
          fetchCodexConfigFiles(backendConfig, scope.toLowerCase(), projId),
          fetchCodexInstructionFiles(backendConfig, scope.toLowerCase(), projId),
          fetchCodexSubAgents(backendConfig, scope.toLowerCase(), projId),
          fetchCodexSkills(backendConfig, scope.toLowerCase(), projId),
          fetchCodexRules(backendConfig, scope.toLowerCase(), projId),
        ]),
        loadCommon(),
      ])
      if (!isCurrent()) return
      setConfig(bundle[0].items)
      setInstructions(bundle[1].items)
      setSubagents(bundle[2].items)
      setSkills(bundle[3].items)
      setRules(bundle[4].items)
      setReadError('')
      setError('')
    } catch (err) {
      if (!isCurrent()) return
      setReadError(err instanceof Error ? err.message : 'Failed to load Codex config')
    } finally {
      if (isCurrent()) {
        setReadCompletedTarget(readTarget)
        setLoading(false)
      }
    }
  }, [backendConfig, scope, projId, loadCommon, setError, setReadError, setLoading, beginRead, readTarget, setReadCompletedTarget])

  useEffect(() => { void reload() }, [reload])

  const saveConfigFile = useCallback(async (path: string, content: string) => {
    if (!backendConfig) return
    setSaving(path)
    try {
      await saveCodexConfigFile(backendConfig, scope.toLowerCase(), content, projId, path)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Codex config')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const saveInstructionFile = useCallback(async (path: string, content: string) => {
    if (!backendConfig) return
    setSaving(path)
    try {
      await saveCodexInstructionFile(backendConfig, scope.toLowerCase(), content, projId, path)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Codex instructions')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const saveSubagentFile = useCallback(async (path: string, content: string) => {
    if (!backendConfig) return
    setSaving(path)
    try {
      await saveCodexSubAgent(backendConfig, scope.toLowerCase(), path.split('/').pop() ?? 'agent', content, projId, path)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Codex sub-agent')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const saveSkillFile = useCallback(async (path: string, content: string) => {
    if (!backendConfig) return
    setSaving(path)
    try {
      const skillName = path.split('/').slice(-2)[0] ?? 'skill'
      await saveCodexSkill(backendConfig, scope.toLowerCase(), skillName, content, projId, path)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Codex skill')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const deleteSubagentFile = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await deleteCodexSubAgent(backendConfig, scope.toLowerCase(), name, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete Codex sub-agent')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const deleteSkillFile = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await deleteCodexSkill(backendConfig, scope.toLowerCase(), name, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete Codex skill')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const saveRuleFile = useCallback(async (name: string, content: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await saveCodexRule(backendConfig, scope.toLowerCase(), name, content, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Codex rule')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const deleteRuleFile = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await deleteCodexRule(backendConfig, scope.toLowerCase(), name, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete Codex rule')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const createConfigFile = useCallback(async () => {
    if (!backendConfig) return
    setSaving('new')
    try {
      await createCodexConfigFile(backendConfig, scope.toLowerCase(), projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Codex config')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const createInstructionFile = useCallback(async () => {
    if (!backendConfig) return
    setSaving('new')
    try {
      await createCodexInstructionFile(backendConfig, scope.toLowerCase(), projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Codex instructions')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const createSubagentFile = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving('new')
    try {
      await createCodexSubAgent(backendConfig, scope.toLowerCase(), name, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Codex sub-agent')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const createSkillResource = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving('new')
    try {
      await createCodexSkill(backendConfig, scope.toLowerCase(), name, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Codex skill')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  return {
    config, instructions, subagents, skills, rules,
    projects: common.projects,
    permissions: common.permissions,
    modelConfig: common.modelConfig,
    hooks: common.hooks,
    providerMcpServers: common.providerMcpServers,
    orchestraMcpServers: common.orchestraMcpServers,
    mcpTools: common.mcpTools,
    loading: common.loading,
    error: common.error,
    readError: common.readError,
    saving: common.saving,
    saveFile: saveConfigFile,
    saveConfigFile,
    saveInstructionFile,
    saveSubagentFile,
    saveSkillFile,
    saveRuleFile,
    deleteSubagentFile,
    deleteSkillFile,
    deleteRuleFile,
    createConfigFile,
    createInstructionFile,
    createSubagentFile,
    createSkillResource,
    savePermissions: common.savePermissions,
    saveModel: common.saveModel,
    saveHooks: common.saveHooks,
    addMCPServer: common.addMCPServer,
    updateMCPServer: common.updateMCPServer,
    toggleMCPServer: common.toggleMCPServer,
    deleteMCPServer: common.deleteProviderServer,
    deleteOrchestraMCPServer: common.deleteOrchestraMCPServer,
    reload,
    setError: common.setError,
  }
}

export function useOpenCodeConfig(backendConfig: BackendConfig | null, scope: Scope, projectId?: string): OpenCodeConfigState {
  const common = useProviderCommon(backendConfig, 'opencode', scope, projectId)
  const [config, setConfig] = useState<ProviderFileEntry[]>([])
  const [agents, setAgents] = useState<ProviderFileEntry[]>([])
  const [commands, setCommands] = useState<ProviderFileEntry[]>([])
  const [skills, setSkills] = useState<ProviderFileEntry[]>([])
  const projId = scope === 'PROJECT' ? projectId : undefined
  const readTarget = JSON.stringify([backendConfig?.baseUrl, backendConfig?.apiToken, scope, projId])
  const beginRead = useConfigReadFence(readTarget)
  const { loadCommon, setLoading, setError, setReadError, setSaving, setReadCompletedTarget } = common

  const reload = useCallback(async () => {
    if (!backendConfig) return
    const isCurrent = beginRead()
    setLoading(true)
    try {
      const [bundle] = await Promise.all([
        Promise.all([
          fetchOpenCodeConfigFiles(backendConfig, scope.toLowerCase(), projId),
          fetchOpenCodeAgentsFiles(backendConfig, scope.toLowerCase(), projId),
          fetchOpenCodeCommandsFiles(backendConfig, scope.toLowerCase(), projId),
          fetchOpenCodeSkillsFiles(backendConfig, scope.toLowerCase(), projId),
        ]),
        loadCommon(),
      ])
      if (!isCurrent()) return
      setConfig(bundle[0].items)
      setAgents(bundle[1].items)
      setCommands(bundle[2].items)
      setSkills(bundle[3].items)
      setReadError('')
      setError('')
    } catch (err) {
      if (!isCurrent()) return
      setReadError(err instanceof Error ? err.message : 'Failed to load OpenCode config')
    } finally {
      if (isCurrent()) {
        setReadCompletedTarget(readTarget)
        setLoading(false)
      }
    }
  }, [backendConfig, scope, projId, loadCommon, setError, setReadError, setLoading, beginRead, readTarget, setReadCompletedTarget])

  useEffect(() => { void reload() }, [reload])

  const saveConfigResource = useCallback(async (path: string, content: string) => {
    if (!backendConfig) return
    setSaving(path)
    try {
      await saveOpenCodeConfigFile(backendConfig, scope.toLowerCase(), content, projId, path)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save OpenCode config')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const saveAgentFile = useCallback(async (path: string, content: string) => {
    if (!backendConfig) return
    setSaving(path)
    try {
      await saveOpenCodeAgentFile(backendConfig, scope.toLowerCase(), path.split('/').pop() ?? 'agent', content, projId, path)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save OpenCode agent')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const saveOpenCodeCommandResource = useCallback(async (path: string, content: string) => {
    if (!backendConfig) return
    setSaving(path)
    try {
      await saveOpenCodeCommandFile(backendConfig, scope.toLowerCase(), path.split('/').pop() ?? 'command', content, projId, path)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save OpenCode command')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const saveSkillFile = useCallback(async (path: string, content: string) => {
    if (!backendConfig) return
    setSaving(path)
    try {
      const skillName = path.split('/').slice(-2)[0] ?? 'skill'
      await saveOpenCodeSkillFile(backendConfig, scope.toLowerCase(), skillName, content, projId, path)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save OpenCode skill')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const deleteAgentFile = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await deleteOpenCodeAgentFile(backendConfig, scope.toLowerCase(), name, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete OpenCode agent')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const deleteCommandResource = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await deleteOpenCodeCommandFile(backendConfig, scope.toLowerCase(), name, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete OpenCode command')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const deleteSkillResource = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving(name)
    try {
      await deleteOpenCodeSkillFile(backendConfig, scope.toLowerCase(), name, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete OpenCode skill')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const createConfigResource = useCallback(async () => {
    if (!backendConfig) return
    setSaving('new')
    try {
      await createOpenCodeConfigFile(backendConfig, scope.toLowerCase(), projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create OpenCode config')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const createAgentResourceFile = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving('new')
    try {
      await createOpenCodeAgentFile(backendConfig, scope.toLowerCase(), name, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create OpenCode agent')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const createCommandResource = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving('new')
    try {
      await createOpenCodeCommandFile(backendConfig, scope.toLowerCase(), name, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create OpenCode command')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  const createSkillResourceFile = useCallback(async (name: string) => {
    if (!backendConfig) return
    setSaving('new')
    try {
      await createOpenCodeSkillFile(backendConfig, scope.toLowerCase(), name, projId)
      setError('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create OpenCode skill')
    } finally {
      setSaving(null)
    }
  }, [backendConfig, scope, projId, reload, setError, setSaving])

  return {
    config, agents, commands, skills,
    projects: common.projects,
    permissions: common.permissions,
    modelConfig: common.modelConfig,
    hooks: common.hooks,
    providerMcpServers: common.providerMcpServers,
    orchestraMcpServers: common.orchestraMcpServers,
    mcpTools: common.mcpTools,
    loading: common.loading,
    error: common.error,
    readError: common.readError,
    saving: common.saving,
    saveFile: saveConfigResource,
    saveConfigResource,
    saveAgentFile,
    saveCommandFile: saveOpenCodeCommandResource,
    saveSkillFile,
    deleteAgentFile,
    deleteCommandResource,
    deleteSkillResource,
    createConfigResource,
    createAgentResourceFile,
    createCommandResource,
    createSkillResourceFile,
    savePermissions: common.savePermissions,
    saveModel: common.saveModel,
    saveHooks: common.saveHooks,
    addMCPServer: common.addMCPServer,
    updateMCPServer: common.updateMCPServer,
    toggleMCPServer: common.toggleMCPServer,
    deleteMCPServer: common.deleteProviderServer,
    deleteOrchestraMCPServer: common.deleteOrchestraMCPServer,
    reload,
    setError: common.setError,
  }
}
