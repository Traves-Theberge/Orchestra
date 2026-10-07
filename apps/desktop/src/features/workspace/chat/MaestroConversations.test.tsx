import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import * as api from '@core/api/client'
import { CHAT_SESSION_EVENT, MaestroConversations } from './MaestroConversations'

vi.mock('@core/api/client', () => ({ listWorkspaceChatSessions: vi.fn(), deleteWorkspaceChatSession: vi.fn(), stopWorkspaceChatTurn: vi.fn() }))
const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture' }
const session = (id: string, title: string, updated: string, status = 'idle') => ({ id, project_id: '__orchestrator__', provider: 'CLAUDE', title, status, conversation_mode: 'transcript_replay', created_at: updated, updated_at: updated })

beforeEach(() => {
  resetAppStore()
  useAppStore.setState({ config, activeSection: 'PROJECTS' })
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session('a', 'Older plan', '2026-10-01T00:00:00Z'), session('b', 'Latest review', '2026-10-06T00:00:00Z')] } as never)
  vi.mocked(api.deleteWorkspaceChatSession).mockResolvedValue()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const conversationNames = () => screen.getAllByRole('button').filter(b => !b.getAttribute('aria-label')?.startsWith('Conversation actions')).map(b => b.textContent)

it('lists Maestro conversations newest first, opens one, starts new and highlights the current one', async () => {
  render(<MaestroConversations />)
  const latest = await screen.findByRole('button', { name: 'Open conversation Latest review' })
  const names = conversationNames()
  expect(names[0]).toContain('New conversation')
  expect(names[1]).toContain('Latest review')
  expect(names[2]).toContain('Older plan')
  fireEvent.click(screen.getByRole('button', { name: 'Open conversation Older plan' }))
  expect(useAppStore.getState().activeSection).toBe('ORCHESTRATOR')
  expect(useAppStore.getState().requestedWorkspaceConversation).toEqual(expect.objectContaining({ projectId: '__orchestrator__', sessionId: 'a', baseUrl: config.baseUrl }))
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  expect(useAppStore.getState().requestedWorkspaceConversation).toEqual(expect.objectContaining({ sessionId: '' }))
  act(() => { window.dispatchEvent(new CustomEvent(CHAT_SESSION_EVENT, { detail: { projectId: '__orchestrator__', sessionId: 'b' } })) })
  expect(latest).toHaveAttribute('aria-current', 'page')
})

it('deletes a conversation after confirming in the dialog and starts fresh when it was open', async () => {
  render(<MaestroConversations />)
  await screen.findByRole('button', { name: 'Open conversation Latest review' })
  act(() => { window.dispatchEvent(new CustomEvent(CHAT_SESSION_EVENT, { detail: { projectId: '__orchestrator__', sessionId: 'b' } })) })
  fireEvent.click(screen.getByRole('button', { name: 'Conversation actions for Latest review' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Conversation…' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Delete conversation?')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(api.deleteWorkspaceChatSession).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Conversation actions for Latest review' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Conversation…' }))
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session('a', 'Older plan', '2026-10-01T00:00:00Z')] } as never)
  fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
  await waitFor(() => expect(api.deleteWorkspaceChatSession).toHaveBeenCalledWith(config, '__orchestrator__', 'b'))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Open conversation Latest review' })).not.toBeInTheDocument())
  expect(useAppStore.getState().requestedWorkspaceConversation).toEqual(expect.objectContaining({ sessionId: '' }))
})

it('opens the same right-click menu as project conversations', async () => {
  render(<MaestroConversations />)
  fireEvent.contextMenu(await screen.findByRole('button', { name: 'Open conversation Older plan' }))
  const menu = screen.getByRole('menu', { name: 'Older plan conversation actions' })
  expect(menu).toHaveTextContent('Open Conversation')
  expect(menu).toHaveTextContent('Copy Session ID')
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Conversation…' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Older plan')
})

it('toggles the actions menu from the dots button', async () => {
  render(<MaestroConversations />)
  const dots = await screen.findByRole('button', { name: 'Conversation actions for Older plan' })
  fireEvent.click(dots)
  expect(screen.getByRole('menu', { name: 'Older plan conversation actions' })).toBeInTheDocument()
  expect(dots).toHaveAttribute('aria-expanded', 'true')
  fireEvent.mouseDown(dots); fireEvent.click(dots)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('cannot delete a conversation while it is running', async () => {
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session('r', 'Busy run', '2026-10-06T00:00:00Z', 'running')] } as never)
  render(<MaestroConversations />)
  fireEvent.click(await screen.findByRole('button', { name: 'Conversation actions for Busy run' }))
  expect(screen.getByRole('menuitem', { name: 'Delete Conversation…' })).toBeDisabled()
})

const seenKey = `orchestra:chat-last-seen:v1:${config.baseUrl}`
const stateOf = (title: string) => screen.getByRole('button', { name: `Open conversation ${title}` }).querySelector('[data-conversation-state]')?.getAttribute('data-conversation-state')

it('shows working, needs input, done, failed and interrupted states per conversation', async () => {
  const row = (id: string, title: string, status: string, extra: Record<string, unknown> = {}) => ({ ...session(id, title, '2026-10-06T00:00:00Z', status), created_at: '2026-10-05T00:00:00Z', ...extra })
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [
    row('w', 'Working one', 'running'), row('w2', 'Working two', 'stopping'), row('q', 'Asks first', 'running', { pending_requests: 1 }),
    row('d', 'Finished', 'idle'), row('f', 'Broke', 'failed'), row('i', 'Halted', 'interrupted'),
    row('s', 'Already seen', 'idle'), { ...row('n', 'Never ran', 'idle'), created_at: '2026-10-06T00:00:00Z' },
  ] } as never)
  localStorage.setItem(seenKey, JSON.stringify({ __baseline__: '2026-10-01T00:00:00Z', s: '2026-10-06T00:00:00Z' }))
  render(<MaestroConversations />)
  await screen.findByRole('button', { name: 'Open conversation Working one' })
  expect(stateOf('Working one')).toBe('working')
  expect(stateOf('Working two')).toBe('working')
  expect(stateOf('Asks first')).toBe('needs-input')
  expect(screen.getByRole('img', { name: 'Needs input' })).toBeInTheDocument()
  expect(stateOf('Finished')).toBe('done')
  expect(stateOf('Broke')).toBe('failed')
  expect(stateOf('Halted')).toBe('interrupted')
  expect(stateOf('Already seen')).toBe('idle')
  expect(stateOf('Never ran')).toBe('idle')
  expect(screen.getAllByRole('img', { name: 'Working' })).toHaveLength(2)
})

it('clears the done indicator once the conversation is opened', async () => {
  localStorage.setItem(seenKey, JSON.stringify({ __baseline__: '2026-10-01T00:00:00Z' }))
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [{ ...session('d', 'Finished', '2026-10-06T00:00:00Z'), created_at: '2026-10-05T00:00:00Z' }] } as never)
  render(<MaestroConversations />)
  await screen.findByRole('button', { name: 'Open conversation Finished' })
  expect(stateOf('Finished')).toBe('done')
  fireEvent.click(screen.getByRole('button', { name: 'Open conversation Finished' }))
  await waitFor(() => expect(stateOf('Finished')).toBe('idle'))
  expect(JSON.parse(localStorage.getItem(seenKey)!).d).toBe('2026-10-06T00:00:00Z')
})
