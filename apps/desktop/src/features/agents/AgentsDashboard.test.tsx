import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsDashboard } from './AgentsDashboard'
import { resetAppStore, useAppStore } from '@core/store'

const mockUseClaudeConfig = vi.fn()
const mockUseCodexConfig = vi.fn()
const mockUseOpenCodeConfig = vi.fn()
vi.mock('./panels/OrchestraAgentsPanel', () => ({ OrchestraAgentsPanel: ({ projectId }: { projectId: string }) => <div>Orchestra agents [{projectId}]</div> }))
vi.mock('./panels/OrchestraSkillsPanel', () => ({ OrchestraSkillsPanel: () => <div>Orchestra skills</div> }))
vi.mock('./panels/McpStatusPanel', () => ({ McpStatusPanel: ({ harness }: { harness?: string }) => <div>MCP status {harness ?? 'all'}</div> }))
vi.mock('./panels/AgentResourcesPanel', () => ({ AgentResourcesPanel: ({ harness, scope, kind }: { harness: string; scope: string; kind: string }) => <div>{harness} {scope} {kind} resources</div> }))

vi.mock('./hooks/use-claude-config', () => ({
  useClaudeConfig: (...args: unknown[]) => mockUseClaudeConfig(...args),
}))

vi.mock('./hooks/use-provider-domain-config', () => ({
  useCodexConfig: (...args: unknown[]) => mockUseCodexConfig(...args),
  useOpenCodeConfig: (...args: unknown[]) => mockUseOpenCodeConfig(...args),
}))

function marker(name: string) {
  return () => <div>{name}</div>
}

vi.mock('./panels/SettingsPanel', () => ({ SettingsPanel: marker('Claude Settings Panel') }))
vi.mock('./panels/InstructionsPanel', () => ({ InstructionsPanel: marker('Claude Instructions Panel') }))
vi.mock('./panels/SkillsPanel', () => ({ SkillsPanel: marker('Claude Skills Panel') }))
vi.mock('./panels/HooksPanel', () => ({ HooksPanel: marker('Hooks Panel') }))
vi.mock('./panels/MCPPanel', () => ({ MCPPanel: marker('MCP Panel') }))
vi.mock('./panels/RulesPanel', () => ({ RulesPanel: marker('Claude Rules Panel') }))
vi.mock('./panels/PermissionsPanel', () => ({ PermissionsPanel: marker('Generic Permissions Panel') }))
vi.mock('./panels/CodexConfigPanel', () => ({ CodexConfigPanel: marker('Codex Config Panel') }))
vi.mock('./panels/CodexApprovalsPanel', () => ({ CodexApprovalsPanel: marker('Codex Approvals Panel') }))
vi.mock('./panels/CodexModelPanel', () => ({ CodexModelPanel: marker('Codex Model Panel') }))
vi.mock('./panels/CodexEnvironmentPanel', () => ({ CodexEnvironmentPanel: marker('Codex Environment Panel') }))
vi.mock('./panels/CodexProfilesPanel', () => ({ CodexProfilesPanel: marker('Codex Profiles Panel') }))
vi.mock('./panels/CodexInstructionsPanel', () => ({ CodexInstructionsPanel: marker('Codex Instructions Panel') }))
vi.mock('./panels/CodexRulesPanel', () => ({ CodexRulesPanel: marker('Codex Rules Panel') }))
vi.mock('./panels/OpenCodeConfigPanel', () => ({ OpenCodeConfigPanel: marker('OpenCode Config') }))
vi.mock('./panels/OpenCodeModelPanel', () => ({ OpenCodeModelPanel: marker('OpenCode Model Panel') }))
vi.mock('./panels/OpenCodeInstructionsPanel', () => ({ OpenCodeInstructionsPanel: marker('OpenCode Instructions Panel') }))
vi.mock('./panels/OpenCodePermissionsPanel', () => ({ OpenCodePermissionsPanel: marker('OpenCode Permissions Panel') }))
vi.mock('./panels/OpenCodeCommandsPanel', () => ({ OpenCodeCommandsPanel: marker('OpenCode Commands Panel') }))

function makeCommonState() {
  return {
    projects: [],
    permissions: { approval_mode: 'interactive', allow: [], deny: [], ask: [] },
    modelConfig: { model: '', effort: '', temperature: null },
    hooks: [],
    providerMcpServers: [],
    orchestraMcpServers: [],
    mcpTools: [],
    loading: false,
    error: '',
    saving: null,
    saveFile: vi.fn(),
    savePermissions: vi.fn(),
    saveModel: vi.fn(),
    saveHooks: vi.fn(),
    addMCPServer: vi.fn(),
    updateMCPServer: vi.fn(),
    toggleMCPServer: vi.fn(),
    deleteMCPServer: vi.fn(),
    deleteOrchestraMCPServer: vi.fn(),
    reload: vi.fn(),
    setError: vi.fn(),
  }
}

describe('AgentsDashboard', () => {
  beforeEach(() => resetAppStore())
  it('uses the sidebar scope for configuration reads and removes duplicate dashboard controls', async () => {
    mockUseClaudeConfig.mockReturnValue({ ...makeCommonState(), rules: [], skills: [], subagents: [] })
    mockUseCodexConfig.mockReturnValue({ ...makeCommonState(), config: [], instructions: [], subagents: [], skills: [], rules: [] })
    mockUseOpenCodeConfig.mockReturnValue({ ...makeCommonState(), config: [], agents: [], commands: [], skills: [] })
    act(() => useAppStore.getState().setActiveAgentProvider('codex'))
    render(<AgentsDashboard config={{ baseUrl: 'http://localhost:4010', apiToken: 'test' }} />)
    expect(screen.queryByText('vs')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Global only' })).toBeNull()

    useAppStore.setState({ projects: [{ id: 'project-1', name: 'Nautilus', root_path: '/tmp/nautilus', remote_url: '' }] })
    act(() => {
      // AgentsSubNav uses this same store action for its scope dropdown.
      useAppStore.getState().setActiveAgentScope('PROJECT', 'project-1')
    })
    expect(await screen.findByText('Codex Config Panel')).toBeTruthy()
    expect(mockUseCodexConfig).toHaveBeenLastCalledWith(expect.anything(), 'PROJECT', 'project-1')
    act(() => useAppStore.getState().setActiveAgentCategory('mcp'))
    expect(mockUseCodexConfig).toHaveBeenLastCalledWith(expect.anything(), 'PROJECT', 'project-1')
    expect(screen.getByText(/Project MCP configuration is read-only here/)).toBeTruthy()
    expect(screen.queryByText('Global only')).toBeNull()

    act(() => useAppStore.getState().setActiveAgentScope('GLOBAL', ''))
    expect(mockUseCodexConfig).toHaveBeenLastCalledWith(expect.anything(), 'GLOBAL', undefined)
    expect(screen.queryByText(/Project MCP configuration is read-only here/)).toBeNull()
  })

  it('normalizes retired Gemini tab state to the Orchestra view without exposing Gemini', async () => {
    mockUseClaudeConfig.mockReturnValue({ ...makeCommonState(), rules: [], skills: [], subagents: [] })
    mockUseCodexConfig.mockReturnValue({ ...makeCommonState(), config: [], instructions: [], subagents: [], skills: [], rules: [] })
    mockUseOpenCodeConfig.mockReturnValue({ ...makeCommonState(), config: [], agents: [], commands: [], skills: [] })
    useAppStore.setState({ activeAgentProvider: 'gemini', availableAgents: ['gemini', 'antigravity'] } as never)
    render(<AgentsDashboard config={{ baseUrl: 'http://localhost:4010', apiToken: 'test' }} />)

    await waitFor(() => expect(useAppStore.getState().activeAgentProvider).toBe('orchestra'))
    expect(await screen.findByText('Orchestra agents []')).toBeInTheDocument()
    expect(screen.queryByText(/Gemini/)).not.toBeInTheDocument()
  })

  it('routes the Orchestra view to agents, skills and MCP status', async () => {
    mockUseClaudeConfig.mockReturnValue({ ...makeCommonState(), rules: [], skills: [], subagents: [] })
    mockUseCodexConfig.mockReturnValue({ ...makeCommonState(), config: [], instructions: [], subagents: [], skills: [], rules: [] })
    mockUseOpenCodeConfig.mockReturnValue({ ...makeCommonState(), config: [], agents: [], commands: [], skills: [] })
    act(() => useAppStore.getState().setActiveAgentProvider('orchestra'))
    render(<AgentsDashboard config={{ baseUrl: 'http://localhost:4010', apiToken: 'test' }} />)
    expect(await screen.findByText('Orchestra agents []')).toBeInTheDocument()
    expect(useAppStore.getState().agentCategories.map(item => item.id)).toEqual(['agents', 'skills', 'mcp'])
    act(() => useAppStore.getState().setActiveAgentCategory('skills'))
    expect(screen.getByText('Orchestra skills')).toBeInTheDocument()
    act(() => useAppStore.getState().setActiveAgentCategory('mcp'))
    expect(screen.getByText('MCP status all')).toBeInTheDocument()
    expect(mockUseCodexConfig).toHaveBeenLastCalledWith(null, 'GLOBAL', undefined)
  })

  it('shows MCP status for the harness above its MCP editor', () => {
    mockUseClaudeConfig.mockReturnValue({ ...makeCommonState(), rules: [], skills: [], subagents: [] })
    mockUseCodexConfig.mockReturnValue({ ...makeCommonState(), config: [], instructions: [], subagents: [], skills: [], rules: [] })
    mockUseOpenCodeConfig.mockReturnValue({ ...makeCommonState(), config: [], agents: [], commands: [], skills: [] })
    act(() => { useAppStore.getState().setActiveAgentProvider('codex') })
    render(<AgentsDashboard config={{ baseUrl: 'http://localhost:4010', apiToken: 'test' }} />)
    act(() => useAppStore.getState().setActiveAgentCategory('mcp'))
    expect(screen.getByText('MCP status codex')).toBeInTheDocument()
    expect(screen.getByText('MCP Panel')).toBeInTheDocument()
  })
  it('routes OpenCode categories to provider-specific panels', () => {
    mockUseClaudeConfig.mockReturnValue({
      ...makeCommonState(),
      settings: {},
      settingsPath: '',
      settingsExists: false,
      instructions: '',
      instructionsPath: '',
      instructionsExists: false,
      rules: [],
      skills: [],
      subagents: [],
      saveSettings: vi.fn(),
      saveInstructions: vi.fn(),
      deleteInstructions: vi.fn(),
      saveRule: vi.fn(),
      removeRule: vi.fn(),
      saveSkill: vi.fn(),
      removeSkill: vi.fn(),
      saveSubAgent: vi.fn(),
      removeSubAgent: vi.fn(),
    })
    mockUseCodexConfig.mockReturnValue({
      ...makeCommonState(),
      config: [],
      instructions: [],
      subagents: [],
      skills: [],
      rules: [],
    })
    mockUseOpenCodeConfig.mockReturnValue({
      ...makeCommonState(),
      config: [{ path: '/tmp/opencode.json', content: '{}', name: 'opencode.json' }],
      agents: [{ path: '/tmp/agents/planner.md', content: '---\ndescription: Planner\n---\n', name: 'planner.md' }],
      commands: [{ path: '/tmp/commands/test.md', content: '---\ndescription: Test\n---\n', name: 'test.md' }],
      skills: [{ path: '/tmp/skills/release/SKILL.md', content: '---\nname: release\ndescription: Release\n---\n', name: 'release' }],
      saveConfigResource: vi.fn(),
      saveAgentFile: vi.fn(),
      saveCommandFile: vi.fn(),
      saveSkillFile: vi.fn(),
      deleteAgentFile: vi.fn(),
      deleteCommandResource: vi.fn(),
      deleteSkillResource: vi.fn(),
      createConfigResource: vi.fn(),
      createAgentResourceFile: vi.fn(),
      createCommandResource: vi.fn(),
      createSkillResourceFile: vi.fn(),
    })

    render(<AgentsDashboard config={{ baseUrl: 'http://localhost:4010', apiToken: 'dev-token' }} />)

    act(() => useAppStore.getState().setActiveAgentProvider('opencode'))
    act(() => useAppStore.getState().setActiveAgentCategory('config'))
    expect(screen.getByText('OpenCode Config')).toBeTruthy()

    act(() => useAppStore.getState().setActiveAgentCategory('models'))
    expect(screen.getByText('OpenCode Model Panel')).toBeTruthy()

    act(() => useAppStore.getState().setActiveAgentCategory('instructions'))
    expect(screen.getByText('OpenCode Instructions Panel')).toBeTruthy()

    act(() => useAppStore.getState().setActiveAgentCategory('agents'))
    expect(screen.getByText('opencode global agent_definition resources')).toBeTruthy()

    act(() => useAppStore.getState().setActiveAgentCategory('commands'))
    expect(screen.getByText('OpenCode Commands Panel')).toBeTruthy()

    act(() => useAppStore.getState().setActiveAgentCategory('skills'))
    expect(screen.getByText('opencode global skill resources')).toBeTruthy()

    act(() => useAppStore.getState().setActiveAgentCategory('permissions'))
    expect(screen.getByText('OpenCode Permissions Panel')).toBeTruthy()
  })
  it('withholds editors after a failed read and offers an explicit retry', () => {
    const reload = vi.fn()
    mockUseClaudeConfig.mockReturnValue({ ...makeCommonState(), rules: [], skills: [], subagents: [] })
    mockUseCodexConfig.mockReturnValue({ ...makeCommonState(), config: [], instructions: [], subagents: [], skills: [], rules: [], readError: '403 forbidden', reload })
    mockUseOpenCodeConfig.mockReturnValue({ ...makeCommonState(), config: [], agents: [], commands: [], skills: [] })
    act(() => {
      useAppStore.getState().setActiveAgentProvider('codex')
      useAppStore.getState().setActiveAgentCategory('config')
    })
    render(<AgentsDashboard config={{ baseUrl: 'http://localhost:4010', apiToken: 'test' }} />)
    expect(screen.getByRole('alert').textContent).toContain('403 forbidden')
    expect(screen.queryByText('Codex Config Panel')).toBeNull()
    expect(screen.queryByText('Harness setup')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry configuration' }))
    expect(reload).toHaveBeenCalledOnce()
  })

})
