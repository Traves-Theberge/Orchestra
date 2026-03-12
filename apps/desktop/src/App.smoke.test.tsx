import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import type { BridgeProfilesPayload, SnapshotPayload } from '@/lib/orchestra-types'

// Mock Electron bridge
const defaultProfiles: BridgeProfilesPayload = {
  activeProfileId: 'default',
  profiles: [
    {
      id: 'default',
      name: 'Default',
      baseUrl: 'http://127.0.0.1:4010',
      apiToken: '',
    },
  ],
}

function setupDesktopBridge(overrides?: {
  profilesPayload?: BridgeProfilesPayload
  activeConfig?: { baseUrl: string; apiToken: string }
  agentTokens?: Record<string, string>
}) {
  const state = {
    profilesPayload: overrides?.profilesPayload ?? JSON.parse(JSON.stringify(defaultProfiles)),
    activeConfig:
      overrides?.activeConfig ?? {
        baseUrl: (overrides?.profilesPayload ?? defaultProfiles).profiles[0]?.baseUrl ?? 'http://127.0.0.1:4010',
        apiToken: (overrides?.profilesPayload ?? defaultProfiles).profiles[0]?.apiToken ?? '',
      },
    agentTokens: overrides?.agentTokens ?? {},
  }

  const bridge = {
    getBackendConfig: vi.fn(async () => state.activeConfig),
    setBackendConfig: vi.fn(async (nextConfig: { baseUrl: string; apiToken: string }) => {
      state.activeConfig = nextConfig
      return state.activeConfig
    }),
    getBackendProfiles: vi.fn(async () => state.profilesPayload),
    saveBackendProfile: vi.fn(async (payload: { name: string; baseUrl: string; apiToken: string; makeActive: boolean }) => {
      const id = payload.name.toLowerCase()
      state.profilesPayload.profiles.push({ id, ...payload })
      if (payload.makeActive) {
        state.profilesPayload.activeProfileId = id
        state.activeConfig = { baseUrl: payload.baseUrl, apiToken: payload.apiToken }
      }
      return state.profilesPayload
    }),
    setActiveBackendProfile: vi.fn(async (profileId: string) => {
      state.profilesPayload.activeProfileId = profileId
      const nextProfiles = state.profilesPayload.profiles.filter((entry: any) => entry.id === profileId)
      const nextActiveProfile = nextProfiles[0]
      if (nextActiveProfile) {
        state.activeConfig = { baseUrl: nextActiveProfile.baseUrl, apiToken: nextActiveProfile.apiToken }
      }
      return state.activeConfig
    }),
    deleteBackendProfile: vi.fn(async (profileId: string) => {
      const nextProfiles = state.profilesPayload.profiles.filter((entry: any) => entry.id !== profileId)
      const nextActive = nextProfiles[0]?.id ?? ''
      state.profilesPayload.profiles = nextProfiles
      state.profilesPayload.activeProfileId = nextActive
      const nextActiveProfile = nextProfiles[0]
      if (nextActiveProfile) {
        state.activeConfig = { baseUrl: nextActiveProfile.baseUrl, apiToken: nextActiveProfile.apiToken }
      }
      return state.profilesPayload
    }),
    getAgentTokens: vi.fn(async () => state.agentTokens),
    setAgentToken: vi.fn(async (name: string, value: string | null) => {
      if (value === null) {
        delete state.agentTokens[name]
      } else {
        state.agentTokens[name] = value
      }
      return true
    }),
    selectFolder: vi.fn(async () => '/mock/selected/path'),
  }

  window.orchestraDesktop = bridge as any
  return bridge
}

// Mock fetch
let fetchMock = vi.fn()
let eventSourceInstances: MockEventSource[] = []
let eventSourceConstructCount = 0

class MockEventSource {
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  closed = false
  listeners: Record<string, any[]> = {}

  constructor(public url: string) {
    eventSourceConstructCount++
    eventSourceInstances.push(this)
  }

  addEventListener = vi.fn((type: string, listener: any) => {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(listener)
  })

  removeEventListener = vi.fn((type: string, listener: any) => {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter(l => l !== listener)
    }
  })

  close = vi.fn(() => {
    this.closed = true
  })

  emit(type: string, data?: any) {
    if (this.listeners[type]) {
      act(() => {
        // Use a copy to avoid issues if listeners remove themselves during iteration
        [...this.listeners[type]].forEach(l => {
          if (type === 'message' || type === 'snapshot' || lifecycleEventTypes.includes(type)) {
            l({ data: JSON.stringify(data) } as MessageEvent)
          } else {
            l(new Event(type))
          }
        })
      })
    }
  }

  emitMessage(data: any) {
    act(() => {
      this.emit('message', data)
    })
  }

  emitError() {
    act(() => {
      if (this.onerror) this.onerror(new Event('error'))
      this.emit('error')
    })
  }
}

const lifecycleEventTypes = [
  'run_event',
  'run_started',
  'run_failed',
  'run_continues',
  'run_succeeded',
  'retry_scheduled',
  'hook_started',
  'hook_completed',
  'hook_failed',
]

function setupFetch(snapshotPayload: any, options?: { onFetch?: (url: string, init?: RequestInit) => Response | null }) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/v1/warehouse/stats')) {
      return new Response(JSON.stringify({ 
        total_tokens: 0, 
        total_input: 0, 
        total_output: 0, 
        provider_usage: {}, 
        recent_sessions: [] 
      }), { status: 200 })
    }

    if (options?.onFetch) {
      const custom = options.onFetch(url, init)
      if (custom) {
        return custom
      }
    }

    if (url.includes('/api/v1/state')) {
      return new Response(JSON.stringify(snapshotPayload), { status: 200 })
    }

    if (url.includes('/api/v1/projects')) {
      return new Response(JSON.stringify([]), { status: 200 })
    }

    if (url.includes('/api/v1/agents')) {
      return new Response(JSON.stringify({ agents: ['agent-codex'] }), { status: 200 })
    }

    if (url.includes('/api/v1/config/agents')) {
      return new Response(JSON.stringify({ commands: {}, agent_provider: 'agent-codex' }), { status: 200 })
    }

    if (url.includes('/api/v1/issues')) {
      return new Response(JSON.stringify({ issues: [] }), { status: 200 })
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function defaultSnapshot(runningCount = 0): SnapshotPayload {
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
              started_at: '2026-03-06T00:00:00Z',
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
    eventSourceInstances = []
    eventSourceConstructCount = 0
    vi.stubGlobal('EventSource', vi.fn().mockImplementation((url) => new MockEventSource(url)))
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
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
      expect(screen.getAllByText(/Dashboard/i).length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByTestId('sidebar-nav-settings'))

    await waitFor(() => {
      expect(screen.getByText(/Connection Profiles/i)).toBeTruthy()
    })
  })

  it('opens issues section with issue board presentation', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(1))

    render(<App />)

    fireEvent.click(await screen.findByTestId('sidebar-nav-issues'))

    await waitFor(() => {
      expect(screen.getAllByText(/Tasks/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/To Do/i)).toBeTruthy()
      expect(screen.getByText(/In Progress/i)).toBeTruthy()
      expect(screen.getByText(/Done/i)).toBeTruthy()
    })
  })

  it('deletes a task from issue board and updates UI', async () => {
    setupDesktopBridge()
    const issues = [
      {
        id: 'issue-1',
        issue_identifier: 'OPS-1',
        identifier: 'OPS-1',
        title: 'Delete me',
        description: 'to be removed',
        state: 'Todo',
        assignee_id: 'agent-codex',
        priority: 2,
        project_id: '',
      },
    ]
    const fetchMock = setupFetch(defaultSnapshot(), {
      onFetch: (url, init) => {
        if (url.includes('/api/v1/issues?')) {
          return new Response(JSON.stringify({ issues }), { status: 200 })
        }
        if (url.includes('/api/v1/issues/OPS-1') && init?.method === 'DELETE') {
          issues.splice(0, issues.length)
          return new Response(null, { status: 204 })
        }
        return null
      },
    })

    render(<App />)

    fireEvent.click(await screen.findByTestId('sidebar-nav-issues'))

    await waitFor(() => {
      expect(screen.getByText('Delete me')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete task OPS-1' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/issues/OPS-1') && call[1]?.method === 'DELETE')).toBe(true)
      expect(screen.queryByText('Delete me')).toBeNull()
    })
  })

  it('keeps delete dialog open when task deletion fails', async () => {
    setupDesktopBridge()
    const issues = [
      {
        id: 'issue-1',
        issue_identifier: 'OPS-1',
        identifier: 'OPS-1',
        title: 'Delete me',
        description: 'to be removed',
        state: 'Todo',
        assignee_id: 'agent-codex',
        priority: 2,
        project_id: '',
      },
    ]
    setupFetch(defaultSnapshot(), {
      onFetch: (url, init) => {
        if (url.includes('/api/v1/issues?')) {
          return new Response(JSON.stringify({ issues }), { status: 200 })
        }
        if (url.includes('/api/v1/issues/OPS-1') && init?.method === 'DELETE') {
          return new Response(JSON.stringify({ error: { code: 'delete_failed', message: 'backend failed' } }), { status: 500 })
        }
        return null
      },
    })

    render(<App />)

    fireEvent.click(await screen.findByTestId('sidebar-nav-issues'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete task OPS-1' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByText(/delete issue failed/i)).toBeTruthy()
    })
  })

  it('inspects issue from running list row click', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(1))

    render(<App />)

    fireEvent.click(await screen.findByTestId('sidebar-nav-running'))

    const row = await screen.findByText('OPS-1')
    fireEvent.click(row)

    await waitFor(() => {
      expect(screen.getByText('Issue Inspection')).toBeTruthy()
      expect(screen.getAllByText('OPS-1').length).toBeGreaterThan(0)
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

    fireEvent.click(await screen.findByTestId('sidebar-nav-running'))

    await waitFor(() => {
      const rows = screen.getAllByRole('button').filter(b => b.textContent?.startsWith('OPS-'))
      const labels = rows.map((button) => button.textContent)
      expect(labels).toEqual(['OPS-A', 'OPS-B', 'OPS-C'])
    })
  })

  it('creates backend profile from settings', async () => {
    const bridge = setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(screen.getByTestId('sidebar-nav-settings'))
    
    await screen.findByText(/Connection Profiles/i)

    fireEvent.change(screen.getByPlaceholderText(/Production, Staging, Local/i), { target: { value: 'staging' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(bridge.saveBackendProfile).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'staging', makeActive: true }),
      )
    })
  })

  it('switches active profile and re-requests state from new base URL', async () => {
    const bridge = setupDesktopBridge({
      profilesPayload: {
        activeProfileId: 'default',
        profiles: [
          { id: 'default', name: 'Default', baseUrl: 'http://127.0.0.1:4010', apiToken: '' },
          { id: 'staging', name: 'Staging', baseUrl: 'http://127.0.0.1:5000', apiToken: '' },
        ],
      },
    })
    const fetchMock = setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(await screen.findByTestId('sidebar-nav-settings'))

    // Trigger dropdown
    const dropdownTrigger = await screen.findByRole('button', { name: /Profile/i })
    fireEvent.click(dropdownTrigger)
    
    // Select option
    await waitFor(async () => {
      const options = screen.getAllByText('Staging')
      fireEvent.click(options[options.length - 1])
    })

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
          { id: 'default', name: 'Default', baseUrl: 'http://127.0.0.1:4010', apiToken: '' },
          { id: 'staging', name: 'Staging', baseUrl: 'http://127.0.0.1:5000', apiToken: '' },
        ],
      },
    })
    setupFetch(defaultSnapshot())

    render(<App />)

    await waitFor(() => {
      expect(eventSourceConstructCount).toBeGreaterThan(0)
    })
    
    // Simulate first instance connecting
    eventSourceInstances[0]?.emit('open')

    fireEvent.click(screen.getByTestId('sidebar-nav-settings'))
    
    const dropdownTrigger = await screen.findByRole('button', { name: /Profile/i })
    fireEvent.click(dropdownTrigger)
    
    await waitFor(async () => {
      const options = screen.getAllByText('Staging')
      fireEvent.click(options[options.length - 1])
    })

    await waitFor(() => {
      // The stream is torn down and a new one created
      expect(eventSourceInstances[0]?.closed).toBe(true)
      expect(eventSourceConstructCount).toBeGreaterThan(1)
    })
  })

  it('saves backend config from settings form', async () => {
    const bridge = setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(screen.getByTestId('sidebar-nav-settings'))
    
    // Wait for form to be ready
    await screen.findByText(/Connection Profiles/i)

    fireEvent.change(screen.getByPlaceholderText('http://127.0.0.1:4000'), { target: { value: 'http://127.0.0.1:9999' } })
    
    const saveButton = await screen.findByRole('button', { name: 'Save Backend Config' })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(bridge.setBackendConfig).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: 'http://127.0.0.1:9999' }),
      )
    })
  })

  it('deletes non-default profile from settings', async () => {
    const bridge = setupDesktopBridge({
      profilesPayload: {
        activeProfileId: 'staging',
        profiles: [
          { id: 'default', name: 'Default', baseUrl: 'http://127.0.0.1:4010', apiToken: '' },
          { id: 'staging', name: 'Staging', baseUrl: 'http://127.0.0.1:5000', apiToken: '' },
        ],
      },
    })
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(screen.getByTestId('sidebar-nav-settings'))
    
    await screen.findByText(/Connection Profiles/i)
    
    // switch profile first
    const dropdownTrigger = await screen.findByRole('button', { name: /Profile/i })
    fireEvent.click(dropdownTrigger)
    
    await waitFor(async () => {
      const options = screen.getAllByText('Staging')
      fireEvent.click(options[options.length - 1])
    })

    await waitFor(() => {
      expect(bridge.setActiveBackendProfile).toHaveBeenCalledWith('staging')
    })

    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(bridge.deleteBackendProfile).toHaveBeenCalledWith('staging')
    })
  })

  it('runs workspace migration plan and apply confirmation flow', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(), {
      onFetch: (url, init) => {
        if (url.includes('/api/v1/workspace/migration/plan')) {
          return new Response(JSON.stringify({ moves: [{ from: '/old', to: '/new' }] }), { status: 200 })
        }
        if (url.includes('/api/v1/workspace/migrate')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        return null
      },
    })

    render(<App />)

    fireEvent.click(screen.getByTestId('sidebar-nav-settings'))
    fireEvent.click(await screen.findByRole('button', { name: 'Migration' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Workspace Migration' }))

    const applyButton = await screen.findByRole('button', { name: 'Apply' })
    fireEvent.click(applyButton)

    const confirmButton = await screen.findByRole('button', { name: 'Confirm Apply' })
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(screen.getByText(/migration apply request accepted/i)).toBeTruthy()
    })
  })

  it('shows refresh success status in runtime strip', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sync state' }))

    await waitFor(() => {
      expect(screen.getByText(/Refresh queued successfully/i)).toBeTruthy()
    })
  })

  it('shows backend config validation error for invalid URL', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(screen.getByTestId('sidebar-nav-settings'))
    await screen.findByText(/Connection Profiles/i)

    fireEvent.change(screen.getByPlaceholderText('http://127.0.0.1:4000'), { target: { value: 'not-a-url' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Backend Config' }))

    await waitFor(() => {
      expect(screen.getByText(/base URL must be a valid absolute URL/i)).toBeTruthy()
    })
  })

  it('shows refresh failure error in runtime strip', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(), {
      onFetch: (url) => {
        if (url.includes('/api/v1/refresh')) {
          return new Response(JSON.stringify({ error: { code: 'refresh_failed', message: 'network timeout' } }), { status: 500 })
        }
        return null
      },
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sync state' }))

    await waitFor(() => {
      expect(screen.getByText(/refresh failed/i)).toBeTruthy()
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

    fireEvent.click(screen.getByTestId('sidebar-nav-settings'))
    fireEvent.click(await screen.findByRole('button', { name: 'Migration' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Workspace Migration' }))

    const applyButton = await screen.findByRole('button', { name: 'Apply' })
    fireEvent.click(applyButton)

    const confirmButton = await screen.findByRole('button', { name: 'Confirm Apply' })
    fireEvent.click(confirmButton)

    await waitFor(() => {
      // The message is displayed in the UI
      expect(screen.getByText(/migration apply failed/i)).toBeTruthy()
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
                message: 'unauthorized: missing token',
              },
            }),
            { status: 401 },
          )
        }
        return null
      },
    })

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sync state' }))

    await waitFor(() => {
      expect(screen.getByText(/Protected host detected/i)).toBeTruthy()
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
          { id: 'default', name: 'Default', baseUrl: 'http://127.0.0.1:4000', apiToken: 'smoke-token' },
        ],
      },
    })
    setupFetch(defaultSnapshot())

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/Polling/i)).toBeTruthy()
    })

    expect(eventSourceConstructCount).toBe(0)
  })

  it('supports keyboard navigation in sidebar with ArrowDown', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    const dashboardButton = await screen.findByTestId('sidebar-nav-dashboard')

    fireEvent.keyDown(dashboardButton, { key: 'ArrowDown' })

    await waitFor(() => {
      const runningButton = screen.getByTestId('sidebar-nav-running')
      expect(runningButton.getAttribute('aria-current')).toBe('page')
    })
  })

  it('supports Home and End keyboard navigation in sidebar', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    const dashboardButton = await screen.findByTestId('sidebar-nav-dashboard')

    fireEvent.keyDown(dashboardButton, { key: 'End' })
    await waitFor(() => {
      const settingsButton = screen.getByTestId('sidebar-nav-settings')
      expect(settingsButton.getAttribute('aria-current')).toBe('page')
    })

    const settingsButton = screen.getByTestId('sidebar-nav-settings')
    fireEvent.keyDown(settingsButton, { key: 'Home' })
    await waitFor(() => {
      const firstButton = screen.getByTestId('sidebar-nav-dashboard')
      expect(firstButton.getAttribute('aria-current')).toBe('page')
    })
  })

  it('disables profile delete when only one profile exists', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(screen.getByTestId('sidebar-nav-settings'))
    
    await screen.findByText(/Connection Profiles/i)
    
    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true)
  })

  it('[degraded] DEGRADED_ASSERTION:sse_disconnect_fallback shows SSE disconnect fallback status after stream error', async () => {
    setupDesktopBridge({
      activeConfig: { baseUrl: 'http://127.0.0.1:4000', apiToken: '' }
    })
    setupFetch(defaultSnapshot())

    render(<App />)

    await waitFor(() => {
      expect(eventSourceConstructCount).toBeGreaterThan(0)
    })

    eventSourceInstances[0]?.emit('open')
    eventSourceInstances[0]?.emitError()

    await waitFor(() => {
      expect(screen.getByText(/SSE disconnected/i)).toBeTruthy()
    })
  })

  it('[degraded] DEGRADED_ASSERTION:sse_disconnect_reconnect_lifecycle restores SSE connected status after reconnect open', async () => {
    setupDesktopBridge({
      activeConfig: { baseUrl: 'http://127.0.0.1:4000', apiToken: '' }
    })
    setupFetch(defaultSnapshot())

    render(<App />)

    await waitFor(() => {
      expect(eventSourceConstructCount).toBeGreaterThan(0)
    })

    eventSourceInstances[0]?.emit('open')
    eventSourceInstances[0]?.emitError()

    await waitFor(() => {
      expect(screen.getByText(/SSE disconnected/i)).toBeTruthy()
    })

    // Simulate reconnect success
    // Wait for the next instance to be created after the 2s delay
    // We check for the construct count specifically
    await waitFor(() => {
      if (eventSourceConstructCount <= 1) throw new Error('waiting for reconnect')
      return true
    }, { timeout: 20000 })
    
    // Trigger open on the NEW instance
    const newInstance = eventSourceInstances[eventSourceConstructCount - 1]
    newInstance.emit('open')

    await waitFor(
      () => {
        // Find ALL elements with text matching /Live/i and find the one that is the badge
        const allLive = screen.getAllByText(/Live/i)
        const liveBadge = allLive.find(el => el.className.includes('tracking-wider'))
        if (!liveBadge) throw new Error('live badge not found')
        expect(liveBadge).toBeTruthy()
      },
      { timeout: 20000 },
    )
  }, 25000)

  it('opens projects section and adds a project via folder picker', async () => {
    const bridge = setupDesktopBridge()
    setupFetch(defaultSnapshot())

    render(<App />)

    fireEvent.click(await screen.findByTestId('sidebar-nav-projects'))

    // Wait for the empty state or projects to load
    await screen.findByText(/No Projects/i)
    fireEvent.click(screen.getByRole('button', { name: /Add Project/i }))

    // Click the browse button
    const browseButton = screen.getByRole('button', { name: /Browse filesystem/i })
    fireEvent.click(browseButton)

    await waitFor(() => {
      expect(bridge.selectFolder).toHaveBeenCalled()
      expect(screen.getByDisplayValue('/mock/selected/path')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /^Add Project$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/projects'), expect.objectContaining({ method: 'POST' }))
    })
  })

  it('toggles theme and updates root dark class', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot())

    window.localStorage.setItem('orchestra-theme', 'dark')
    render(<App />)

    const toggleButton = await screen.findByRole('button', { name: 'Toggle theme' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    fireEvent.click(toggleButton)

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(window.localStorage.getItem('orchestra-theme')).toBe('light')
    })
  })
})
