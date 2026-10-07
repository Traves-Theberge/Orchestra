import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { WorkspaceChat } from './WorkspaceChat'
import * as api from '@core/api/client'
import { fetchAgentCatalog, type AgentCatalog } from '@core/api/agent-catalog'
import { resetAppStore, useAppStore } from '@core/store'
import { readAgentModelChoice } from './agent-model-memory'

vi.mock('@core/api/client', () => ({
  fetchWorkspaceChatProviders: vi.fn(), listWorkspaceChatSessions: vi.fn(), fetchWorkspaceChatModels: vi.fn(),
  createWorkspaceChatSession: vi.fn(), fetchWorkspaceChat: vi.fn(), renameWorkspaceChatSession: vi.fn(),
  switchWorkspaceChatProvider: vi.fn(), sendWorkspaceChatMessage: vi.fn(), stopWorkspaceChatTurn: vi.fn(),
  replyWorkspaceChatRequest: vi.fn(), fetchUnifiedAgents: vi.fn(), fetchHarnessCapabilities: vi.fn(),
}))
vi.mock('@core/api/agent-catalog', () => ({ fetchAgentCatalog: vi.fn() }))

const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture-only' }
const session: api.WorkspaceChatSession = {
  id: 'chat-a', project_id: 'project-a', provider: 'codex', title: 'Review changes',
  status: 'idle', conversation_mode: 'native_session', created_at: '', updated_at: '',
}
const reviewerId = 'orchestra:global:orchestra:reviewer'
const agents: api.OrchestraAgent[] = [
  { id: reviewerId, name: 'reviewer', mode: 'primary', source: 'orchestra', scope: 'global', color: '#00ff00' },
  { id: 'orchestra:global:orchestra:researcher', name: 'researcher', description: 'Finds context', mode: 'subagent', source: 'orchestra', scope: 'global', compatible_harnesses: ['codex'] },
  { id: 'orchestra:global:orchestra:claude-only', name: 'reporter', mode: 'subagent', source: 'orchestra', scope: 'global', compatible_harnesses: ['claude'] },
]
const catalog: AgentCatalog = {
  project_id: 'project-a', harness: 'codex', scope: 'effective', root: '/repo', observation: 'observed', selection_capability: 'selectable_primary',
  items: [{ id: reviewerId, kind: 'agent_definition', harness: 'codex', scope: 'global', path: '/a/reviewer.md', content_hash: 'h1', format: 'markdown', display_name: 'Reviewer', description: '', mode: 'primary', selectable_as_primary: true, selection_status: 'selectable', selectable: true, source: 'orchestra' }],
}

beforeEach(() => {
  resetAppStore()
  useAppStore.setState({ config, projects: [{ id: 'project-a', name: 'Alpha', root_path: '/repo', remote_url: '' }] })
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  sessionStorage.clear()
  localStorage.clear()
  vi.resetAllMocks()
  vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [{ id: 'codex', label: 'Codex', enabled: true, provider_resume: false, conversation_mode: 'native_session' }] })
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session] })
  vi.mocked(api.fetchWorkspaceChatModels).mockResolvedValue({ project_id: 'project-a', provider: 'codex', observation: 'provider_catalog', models: [
    { id: 'm1', model: 'provider-model', display_name: 'Provider Model', is_default: false },
  ] })
  vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [] })
  vi.mocked(api.fetchUnifiedAgents).mockResolvedValue(agents)
  vi.mocked(api.fetchHarnessCapabilities).mockResolvedValue([])
  vi.mocked(fetchAgentCatalog).mockResolvedValue(catalog)
  vi.mocked(api.sendWorkspaceChatMessage).mockResolvedValue({ session: { ...session, status: 'running' }, message: { id: 'm', session_id: 'chat-a', role: 'user', text: '', status: 'accepted', created_at: '' } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const open = () => render(<AppTooltipProvider><WorkspaceChat config={config} projectId="project-a" projectName="Alpha" /></AppTooltipProvider>)
async function selectConversation() {
  act(() => useAppStore.getState().requestWorkspaceConversation('project-a', session.id))
  await screen.findByRole('button', { name: 'Rename conversation: Review changes' })
}

describe('WorkspaceChat agents', () => {
  it('autocompletes compatible subagents after @ and inserts @name without sending', async () => {
    open()
    await selectConversation()
    await waitFor(() => expect(api.fetchUnifiedAgents).toHaveBeenCalledWith(config, { projectId: 'project-a', harness: 'codex' }))
    const composer = screen.getByRole('textbox', { name: 'Message agent' }) as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: 'Ask @re', selectionStart: 7, selectionEnd: 7 } })
    const list = await screen.findByRole('listbox', { name: 'Subagent suggestions' })
    expect(within(list).getByText('@researcher')).toBeInTheDocument()
    // Primary-only and other-harness agents are not mentionable.
    expect(within(list).queryByText('@reviewer')).not.toBeInTheDocument()
    expect(within(list).queryByText('@reporter')).not.toBeInTheDocument()
    fireEvent.keyDown(composer, { key: 'Enter' })
    expect(composer).toHaveValue('Ask @researcher ')
    expect(api.sendWorkspaceChatMessage).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox', { name: 'Subagent suggestions' })).not.toBeInTheDocument()
  })

  it('closes suggestions with Escape and keeps the typed text', async () => {
    open()
    await selectConversation()
    const composer = screen.getByRole('textbox', { name: 'Message agent' })
    await waitFor(() => expect(api.fetchUnifiedAgents).toHaveBeenCalled())
    fireEvent.change(composer, { target: { value: '@', selectionStart: 1, selectionEnd: 1 } })
    await screen.findByRole('listbox', { name: 'Subagent suggestions' })
    fireEvent.keyDown(composer, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: 'Subagent suggestions' })).not.toBeInTheDocument()
    expect(composer).toHaveValue('@')
  })

  it('labels assistant turns with the applied agent and warns when it was not applied', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, effective_agent_id: reviewerId, agent_observation: 'not_applied:harness rejected agent' }, messages: [
      { id: 'u1', session_id: 'chat-a', role: 'user', text: 'Review it', status: 'completed', created_at: '', requested_agent_id: reviewerId },
      { id: 'a1', session_id: 'chat-a', role: 'assistant', text: 'Reviewed.', status: 'completed', created_at: '' },
    ] })
    open()
    await selectConversation()
    await screen.findByText('Reviewed.')
    const assistant = document.querySelector('[data-chat-message="assistant"]') as HTMLElement
    await waitFor(() => expect(within(assistant).getByText('reviewer')).toBeInTheDocument())
    expect(within(assistant).getByRole('note')).toHaveTextContent('Agent not applied: harness rejected agent')
    expect(document.querySelector('[data-chat-message="user"] [data-chat-agent]')).toBeNull()
  })

  it('marks a mid-conversation agent switch and sends the next turn with the pill-selected agent', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [
      { id: 'u1', session_id: 'chat-a', role: 'user', text: 'First', status: 'completed', created_at: '' },
      { id: 'a1', session_id: 'chat-a', role: 'assistant', text: 'One', status: 'completed', created_at: '' },
      { id: 'u2', session_id: 'chat-a', role: 'user', text: 'Second', status: 'completed', created_at: '', requested_agent_id: reviewerId },
    ] })
    open()
    await selectConversation()
    expect(await screen.findByRole('separator', { name: 'Switched to reviewer' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Agent: Reviewer' }))
    expect(screen.getByRole('button', { name: 'Agent: Reviewer' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByRole('textbox', { name: 'Message agent' }), { target: { value: 'Next' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalledWith(config, 'project-a', 'chat-a', expect.any(String), 'Next', undefined, undefined, expect.objectContaining({ agent_id: reviewerId })))
  })

  it('restores the last model chosen under an agent and sends it with the agent', async () => {
    localStorage.setItem(`orchestra.agent-model-memory.v1:${config.baseUrl}`, JSON.stringify({ [reviewerId]: { model: 'provider-model', effort: '' } }))
    open()
    await selectConversation()
    fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
    fireEvent.click(await screen.findByRole('option', { name: /Reviewer/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose harness and model' })).toHaveTextContent('Provider Model'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message agent' }), { target: { value: 'Go' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(api.sendWorkspaceChatMessage).toHaveBeenCalledExactlyOnceWith(config, 'project-a', 'chat-a', expect.any(String), 'Go', 'provider-model', undefined,
      { agent_id: reviewerId, agent_scope: 'global', agent_content_hash: 'h1', agent_format: 'markdown' }))
  })

  it('remembers a model picked while an agent is selected', async () => {
    open()
    await selectConversation()
    fireEvent.click(screen.getByRole('button', { name: 'Choose agent mode' }))
    fireEvent.click(await screen.findByRole('option', { name: /Reviewer/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose harness and model' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Provider Model' }))
    expect(readAgentModelChoice(config.baseUrl, reviewerId)).toEqual({ model: 'provider-model', effort: '' })
    expect(readAgentModelChoice('http://other-backend', reviewerId)).toBeUndefined()
  })
})
