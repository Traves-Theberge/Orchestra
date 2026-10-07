import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { type ReactElement } from 'react'
import { act, cleanup, fireEvent, render as renderBase, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceChat } from './WorkspaceChat'
import { webcrypto } from 'node:crypto'
import { chatDraftStorageKey } from './chat-draft-storage'
import * as api from '@core/api/client'
import { resetAppStore, useAppStore } from '@core/store'

vi.mock('@core/api/client', () => ({
  fetchWorkspaceChatProviders: vi.fn(), listWorkspaceChatSessions: vi.fn(),
  fetchWorkspaceChatModels: vi.fn(),
  createWorkspaceChatSession: vi.fn(), fetchWorkspaceChat: vi.fn(),
  renameWorkspaceChatSession: vi.fn(),
  switchWorkspaceChatProvider: vi.fn(),
  sendWorkspaceChatMessage: vi.fn(), stopWorkspaceChatTurn: vi.fn(),
  replyWorkspaceChatRequest: vi.fn(),
}))
const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture-only' }
const session: api.WorkspaceChatSession = {
  id: 'chat-a', project_id: 'project-a', provider: 'codex', title: 'Review changes',
  status: 'idle', conversation_mode: 'transcript_replay', created_at: '', updated_at: '',
}
const message: api.WorkspaceChatMessage = {
  id: 'message-a', session_id: 'chat-a', role: 'user', text: 'Inspect this project',
  status: 'accepted', created_at: '',
}
beforeEach(() => {
  resetAppStore()
  useAppStore.setState({ config, projects: [{ id: 'project-a', name: 'Alpha', root_path: '/repo', remote_url: '' }] })
  vi.stubGlobal('crypto', webcrypto)
  sessionStorage.clear()
  vi.resetAllMocks()
  vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [
    { id: 'codex', label: 'Codex', enabled: true, provider_resume: false, conversation_mode: 'transcript_replay' },
  ] })
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session] })
  vi.mocked(api.fetchWorkspaceChatModels).mockResolvedValue({ project_id: 'project-a', provider: 'codex', observation: 'provider_catalog', models: [] })
  vi.mocked(api.createWorkspaceChatSession).mockResolvedValue(session)
  vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [] })
  vi.mocked(api.sendWorkspaceChatMessage).mockResolvedValue({ session: { ...session, status: 'running' }, message })
})
afterEach(() => { cleanup(); vi.useRealTimers() })
const open = (overrides: Partial<React.ComponentProps<typeof WorkspaceChat>> = {}) => render(<WorkspaceChat config={config} projectId="project-a" projectName="Alpha" {...overrides} />)
async function selectConversation(title = 'Review changes', id?: string) {
  let targetId = id
  if (!targetId) {
    if (title === 'Other conversation') targetId = 'chat-b'
    else if (title === 'Old Gemini chat') targetId = 'legacy-gemini'
    else targetId = session.id
  }
  act(() => useAppStore.getState().requestWorkspaceConversation('project-a', targetId))
  await screen.findByRole('button', { name: `Rename conversation: ${title}` })
}

describe('WorkspaceChat', () => {
  it('offers Antigravity instead of Gemini for new workspace conversations', async () => {
    vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [
      { id: 'GEMINI', label: 'Gemini', enabled: true, provider_resume: false, conversation_mode: 'transcript_replay' },
      { id: 'ANTIGRAVITY', label: 'Antigravity', enabled: true, provider_resume: true, conversation_mode: 'native_session' },
    ] })
    open()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose harness and model' })).toHaveTextContent('Antigravity'))
    fireEvent.click(screen.getByRole('button', { name: 'Choose harness and model' }))
    expect(await screen.findByRole('button', { name: 'Use Antigravity' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use Gemini' })).not.toBeInTheDocument()
  })

  it('keeps historical Gemini conversation content readable and read-only', async () => {
    const legacySession: api.WorkspaceChatSession = { ...session, id: 'legacy-gemini', provider: 'gemini', title: 'Old Gemini chat' }
    vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [
      { id: 'antigravity', label: 'Antigravity', enabled: true, provider_resume: true, conversation_mode: 'native_session' },
      { id: 'gemini', label: 'Gemini', enabled: true, provider_resume: false, conversation_mode: 'transcript_replay' },
    ] })
    vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [legacySession] })
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: legacySession, messages: [{ ...message, id: 'legacy-message', session_id: legacySession.id, text: 'Historical Gemini message' }] })
    open()

    await selectConversation('Old Gemini chat', legacySession.id)
    expect(await screen.findByText('Historical Gemini message')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Gemini conversation history is preserved and read-only')
    expect(screen.getByRole('button', { name: 'Choose harness and model' })).toHaveTextContent('Gemini')
    expect(screen.getByRole('textbox', { name: 'Message agent' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Choose harness and model' }))
    expect(await screen.findByRole('button', { name: 'Use Antigravity' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use Gemini' })).not.toBeInTheDocument()
  })
  it('renames inline and reconciles a committed mutation with a lost response', async () => {
    open(); await selectConversation()
    vi.mocked(api.renameWorkspaceChatSession).mockRejectedValue(new Error('Response lost'))
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, title: 'Named conversation' }, messages: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Rename conversation: Review changes' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Conversation name' }), { target: { value: ' Named conversation ' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Conversation name' }), { key: 'Enter' })
    await screen.findByRole('button', { name: 'Rename conversation: Named conversation' })
    expect(api.renameWorkspaceChatSession).toHaveBeenCalledWith(config, 'project-a', 'chat-a', 'Named conversation', 'Review changes')
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })
  it('cancels a conversation title edit with Escape without issuing a mutation', async () => {
    open(); await selectConversation()
    fireEvent.click(screen.getByRole('button', { name: 'Rename conversation: Review changes' }))
    const input = screen.getByRole('textbox', { name: 'Conversation name' })
    fireEvent.change(input, { target: { value: 'Uncommitted title' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Rename conversation: Review changes' })).toBeVisible()
    expect(api.renameWorkspaceChatSession).not.toHaveBeenCalled()
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })

  it('keeps an editable new conversation name without creating or sending, then restores it', async () => {
    const rendered = open()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message agent' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Rename conversation: New conversation' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Conversation name' }), { target: { value: 'Future work' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Conversation name' }), { key: 'Enter' })
    await screen.findByRole('button', { name: 'Rename conversation: Future work' })
    expect(api.createWorkspaceChatSession).not.toHaveBeenCalled()
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
    rendered.unmount(); open()
    await screen.findByRole('button', { name: 'Rename conversation: Future work' })
    vi.mocked(api.createWorkspaceChatSession).mockImplementation(async (_config, _project, _provider, id) => ({ ...session, id: id!, title: 'Future work' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message agent' }), { target: { value: 'Start work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(api.createWorkspaceChatSession).toHaveBeenCalledWith(config, 'project-a', 'codex', expect.any(String), { title: 'Future work' }))
  })

  it('rejects a foreign rename recovery without replacing the current conversation', async () => {
    open(); await selectConversation()
    vi.mocked(api.renameWorkspaceChatSession).mockRejectedValue(new Error('Response lost'))
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, project_id: 'foreign', title: 'Foreign' }, messages: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Rename conversation: Review changes' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Conversation name' }), { target: { value: 'Attempt' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Conversation name' }), { key: 'Enter' })
    await screen.findByText(/belongs to another workspace/)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Conversation name' }), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Rename conversation: Review changes' })).toBeVisible()
    expect(screen.queryByText('Foreign')).not.toBeInTheDocument()
  })
  it('opens a sidebar-requested conversation without sending a message', async () => {
    useAppStore.setState({ config, projects: [{ id: 'project-a', name: 'Alpha', root_path: '/alpha', remote_url: '' }] })
    open()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename conversation: New conversation' })).not.toBeDisabled())
    act(() => useAppStore.getState().requestWorkspaceConversation('project-a', session.id))
    await screen.findByRole('button', { name: 'Rename conversation: Review changes' })
    expect(api.fetchWorkspaceChat).toHaveBeenCalledWith(config, 'project-a', session.id)
    expect(useAppStore.getState().requestedWorkspaceConversation).toBeNull()
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })
  it('does not consume a sidebar conversation request from a different backend', async () => {
    open()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename conversation: New conversation' })).not.toBeDisabled())
    act(() => useAppStore.setState({ requestedWorkspaceConversation: {
      baseUrl: 'http://other-backend:4014', apiToken: config.apiToken, projectId: 'project-a', sessionId: session.id, requestId: 1,
    } }))
    await act(async () => { await Promise.resolve() })
    expect(api.fetchWorkspaceChat).not.toHaveBeenCalled()
    expect(useAppStore.getState().requestedWorkspaceConversation?.requestId).toBe(1)
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })
  it('switches harness in place, keeping the conversation and draft', async () => {
    vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [
      { id: 'codex', label: 'Codex', enabled: true, provider_resume: false, conversation_mode: 'transcript_replay' },
      { id: '8GENT', label: '8gent', enabled: true, provider_resume: false, conversation_mode: 'transcript_replay' },
      { id: 'CLAUDE', label: 'Claude Code', enabled: false, reason: 'CLI is not configured', provider_resume: false, conversation_mode: 'transcript_replay' },
    ] })
    open()
    await selectConversation()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Carry this draft' } })
    fireEvent.click(screen.getByLabelText('Choose harness and model'))
    expect(screen.getByRole('button', { name: 'Use Claude Code' })).toBeDisabled()
    const switched = { ...session, provider: '8GENT' }
    vi.mocked(api.switchWorkspaceChatProvider).mockResolvedValue(switched)
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: switched, messages: [] })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use 8gent' })) })
    expect(api.switchWorkspaceChatProvider).toHaveBeenCalledWith(config, 'project-a', session.id, '8GENT', session.provider)
    await waitFor(() => expect(screen.getByLabelText('Choose harness and model')).toHaveTextContent('8gent'))
    expect(screen.getByLabelText('Message agent')).toHaveValue('Carry this draft')
    expect(api.createWorkspaceChatSession).not.toHaveBeenCalled()
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })
  it('observes late provider usage on the next bounded idle poll', async () => {
    const mounted = open()
    await selectConversation()
    vi.useFakeTimers()
    await act(async () => mounted.rerender(<WorkspaceChat config={config} projectId="project-a" projectName="Alpha" active={false} />))
    await act(async () => mounted.rerender(<WorkspaceChat config={config} projectId="project-a" projectName="Alpha" active />))
    const observed = vi.mocked(api.fetchWorkspaceChat).mock.calls.length
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [], events: [{
      sequence: 1, type: 'thread/tokenUsage/updated', created_at: '',
      payload: { tokenUsage: { total: { inputTokens: 17, outputTokens: 9, cachedInputTokens: 3, totalTokens: 26 } } },
    }] })
    await act(async () => { await vi.advanceTimersByTimeAsync(4999) })
    expect(api.fetchWorkspaceChat).toHaveBeenCalledTimes(observed)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(api.fetchWorkspaceChat).toHaveBeenCalledTimes(observed + 1)
    expect(screen.queryByText(/17 input.*9 output.*26 total tokens/)).not.toBeInTheDocument()
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })
  it('pauses inactive workspace reads and immediately resumes without losing its draft or snapshot', async () => {
    const mounted = open()
    await selectConversation()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Keep this workspace draft' } })
    vi.useFakeTimers()
    await act(async () => mounted.rerender(<WorkspaceChat config={config} projectId="project-a" projectName="Alpha" active={false} />))
    const detailCalls = vi.mocked(api.fetchWorkspaceChat).mock.calls.length
    const providerCalls = vi.mocked(api.fetchWorkspaceChatProviders).mock.calls.length
    const historyCalls = vi.mocked(api.listWorkspaceChatSessions).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(api.fetchWorkspaceChat).toHaveBeenCalledTimes(detailCalls)
    expect(api.fetchWorkspaceChatProviders).toHaveBeenCalledTimes(providerCalls)
    expect(api.listWorkspaceChatSessions).toHaveBeenCalledTimes(historyCalls)
    expect(screen.getByRole('button', { name: 'Rename conversation: Review changes' })).toBeInTheDocument()
    expect(screen.getByLabelText('Message agent')).toHaveValue('Keep this workspace draft')
    await act(async () => mounted.rerender(<WorkspaceChat config={config} projectId="project-a" projectName="Alpha" active />))
    expect(api.fetchWorkspaceChat).toHaveBeenCalledTimes(detailCalls + 1)
    expect(screen.getByLabelText('Message agent')).toHaveValue('Keep this workspace draft')
    expect(api.createWorkspaceChatSession).not.toHaveBeenCalled()
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })
  it('restores an unsent draft across renderer remount without persisting credentials', async () => {
    const mounted = open()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Unsent design notes' } })
    const key = await chatDraftStorageKey(config, 'project-a')
    await waitFor(() => expect(sessionStorage.getItem(key)).toContain('Unsent design notes'))
    mounted.unmount()
    open()
    await waitFor(() => expect(screen.getByLabelText('Message agent')).toHaveValue('Unsent design notes'))
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain(config.apiToken)
    expect(key).not.toContain(config.baseUrl)
    expect(api.createWorkspaceChatSession).not.toHaveBeenCalled()
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })
  it('isolates restored drafts across account, backend and project changes', async () => {
    const mounted = open()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Alpha draft' } })
    const key = await chatDraftStorageKey(config, 'project-a')
    await waitFor(() => expect(sessionStorage.getItem(key)).toContain('Alpha draft'))
    for (const [nextConfig, project] of [
      [{ ...config, apiToken: 'other-account' }, 'project-a'],
      [{ ...config, baseUrl: 'http://localhost:4999' }, 'project-a'],
      [config, 'project-b'],
    ] as const) {
      mounted.rerender(<WorkspaceChat config={nextConfig} projectId={project} projectName="Other" />)
      expect(screen.getByLabelText('Message agent')).toHaveValue('')
      fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Other draft' } })
      const otherKey = await chatDraftStorageKey(nextConfig, project)
      await waitFor(() => expect(sessionStorage.getItem(otherKey)).toContain('Other draft'))
      expect(otherKey).not.toBe(key)
    }
    mounted.rerender(<WorkspaceChat config={config} projectId="project-a" projectName="Alpha" />)
    await waitFor(() => expect(screen.getByLabelText('Message agent')).toHaveValue('Alpha draft'))
  })
  it('restores a lost creation as blocked and explicitly recovers the same identity without sending', async () => {
    let exists = false
    vi.mocked(api.createWorkspaceChatSession).mockImplementation(async (_config, _project, _provider, id) => {
      if (!exists) throw new Error('Response lost')
      return { ...session, id: id! }
    })
    vi.mocked(api.fetchWorkspaceChat).mockImplementation(async (_config, _project, id) => {
      if (!exists) throw new Error('Not found')
      return { session: { ...session, id }, messages: [] }
    })
    const mounted = open()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Persist first prompt' } })
    await waitFor(() => expect(screen.getByLabelText('Send message')).not.toBeDisabled())
    fireEvent.click(screen.getByLabelText('Send message'))
    await screen.findByRole('button', { name: 'Retry creating chat' })
    const id = vi.mocked(api.createWorkspaceChatSession).mock.calls[0][3]
    mounted.unmount()
    open()
    await screen.findByRole('button', { name: 'Retry creating chat' })
    expect(screen.getByLabelText('Message agent')).toHaveValue('Persist first prompt')
    expect(screen.getByLabelText('Send message')).toBeDisabled()
    expect(api.createWorkspaceChatSession).toHaveBeenCalledTimes(1)
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
    exists = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry creating chat' }))
    await screen.findByText('Conversation recovered. Your draft has not been sent; send it when ready.')
    expect(api.createWorkspaceChatSession).toHaveBeenNthCalledWith(2, config, 'project-a', 'codex', id)
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })
  it('restores a lost message receipt and reconciles acceptance through reads without resend', async () => {
    vi.mocked(api.sendWorkspaceChatMessage).mockRejectedValue(new Error('Response lost'))
    const mounted = open()
    await selectConversation()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Persist delivery identity' } })
    await waitFor(() => expect(screen.getByLabelText('Send message')).not.toBeDisabled())
    fireEvent.click(screen.getByLabelText('Send message'))
    await screen.findByRole('alert')
    const clientId = vi.mocked(api.sendWorkspaceChatMessage).mock.calls[0][3]
    mounted.unmount()
    open()
    await waitFor(() => expect(screen.getByLabelText('Message agent')).toHaveValue('Persist delivery identity'))
    expect(screen.getByLabelText('Send message')).toBeDisabled()
    expect(api.sendWorkspaceChatMessage).toHaveBeenCalledTimes(1)
    // A correction typed while reconciling must survive the accepted old receipt.
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'A later unsent correction' } })
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [{ ...message, client_message_id: clientId, text: 'Persist delivery identity' }] })
    act(() => { window.dispatchEvent(new CustomEvent('orchestra:harness-registration-changed')) })
    await waitFor(() => expect(screen.getByLabelText('Send message')).not.toBeDisabled())
    expect(screen.getByLabelText('Message agent')).toHaveValue('A later unsent correction')
    expect(api.sendWorkspaceChatMessage).toHaveBeenCalledTimes(1)
    expect(api.createWorkspaceChatSession).not.toHaveBeenCalled()
  })
  it('does not start an agent or create a session on mount', async () => {
    open()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename conversation: New conversation' })).not.toBeDisabled())
    expect(api.createWorkspaceChatSession).not.toHaveBeenCalled()
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Message agent')).not.toBeDisabled()
  })
  it('opens a draft without creating a session and creates only on first send', async () => {
    vi.mocked(api.createWorkspaceChatSession).mockImplementation(async (_config, _project, _provider, id) => ({ ...session, id: id! }))
    vi.mocked(api.fetchWorkspaceChat).mockImplementation(async (_config, _project, id) => ({ session: { ...session, id }, messages: [] }))
    vi.mocked(api.sendWorkspaceChatMessage).mockImplementation(async (_config, _project, id, clientId, text) => ({ session: { ...session, id, status: 'running' }, message: { ...message, session_id: id, client_message_id: clientId, text } }))
    open()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename conversation: New conversation' })).not.toBeDisabled())
    expect(api.createWorkspaceChatSession).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Start from this prompt' } })
    await waitFor(() => expect(screen.getByLabelText('Send message')).not.toBeDisabled())
    fireEvent.click(screen.getByLabelText('Send message'))
    await waitFor(() => expect(api.createWorkspaceChatSession).toHaveBeenCalledExactlyOnceWith(config, 'project-a', 'codex', expect.any(String)))
    const id = vi.mocked(api.createWorkspaceChatSession).mock.calls[0][3]
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalledExactlyOnceWith(config, 'project-a', id, expect.any(String), 'Start from this prompt'))
  })
  it('retains a failed send draft and never retries the mutation automatically', async () => {
    vi.mocked(api.sendWorkspaceChatMessage).mockRejectedValue(new Error('Connection lost'))
    open()
    await selectConversation()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Inspect this project' } })
    fireEvent.click(screen.getByLabelText('Send message'))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Message agent')).toHaveValue('Inspect this project')
    expect(api.sendWorkspaceChatMessage).toHaveBeenCalledTimes(1)
    expect(api.sendWorkspaceChatMessage).toHaveBeenCalledWith(config, 'project-a', 'chat-a', expect.any(String), 'Inspect this project')
    expect(screen.getByRole('alert')).toHaveTextContent('delivery may be uncertain')
  })
  it('fails closed when a session snapshot belongs to another project', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, project_id: 'project-b' }, messages: [] })
    open()
    act(() => useAppStore.getState().requestWorkspaceConversation('project-a', session.id))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Send message')).toBeDisabled()
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })
  it('keeps an unavailable native provider disabled with its reason', async () => {
    vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [
      { id: 'codex', label: 'Codex', enabled: false, reason: 'CLI not configured', provider_resume: false, conversation_mode: 'transcript_replay' },
    ] })
    open()
    await screen.findByText(/CLI not configured/)
    expect(screen.getByLabelText('Send message')).toBeDisabled()
    expect(api.createWorkspaceChatSession).not.toHaveBeenCalled()
  })
  it('stops only the current chat turn without invoking task reset', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [message] })
    vi.mocked(api.stopWorkspaceChatTurn).mockResolvedValue({ session: { ...session, status: 'stopping' } })
    open()
    await selectConversation()
    fireEvent.click(await screen.findByLabelText('Stop current turn'))
    await waitFor(() => expect(api.stopWorkspaceChatTurn).toHaveBeenCalledExactlyOnceWith(config, 'project-a', 'chat-a'))
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })
  it('rejects a stop response from a different workspace', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [] })
    vi.mocked(api.stopWorkspaceChatTurn).mockResolvedValue({ session: { ...session, project_id: 'project-b', status: 'stopping' } })
    open()
    await selectConversation()
    fireEvent.click(await screen.findByLabelText('Stop current turn'))
    expect(await screen.findByRole('alert')).toHaveTextContent('another workspace')
    expect(screen.queryByText('Stopping current turn…')).not.toBeInTheDocument()
  })
  it('preserves drafts separately when selecting another conversation', async () => {
    const second = { ...session, id: 'chat-b', title: 'Other conversation' }
    vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session, second] })
    vi.mocked(api.fetchWorkspaceChat).mockImplementation(async (_config, _project, id) => ({ session: id === 'chat-a' ? session : second, messages: [] }))
    open()
    await selectConversation()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Keep Alpha draft' } })
    await selectConversation('Other conversation')
    await waitFor(() => expect(screen.getByLabelText('Message agent')).not.toBeDisabled())
    expect(screen.getByLabelText('Message agent')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Keep other draft' } })
    await selectConversation()
    await waitFor(() => expect(screen.getByLabelText('Message agent')).not.toBeDisabled())
    expect(screen.getByLabelText('Message agent')).toHaveValue('Keep Alpha draft')
  })
  it('does not duplicate a pending send on repeated Enter', async () => {
    let resolveSend!: (value: { session: api.WorkspaceChatSession; message: api.WorkspaceChatMessage }) => void
    vi.mocked(api.sendWorkspaceChatMessage).mockImplementation(() => new Promise(resolve => { resolveSend = resolve }))
    open()
    await selectConversation()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Inspect this project' } })
    fireEvent.keyDown(screen.getByLabelText('Message agent'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('Message agent'), { key: 'Enter' })
    expect(api.sendWorkspaceChatMessage).toHaveBeenCalledTimes(1)
    resolveSend({ session, message })
    await waitFor(() => expect(screen.getByLabelText('Message agent')).toHaveValue(''))
  })
  it('renders streamed text, tool activity and plans without session metadata panels', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({
      session: { ...session, status: 'running', conversation_mode: 'native_session', provider_thread_id: 'provider-thread', requested_model: 'requested-model', effective_model: 'observed-model', approval_policy: 'on-request', sandbox_mode: 'workspace-write' },
      messages: [], events: [
        { sequence: 1, type: 'item/agentMessage/delta', turn_id: 'turn-1', item_id: 'answer', delta: 'Hello ', created_at: '' },
        { sequence: 2, type: 'item/agentMessage/delta', turn_id: 'turn-1', item_id: 'answer', delta: 'world', created_at: '' },
        { sequence: 3, type: 'item/started', turn_id: 'turn-1', item_id: 'tool', payload: { item: { id: 'tool', type: 'commandExecution', command: 'git status' } }, created_at: '' },
        { sequence: 4, type: 'turn/plan/updated', turn_id: 'turn-1', payload: { plan: [{ step: 'Inspect', status: 'inProgress' }] }, created_at: '' },
        { sequence: 5, type: 'thread/tokenUsage/updated', payload: { tokenUsage: { total: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 40, totalTokens: 120 } } }, created_at: '' },
        { sequence: 6, type: 'orchestra/tool/started', turn_id: 'turn-1', item_id: 'control', payload: { tool: 'orchestra_control', arguments: { operation: 'create' } }, created_at: '' },
        { sequence: 7, type: 'orchestra/tool/completed', turn_id: 'turn-1', item_id: 'control', payload: { success: true, data: { task_id: 'durable-task-id' } }, created_at: '' },
      ], cursor: 5,
    })
    open()
    await selectConversation()
    expect(await screen.findByText('Hello world')).toBeInTheDocument()
    expect(screen.queryByText(/Provider thread: provider-thread/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Session details/)).not.toBeInTheDocument()
    expect(screen.getByText('git status')).toBeInTheDocument()
    expect(screen.getByText('Orchestra control')).toBeInTheDocument()
    expect(screen.getByText(/durable-task-id/)).toBeInTheDocument()
    expect(screen.getByText(/inProgress: Inspect/)).toBeInTheDocument()
    expect(screen.queryByText(/100 input.*20 output.*40 cached.*120 total tokens/)).not.toBeInTheDocument()
  })
  it('sends a scoped approval once and disables repeat answers', async () => {
    const request: api.WorkspaceChatRequest = { id: 'approval-a', turn_id: 'turn-a', method: 'item/commandExecution/requestApproval', params: { command: 'git status' }, status: 'pending', created_at: '' }
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [], requests: [request] })
    vi.mocked(api.replyWorkspaceChatRequest).mockResolvedValue({ ...request, status: 'answered' })
    open()
    await selectConversation()
    fireEvent.click(await screen.findByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(api.replyWorkspaceChatRequest).toHaveBeenCalledExactlyOnceWith(config, 'project-a', 'chat-a', 'approval-a', expect.any(String), { decision: 'accept' }))
    await waitFor(() => {
      const button = screen.queryByRole('button', { name: 'Allow once' })
      if (button) expect(button).toBeDisabled()
      else expect(screen.getByText('Agent request answered')).toBeInTheDocument()
    })
  })
  it('preserves unknown reply outcome and never retries a denial', async () => {
    const request: api.WorkspaceChatRequest = { id: 'approval-a', turn_id: 'turn-a', method: 'item/fileChange/requestApproval', params: { reason: 'Update source' }, status: 'pending', created_at: '' }
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [], requests: [request] })
    vi.mocked(api.replyWorkspaceChatRequest).mockRejectedValue(new Error('Disconnected'))
    open()
    await selectConversation()
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
    expect(api.replyWorkspaceChatRequest).toHaveBeenCalledExactlyOnceWith(config, 'project-a', 'chat-a', 'approval-a', expect.any(String), { decision: 'decline' })
  })
  it('sends typed answers to the exact question request', async () => {
    const request: api.WorkspaceChatRequest = { id: 'question-a', turn_id: 'turn-a', method: 'item/tool/requestUserInput', params: { questions: [{ id: 'strategy', question: 'Choose a strategy', options: [{ label: 'Small patch', description: 'Focused change' }] }] }, status: 'pending', created_at: '' }
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [], requests: [request] })
    vi.mocked(api.replyWorkspaceChatRequest).mockResolvedValue({ ...request, status: 'answered' })
    open()
    await selectConversation()
    expect(await screen.findByRole('button', { name: 'Submit answers' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Small patch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }))
    await waitFor(() => expect(api.replyWorkspaceChatRequest).toHaveBeenCalledExactlyOnceWith(config, 'project-a', 'chat-a', 'question-a', expect.any(String), { answers: { strategy: { answers: ['Small patch'] } } }))
  })
  it('does not render duplicate streamed assistant text after the turn settles', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [{ ...message, id: 'assistant-a', role: 'assistant', text: 'Final answer', status: 'completed' }], events: [
      { sequence: 1, type: 'item/agentMessage/delta', turn_id: 'turn-a', item_id: 'answer', delta: 'Final answer', created_at: '' },
      { sequence: 2, type: 'turn/completed', turn_id: 'turn-a', created_at: '' },
    ] })
    open()
    await selectConversation()
    expect(screen.getAllByText('Final answer')).toHaveLength(1)
  })
  it('sends Implement and Regenerate for the selected variant without touching the draft', async () => {
    const variants = 'Two takes.\n\n```orchestra-html\n<!-- title: Calm -->\n<div>calm</div>\n```\n\n```orchestra-html\n<!-- title: Bold -->\n<div>bold</div>\n```'
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [{ ...message, id: 'assistant-v', role: 'assistant', text: variants, status: 'completed' }] })
    open()
    await selectConversation()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'My unsent draft' } })
    fireEvent.click(await screen.findByRole('tab', { name: 'Variant #2' }))
    expect(screen.getByTitle('Bold')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Implement' }))
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalledTimes(1))
    expect(api.sendWorkspaceChatMessage).toHaveBeenCalledWith(config, 'project-a', 'chat-a', expect.any(String),
      'Implement Variant #2 ("Bold") in this project. Integrate it with the existing components, styles, and conventions rather than pasting the standalone HTML.\n\nReference HTML for the variant:\n\n```html\n<!-- title: Bold -->\n<div>bold</div>\n```')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Implement' })).toBeEnabled())
    expect(screen.getByLabelText('Message agent')).toHaveValue('My unsent draft')

    vi.mocked(api.sendWorkspaceChatMessage).mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalledWith(config, 'project-a', 'chat-a', expect.any(String),
      'Regenerate Variant #2 ("Bold") as a fresh, improved take that keeps its direction. Publish it as an HTML render.'))
    expect(screen.getByLabelText('Message agent')).toHaveValue('My unsent draft')
  })
  it('sends the exact provider-reported model slug only after explicit selection', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, conversation_mode: 'native_session' }, messages: [] })
    vi.mocked(api.fetchWorkspaceChatModels).mockResolvedValue({ project_id: 'project-a', provider: 'codex', observation: 'provider_catalog', models: [
      { id: 'opaque-id', model: 'provider-model', display_name: 'Provider Model', is_default: false },
      { id: 'hidden', model: 'hidden-model', display_name: 'Hidden Model', is_default: false, hidden: true },
    ] })
    open()
    await selectConversation()
    fireEvent.click(screen.getByLabelText('Choose harness and model'))
    await screen.findByRole('option', { name: 'Provider Model' })
    // The new-conversation composer loads the same catalog before a conversation is chosen.
    expect(api.fetchWorkspaceChatModels).toHaveBeenLastCalledWith(config, 'project-a', 'codex')
    expect(screen.getByRole('option', { name: /Provider default/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('option', { name: 'Hidden Model' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Provider Model' }))
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Use this model' } })
    fireEvent.click(screen.getByLabelText('Send message'))
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalledExactlyOnceWith(config, 'project-a', 'chat-a', expect.any(String), 'Use this model', 'provider-model'))
  })
  it('keeps drafts and provider-default dispatch when catalog observation fails', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, conversation_mode: 'native_session' }, messages: [] })
    vi.mocked(api.fetchWorkspaceChatModels).mockRejectedValue(new Error('Catalog disconnected'))
    open()
    await selectConversation()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Retain this draft' } })
    await screen.findByText(/Model catalog unavailable: Catalog disconnected/)
    expect(screen.getByLabelText('Message agent')).toHaveValue('Retain this draft')
    expect(screen.getByLabelText('Choose harness and model')).not.toBeDisabled()
    fireEvent.click(screen.getByLabelText('Send message'))
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalledExactlyOnceWith(config, 'project-a', 'chat-a', expect.any(String), 'Retain this draft'))
  })
  it('discards a delayed catalog from the previous conversation', async () => {
    const native = { ...session, conversation_mode: 'native_session' }
    const second = { ...native, id: 'chat-b', title: 'Other conversation' }
    vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [native, second] })
    vi.mocked(api.fetchWorkspaceChat).mockImplementation(async (_config, _project, id) => ({ session: id === 'chat-a' ? native : second, messages: [] }))
    let resolveOld!: (value: api.WorkspaceChatModelCatalog) => void
    vi.mocked(api.fetchWorkspaceChatModels).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve })).mockResolvedValue({ project_id: 'project-a', provider: 'codex', observation: 'provider_catalog', models: [{ id: 'new', model: 'new-model', display_name: 'New Model', is_default: false }] })
    open()
    await selectConversation()
    await waitFor(() => expect(api.fetchWorkspaceChatModels).toHaveBeenCalled())
    await selectConversation('Other conversation')
    fireEvent.click(screen.getByLabelText('Choose harness and model'))
    await screen.findByRole('option', { name: 'New Model' })
    resolveOld({ project_id: 'project-a', provider: 'codex', observation: 'provider_catalog', models: [{ id: 'old', model: 'old-model', display_name: 'Old Model', is_default: false }] })
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Old Model' })).not.toBeInTheDocument())
    expect(screen.getByRole('option', { name: 'New Model' })).toBeInTheDocument()
  })
  it('rejects a catalog belonging to another project/provider without inventing choices', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, conversation_mode: 'native_session' }, messages: [] })
    vi.mocked(api.fetchWorkspaceChatModels).mockResolvedValue({ project_id: 'project-b', provider: 'claude', observation: 'provider_catalog', models: [{ id: 'wrong', model: 'wrong-model', display_name: 'Wrong Model', is_default: false }] })
    open()
    await selectConversation()
    await screen.findByText(/Model catalog belongs to another workspace or provider/)
    fireEvent.click(screen.getByLabelText('Choose harness and model'))
    expect(screen.queryByRole('option', { name: 'Wrong Model' })).not.toBeInTheDocument()
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
    expect(screen.getByRole('option', { name: /Provider default/ })).toHaveAttribute('aria-selected', 'true')
  })
  it('renders assistant Markdown and code while preserving user text literally', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [
      { ...message, text: '**literal user text**', status: 'completed' },
      { ...message, id: 'assistant-a', role: 'assistant', status: 'completed', text: '## Result\n\n**Ready**\n\n```ts\nconst result = 42\n```\n\n- Verified\n\n[Docs](https://example.test/docs)' },
    ] })
    open()
    await selectConversation()
    expect(screen.getByRole('heading', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText('Ready').tagName).toBe('STRONG')
    expect(screen.getByText('**literal user text**')).toBeInTheDocument()
    expect(screen.getByText((_content, element) => element?.tagName === 'CODE' && element.textContent?.includes('const result = 42') === true)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://example.test/docs')
  })
  it('sends only actual model-supported effort after explicit model selection', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, conversation_mode: 'native_session' }, messages: [] })
    vi.mocked(api.fetchWorkspaceChatModels).mockResolvedValue({ project_id: 'project-a', provider: 'codex', observation: 'provider_catalog', models: [{ id: 'opaque-id', model: 'provider-model', display_name: 'Provider Model', is_default: true, supported_reasoning_efforts: [{ reasoning_effort: 'deep', description: 'Provider-reported effort' }] }] })
    open()
    await selectConversation()
    fireEvent.click(screen.getByLabelText('Choose harness and model'))
    await screen.findByRole('option', { name: 'Provider Model' })
    expect(screen.queryByLabelText('Reasoning effort for next turn')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Provider Model' }))
    expect(screen.queryByRole('button', { name: 'Reasoning effort for next turn' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Set reasoning effort to deep' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Think carefully' } })
    fireEvent.click(screen.getByLabelText('Send message'))
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalledExactlyOnceWith(config, 'project-a', 'chat-a', expect.any(String), 'Think carefully', 'provider-model', 'deep'))
  })
  it('retains unsent drafts while working and interrupts with Escape', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [message] })
    vi.mocked(api.stopWorkspaceChatTurn).mockResolvedValue({ session: { ...session, status: 'stopping' } })
    open()
    await selectConversation()
    await screen.findByLabelText('Stop current turn')
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Unsent follow-up' } })
    fireEvent.keyDown(screen.getByLabelText('Message agent'), { key: 'Enter' })
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByLabelText('Message agent'), { key: 'Escape' })
    await waitFor(() => expect(api.stopWorkspaceChatTurn).toHaveBeenCalledExactlyOnceWith(config, 'project-a', 'chat-a'))
    expect(screen.getByLabelText('Message agent')).toHaveValue('Unsent follow-up')
  })
  it('does not interrupt a running turn when a nested harness picker consumes Escape', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [message] })
    open({ headerTools: <button type="button" onKeyDown={event => event.preventDefault()}>Nested picker</button> })
    await selectConversation()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Nested picker' }), { key: 'Escape' })
    expect(api.stopWorkspaceChatTurn).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Stop current turn')).toBeInTheDocument()
  })
  it('does not send on Shift+Enter or an IME composition gesture', async () => {
    open()
    await selectConversation()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Multiline draft' } })
    fireEvent.keyDown(screen.getByLabelText('Message agent'), { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(screen.getByLabelText('Message agent'), { key: 'Enter', isComposing: true })
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
  })
  it('offers a jump to the live edge without forcing it while reading history', async () => {
    open()
    await selectConversation()
    const timeline = screen.getByLabelText('Chat timeline')
    Object.defineProperties(timeline, { scrollHeight: { value: 1000 }, clientHeight: { value: 200 }, scrollTop: { value: 100, configurable: true } })
    fireEvent.scroll(timeline)
    expect(screen.getByLabelText('Scroll to latest message')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Scroll to latest message'))
    expect(screen.queryByLabelText('Scroll to latest message')).not.toBeInTheDocument()
  })
  it('places dated tool activity before its completed assistant response', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [
      { ...message, text: 'Inspect repository', created_at: '2026-10-04T10:00:00Z' },
      { ...message, id: 'assistant-a', role: 'assistant', status: 'completed', text: 'Repository inspected', created_at: '2026-10-04T10:00:02Z' },
    ], events: [{ sequence: 1, type: 'item/completed', turn_id: 'turn-a', item_id: 'tool-a', created_at: '2026-10-04T10:00:01Z', payload: { item: { type: 'commandExecution', command: 'git status', aggregatedOutput: 'clean' } } }] })
    open()
    await selectConversation()
    const activity = screen.getByLabelText('Agent activity')
    const response = screen.getByText('Repository inspected')
    expect(activity.compareDocumentPosition(response) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(/git status.*clean/s)).toBeInTheDocument()
  })
  it('renders Codex reasoning from string summaries and streamed deltas, never raw JSON', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [], events: [
      { sequence: 1, type: 'item/completed', turn_id: 'turn-a', item_id: 'r1', created_at: '', payload: { item: { id: 'r1', type: 'reasoning', summary: ['Checked the router'], content: [] } } },
      { sequence: 2, type: 'item/started', turn_id: 'turn-a', item_id: 'r2', created_at: '', payload: { item: { id: 'r2', type: 'reasoning', summary: [], content: [] } } },
      { sequence: 3, type: 'item/reasoning/summaryTextDelta', turn_id: 'turn-a', item_id: 'r2', delta: 'Streaming ', created_at: '', payload: { summaryIndex: 0 } },
      { sequence: 4, type: 'item/reasoning/summaryTextDelta', turn_id: 'turn-a', item_id: 'r2', delta: 'thoughts', created_at: '', payload: { summaryIndex: 0 } },
      { sequence: 5, type: 'item/completed', turn_id: 'turn-a', item_id: 'r3', created_at: '', payload: { item: { id: 'r3', type: 'reasoning', summary: [], content: [] } } },
    ] })
    open()
    await selectConversation()
    expect(screen.getByText('Checked the router')).toBeInTheDocument()
    expect(screen.getByText('Streaming thoughts')).toBeInTheDocument()
    expect(screen.getAllByText('Reasoning')).toHaveLength(2)
    expect(screen.queryByText(/"type": "reasoning"/)).not.toBeInTheDocument()
  })
  it('keeps a definite preaccept model rejection editable without labeling it uncertain', async () => {
    vi.mocked(api.sendWorkspaceChatMessage).mockRejectedValue(Object.assign(new Error('Model unsupported'), { code: 'chat_provider_unavailable' }))
    open()
    await selectConversation()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Keep this prompt' } })
    fireEvent.click(screen.getByLabelText('Send message'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Message was not accepted')
    expect(screen.getByLabelText('Message agent')).toHaveValue('Keep this prompt')
    expect(screen.getByLabelText('Send message')).not.toBeDisabled()
    expect(screen.queryByText(/Delivery is uncertain/)).not.toBeInTheDocument()
    expect(api.sendWorkspaceChatMessage).toHaveBeenCalledTimes(1)
  })
  it('starts with a centered editable draft and no conversation dropdown', async () => {
    open()
    expect(screen.getByLabelText('Message agent')).not.toBeDisabled()
    expect(screen.queryByLabelText('Conversation')).not.toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toHaveAttribute('data-chat-composer-placement', 'centered')
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Type immediately' } })
    expect(screen.getByLabelText('Message agent')).toHaveValue('Type immediately')
    await waitFor(() => expect(screen.getByLabelText('Send message')).not.toBeDisabled())
    expect(api.createWorkspaceChatSession).not.toHaveBeenCalled()
  })
  it('reconciles an uncertain creation by its known ID without automatically sending', async () => {
    vi.mocked(api.createWorkspaceChatSession).mockRejectedValue(new Error('Creation response lost'))
    vi.mocked(api.fetchWorkspaceChat).mockImplementation(async (_config, _project, id) => ({ session: { ...session, id }, messages: [] }))
    open()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Retain my first prompt' } })
    await waitFor(() => expect(screen.getByLabelText('Send message')).not.toBeDisabled())
    fireEvent.click(screen.getByLabelText('Send message'))
    await screen.findByText('Conversation recovered. Your draft has not been sent; send it when ready.')
    expect(screen.getByLabelText('Message agent')).toHaveValue('Retain my first prompt')
    expect(api.createWorkspaceChatSession).toHaveBeenCalledTimes(1)
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
    const id = vi.mocked(api.createWorkspaceChatSession).mock.calls[0][3]
    expect(api.fetchWorkspaceChat).toHaveBeenCalledWith(config, 'project-a', id)
  })
  it('does not create duplicate sessions when Enter repeats during the first send', async () => {
    let resolveCreate!: (value: api.WorkspaceChatSession) => void
    let accepted: api.WorkspaceChatMessage | undefined
    vi.mocked(api.createWorkspaceChatSession).mockImplementation(() => new Promise(resolve => { resolveCreate = resolve }))
    vi.mocked(api.fetchWorkspaceChat).mockImplementation(async (_config, _project, id) => ({ session: { ...session, id }, messages: accepted ? [accepted] : [] }))
    vi.mocked(api.sendWorkspaceChatMessage).mockImplementation(async (_config, _project, id, clientId, text) => { accepted = { ...message, session_id: id, client_message_id: clientId, text }; return { session: { ...session, id }, message: accepted } })
    open()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'Start once' } })
    await waitFor(() => expect(screen.getByLabelText('Send message')).not.toBeDisabled())
    fireEvent.keyDown(screen.getByLabelText('Message agent'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('Message agent'), { key: 'Enter' })
    expect(api.createWorkspaceChatSession).toHaveBeenCalledTimes(1)
    const id = vi.mocked(api.createWorkspaceChatSession).mock.calls[0][3]!
    resolveCreate({ ...session, id })
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('contentinfo')).toHaveAttribute('data-chat-composer-placement', 'docked'))
  })
  it('retries only creation with the same identity after repeated missing observations', async () => {
    let exists = false
    vi.mocked(api.createWorkspaceChatSession).mockImplementation(async (_config, _project, _provider, id) => {
      if (!exists) throw new Error('Creation response lost')
      return { ...session, id: id! }
    })
    vi.mocked(api.fetchWorkspaceChat).mockImplementation(async (_config, _project, id) => {
      if (!exists) throw new Error('404 Chat not found')
      return { session: { ...session, id }, messages: [] }
    })
    vi.mocked(api.sendWorkspaceChatMessage).mockImplementation(async (_config, _project, id, clientId, text) => ({ session: { ...session, id }, message: { ...message, session_id: id, client_message_id: clientId, text } }))
    open()
    fireEvent.change(screen.getByLabelText('Message agent'), { target: { value: 'My first prompt' } })
    await waitFor(() => expect(screen.getByLabelText('Send message')).not.toBeDisabled())
    fireEvent.click(screen.getByLabelText('Send message'))
    await screen.findByRole('button', { name: 'Retry creating chat' })
    const id = vi.mocked(api.createWorkspaceChatSession).mock.calls[0][3]
    exists = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry creating chat' }))
    await screen.findByText('Conversation recovered. Your draft has not been sent; send it when ready.')
    expect(api.createWorkspaceChatSession).toHaveBeenNthCalledWith(2, config, 'project-a', 'codex', id)
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Message agent')).toHaveValue('My first prompt')
    fireEvent.click(screen.getByLabelText('Send message'))
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalledExactlyOnceWith(config, 'project-a', id, expect.any(String), 'My first prompt'))
  })
})

const render = (ui: ReactElement) => renderBase(ui, { wrapper: AppTooltipProvider })
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }))
