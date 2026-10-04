import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@core/api/client'
import { useCodexConfig } from './use-provider-domain-config'
import { useClaudeConfig } from './use-claude-config'

vi.mock('@core/api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('@core/api/client')>()
  return { ...actual, ...Object.fromEntries(Object.keys(actual)
    .filter(name => name.startsWith('fetch') || name.startsWith('updateProvider') || name.includes('ProviderMCPServer'))
    .map(name => [name, vi.fn(async () => [])])) }
})
const config = { baseUrl: 'http://localhost:4010', apiToken: 'test' }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchProviderPermissions).mockResolvedValue({ approval_mode: 'default', allow: [], deny: [], ask: [] })
  vi.mocked(api.fetchProviderModel).mockResolvedValue({ model: 'observed-config', effort: '', temperature: null })
  for (const fn of [api.fetchCodexConfigFiles, api.fetchCodexInstructionFiles, api.fetchCodexSubAgents, api.fetchCodexSkills, api.fetchCodexRules]) {
    vi.mocked(fn).mockResolvedValue({ items: [], dir: '' })
  }
  vi.mocked(api.fetchClaudeSettings).mockResolvedValue({ settings: { model: 'existing' }, path: '/fixture/settings.json', exists: true })
  vi.mocked(api.fetchClaudeInstructions).mockResolvedValue({ content: '', path: '/fixture/CLAUDE.md', exists: false })
  for (const fn of [api.fetchClaudeRules, api.fetchClaudeSkills, api.fetchClaudeSubAgents]) {
    vi.mocked(fn).mockResolvedValue({ items: [], dir: '' })
  }
})

describe('configuration read failures', () => {
  it.each(['401 unauthorized', '403 forbidden', 'request timeout', '500 server error'])('does not treat %s as an empty successful Codex configuration', async message => {
    vi.mocked(api.fetchProviderModel).mockRejectedValueOnce(new Error(message))
    const { result } = renderHook(() => useCodexConfig(config, 'GLOBAL'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.readError).toBe(message)
    act(() => result.current.setError(''))
    expect(result.current.readError).toBe(message)
    await act(() => result.current.reload())
    expect(result.current.readError).toBe('')
    expect(result.current.modelConfig.model).toBe('observed-config')
  })

  it('retains the previous Claude snapshot on read failure and routes all scoped reads to the project', async () => {
    const { result } = renderHook(() => useClaudeConfig(config, 'PROJECT', 'project-a'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(api.fetchProviderModel).toHaveBeenCalledWith(config, 'claude', 'project-a', 'project')
    expect(api.fetchProviderHooks).toHaveBeenCalledWith(config, 'claude', 'project', 'project-a')
    await act(() => result.current.saveModel({ model: 'new', effort: '', temperature: null }))
    expect(api.updateProviderModel).toHaveBeenCalledWith(config, 'claude', { model: 'new', effort: '', temperature: null }, 'project-a', 'project')
    await act(() => result.current.saveHooks([]))
    expect(api.updateProviderHooks).toHaveBeenCalledWith(config, 'claude', [], 'project', 'project-a')
    await act(() => result.current.addMCPServer('project-server', 'fixture-command'))
    expect(api.addProviderMCPServer).not.toHaveBeenCalled()
    expect(result.current.error).toContain('Project MCP editing is unavailable')
    vi.mocked(api.fetchClaudeSettings).mockRejectedValueOnce(new Error('settings unavailable'))
    await act(() => result.current.reload())
    expect(result.current.readError).toBe('settings unavailable')
    expect(result.current.settings).toEqual({ model: 'existing' })
    expect(result.current.settingsExists).toBe(true)
  })

  it('ignores a delayed previous-project Claude snapshot', async () => {
    let release!: (value: Awaited<ReturnType<typeof api.fetchClaudeSettings>>) => void
    vi.mocked(api.fetchClaudeSettings).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const { result, rerender } = renderHook(({ project }) => useClaudeConfig(config, 'PROJECT', project), { initialProps: { project: 'old' } })
    rerender({ project: 'new' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => release({ settings: { model: 'old' }, path: '/old/settings.json', exists: true }))
    expect(result.current.settings).toEqual({ model: 'existing' })
    expect(result.current.settingsPath).toBe('/fixture/settings.json')
  })
})
