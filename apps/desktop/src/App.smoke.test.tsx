/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

class MockEventSource {
  onerror: ((event: Event) => void) | null = null
  private listeners: Record<string, Array<(event: { data: string }) => void>> = {}
  closed = false

  constructor(_url: string) {
    eventSourceConstructCount += 1
    eventSourceInstances.push(this)
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(listener)
  }

  close() {
    this.closed = true
  }

  emitOpen() {
    const openListeners = this.listeners.open ?? []
    for (const listener of openListeners) {
      listener({ data: '' })
    }
  }

  emitError() {
    this.onerror?.(new Event('error'))
  }
}

let eventSourceConstructCount = 0
let eventSourceInstances: MockEventSource[] = []

type BridgeProfilesPayload = {
  activeProfileId: string
  profiles: Array<{
    id: string
    name: string
    baseUrl: string
    apiToken: string
  }>
}

const defaultProfiles: BridgeProfilesPayload = {
  activeProfileId: 'default',
  profiles: [
    {
      id: 'default',
      name: 'Default',
      baseUrl: 'http://127.0.0.1:4000',
      apiToken: '',
    },
  ],
}

function setupDesktopBridge(overrides?: {
  profilesPayload?: BridgeProfilesPayload
  activeConfig?: { baseUrl: string; apiToken: string }
}) {
  const state = {
    profilesPayload: overrides?.profilesPayload ?? defaultProfiles,
    activeConfig:
      overrides?.activeConfig ?? {
        baseUrl: (overrides?.profilesPayload ?? defaultProfiles).profiles[0]?.baseUrl ?? 'http://127.0.0.1:4000',
        apiToken: (overrides?.profilesPayload ?? defaultProfiles).profiles[0]?.apiToken ?? '',
      },
  }

  const bridge = {
    getBackendConfig: vi.fn(async () => state.activeConfig),
    setBackendConfig: vi.fn(async (nextConfig: { baseUrl: string; apiToken: string }) => {
      state.activeConfig = nextConfig
      state.profilesPayload = {
        ...state.profilesPayload,
        profiles: state.profilesPayload.profiles.map((profile) =>
          profile.id === state.profilesPayload.activeProfileId
            ? { ...profile, baseUrl: nextConfig.baseUrl, apiToken: nextConfig.apiToken }
            : profile,
        ),
      }
      return nextConfig
    }),
    getBackendProfiles: vi.fn(async () => state.profilesPayload),
    setActiveBackendProfile: vi.fn(async (profileId: string) => {
      const profile = state.profilesPayload.profiles.find((entry) => entry.id === profileId)
      if (!profile) {
        throw new Error('profile not found')
      }
      state.profilesPayload = {
        ...state.profilesPayload,
        activeProfileId: profileId,
      }
      state.activeConfig = { baseUrl: profile.baseUrl, apiToken: profile.apiToken }
      return state.activeConfig
    }),
    saveBackendProfile: vi.fn(async (payload: { name: string; baseUrl: string; apiToken: string; makeActive?: boolean }) => {
      const id = payload.name.toLowerCase().replace(/\s+/g, '-')
      const nextProfiles = [...state.profilesPayload.profiles, { id, name: payload.name, baseUrl: payload.baseUrl, apiToken: payload.apiToken }]
      const activeProfileId = payload.makeActive ? id : state.profilesPayload.activeProfileId
      state.profilesPayload = {
        activeProfileId,
        profiles: nextProfiles,
      }
      if (payload.makeActive) {
        state.activeConfig = { baseUrl: payload.baseUrl, apiToken: payload.apiToken }
      }
      return state.profilesPayload
    }),
    deleteBackendProfile: vi.fn(async (profileId: string) => {
      const nextProfiles = state.profilesPayload.profiles.filter((entry) => entry.id !== profileId)
      const nextActive = nextProfiles[0]?.id ?? ''
      state.profilesPayload = {
        activeProfileId: nextActive,
        profiles: nextProfiles,
      }
      const nextActiveProfile = nextProfiles[0]
      if (nextActiveProfile) {
        state.activeConfig = { baseUrl: nextActiveProfile.baseUrl, apiToken: nextActiveProfile.apiToken }
      }
      return state.profilesPayload
    }),
  }

  window.orchestraDesktop = bridge
  return bridge
}

function setupFetch(snapshotPayload: Record<string, unknown>, options?: { onFetch?: (url: string, init?: RequestInit) => Response | null }) {
  const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input)

    if (options?.onFetch) {
      const custom = options.onFetch(url, init)
      if (custom) {
        return custom
      }
    }

    if (url.includes('/api/v1/state')) {
      return new Response(JSON.stringify(snapshotPayload), { status: 200 })
    }

    if (url.includes('/api/v1/OPS-1') && (!init?.method || init.method === 'GET')) {
      return new Response(
        JSON.stringify({
          issue_identifier: 'OPS-1',
          issue_id: '1',
          status: 'running',
          attempts: { restart_count: 0, current_retry_attempt: 0 },
          workspace: { path: '/tmp/workspace' },
          running: null,
          retry: null,
          logs: {},
          recent_events: [],
          last_error: null,
          tracked: {},
        }),
        { status: 200 },
      )
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function defaultSnapshot(runningCount = 0): Record<string, unknown> {
  return {
    generated_at: '2026-03-06T00:00:00Z',
    counts: { running: runningCount, retrying: 0 },
    running:
      runningCount > 0
        ? [
            {
              issue_id: '1',
              issue_identifier: 'OPS-1',
              state: 'running',
              session_id: 'session-1',
            },
          ]
        : [],
    retrying: [],
    codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_run: 0 },
    rate_limits: null,
  }
}

describe('App smoke render', () => {
  beforeEach(() => {
    cleanup()
    eventSourceConstructCount = 0
    eventSourceInstances = []
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders dashboard and opens settings without crashing', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Dashboard' }).length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    await waitFor(() => {
      expect(screen.getByText('Backend Configuration')).toBeTruthy()
    })
  })

  it('renders integration utility lanes for Codex/OpenCode/Claude Code/Linear', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Integration Surface')).toBeTruthy()
      expect(screen.getByText('Codex')).toBeTruthy()
      expect(screen.getByText('OpenCode')).toBeTruthy()
      expect(screen.getByText('Claude Code')).toBeTruthy()
      expect(screen.getByText('Linear')).toBeTruthy()
    })
  })

  it('opens issues section with issue board presentation', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(1))

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Issues/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Issue Board' })).toBeTruthy()
      expect(screen.getByRole('heading', { name: /To Do/i })).toBeTruthy()
      expect(screen.getByRole('heading', { name: /In Progress/i })).toBeTruthy()
      expect(screen.getByRole('heading', { name: /Done/i })).toBeTruthy()
    })
  })

  it('inspects issue from running list row click', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(1))

    render(<App />)

    const runningHeading = await screen.findByText('Running Issues')
    const runningCardElement = runningHeading.closest('div[class*="shadow"]')
    const runningCard = runningCardElement instanceof HTMLElement ? runningCardElement : document.body
    const issueButton = within(runningCard).getByRole('button', { name: 'OPS-1' })
    fireEvent.click(issueButton)

    await waitFor(() => {
      expect(screen.getByText('Issue Inspector')).toBeTruthy()
      // In the enriched UI, OPS-1 is in a badge and Title/State are visible
      expect(screen.getAllByText('OPS-1').length).toBeGreaterThan(0)
      expect(screen.getByText('No Title')).toBeTruthy()
    })
  })

  it('renders running list in deterministic issue-identifier order', async () => {
    setupDesktopBridge()
    setupFetch({
      generated_at: '2026-03-06T00:00:00Z',
      counts: { running: 3, retrying: 0 },
      running: [
        { issue_id: '3', issue_identifier: 'OPS-C', state: 'running', session_id: 's3' },
        { issue_id: '2', issue_identifier: 'OPS-A', state: 'running', session_id: 's2' },
        { issue_id: '1', issue_identifier: 'OPS-B', state: 'running', session_id: 's1' },
      ],
      retrying: [],
      codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_run: 0 },
      rate_limits: null,
    })

    render(<App />)

    const runningHeading = await screen.findByText('Running Issues')
    const runningCardElement = runningHeading.closest('div[class*="shadow"]')
    const runningCard = runningCardElement instanceof HTMLElement ? runningCardElement : document.body
    const issueButtons = within(runningCard).getAllByTitle('Inspect issue details')
    const labels = issueButtons.map((button) => button.textContent)
    expect(labels).toEqual(['OPS-A', 'OPS-B', 'OPS-C'])
  })

  it('shows normalized error for missing issue lookup', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(), {
      onFetch: (url, init) => {
        if (url.includes('/api/v1/OPS-MISSING') && (!init?.method || init.method === 'GET')) {
          return new Response(
            JSON.stringify({
              error: {
                code: 'issue_not_found',
                message: 'issue not found',
              },
            }),
            { status: 404 },
          )
        }
        return null
      },
    })

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Dashboard' }).length).toBeGreaterThan(0)
    })

    fireEvent.change(screen.getByPlaceholderText('e.g. OPS-123'), { target: { value: 'OPS-MISSING' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch Issue' }))

    await waitFor(() => {
      expect(screen.getByText('issue_not_found: issue not found')).toBeTruthy()
    })
  })

  it('creates backend profile from settings', async () => {
    const bridge = setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Dashboard' }).length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => {
      expect(screen.getByText('Backend Configuration')).toBeTruthy()
    })

    fireEvent.change(screen.getByPlaceholderText('Production, Staging, Local...'), { target: { value: 'Staging' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(bridge.saveBackendProfile).toHaveBeenCalled()
    })
  })

  it('switches active profile and re-requests state from new base URL', async () => {
    const bridge = setupDesktopBridge({
      profilesPayload: {
        activeProfileId: 'default',
        profiles: [
          { id: 'default', name: 'Default', baseUrl: 'http://127.0.0.1:4000', apiToken: '' },
          { id: 'staging', name: 'Staging', baseUrl: 'http://127.0.0.1:4010', apiToken: '' },
        ],
      },
      activeConfig: { baseUrl: 'http://127.0.0.1:4000', apiToken: '' },
    })

    const fetchMock = setupFetch(defaultSnapshot(), {
      onFetch: (url) => {
        if (url.includes('http://127.0.0.1:4010/api/v1/state')) {
          return new Response(JSON.stringify(defaultSnapshot()), { status: 200 })
        }
        return null
      },
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    const select = await screen.findByDisplayValue('Default')
    fireEvent.change(select, { target: { value: 'staging' } })

    await waitFor(() => {
      expect(bridge.setActiveBackendProfile).toHaveBeenCalledWith('staging')
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('http://127.0.0.1:4010/api/v1/state'))).toBe(true)
    })
  })

  it('tears down prior stream when active profile switches', async () => {
    setupDesktopBridge({
      profilesPayload: {
        activeProfileId: 'default',
        profiles: [
          { id: 'default', name: 'Default', baseUrl: 'http://127.0.0.1:4000', apiToken: '' },
          { id: 'staging', name: 'Staging', baseUrl: 'http://127.0.0.1:4010', apiToken: '' },
        ],
      },
      activeConfig: { baseUrl: 'http://127.0.0.1:4000', apiToken: '' },
    })

    setupFetch(defaultSnapshot(), {
      onFetch: (url) => {
        if (url.includes('http://127.0.0.1:4010/api/v1/state')) {
          return new Response(JSON.stringify(defaultSnapshot()), { status: 200 })
        }
        return null
      },
    })

    render(<App />)

    await waitFor(() => {
      expect(eventSourceInstances.length).toBe(1)
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const select = await screen.findByDisplayValue('Default')
    fireEvent.change(select, { target: { value: 'staging' } })

    await waitFor(() => {
      expect(eventSourceInstances.length).toBeGreaterThan(1)
      expect(eventSourceInstances[0]?.closed).toBe(true)
    })
  })

  it('saves backend config from settings form', async () => {
    const bridge = setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))

    const baseUrlInput = await screen.findByPlaceholderText('http://127.0.0.1:4000')
    fireEvent.change(baseUrlInput, { target: { value: 'http://127.0.0.1:4020' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Backend Config' }))

    await waitFor(() => {
      expect(bridge.setBackendConfig).toHaveBeenCalledWith({
        baseUrl: 'http://127.0.0.1:4020',
        apiToken: '',
      })
    })
  })

  it('deletes non-default profile from settings', async () => {
    const bridge = setupDesktopBridge({
      profilesPayload: {
        activeProfileId: 'staging',
        profiles: [
          { id: 'default', name: 'Default', baseUrl: 'http://127.0.0.1:4000', apiToken: '' },
          { id: 'staging', name: 'Staging', baseUrl: 'http://127.0.0.1:4010', apiToken: '' },
        ],
      },
      activeConfig: { baseUrl: 'http://127.0.0.1:4010', apiToken: '' },
    })
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(bridge.deleteBackendProfile).toHaveBeenCalledWith('staging')
    })
  })

  it('runs workspace migration plan and apply confirmation flow', async () => {
    setupDesktopBridge()
    const fetchMock = setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Workspace Migration' }))

    fireEvent.change(await screen.findByPlaceholderText('optional source path'), { target: { value: '/tmp/from' } })
    fireEvent.change(screen.getByPlaceholderText('optional target path'), { target: { value: '/tmp/to' } })

    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Apply' }))

    await waitFor(() => {
      const calledPlan = fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/workspace/migration/plan'))
      const calledApply = fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/workspace/migrate'))
      expect(calledPlan).toBe(true)
      expect(calledApply).toBe(true)
      expect(screen.getByText('Migration apply request accepted.')).toBeTruthy()
    })
  })

  it('shows refresh success status in runtime strip', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(screen.getByText('Refresh queued successfully.')).toBeTruthy()
    })
  })

  it('shows backend config validation error for invalid URL', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const baseUrlInput = await screen.findByPlaceholderText('http://127.0.0.1:4000')
    fireEvent.change(baseUrlInput, { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Backend Config' }))

    await waitFor(() => {
      expect(screen.getByText('backend config save failed: base URL must be a valid absolute URL')).toBeTruthy()
    })
  })

  it('shows refresh failure error in runtime strip', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(), {
      onFetch: (url, init) => {
        if (url.includes('/api/v1/refresh') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              error: {
                code: 'refresh_failed',
                message: 'backend refresh unavailable',
              },
            }),
            { status: 503 },
          )
        }
        return null
      },
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(screen.getByText('refresh failed: refresh_failed: backend refresh unavailable')).toBeTruthy()
    })
  })

  it('shows migration apply failure error message', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(), {
      onFetch: (url, init) => {
        if (url.includes('/api/v1/workspace/migrate') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              error: {
                code: 'migration_failed',
                message: 'apply blocked',
              },
            }),
            { status: 409 },
          )
        }
        return null
      },
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Workspace Migration' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm Apply' }))

    await waitFor(() => {
      expect(screen.getByText('migration apply failed: migration_failed: apply blocked')).toBeTruthy()
    })
  })

  it('[degraded] shows protected-host token guidance on unauthorized refresh', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(), {
      onFetch: (url, init) => {
        if (url.includes('/api/v1/refresh') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              error: {
                code: 'unauthorized',
                message: 'missing or invalid bearer token',
              },
            }),
            { status: 401 },
          )
        }
        return null
      },
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(screen.getByText('Protected host detected. Add bearer token in Settings -> Backend Configuration.')).toBeTruthy()
    })
  })

  it('shows polling mode status when bearer token is configured and does not open EventSource', async () => {
    setupDesktopBridge({
      activeConfig: {
        baseUrl: 'http://127.0.0.1:4000',
        apiToken: 'smoke-token',
      },
      profilesPayload: {
        activeProfileId: 'default',
        profiles: [
          {
            id: 'default',
            name: 'Default',
            baseUrl: 'http://127.0.0.1:4000',
            apiToken: 'smoke-token',
          },
        ],
      },
    })
    setupFetch(defaultSnapshot())

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('SSE disabled while bearer token is set (EventSource header limitation); polling mode active.')).toBeTruthy()
    })

    expect(eventSourceConstructCount).toBe(0)
  })

  it('shows protected-host token guidance on unauthorized issue lookup', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(), {
      onFetch: (url, init) => {
        if (url.includes('/api/v1/OPS-AUTH') && (!init?.method || init.method === 'GET')) {
          return new Response(
            JSON.stringify({
              error: {
                code: 'unauthorized',
                message: 'missing or invalid bearer token',
              },
            }),
            { status: 401 },
          )
        }
        return null
      },
    })

    render(<App />)

    fireEvent.change(await screen.findByPlaceholderText('e.g. OPS-123'), { target: { value: 'OPS-AUTH' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch Issue' }))

    await waitFor(() => {
      expect(screen.getByText('Protected host detected. Add bearer token in Settings -> Backend Configuration.')).toBeTruthy()
    })
  })

  it('supports keyboard navigation in sidebar with ArrowDown', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    const nav = await screen.findByRole('navigation', { name: 'Primary navigation' })
    const navQueries = within(nav)
    const dashboardButton = navQueries.getByRole('button', { name: /Dashboard/i })

    fireEvent.keyDown(dashboardButton, { key: 'ArrowDown' })

    await waitFor(() => {
      const runningButton = navQueries.getByRole('button', { name: /Running/i })
      expect(runningButton.getAttribute('aria-current')).toBe('page')
    })
  })

  it('supports Home and End keyboard navigation in sidebar', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    const nav = await screen.findByRole('navigation', { name: 'Primary navigation' })
    const navQueries = within(nav)
    const dashboardButton = navQueries.getByRole('button', { name: /Dashboard/i })

    fireEvent.keyDown(dashboardButton, { key: 'End' })
    await waitFor(() => {
      const settingsButton = navQueries.getByRole('button', { name: /Settings/i })
      expect(settingsButton.getAttribute('aria-current')).toBe('page')
    })

    const settingsButton = navQueries.getByRole('button', { name: /Settings/i })
    fireEvent.keyDown(settingsButton, { key: 'Home' })
    await waitFor(() => {
      const firstButton = navQueries.getByRole('button', { name: /Dashboard/i })
      expect(firstButton.getAttribute('aria-current')).toBe('page')
    })
  })

  it('disables profile delete when only one profile exists', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const deleteButton = await screen.findByRole('button', { name: 'Delete' })
    expect(deleteButton.hasAttribute('disabled')).toBe(true)
  })

  it('disables issue inspector lookup action when identifier is blank', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    const fetchIssueButton = await screen.findByRole('button', { name: 'Fetch Issue' })
    expect(fetchIssueButton.hasAttribute('disabled')).toBe(true)
  })

  it('[degraded] DEGRADED_ASSERTION:sse_disconnect_fallback shows SSE disconnect fallback status after stream error', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    await waitFor(() => {
      expect(eventSourceInstances.length).toBeGreaterThan(0)
    })

    eventSourceInstances[0]?.emitError()

    await waitFor(() => {
      expect(screen.getByText('SSE disconnected, using polling fallback and reconnecting...')).toBeTruthy()
    })
  })

  it('[degraded] DEGRADED_ASSERTION:sse_disconnect_reconnect_lifecycle restores SSE connected status after reconnect open', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    await waitFor(() => {
      expect(eventSourceInstances.length).toBeGreaterThan(0)
    })

    eventSourceInstances[0]?.emitError()

    await waitFor(() => {
      expect(screen.getByText('SSE disconnected, using polling fallback and reconnecting...')).toBeTruthy()
    })

    await waitFor(
      () => {
        expect(eventSourceInstances.length).toBeGreaterThan(1)
      },
      { timeout: 5000 },
    )

    eventSourceInstances[1]?.emitOpen()

    await waitFor(() => {
      expect(screen.getByText('SSE connected.')).toBeTruthy()
    })
  })

  it('toggles theme and updates root dark class', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    window.localStorage.setItem('orchestra-theme', 'dark')
    render(<App />)

    const toggleButton = await screen.findByRole('button', { name: 'Toggle light and dark mode' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    fireEvent.click(toggleButton)

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(window.localStorage.getItem('orchestra-theme')).toBe('light')
    })
  })
})
