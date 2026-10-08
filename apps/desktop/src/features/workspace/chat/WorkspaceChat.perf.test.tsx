import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import * as api from '@core/api/client'
import { resetAppStore, useAppStore } from '@core/store'
import { WorkspaceChat } from './WorkspaceChat'

const markdownRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('@ui/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => { markdownRenders.count++; return <div>{content}</div> },
}))
vi.mock('@core/api/client', () => ({
  fetchWorkspaceChatProviders: vi.fn(), listWorkspaceChatSessions: vi.fn(), fetchWorkspaceChatModels: vi.fn(),
  createWorkspaceChatSession: vi.fn(), fetchWorkspaceChat: vi.fn(), renameWorkspaceChatSession: vi.fn(),
  switchWorkspaceChatProvider: vi.fn(), sendWorkspaceChatMessage: vi.fn(), stopWorkspaceChatTurn: vi.fn(),
  replyWorkspaceChatRequest: vi.fn(),
}))

const config = { baseUrl: 'http://localhost:4015', apiToken: 'fixture-only' }
const session: api.WorkspaceChatSession = {
  id: 'chat-a', project_id: 'project-a', provider: 'codex', title: 'Long conversation',
  status: 'idle', conversation_mode: 'transcript_replay', created_at: '', updated_at: '',
}
// 40 turns with tool activity: big enough that re-rendering it per keystroke would lag.
const messages: api.WorkspaceChatMessage[] = Array.from({ length: 80 }, (_, i) => ({
  id: `m${i}`, session_id: 'chat-a', role: i % 2 ? 'assistant' : 'user', text: `Message ${i}`, status: 'completed',
  created_at: new Date(Date.UTC(2026, 9, 4, 10, 0, i * 10)).toISOString(),
}))
const events: api.WorkspaceChatEvent[] = messages.filter(m => m.role === 'assistant').map((m, i) => ({
  sequence: i + 1, type: 'item/completed', turn_id: `t${i}`, item_id: `c${i}`,
  created_at: new Date(Date.parse(m.created_at) - 2000).toISOString(),
  payload: { item: { type: 'commandExecution', command: `echo ${i}`, aggregatedOutput: 'ok' } },
}))

beforeEach(() => {
  resetAppStore()
  useAppStore.setState({ config, projects: [{ id: 'project-a', name: 'Alpha', root_path: '/repo', remote_url: '' }] })
  vi.stubGlobal('crypto', webcrypto)
  vi.resetAllMocks()
  vi.mocked(api.fetchWorkspaceChatProviders).mockResolvedValue({ providers: [{ id: 'codex', label: 'Codex', enabled: true, provider_resume: false, conversation_mode: 'transcript_replay' }] })
  vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session] })
  vi.mocked(api.fetchWorkspaceChatModels).mockResolvedValue({ project_id: 'project-a', provider: 'codex', observation: 'provider_catalog', models: [] })
  vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages, events, cursor: events.length })
})
afterEach(() => { cleanup() })

it('typing in the composer never re-renders the conversation', async () => {
  render(<AppTooltipProvider><WorkspaceChat config={config} projectId="project-a" projectName="Alpha" /></AppTooltipProvider>)
  act(() => useAppStore.getState().requestWorkspaceConversation('project-a', 'chat-a'))
  await screen.findByText('Message 79')
  const before = markdownRenders.count
  const composer = screen.getByLabelText('Message agent')
  for (const text of ['H', 'He', 'Hel', 'Hell', 'Hello', 'Hello there']) fireEvent.change(composer, { target: { value: text } })
  expect(composer).toHaveValue('Hello there')
  expect(markdownRenders.count).toBe(before)
})
