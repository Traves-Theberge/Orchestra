import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetAppStore, useAppStore } from '@core/store'
import * as api from '@core/api/client'
import { CHAT_SESSION_EVENT, MaestroConversations } from './MaestroConversations'

vi.mock('@core/api/client', () => ({ listWorkspaceChatSessions: vi.fn(), deleteWorkspaceChatSession: vi.fn() }))
const config = { baseUrl: 'http://localhost:4014', apiToken: 'fixture' }
const session = (id: string, title: string, updated: string, status = 'idle') => ({ id, project_id: '__orchestrator__', provider: 'CLAUDE', title, status, conversation_mode: 'transcript_replay', created_at: updated, updated_at: updated })

beforeEach(() => {
  resetAppStore()
  useAppStore.setState({ config, activeSection: 'PROJECTS' })
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session('a', 'Older plan', '2026-10-01T00:00:00Z'), session('b', 'Latest review', '2026-10-06T00:00:00Z')] } as never)
  vi.mocked(api.deleteWorkspaceChatSession).mockResolvedValue()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const conversationNames = () => screen.getAllByRole('button').filter(b => !b.getAttribute('aria-label')?.startsWith('Delete')).map(b => b.textContent)

it('lists Maestro conversations newest first, opens one, starts new and highlights the current one', async () => {
  render(<MaestroConversations />)
  const latest = await screen.findByRole('button', { name: /^Latest review/ })
  const names = conversationNames()
  expect(names[0]).toContain('New conversation')
  expect(names[1]).toContain('Latest review')
  expect(names[2]).toContain('Older plan')
  fireEvent.click(screen.getByRole('button', { name: /^Older plan/ }))
  expect(useAppStore.getState().activeSection).toBe('ORCHESTRATOR')
  expect(useAppStore.getState().requestedWorkspaceConversation).toEqual(expect.objectContaining({ projectId: '__orchestrator__', sessionId: 'a', baseUrl: config.baseUrl }))
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  expect(useAppStore.getState().requestedWorkspaceConversation).toEqual(expect.objectContaining({ sessionId: '' }))
  act(() => { window.dispatchEvent(new CustomEvent(CHAT_SESSION_EVENT, { detail: { projectId: '__orchestrator__', sessionId: 'b' } })) })
  expect(latest).toHaveAttribute('aria-current', 'page')
})

it('deletes a conversation after inline confirmation and starts fresh when it was open', async () => {
  render(<MaestroConversations />)
  await screen.findByRole('button', { name: /^Latest review/ })
  act(() => { window.dispatchEvent(new CustomEvent(CHAT_SESSION_EVENT, { detail: { projectId: '__orchestrator__', sessionId: 'b' } })) })
  fireEvent.click(screen.getByRole('button', { name: 'Delete Latest review' }))
  expect(api.deleteWorkspaceChatSession).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete Latest review' }))
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session('a', 'Older plan', '2026-10-01T00:00:00Z')] } as never)
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(api.deleteWorkspaceChatSession).toHaveBeenCalledWith(config, '__orchestrator__', 'b'))
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Latest review/ })).not.toBeInTheDocument())
  expect(useAppStore.getState().requestedWorkspaceConversation).toEqual(expect.objectContaining({ sessionId: '' }))
})

it('cannot delete a conversation while it is running', async () => {
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session('r', 'Busy run', '2026-10-06T00:00:00Z', 'running')] } as never)
  render(<MaestroConversations />)
  expect(await screen.findByRole('button', { name: 'Delete Busy run' })).toBeDisabled()
})
