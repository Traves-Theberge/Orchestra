import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@core/api/client'
import { useAppStore } from '@core/store'
import { HarnessSetupPanel } from './HarnessSetupPanel'

vi.mock('@core/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@core/api/client')>()
  return { ...original, fetchAgents: vi.fn(), fetchAgentConfig: vi.fn(), fetchHarnessSetup: vi.fn(), fetchWorkspaceChatProviders: vi.fn(), updateAgentConfig: vi.fn(), setHarnessRegistration: vi.fn(), startCodexDeviceLogin: vi.fn(), fetchCodexDeviceLogin: vi.fn(), cancelCodexDeviceLogin: vi.fn(), fetchHarnessAccounts: vi.fn(), selectHarnessAccount: vi.fn(), beginHarnessAccount: vi.fn(), verifyHarnessAccount: vi.fn(), reauthHarnessAccount: vi.fn(), removeHarnessAccount: vi.fn() }
})

const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture' }

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({ openTerminals: [], activeSection: 'AGENTS' })
  vi.mocked(api.fetchAgents).mockResolvedValue(['CODEX', 'CLAUDE'])
  vi.mocked(api.fetchHarnessSetup).mockResolvedValue([
    { id: 'CODEX', registered: true, command_configured: true, installation: 'detected', authentication: 'signed_in', executable: '/bin/codex', terminal_supported: true },
    { id: 'CLAUDE', registered: true, command_configured: true, installation: 'missing', authentication: 'unknown', terminal_supported: true },
  ])
  vi.mocked(api.fetchAgentConfig).mockResolvedValue({ commands: { CODEX: 'codex exec {{prompt}}', CLAUDE: 'claude -p {{prompt}}' }, agent_provider: 'CODEX', max_turns: 20 })
  vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [
    { id: 'CODEX', label: 'Codex', enabled: true, conversation_mode: 'native_session', provider_resume: true },
    { id: 'CLAUDE', label: 'Claude Code', enabled: true, conversation_mode: 'transcript_replay', provider_resume: false },
  ] })
  vi.mocked(api.updateAgentConfig).mockResolvedValue(undefined)
  vi.mocked(api.setHarnessRegistration).mockResolvedValue(undefined)
  vi.mocked(api.startCodexDeviceLogin).mockResolvedValue({ id: 'login-1', state: 'pending', user_code: 'TEST-CODE', verification_url: 'https://auth.openai.com/device', message: 'Enter the code at the verification page.' })
  vi.mocked(api.cancelCodexDeviceLogin).mockResolvedValue(undefined)
  vi.mocked(api.fetchCodexDeviceLogin).mockResolvedValue({ id: 'login-1', state: 'canceled', message: 'Sign-in canceled.' })
  vi.mocked(api.fetchHarnessAccounts).mockResolvedValue({ accounts: [], selections: [], supported_providers: ['CODEX'] })
  vi.mocked(api.selectHarnessAccount).mockResolvedValue({ provider: 'CODEX', account_id: '', version: 1 })
})

afterEach(() => cleanup())

describe('HarnessSetupPanel', () => {
  it('unregisters a non-default harness with a version precondition', async () => {
    vi.mocked(api.fetchHarnessSetup).mockResolvedValue([{ id: 'CLAUDE', registered: true, registration_version: 4, command_configured: true, installation: 'detected', authentication: 'unknown', terminal_supported: false }])
    render(<HarnessSetupPanel config={config} provider="claude" projectId={null} />)
    const setup = await screen.findByRole('region', { name: 'Claude Code onboarding' })
    fireEvent.click(within(setup).getByRole('button', { name: 'Unregister' }))
    await waitFor(() => expect(api.setHarnessRegistration).toHaveBeenCalledWith(config, 'CLAUDE', false, 4))
  })
  it('keeps the default harness registered until another default is selected', async () => {
    render(<HarnessSetupPanel config={config} provider="codex" projectId={null} />)
    const setup = await screen.findByRole('region', { name: 'Codex onboarding' })
    expect(within(setup).getByRole('button', { name: 'Unregister' })).toBeDisabled()
    expect(within(setup).getByText(/Select another default task harness/)).toBeInTheDocument()
  })
  it('renders host default when an older backend returns null account lists', async () => {
    vi.mocked(api.fetchHarnessAccounts).mockResolvedValue({ accounts: null, selections: null, supported_providers: ['CODEX'] } as unknown as Awaited<ReturnType<typeof api.fetchHarnessAccounts>>)
    render(<HarnessSetupPanel config={config} provider="codex" projectId={null} />)
    const region = await screen.findByRole('region', { name: 'Managed Codex accounts' })
    expect(await within(region).findByText(/existing CLI credentials/)).toBeInTheDocument()
  })
  it('selects a verified managed account with a version precondition', async () => {
    vi.mocked(api.fetchHarnessAccounts).mockResolvedValue({ accounts: [{ id: 'account-a', provider: 'CODEX', label: 'Work', auth_state: 'signed_in', created_at: '2026-10-05T00:00:00Z' }], selections: [{ provider: 'CODEX', version: 3 }], supported_providers: ['CODEX'] })
    render(<HarnessSetupPanel config={config} provider="codex" projectId={null} />)
    const region = await screen.findByRole('region', { name: 'Managed Codex accounts' })
    expect(await within(region).findByText('Work')).toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: 'Select' }))
    await waitFor(() => expect(api.selectHarnessAccount).toHaveBeenCalledWith(config, 'CODEX', 'account-a', 3))
  })
  it('separates backend discovery from registration and verified sign-in', async () => {
    render(<HarnessSetupPanel config={config} provider="codex" projectId={null} />)
    const setup = await screen.findByRole('region', { name: 'Codex onboarding' })
    expect(within(setup).getByText('Detected on backend')).toBeInTheDocument()
    expect(within(setup).getByText('Signed in (Codex CLI status)')).toBeInTheDocument()
    expect(within(setup).getByRole('button', { name: 'Copy command' })).toBeInTheDocument()
    fireEvent.click(within(setup).getByRole('button', { name: 'Open sign-in terminal' }))
    expect(useAppStore.getState().openTerminals).toMatchObject([{ title: 'Codex sign-in', initialCommand: 'codex login' }])
    expect(useAppStore.getState().activeSection).toBe('CONSOLE')
  })
  it('offers a device-code flow for a remote Codex backend', async () => {
    render(<HarnessSetupPanel config={config} provider="codex" projectId={null} />)
    const setup = await screen.findByRole('region', { name: 'Codex onboarding' })
    fireEvent.click(within(setup).getByRole('button', { name: 'Use device code' }))
    expect(useAppStore.getState().openTerminals).toMatchObject([{ initialCommand: 'codex login --device-auth' }])
  })
  it('offers copy-and-run setup when the backend has no interactive terminal', async () => {
    vi.mocked(api.fetchHarnessSetup).mockResolvedValue([{ id: 'CODEX', registered: true, command_configured: true, installation: 'detected', authentication: 'unknown', terminal_supported: false }])
    render(<HarnessSetupPanel config={config} provider="codex" projectId={null} />)
    const setup = await screen.findByRole('region', { name: 'Codex onboarding' })
    expect(within(setup).queryByRole('button', { name: 'Open sign-in terminal' })).not.toBeInTheDocument()
    expect(within(setup).getByRole('button', { name: 'Copy device-code command' })).toBeInTheDocument()
    expect(setup).toHaveTextContent('Interactive backend terminals are unavailable on this host')
    fireEvent.click(within(setup).getByRole('button', { name: 'Start sign-in' }))
    expect(await within(setup).findByText('TEST-CODE')).toBeInTheDocument()
    expect(within(setup).getByRole('link', { name: 'Open verification page ↗' })).toHaveAttribute('href', 'https://auth.openai.com/device')
    fireEvent.click(within(setup).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(api.cancelCodexDeviceLogin).toHaveBeenCalledWith(config, 'login-1'))
  })
  it('shows observed native chat separately from command registration and leaves auth unknown', async () => {
    render(<HarnessSetupPanel config={config} provider="codex" projectId={null} />)
    expect(await screen.findByText('Chat: native session · resume supported')).toBeInTheDocument()
    expect(screen.getAllByText('Installation: not observed').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Authentication: Not verified').length).toBeGreaterThan(0)
    expect(screen.getByText(/Codex chat uses the separately registered native app-server/)).toBeInTheDocument()
    expect(api.fetchWorkspaceChatProviders).toHaveBeenCalledWith(config, '__orchestrator__')
  })
  it('does not launch sign-in when the backend CLI is missing', async () => {
    render(<HarnessSetupPanel config={config} provider="claude" projectId={null} />)
    const setup = await screen.findByRole('region', { name: 'Claude Code onboarding' })
    expect(within(setup).queryByRole('button', { name: 'Open sign-in terminal' })).not.toBeInTheDocument()
    expect(useAppStore.getState().openTerminals).toEqual([])
  })
  it('attributes a verified Claude sign-in to Claude CLI status', async () => {
    vi.mocked(api.fetchHarnessSetup).mockResolvedValue([
      { id: 'CODEX', registered: true, command_configured: true, installation: 'missing', authentication: 'unknown', terminal_supported: false },
      { id: 'CLAUDE', registered: true, command_configured: true, installation: 'detected', authentication: 'signed_in', terminal_supported: false },
    ])
    render(<HarnessSetupPanel config={config} provider="claude" projectId={null} />)
    const setup = await screen.findByRole('region', { name: 'Claude Code onboarding' })
    expect(within(setup).getByText('Signed in (Claude CLI status)')).toBeInTheDocument()
  })
  it('hides one backend host’s sign-in observation while switching profiles', async () => {
    const { rerender } = render(<HarnessSetupPanel config={config} provider="codex" projectId={null} />)
    expect(await screen.findByText('Signed in (Codex CLI status)')).toBeInTheDocument()
    rerender(<HarnessSetupPanel config={{ ...config, baseUrl: 'http://localhost:4015' }} provider="codex" projectId={null} />)
    expect(screen.getByText(/Checking harnesses on the connected backend/)).toBeInTheDocument()
    expect(screen.queryByText('Signed in (Codex CLI status)')).not.toBeInTheDocument()
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

  it('keeps a stored Gemini task default intact while removing it from active default options', async () => {
    vi.mocked(api.fetchAgents).mockResolvedValue(['ANTIGRAVITY', 'GEMINI'])
    vi.mocked(api.fetchAgentConfig).mockResolvedValue({ commands: { GEMINI: 'gemini --prompt {{prompt}}', ANTIGRAVITY: 'agy --prompt {{prompt}}' }, agent_provider: 'GEMINI', max_turns: 20 })
    vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [
      { id: 'ANTIGRAVITY', label: 'Antigravity', enabled: true, conversation_mode: 'native_session', provider_resume: true },
      { id: 'GEMINI', label: 'Gemini', enabled: true, conversation_mode: 'transcript_replay', provider_resume: false },
    ] })
    render(<HarnessSetupPanel config={config} provider="antigravity" projectId={null} />)

    const defaults = await screen.findByRole('region', { name: 'Default task harness' })
    expect(within(defaults).getByText(/Current: Gemini/)).toBeInTheDocument()
    expect(within(defaults).getByRole('status')).toHaveTextContent('stored Gemini task default is preserved')
    fireEvent.click(within(defaults).getAllByRole('button')[0])
    expect(within(defaults).getByRole('button', { name: 'Antigravity' })).toBeInTheDocument()
    expect(within(defaults).queryByRole('button', { name: 'Gemini' })).not.toBeInTheDocument()
    expect(api.updateAgentConfig).not.toHaveBeenCalled()
  })
})
