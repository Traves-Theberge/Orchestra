import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import type { BackendConfig } from '@core/api/client'
import { SettingsPage } from './SettingsPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resetAppStore()
})

function renderSettings(config: BackendConfig | null = null, initialTab?: 'backend' | 'integrations' | 'shortcuts' | 'notifications') {
  const onSetActiveProfile = vi.fn(async (_id: string) => {})
  const onSaveBackendConfig = vi.fn(async (_next: { baseUrl: string; apiToken: string }) => {})
  const setActiveTheme = vi.fn()
  const setMode = vi.fn()
  const setTheme = vi.fn()
  useAppStore.setState({ setActiveTheme, setMode, setTheme })
  render(<SettingsPage
    loadingConfig={false}
    savingConfig={false}
    profilesPending={false}
    config={config}
    backendProfiles={[
      { id: 'fixture-profile-a', name: 'Fixture A', baseUrl: 'http://a.fixture.invalid', apiToken: 'fixture-a' },
      { id: 'fixture-profile-b', name: 'Fixture B', baseUrl: 'http://b.fixture.invalid', apiToken: 'fixture-b' },
    ]}
    activeProfileId="fixture-profile-a"
    migrationPending={false}
    migrationFrom=""
    migrationTo=""
    migrationPlan={null}
    agentConfig={null}
    onMigrationFromChange={vi.fn()}
    onMigrationToChange={vi.fn()}
    onMigrationPlan={vi.fn(async () => {})}
    onMigrationApply={vi.fn(async () => {})}
    onSaveBackendConfig={onSaveBackendConfig}
    onSetActiveProfile={onSetActiveProfile}
    onCreateProfile={vi.fn(async () => {})}
    onDeleteProfile={vi.fn(async () => {})}
    onSaveAgentConfig={vi.fn(async () => {})}
    initialTab={initialTab}
  />)
  return { onSetActiveProfile, setActiveTheme, setMode, setTheme }
}

describe('Settings selector walkthroughs', () => {
  it('places every harness onboarding and usage quota in Settings', () => {
    renderSettings()
    const harnesses = document.querySelector('[data-settings-section="harnesses"]')
    const usage = document.querySelector('[data-settings-section="usage"]')
    expect(harnesses).toBeInTheDocument()
    expect(usage).toBeInTheDocument()
    for (const name of ['Codex', 'Claude Code', 'OpenCode', 'Antigravity', '8gent']) {
      expect(harnesses).toHaveTextContent(name)
    }
    for (const name of ['Claude', 'Codex', 'OpenCode', 'Antigravity', '8gent']) expect(usage).toHaveTextContent(name)
    expect(usage).toHaveTextContent('Antigravity history')
    expect(usage).toHaveTextContent('8gent history')
    expect(usage).toHaveTextContent('Gemini CLI (legacy logs)')
  })

  it('chooses the exact backend profile while keeping fixture credentials out of the callback', () => {
    const { onSetActiveProfile } = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: 'Fixture A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fixture B' }))
    expect(onSetActiveProfile).toHaveBeenCalledExactlyOnceWith('fixture-profile-b')
    expect(onSetActiveProfile).not.toHaveBeenCalledWith(expect.stringContaining('fixture-b'))
  })

  it.each([
    ['Linear', 'Team key', 'ENG', 'linear', { team_key: 'ENG' }],
    ['Jira', 'Project key', 'PROJ', 'jira', { jira_user: 'service-user', default_project: 'PROJ' }],
  ])('saves the required %s native scope in tracker config extra', async (provider, scopeLabel, scopeValue, type, expectedExtra) => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'fixture-config', type, display_name: 'Fixture', endpoint: '', has_token: true }), { status: 201 })
      }
      return new Response('[]', { status: 200 })
    }))

    renderSettings({ baseUrl: 'http://orchestra.fixture', apiToken: 'fixture-token' }, 'integrations')
    await waitFor(() => expect(screen.getByRole('button', { name: provider })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: provider }))
    fireEvent.change(await screen.findByLabelText(/Connection name/), { target: { value: 'Fixture' } })
    fireEvent.change(screen.getByLabelText(new RegExp(scopeLabel)), { target: { value: scopeValue } })
    if (provider === 'Jira') {
      fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: 'https://jira.fixture.invalid' } })
      fireEvent.change(screen.getByLabelText(/Email \(Cloud\) or username \(Server\)/), { target: { value: 'service-user' } })
    }
    fireEvent.change(screen.getByLabelText(provider === 'Linear' ? /API key/ : /API token or PAT/), { target: { value: 'fixture-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requests.some(request => request.init?.method === 'POST')).toBe(true))
    const create = requests.find(request => request.init?.method === 'POST')!
    const payload = JSON.parse(String(create.init?.body)) as { type: string; extra: Record<string, unknown> }
    expect(payload.type).toBe(type)
    expect(payload.extra).toEqual(expectedExtra)
  })

  it('requires a username before saving Jira Server credentials', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
    renderSettings({ baseUrl: 'http://orchestra.fixture', apiToken: 'fixture-token' }, 'integrations')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Jira' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Jira' }))
    fireEvent.change(await screen.findByLabelText(/Connection name/), { target: { value: 'Server' } })
    fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: 'https://jira.server.fixture' } })
    fireEvent.change(screen.getByLabelText(/Project key/), { target: { value: 'PROJ' } })
    fireEvent.change(screen.getByLabelText(/API token or PAT/), { target: { value: 'fixture-secret' } })
    expect(screen.getByRole('alert').textContent).toContain('username (Server)')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('allows Jira Cloud Bearer credentials without an email', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const requests: Array<{ init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ init })
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'cloud-config', type: 'jira', display_name: 'Cloud', endpoint: 'https://acme.atlassian.net', has_token: true }), { status: 201 })
      }
      return new Response('[]', { status: 200 })
    }))
    renderSettings({ baseUrl: 'http://orchestra.fixture', apiToken: 'fixture-token' }, 'integrations')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Jira' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Jira' }))
    fireEvent.change(await screen.findByLabelText(/Connection name/), { target: { value: 'Cloud' } })
    fireEvent.change(screen.getByLabelText(/Base URL/), { target: { value: 'https://acme.atlassian.net' } })
    fireEvent.change(screen.getByLabelText(/Project key/), { target: { value: 'PROJ' } })
    fireEvent.change(screen.getByLabelText(/API token or PAT/), { target: { value: 'fixture-token' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(requests.some(request => request.init?.method === 'POST')).toBe(true))
    const create = requests.find(request => request.init?.method === 'POST')!
    const payload = JSON.parse(String(create.init?.body)) as { extra: Record<string, string> }
    expect(payload.extra).toEqual({ default_project: 'PROJ' })
  })

  it('visibly blocks a tracker config save while required native scope is missing', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
    renderSettings({ baseUrl: 'http://orchestra.fixture', apiToken: 'fixture-token' }, 'integrations')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Linear' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Linear' }))
    fireEvent.change(await screen.findByLabelText(/Connection name/), { target: { value: 'Fixture' } })
    expect(screen.getByRole('alert').textContent).toContain('Team key')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('selects a theme preset by its stable ID and switches appearance mode explicitly', () => {
    const { setActiveTheme, setMode, setTheme } = renderSettings()
    const theme = useAppStore.getState().builtinThemes.find(item => item.id !== useAppStore.getState().activeThemeId)
    expect(theme).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: theme!.name }))
    expect(setActiveTheme).toHaveBeenCalledExactlyOnceWith(theme!.id)

    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    expect(setMode).toHaveBeenCalledExactlyOnceWith('auto')
    expect(setTheme).not.toHaveBeenCalled()
  })
})
