import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { WorkspaceChat } from './WorkspaceChat'
import * as api from '@core/api/client'
import { fetchAgentCatalog } from '@core/api/agent-catalog'
import { resetAppStore, useAppStore } from '@core/store'

vi.mock('@core/api/client', () => ({
  fetchWorkspaceChatProviders: vi.fn(), listWorkspaceChatSessions: vi.fn(), fetchWorkspaceChatModels: vi.fn(),
  createWorkspaceChatSession: vi.fn(), fetchWorkspaceChat: vi.fn(), renameWorkspaceChatSession: vi.fn(),
  switchWorkspaceChatProvider: vi.fn(), sendWorkspaceChatMessage: vi.fn(), stopWorkspaceChatTurn: vi.fn(),
  replyWorkspaceChatRequest: vi.fn(), fetchUnifiedAgents: vi.fn(), fetchHarnessCapabilities: vi.fn(),
}))
vi.mock('@core/api/agent-catalog', () => ({ fetchAgentCatalog: vi.fn() }))

const MAESTRO = '__orchestrator__'
const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture-only' }
const base = { project_id: MAESTRO, provider: 'codex', conversation_mode: 'native_session', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const sessionA: api.WorkspaceChatSession = { ...base, id: 'chat-a', title: 'Counting', status: 'running' }
const sessionB: api.WorkspaceChatSession = { ...base, id: 'chat-b', title: 'Second thread', status: 'idle' }
const snapshots: Record<string, api.WorkspaceChatSnapshot> = {}

beforeEach(() => {
  resetAppStore()
  useAppStore.setState({ config })
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  sessionStorage.clear()
  localStorage.clear()
  vi.resetAllMocks()
  snapshots['chat-a'] = {
    session: sessionA,
    messages: [{ id: 'a1', session_id: 'chat-a', role: 'user', text: 'Count to forty', status: 'accepted', created_at: '2026-01-01T00:00:01Z' }],
    events: [{ sequence: 1, turn_id: 't1', item_id: 'i1', type: 'item/agentMessage/delta', delta: 'one two three', created_at: '2026-01-01T00:00:02Z' } as api.WorkspaceChatEvent],
    requests: [],
  }
  snapshots['chat-b'] = {
    session: sessionB,
    messages: [{ id: 'b1', session_id: 'chat-b', role: 'user', text: 'Earlier question in B', status: 'completed', created_at: '2026-01-01T00:00:01Z' }],
    events: [], requests: [],
  }
  vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [{ id: 'codex', label: 'Codex', enabled: true, provider_resume: false, conversation_mode: 'native_session' }] })
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [sessionA, sessionB] })
  vi.mocked(api.fetchWorkspaceChatModels).mockResolvedValue({ project_id: MAESTRO, provider: 'codex', observation: 'provider_catalog', models: [] })
  vi.mocked(api.fetchWorkspaceChat).mockImplementation(async (_config, _project, id) => structuredClone(snapshots[id]))
  vi.mocked(api.fetchUnifiedAgents).mockResolvedValue([])
  vi.mocked(api.fetchHarnessCapabilities).mockResolvedValue([])
  vi.mocked(fetchAgentCatalog).mockRejectedValue(new Error('no catalog'))
  vi.mocked(api.sendWorkspaceChatMessage).mockImplementation(async (_config, _project, id, messageId, text) => {
    const message: api.WorkspaceChatMessage = { id: `m-${messageId}`, session_id: id, role: 'user', text, status: 'accepted', client_message_id: messageId, created_at: '2026-01-01T00:00:05Z' }
    snapshots[id] = { ...snapshots[id], session: { ...snapshots[id].session, status: 'running' }, messages: [...snapshots[id].messages, message] }
    return { session: snapshots[id].session, message }
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// Mirrors MaestroConversations.open(): the sidebar list requests a conversation.
const pick = (sessionId: string) => act(() => {
  useAppStore.setState({ requestedWorkspaceConversation: { baseUrl: config.baseUrl, apiToken: config.apiToken, projectId: MAESTRO, sessionId, requestId: Date.now() + Math.random() } })
})

describe('WorkspaceChat concurrent conversations', () => {
  it('renders each conversation when switching away from and back to a running turn, and sends in another while one runs', async () => {
    render(<AppTooltipProvider><WorkspaceChat config={config} projectId={MAESTRO} projectName="Maestro" /></AppTooltipProvider>)
    await waitFor(() => expect(api.listWorkspaceChatSessions).toHaveBeenCalled())
    pick('chat-a')
    await screen.findByRole('button', { name: 'Rename conversation: Counting' })
    expect(await screen.findByText('one two three')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: /turn in progress/ })).toBeInTheDocument()

    pick('chat-b')
    await screen.findByRole('button', { name: 'Rename conversation: Second thread' })
    expect(await screen.findByText('Earlier question in B')).toBeInTheDocument()
    expect(screen.queryByText('one two three')).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: /turn in progress/ })).not.toBeInTheDocument()
    const composer = screen.getByRole('textbox', { name: 'Message agent' })
    expect(composer).not.toBeDisabled()

    // A keeps running in the background while B gets a new turn.
    snapshots['chat-a'] = { ...snapshots['chat-a'], events: [...snapshots['chat-a'].events!, { sequence: 2, turn_id: 't1', item_id: 'i1', type: 'item/agentMessage/delta', delta: ' four five', created_at: '2026-01-01T00:00:03Z' } as api.WorkspaceChatEvent] }
    fireEvent.change(composer, { target: { value: 'Short question' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalledWith(config, MAESTRO, 'chat-b', expect.any(String), 'Short question'))
    expect(await screen.findByText('Short question')).toBeInTheDocument()
    await screen.findByRole('status', { name: /turn in progress/ })

    pick('chat-a')
    await screen.findByRole('button', { name: 'Rename conversation: Counting' })
    expect(await screen.findByText('one two three four five')).toBeInTheDocument()
    expect(screen.queryByText('Short question')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: /turn in progress/ })).toBeInTheDocument()

    pick('chat-b')
    await screen.findByRole('button', { name: 'Rename conversation: Second thread' })
    expect(await screen.findByText('Short question')).toBeInTheDocument()
    expect(screen.queryByText(/one two three/)).not.toBeInTheDocument()
  })

  it('shows a live working indicator with elapsed time and the latest activity, including before any event', async () => {
    const recent = new Date(Date.now() - 12_000).toISOString()
    snapshots['chat-a'] = { ...snapshots['chat-a'], messages: [{ ...snapshots['chat-a'].messages[0], created_at: recent }], events: [] }
    render(<AppTooltipProvider><WorkspaceChat config={config} projectId={MAESTRO} projectName="Maestro" /></AppTooltipProvider>)
    await waitFor(() => expect(api.listWorkspaceChatSessions).toHaveBeenCalled())
    pick('chat-a')
    const status = await screen.findByRole('status', { name: /turn in progress/ })
    expect(status).toHaveAttribute('data-activity', 'Thinking…')
    expect(status).toHaveTextContent(/Thinking….*1[2-4]s/)
    snapshots['chat-a'] = { ...snapshots['chat-a'], events: [{ sequence: 1, turn_id: 't1', item_id: 'c1', type: 'item/started', payload: { item: { type: 'commandExecution', command: 'npm test' } }, created_at: new Date().toISOString() } as api.WorkspaceChatEvent] }
    pick('chat-b')
    await screen.findByRole('button', { name: 'Rename conversation: Second thread' })
    expect(screen.queryByRole('status', { name: /turn in progress/ })).not.toBeInTheDocument()
    pick('chat-a')
    await waitFor(() => expect(screen.getByRole('status', { name: /turn in progress/ })).toHaveAttribute('data-activity', 'Running command…'))
    expect(screen.getByRole('status', { name: /turn in progress/ })).toHaveTextContent(/Running command…/)
  })

  it('does not stay locked when the chat is hidden and shown while a send is in flight', async () => {
    snapshots['chat-a'] = { ...snapshots['chat-a'], session: { ...sessionA, status: 'idle' }, events: [] }
    let release: () => void = () => {}
    const original = vi.mocked(api.sendWorkspaceChatMessage).getMockImplementation()!
    vi.mocked(api.sendWorkspaceChatMessage).mockImplementationOnce((...args) => new Promise(resolve => { release = () => resolve(original(...args)) }))
    const view = (active: boolean) => <AppTooltipProvider><WorkspaceChat config={config} projectId={MAESTRO} projectName="Maestro" active={active} /></AppTooltipProvider>
    const { rerender } = render(view(true))
    await waitFor(() => expect(api.listWorkspaceChatSessions).toHaveBeenCalled())
    pick('chat-a')
    await screen.findByRole('button', { name: 'Rename conversation: Counting' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message agent' }), { target: { value: 'Count to forty' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalled())
    // Leaving the section and coming back re-runs the catalog load mid-send.
    rerender(view(false))
    rerender(view(true))
    await act(async () => { release() })
    await screen.findByRole('status', { name: /turn in progress/ })
    pick('chat-b')
    await screen.findByRole('button', { name: 'Rename conversation: Second thread' })
    expect(await screen.findByText('Earlier question in B')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message agent' })).not.toBeDisabled()
  })
})
