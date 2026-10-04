import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BridgeProfilesPayload, SnapshotPayload } from '@core/api/types'

vi.mock('@features/terminal/TerminalView', () => ({
  TerminalView: () => <div data-testid="terminal-view-mock" />,
}))

import App from './App'
import { resetAppStore, useAppStore } from '@core/store'

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
  type BridgeProfile = BridgeProfilesPayload['profiles'][number]

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
    saveBackendProfile: vi.fn(async (payload: { name: string; baseUrl: string; apiToken: string; makeActive?: boolean }) => {
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
      const nextProfiles = state.profilesPayload.profiles.filter((entry: BridgeProfile) => entry.id === profileId)
      const nextActiveProfile = nextProfiles[0]
      if (nextActiveProfile) {
        state.activeConfig = { baseUrl: nextActiveProfile.baseUrl, apiToken: nextActiveProfile.apiToken }
      }
      return state.activeConfig
    }),
    deleteBackendProfile: vi.fn(async (profileId: string) => {
      const nextProfiles = state.profilesPayload.profiles.filter((entry: BridgeProfile) => entry.id !== profileId)
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
    }),
    selectFolder: vi.fn(async () => '/mock/selected/path'),
    selectFile: vi.fn(async () => '/mock/selected/file.md'),
    openExternal: vi.fn(async () => {}),
    openPath: vi.fn(async () => {}),
    getScaleFactor: vi.fn(() => 1),
    fs: {
      readDir: vi.fn(async () => []),
      readFile: vi.fn(async () => ({ content: '', isBinary: false })),
      writeFile: vi.fn(async () => {}),
      stat: vi.fn(async () => ({ isDirectory: false, size: 0, mtime: 0 })),
      deletePath: vi.fn(async () => {}),
      gitStatus: vi.fn(async () => ({})),
      search: vi.fn(async () => []),
    },
  }

  window.orchestraDesktop = bridge
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
  listeners: Record<string, Array<(event: MessageEvent | Event) => void>> = {}

  constructor(public url: string) {
    eventSourceConstructCount++
    eventSourceInstances.push(this)
  }

  addEventListener = vi.fn((type: string, listener: (event: MessageEvent | Event) => void) => {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(listener)
  })

  removeEventListener = vi.fn((type: string, listener: (event: MessageEvent | Event) => void) => {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter(l => l !== listener)
    }
  })

  close = vi.fn(() => {
    this.closed = true
  })

  emit(type: string, data?: unknown) {
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

  emitMessage(data: unknown) {
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
  'RUN_EVENT',
  'RUN_STARTED',
  'RUN_FAILED',
  'RUN_CONTINUES',
  'RUN_SUCCEEDED',
  'RETRY_SCHEDULED',
  'HOOK_STARTED',
  'HOOK_COMPLETED',
  'HOOK_FAILED',
]

function setupFetch(snapshotPayload: SnapshotPayload, options?: { onFetch?: (url: string, init?: RequestInit) => Response | null }) {
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
    codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
    rate_limits: null,
  }
}

describe('App smoke render', () => {
  beforeEach(() => {
    useAppStore.setState({ activeSection: 'ISSUES' })
    eventSourceInstances = []
    eventSourceConstructCount = 0
    vi.stubGlobal('EventSource', MockEventSource)
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    Element.prototype.scrollIntoView = vi.fn()
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
    resetAppStore()
    vi.unstubAllGlobals()
  })

  it('renders task board on launch', async () => {
    setupDesktopBridge()
    setupFetch(defaultSnapshot(1))

    render(<App />)

    fireEvent.click(await screen.findByTestId('sidebar-nav-ISSUES'))

    await waitFor(() => {
      expect(screen.getAllByText(/Tasks/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/To Do/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/In Progress/i).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Done/i).length).toBeGreaterThan(0)
    })
  })

  describe('task management', () => {
    it('creates a task', async () => {
      setupDesktopBridge()
      const projects = [
        { id: 'proj-1', name: 'My Project', root_path: '/tmp/proj', remote_url: '' },
      ]
      const issues: Array<Record<string, unknown>> = []
      const fetchMockRef = setupFetch(defaultSnapshot(), {
        onFetch: (url, init) => {
          if (url.includes('/api/v1/projects')) {
            return new Response(JSON.stringify(projects), { status: 200 })
          }
          if (url.includes('/api/v1/issues') && init?.method === 'POST') {
            const body = JSON.parse(init?.body as string)
            const created = {
              id: 'issue-new',
              issue_identifier: 'OPS-99',
              identifier: 'OPS-99',
              title: body.title,
              description: body.description ?? '',
              state: body.state ?? 'Todo',
              assignee_id: body.assignee_id ?? '',
              priority: 2,
              project_id: body.project_id ?? '',
            }
            issues.push(created)
            return new Response(JSON.stringify(created), { status: 201 })
          }
          if (url.includes('/api/v1/issues?') || (url.includes('/api/v1/issues') && (!init || init.method === 'GET'))) {
            return new Response(JSON.stringify({ issues }), { status: 200 })
          }
          return null
        },
      })

      render(<App />)

      fireEvent.click(await screen.findByTestId('sidebar-nav-ISSUES'))

      await waitFor(() => {
        expect(screen.getAllByText(/To Do/i).length).toBeGreaterThan(0)
      })

      // Open command palette and create task
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

      await waitFor(() => {
        expect(screen.getByText(/Create New Task/i)).toBeTruthy()
      })

      fireEvent.click(screen.getByText(/Create New Task/i))

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/What needs to be done/i)).toBeTruthy()
      })

      fireEvent.change(screen.getByPlaceholderText(/What needs to be done/i), {
        target: { value: 'Build the feature' },
      })

      // Fill in description (required)
      fireEvent.change(screen.getByPlaceholderText(/Describe the task for the agent/i), {
        target: { value: 'Implement the new feature end to end' },
      })

      // Agent auto-selected from availableAgents, project auto-selected since only one exists
      const submitButton = screen.getAllByRole('button').find(
        (btn) => btn.textContent === 'Create task' && (btn as HTMLButtonElement).type === 'submit',
      )
      expect(submitButton).toBeTruthy()
      fireEvent.click(submitButton!)

      await waitFor(() => {
        expect(fetchMockRef.mock.calls.some(
          (call) => String(call[0]).includes('/api/v1/issues') && call[1]?.method === 'POST',
        )).toBe(true)
      })
    })

    it('deletes a task', async () => {
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

      fireEvent.click(await screen.findByTestId('sidebar-nav-ISSUES'))

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

    it('shows error on failed task deletion', async () => {
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

      fireEvent.click(await screen.findByTestId('sidebar-nav-ISSUES'))
      fireEvent.click(await screen.findByRole('button', { name: 'Delete task OPS-1' }))

      const dialog = await screen.findByRole('dialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeTruthy()
        expect(screen.getByText(/delete issue failed/i)).toBeTruthy()
      })
    })

    it('opens issue inspector', async () => {
      setupDesktopBridge()
      const issues = [
        {
          id: 'issue-inspect',
          issue_identifier: 'OPS-42',
          identifier: 'OPS-42',
          title: 'Inspect this task',
          description: 'Details here',
          state: 'Todo',
          assignee_id: 'agent-codex',
          priority: 2,
          project_id: '',
        },
      ]
      setupFetch(defaultSnapshot(), {
        onFetch: (url) => {
          if (url.includes('/api/v1/issues/OPS-42/history')) {
            return new Response(JSON.stringify({ history: [] }), { status: 200 })
          }
          if (url.includes('/api/v1/issues/OPS-42')) {
            return new Response(JSON.stringify(issues[0]), { status: 200 })
          }
          if (url.includes('/api/v1/issues')) {
            return new Response(JSON.stringify({ issues }), { status: 200 })
          }
          return null
        },
      })

      render(<App />)

      fireEvent.click(await screen.findByTestId('sidebar-nav-ISSUES'))

      await waitFor(() => {
        expect(screen.getByText('Inspect this task')).toBeTruthy()
      })

      // Click the task card to open inspector
      fireEvent.click(screen.getByText('Inspect this task'))

      // Should open the issue inspection dialog
      await waitFor(() => {
        expect(screen.getByText(/Issue Inspector/i)).toBeTruthy()
        expect(screen.getByText('OPS-42')).toBeTruthy()
      })
    })

    it('changes task state', async () => {
      setupDesktopBridge()
      const issues = [
        {
          id: 'issue-state',
          issue_identifier: 'OPS-60',
          identifier: 'OPS-60',
          title: 'State change task',
          description: '',
          state: 'Review',
          assignee_id: 'agent-codex',
          priority: 1,
          project_id: 'proj-1',
        },
      ]
      const fetchMock = setupFetch(defaultSnapshot(), {
        onFetch: (url, init) => {
          if (url.includes('/api/v1/issues/OPS-60/history')) {
            return new Response(JSON.stringify({ history: [] }), { status: 200 })
          }
          if (url.includes('/api/v1/issues/OPS-60') && init?.method === 'PATCH') {
            return new Response(JSON.stringify({ ...issues[0], state: 'Done' }), { status: 200 })
          }
          if (url.includes('/api/v1/issues/OPS-60')) {
            return new Response(JSON.stringify(issues[0]), { status: 200 })
          }
          if (url.includes('/api/v1/issues')) {
            return new Response(JSON.stringify({ issues }), { status: 200 })
          }
          return null
        },
      })

      render(<App />)

      fireEvent.click(await screen.findByTestId('sidebar-nav-ISSUES'))

      await waitFor(() => {
        expect(screen.getByText('State change task')).toBeTruthy()
      })

      fireEvent.click(screen.getByText('State change task'))

      await waitFor(() => {
        expect(screen.getByText(/Issue Inspector/i)).toBeTruthy()
      })

      // The issue is in Review state — close the task from the review actions
      const dialog = screen.getByRole('dialog')
      const closeBtn = within(dialog).getByRole('button', { name: /close/i })
      fireEvent.click(closeBtn)

      await waitFor(() => {
        expect(fetchMock.mock.calls.some(
          (call) => String(call[0]).includes('/api/v1/issues/OPS-60') && call[1]?.method === 'PATCH',
        )).toBe(true)
      })
    })

    it('requires project for task creation', async () => {
      setupDesktopBridge()
      setupFetch(defaultSnapshot(), {
        onFetch: (url) => {
          if (url.includes('/api/v1/projects')) {
            return new Response(JSON.stringify([]), { status: 200 })
          }
          return null
        },
      })

      render(<App />)

      fireEvent.click(await screen.findByTestId('sidebar-nav-ISSUES'))

      await waitFor(() => {
        expect(screen.getAllByText(/To Do/i).length).toBeGreaterThan(0)
      })

      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

      await waitFor(() => {
        expect(screen.getByText(/Create New Task/i)).toBeTruthy()
      })
      fireEvent.click(screen.getByText(/Create New Task/i))

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/What needs to be done/i)).toBeTruthy()
      })

      fireEvent.change(screen.getByPlaceholderText(/What needs to be done/i), {
        target: { value: 'Some task' },
      })

      // Create button should be disabled: no project selected
      const submitButton = screen.getAllByRole('button').find(
        (btn) => btn.textContent === 'Create task' && (btn as HTMLButtonElement).type === 'submit',
      )
      expect(submitButton).toBeTruthy()
      expect((submitButton as HTMLButtonElement).disabled).toBe(true)
    })

    it('opens issue inspector with detail tabs', async () => {
      setupDesktopBridge()
      const issues = [
        {
          id: 'issue-hist',
          issue_identifier: 'OPS-50',
          identifier: 'OPS-50',
          title: 'History task',
          description: '',
          state: 'In Progress',
          assignee_id: 'agent-codex',
          priority: 1,
          project_id: '',
        },
      ]
      setupFetch(defaultSnapshot(), {
        onFetch: (url) => {
          if (url.includes('/api/v1/issues/OPS-50/history')) {
            return new Response(JSON.stringify({ history: [] }), { status: 200 })
          }
          if (url.includes('/api/v1/issues/OPS-50')) {
            return new Response(JSON.stringify(issues[0]), { status: 200 })
          }
          if (url.includes('/api/v1/issues')) {
            return new Response(JSON.stringify({ issues }), { status: 200 })
          }
          return null
        },
      })

      render(<App />)

      fireEvent.click(await screen.findByTestId('sidebar-nav-ISSUES'))

      await waitFor(() => {
        expect(screen.getByText('History task')).toBeTruthy()
      })

      fireEvent.click(screen.getByText('History task'))

      await waitFor(() => {
        expect(screen.getByText(/Issue Inspector/i)).toBeTruthy()
      })

      // Verify the detail tabs are present (Details, Plan, Session, Changes)
      await waitFor(() => {
        expect(screen.getByText('Details')).toBeTruthy()
        expect(screen.getByText('Session')).toBeTruthy()
        expect(screen.getByText('Changes')).toBeTruthy()
      })
    })
  })

  describe('project management', () => {
    it('adds a project', async () => {
      const bridge = setupDesktopBridge()
      setupFetch(defaultSnapshot())

      render(<App />)

      fireEvent.click(await screen.findByTestId('sidebar-nav-PROJECTS'))

      // Wait for the empty state or projects to load
      await screen.findAllByText(/No projects yet/i)
      fireEvent.click(screen.getByRole('button', { name: /New Project/i }))

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

    it('opens project detail', async () => {
      setupDesktopBridge()
      const projects = [
        { id: 'proj-1', name: 'Alpha Project', root_path: '/home/user/alpha', remote_url: 'https://github.com/test/alpha' },
      ]
      setupFetch(defaultSnapshot(), {
        onFetch: (url) => {
          if (url.includes('/api/v1/projects/proj-1/stats')) {
            return new Response(JSON.stringify({ total_sessions: 5, total_input: 1000, total_output: 2000 }), { status: 200 })
          }
          if (url.includes('/api/v1/projects')) {
            return new Response(JSON.stringify(projects), { status: 200 })
          }
          return null
        },
      })

      render(<App />)

      fireEvent.click(await screen.findByTestId('sidebar-nav-PROJECTS'))

      await waitFor(() => {
        expect(screen.getAllByText('Alpha Project').length).toBeGreaterThan(0)
      })

      fireEvent.click(screen.getByRole('button', { name: 'Alpha Project' }))

      await waitFor(() => {
        expect(screen.getAllByText('Alpha Project').length).toBeGreaterThan(0)
        expect(screen.getAllByText(/\/home\/user\/alpha/).length).toBeGreaterThan(0)
      })
    })

    it('deletes a project', async () => {
      setupDesktopBridge()
      const projects = [
        { id: 'proj-del', name: 'Doomed Project', root_path: '/tmp/doomed', remote_url: '' },
      ]
      const fetchMockRef = setupFetch(defaultSnapshot(), {
        onFetch: (url, init) => {
          if (url.includes('/api/v1/projects/proj-del/stats')) {
            return new Response(JSON.stringify({ total_sessions: 0, total_input: 0, total_output: 0 }), { status: 200 })
          }
          if (url.includes('/api/v1/projects/proj-del') && init?.method === 'DELETE') {
            projects.splice(0, projects.length)
            return new Response(null, { status: 204 })
          }
          if (url.includes('/api/v1/projects')) {
            return new Response(JSON.stringify(projects), { status: 200 })
          }
          return null
        },
      })

      render(<App />)

      fireEvent.click(await screen.findByTestId('sidebar-nav-PROJECTS'))

      await waitFor(() => {
        expect(screen.getAllByText('Doomed Project').length).toBeGreaterThan(0)
      })

      // The ProjectGrid card has a delete button that calls setProjectToDelete
      fireEvent.click(screen.getByRole('button', { name: 'Doomed Project' }))
      const trashButton = await screen.findByRole('button', { name: 'Remove project' })
      expect(trashButton).toBeTruthy()
      fireEvent.click(trashButton)

      // ProjectGrid delete confirmation dialog
      const dialog = await screen.findByRole('dialog')
      fireEvent.click(within(dialog).getByRole('button', { name: /^Remove$/i }))

      await waitFor(() => {
        expect(fetchMockRef.mock.calls.some(
          (call) => String(call[0]).includes('/api/v1/projects/proj-del') && call[1]?.method === 'DELETE',
        )).toBe(true)
      })
    })

    it('warns on missing project path', async () => {
      setupDesktopBridge()
      const projects = [
        { id: 'proj-missing', name: 'Ghost Project', root_path: '/nonexistent/path', remote_url: '', path_exists: false },
      ]
      setupFetch(defaultSnapshot(), {
        onFetch: (url) => {
          if (url.includes('/api/v1/projects/proj-missing/stats')) {
            return new Response(JSON.stringify({ total_sessions: 0, total_input: 0, total_output: 0 }), { status: 200 })
          }
          if (url.includes('/api/v1/projects')) {
            return new Response(JSON.stringify(projects), { status: 200 })
          }
          return null
        },
      })

      render(<App />)

      fireEvent.click(await screen.findByTestId('sidebar-nav-PROJECTS'))

      await waitFor(() => {
        expect(screen.getAllByText('Ghost Project').length).toBeGreaterThan(0)
      })

      fireEvent.click(screen.getByRole('button', { name: 'Ghost Project' }))

      await waitFor(() => {
        expect(screen.getByText(/Path not found/i)).toBeTruthy()
        expect(screen.getAllByText(/\/nonexistent\/path/).length).toBeGreaterThan(0)
      })
    })
  })

  describe('settings', () => {
    it('saves backend config from settings form', async () => {
      const user = userEvent.setup()
      const bridge = setupDesktopBridge()
      setupFetch(defaultSnapshot())

      render(<App />)

      fireEvent.click(screen.getByTestId('sidebar-nav-SETTINGS'))

      // Wait for form to be ready
      await screen.findByText(/Connection Profiles/i)

      const urlInput = screen.getByPlaceholderText('http://127.0.0.1:4010')
      await user.clear(urlInput)
      await user.type(urlInput, 'http://127.0.0.1:9999')

      const saveButton = await screen.findByRole('button', { name: 'Save Backend Config' })
      await user.click(saveButton)

      await waitFor(() => {
        expect(bridge.setBackendConfig).toHaveBeenCalledWith(
          expect.objectContaining({ baseUrl: 'http://127.0.0.1:9999' }),
        )
      })
    })

    it('shows backend config validation error for invalid URL', async () => {
      const user = userEvent.setup()
      setupDesktopBridge()
      setupFetch(defaultSnapshot())

      render(<App />)

      fireEvent.click(screen.getByTestId('sidebar-nav-SETTINGS'))
      await screen.findByText(/Connection Profiles/i)

      const urlInput = screen.getByPlaceholderText('http://127.0.0.1:4010')
      await user.clear(urlInput)
      await user.type(urlInput, 'not-a-url')
      await user.click(screen.getByRole('button', { name: 'Save Backend Config' }))

      await waitFor(() => {
        expect(screen.getByText(/must be a valid absolute URL/i)).toBeTruthy()
      })
    })

    it('creates backend profile from settings', async () => {
      const bridge = setupDesktopBridge()
      setupFetch(defaultSnapshot())

      render(<App />)

      fireEvent.click(screen.getByTestId('sidebar-nav-SETTINGS'))

      await screen.findByText(/Connection Profiles/i)

      fireEvent.change(screen.getByPlaceholderText(/Production, Staging, Local/i), { target: { value: 'staging' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))

      await waitFor(() => {
        expect(bridge.saveBackendProfile).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'staging', makeActive: true }),
        )
      })
    })

    it('switches backend profile', async () => {
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

      fireEvent.click(await screen.findByTestId('sidebar-nav-SETTINGS'))

      // Trigger dropdown
      const activeProfileLabel = await screen.findByText('Active Profile')
      const dropdownTrigger = within(activeProfileLabel.parentElement as HTMLElement).getAllByRole('button')[0]
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

    it('reconnects SSE on profile switch', async () => {
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

      fireEvent.click(screen.getByTestId('sidebar-nav-SETTINGS'))

      const activeProfileLabel = await screen.findByText('Active Profile')
      const dropdownTrigger = within(activeProfileLabel.parentElement as HTMLElement).getAllByRole('button')[0]
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

      fireEvent.click(screen.getByTestId('sidebar-nav-SETTINGS'))

      await screen.findByText(/Connection Profiles/i)

      // switch profile first
      const activeProfileLabel = await screen.findByText('Active Profile')
      const dropdownTrigger = within(activeProfileLabel.parentElement as HTMLElement).getAllByRole('button')[0]
      fireEvent.click(dropdownTrigger)

      await waitFor(async () => {
        const options = screen.getAllByText('Staging')
        fireEvent.click(options[options.length - 1])
      })

      await waitFor(() => {
        expect(bridge.setActiveBackendProfile).toHaveBeenCalledWith('staging')
      })

      // Mock window.confirm to return true so the delete proceeds
      vi.spyOn(window, 'confirm').mockReturnValue(true)

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(bridge.deleteBackendProfile).toHaveBeenCalledWith('staging')
      })
    })

    it('disables profile delete when only one profile exists', async () => {
      setupDesktopBridge()
      setupFetch(defaultSnapshot())

      render(<App />)

      fireEvent.click(screen.getByTestId('sidebar-nav-SETTINGS'))

      await screen.findByText(/Connection Profiles/i)

      const deleteButton = screen.getByRole('button', { name: 'Delete' })
      expect((deleteButton as HTMLButtonElement).disabled).toBe(true)
    })

    it.skip('runs workspace migration', async () => { // migration UI removed from SettingsCard
      setupDesktopBridge()
      setupFetch(defaultSnapshot(), {
        onFetch: (url, _init) => {
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

      fireEvent.click(screen.getByTestId('sidebar-nav-SETTINGS'))
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

    it.skip('shows migration error', async () => { // migration UI removed from SettingsCard
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

      fireEvent.click(screen.getByTestId('sidebar-nav-SETTINGS'))
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

    it('triggers a refresh request when clicked', async () => {
      setupDesktopBridge()
      const fetchMock = setupFetch(defaultSnapshot())

      render(<App />)

      await screen.findByTestId('sidebar-nav-ISSUES')
      fireEvent.keyDown(document, { key: 'r', ctrlKey: true })

      await waitFor(() => {
        const calls = fetchMock.mock.calls.map(c => String(c[0]))
        expect(calls.some(u => u.includes('/api/v1/refresh'))).toBe(true)
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

      await screen.findByTestId('sidebar-nav-ISSUES')
      fireEvent.keyDown(document, { key: 'r', ctrlKey: true })

      await waitFor(() => {
        expect(screen.getByText(/refresh failed/i)).toBeTruthy()
      }, { timeout: 3000 })
    })

    it('passes token to SSE', async () => {
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
        expect(eventSourceConstructCount).toBeGreaterThan(0)
      })

      const instance = eventSourceInstances[eventSourceInstances.length - 1]
      expect(instance.url).toContain('token=smoke-token')
    })
  })

  describe('navigation', () => {
    it('sidebar navigation', async () => {
      setupDesktopBridge()
      setupFetch(defaultSnapshot())

      render(<App />)

      // Tasks is the initial view
      await waitFor(() => {
        expect(screen.getAllByText(/Tasks/i).length).toBeGreaterThan(0)
      })

      const sections = [
        { testId: 'sidebar-nav-PROJECTS', label: /Projects/i },
        { testId: 'sidebar-nav-SETTINGS', label: /Settings/i },
      ]

      for (const section of sections) {
        fireEvent.click(screen.getByTestId(section.testId))
        await waitFor(() => {
          // Drilldown replaces the primary navigation with its section header.
          expect(screen.getByRole('button', { name: section.label })).toBeTruthy()
        })
        fireEvent.click(screen.getByRole('button', { name: section.label }))
      }
    })

    it('arrow key navigation in sidebar', async () => {
      setupDesktopBridge()
      setupFetch(defaultSnapshot())

      render(<App />)

      const issuesButton = await screen.findByTestId('sidebar-nav-ISSUES')

      fireEvent.keyDown(issuesButton, { key: 'ArrowDown' })

      await waitFor(() => {
        const nav = screen.getByRole('navigation', { name: 'Primary navigation' })
        const buttons = within(nav).getAllByTestId(/^sidebar-nav-/)
        expect(document.activeElement).toBe(buttons[buttons.indexOf(issuesButton) + 1])
      })
    })

    it('Home/End navigation in sidebar', async () => {
      setupDesktopBridge()
      setupFetch(defaultSnapshot())

      render(<App />)

      const dashboardButton = await screen.findByTestId('sidebar-nav-ISSUES')

      fireEvent.keyDown(dashboardButton, { key: 'End' })
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByTestId('sidebar-nav-SETTINGS'))
      })

      const lastButton = screen.getByTestId('sidebar-nav-SETTINGS')
      fireEvent.keyDown(lastButton, { key: 'Home' })
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByTestId('sidebar-nav-CONSOLE'))
      })
    })

    it('opens command palette', async () => {
      setupDesktopBridge()
      setupFetch(defaultSnapshot())

      render(<App />)

      await waitFor(() => {
        expect(screen.getAllByText(/Tasks/i).length).toBeGreaterThan(0)
      })

      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Type a command or search/i)).toBeTruthy()
        expect(screen.getByText(/Go to Tasks/i)).toBeTruthy()
        expect(screen.getByText(/Create New Task/i)).toBeTruthy()
      })
    })

    it('toggles theme', async () => {
      setupDesktopBridge()
      setupFetch(defaultSnapshot())

      window.localStorage.setItem('orchestra-theme', 'dark')
      render(<App />)

      await screen.findByTestId('sidebar-nav-ISSUES')
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
      const toggleButton = await screen.findByText('Toggle Theme')
      expect(document.documentElement.classList.contains('dark')).toBe(true)

      fireEvent.click(toggleButton)

      await waitFor(() => {
        expect(document.documentElement.classList.contains('dark')).toBe(false)
        expect(window.localStorage.getItem('orchestra-theme')).toBe('light')
      })
    })
  })
})
