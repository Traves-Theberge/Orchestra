import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@core/api/client'
import { HarnessSetupPanel } from './HarnessSetupPanel'

vi.mock('@core/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@core/api/client')>()
  return { ...original, fetchAgents: vi.fn(), fetchAgentConfig: vi.fn(), fetchWorkspaceChatProviders: vi.fn(), updateAgentConfig: vi.fn() }
})

const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchAgents).mockResolvedValue(['CODEX', 'CLAUDE'])
  vi.mocked(api.fetchAgentConfig).mockResolvedValue({ commands: { CODEX: 'codex exec {{prompt}}', CLAUDE: 'claude -p {{prompt}}' }, agent_provider: 'CODEX', max_turns: 20 })
  vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [
    { id: 'CODEX', label: 'Codex', enabled: true, conversation_mode: 'native_session', provider_resume: true },
    { id: 'CLAUDE', label: 'Claude Code', enabled: true, conversation_mode: 'transcript_replay', provider_resume: false },
  ] })
  vi.mocked(api.updateAgentConfig).mockResolvedValue(undefined)
})

afterEach(() => cleanup())

describe('HarnessSetupPanel', () => {
  it('shows observed native chat separately from command registration and leaves auth unknown', async () => {
    render(<HarnessSetupPanel config={config} provider="codex" projectId={null} />)
    expect(await screen.findByText('Chat: native session · resume supported')).toBeInTheDocument()
    expect(screen.getAllByText('Installation: not observed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Authentication: not observed').length).toBeGreaterThan(0)
    expect(screen.getByText(/Codex chat uses the separately registered native app-server/)).toBeInTheDocument()
    expect(api.fetchWorkspaceChatProviders).toHaveBeenCalledWith(config, '__orchestrator__')
  })

  it('saves only the selected batch command', async () => {
    render(<HarnessSetupPanel config={config} provider="codex" projectId="project-1" />)
    const editor = await screen.findByRole('textbox', { name: 'Command template' })
    await waitFor(() => expect(editor).toHaveValue('codex exec {{prompt}}'))
    fireEvent.change(editor, { target: { value: 'codex exec --json {{prompt}}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save command' }))
    await waitFor(() => expect(api.updateAgentConfig).toHaveBeenCalledWith(config, {
      commands: { CODEX: 'codex exec --json {{prompt}}' }, agent_provider: 'CODEX',
    }))
  })

  it('refuses to overwrite a concurrent command or default change', async () => {
    render(<HarnessSetupPanel config={config} provider="codex" projectId="project-1" />)
    const editor = await screen.findByRole('textbox', { name: 'Command template' })
    await waitFor(() => expect(editor).toHaveValue('codex exec {{prompt}}'))
    fireEvent.change(editor, { target: { value: 'codex exec --json {{prompt}} --more' } })
    vi.mocked(api.fetchAgentConfig).mockResolvedValueOnce({ commands: { CODEX: 'changed elsewhere' }, agent_provider: 'CODEX', max_turns: 20 })
    fireEvent.click(screen.getByRole('button', { name: 'Save command' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed elsewhere')
    expect(api.updateAgentConfig).not.toHaveBeenCalled()
  })

  it('lists Antigravity separately and does not claim runtime or account setup is available', async () => {
    render(<HarnessSetupPanel config={config} provider="antigravity" projectId={null} />)
    expect((await screen.findAllByText('Runtime capability: unavailable until registered')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Antigravity is its own harness, separate from Gemini CLI/)).toBeInTheDocument()
    expect(screen.getByText(/--mode accept-edits\|plan/)).toBeInTheDocument()
    expect(screen.getAllByText('Antigravity').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Provider install and sign-in guide ↗' }).some((link) => link.getAttribute('href') === 'https://antigravity.google/docs/cli-overview')).toBe(true)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Command template' }), { target: { value: 'agy --verified-args {{prompt}}' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save command' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Save command' }))
    await waitFor(() => expect(api.updateAgentConfig).toHaveBeenCalledWith(config, {
      commands: { ANTIGRAVITY: 'agy --verified-args {{prompt}}' }, agent_provider: 'CODEX',
    }))
  })
})
