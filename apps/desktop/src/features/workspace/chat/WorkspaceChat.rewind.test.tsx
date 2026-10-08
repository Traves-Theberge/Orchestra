import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { type ReactElement } from 'react'
import { act, cleanup, fireEvent, render as renderBase, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import * as api from '@core/api/client'
import { resetAppStore, useAppStore } from '@core/store'
import { WorkspaceChat } from './WorkspaceChat'

vi.mock('@core/api/client', () => ({
  fetchWorkspaceChatProviders: vi.fn(), listWorkspaceChatSessions: vi.fn(),
  fetchWorkspaceChatModels: vi.fn(),
  createWorkspaceChatSession: vi.fn(), fetchWorkspaceChat: vi.fn(),
  renameWorkspaceChatSession: vi.fn(),
  switchWorkspaceChatProvider: vi.fn(),
  sendWorkspaceChatMessage: vi.fn(), stopWorkspaceChatTurn: vi.fn(),
  replyWorkspaceChatRequest: vi.fn(),
  previewWorkspaceChatRewind: vi.fn(), editWorkspaceChatMessage: vi.fn(), regenerateWorkspaceChatResponse: vi.fn(),
  activateWorkspaceChatBranch: vi.fn(), undoWorkspaceChatRestore: vi.fn(),
}))

const config = { baseUrl: 'http://localhost:4016', apiToken: 'fixture-only' }
const session: api.WorkspaceChatSession = {
  id: 'chat-a', project_id: 'project-a', provider: 'codex', title: 'Review changes',
  status: 'idle', conversation_mode: 'transcript_replay', created_at: '', updated_at: '',
}
const prompt: api.WorkspaceChatMessage = {
  id: 'u1', session_id: 'chat-a', role: 'user', text: 'Fix the bug', status: 'completed', has_checkpoint: true,
  created_at: '2026-10-08T10:00:00Z',
}
const reply: api.WorkspaceChatMessage = {
  id: 'a1', session_id: 'chat-a', role: 'assistant', text: 'Fixed the bug', status: 'completed', created_at: '2026-10-08T10:00:05Z',
}
const preview: api.WorkspaceChatRewindPreview = {
  message_id: 'u1', has_checkpoint: true, files_available: true,
  changes: [{ path: 'src/a.ts', kind: 'modify' }], changed_since_turn: [], skipped: 0,
}
const editedPrompt: api.WorkspaceChatMessage = { ...prompt, id: 'u2', text: 'Fix the other bug', versions: [{ branch_id: 'b1', active: false }, { branch_id: 'b2', active: true }] }
const apiError = (code: string, message: string) => Object.assign(new Error(message), { code })

const render = (ui: ReactElement) => renderBase(ui, { wrapper: AppTooltipProvider })
const open = (projectId = 'project-a') => render(<WorkspaceChat config={config} projectId={projectId} projectName="Alpha" />)
async function selectConversation(projectId = 'project-a') {
  act(() => useAppStore.getState().requestWorkspaceConversation(projectId, session.id))
  await screen.findByRole('button', { name: 'Rename conversation: Review changes' })
  await screen.findByText('Fixed the bug')
}
const dialog = () => screen.getByRole('dialog')

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
  vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [prompt, reply], events: [], requests: [], cursor: 1 })
  vi.mocked(api.previewWorkspaceChatRewind).mockResolvedValue(preview)
})
afterEach(() => { cleanup() })

async function editTo(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
  const editor = screen.getByRole('textbox', { name: 'Edit message' })
  fireEvent.change(editor, { target: { value: text } })
  fireEvent.keyDown(editor, { key: 'Enter' })
  await screen.findByRole('dialog')
}

describe('WorkspaceChat rewind', () => {
  it('edits with files: previews, confirms, refetches the conversation and offers Undo restore', async () => {
    open(); await selectConversation()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message agent' }), { target: { value: 'my unsent draft' } })
    await editTo('Fix the other bug')
    expect(api.previewWorkspaceChatRewind).toHaveBeenCalledWith(config, 'project-a', 'chat-a', 'u1')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockResolvedValue({ session: { ...session, status: 'running' }, message: editedPrompt })
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [editedPrompt], events: [], requests: [], cursor: 7 })
    const fetchesBefore = vi.mocked(api.fetchWorkspaceChat).mock.calls.length
    fireEvent.click(within(dialog()).getByRole('radio', { name: /Conversation and files/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.editWorkspaceChatMessage).toHaveBeenCalledWith(config, 'project-a', 'chat-a', {
      message_id: 'u1', text: 'Fix the other bug', client_message_id: expect.stringMatching(/^[0-9a-f-]{36}$/), restore_files: true,
    })
    expect(vi.mocked(api.fetchWorkspaceChat).mock.calls.length).toBeGreaterThan(fetchesBefore)
    expect(await screen.findByText('Fix the other bug')).toBeDefined()
    expect(screen.queryByText('Fixed the bug')).toBeNull()
    expect(screen.getByRole('group', { name: 'Message version 2 of 2' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Undo restore' })).toBeDefined()
    expect(screen.getByRole('textbox', { name: 'Message agent' })).toHaveValue('my unsent draft')
  })

  it('uses a fresh client message id for each rewind', async () => {
    open(); await selectConversation()
    vi.mocked(api.regenerateWorkspaceChatResponse).mockRejectedValue(apiError('chat_busy', 'busy'))
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }))
    await within(await screen.findByRole('dialog')).findByText('1 file will change')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Regenerate' }))
    await within(dialog()).findByRole('alert')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(api.regenerateWorkspaceChatResponse).toHaveBeenCalledTimes(2))
    const [first, second] = vi.mocked(api.regenerateWorkspaceChatResponse).mock.calls.map(call => call[3].client_message_id)
    expect(first).not.toBe(second)
  })

  it('regenerates with Conversation only and refetches without an undo offer', async () => {
    open(); await selectConversation()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }))
    await screen.findByRole('dialog')
    expect(api.previewWorkspaceChatRewind).toHaveBeenCalledWith(config, 'project-a', 'chat-a', 'a1')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.regenerateWorkspaceChatResponse).mockResolvedValue({ session: { ...session, status: 'running' }, message: prompt })
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [prompt], events: [], requests: [], cursor: 9 })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.regenerateWorkspaceChatResponse).toHaveBeenCalledWith(config, 'project-a', 'chat-a', {
      message_id: 'a1', client_message_id: expect.any(String), restore_files: false,
    })
    await waitFor(() => expect(screen.queryByText('Fixed the bug')).toBeNull())
    expect(screen.queryByRole('button', { name: 'Undo restore' })).toBeNull()
  })

  it('keeps the dialog open with the failed files when a restore is partial', async () => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(apiError('restore_partial', 'Files could not be restored: src/a.ts (locked).'))
    fireEvent.click(within(dialog()).getByRole('radio', { name: /Conversation and files/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    const alert = await within(dialog()).findByRole('alert')
    expect(alert).toHaveTextContent('Files could not be restored: src/a.ts (locked).')
    expect(alert).toHaveTextContent('Nothing in the conversation was changed.')
    expect(screen.getByText('Fixed the bug')).toBeDefined()
    expect(screen.queryByText(/delivery may be uncertain/)).toBeNull()
  })

  it.each([
    ['chat_busy', 'A turn is running here or another conversation is using this folder. Try again when it finishes.'],
    ['checkpoint_unavailable', 'There is no file checkpoint for that message. Choose Conversation only.'],
    ['invalid_chat_request', 'The backend said no.'],
  ])('maps %s to plain words inside the dialog', async (code, text) => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(apiError(code, 'The backend said no.'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(text)
  })

  it('reports a timed out rewind without claiming it failed', async () => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('The request timed out. Check the conversation before retrying; the server may still finish.')
  })

  it('closes the dialog and offers Undo restore when files were restored but the message was not sent; Undo refetches and hides it', async () => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(apiError('files_restored', 'The files were restored to the earlier state but the message was not sent (boom). Use "Undo restore" to bring the files back.'))
    fireEvent.click(within(dialog()).getByRole('radio', { name: /Conversation and files/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const banner = screen.getByRole('button', { name: 'Undo restore' }).closest('[role="status"]')!
    expect(banner).toHaveTextContent('the message was not sent (boom)')

    let finishUndo: (value: api.WorkspaceChatRestoreResult) => void = () => {}
    vi.mocked(api.undoWorkspaceChatRestore).mockImplementation(() => new Promise(resolve => { finishUndo = resolve }))
    const fetchesBefore = vi.mocked(api.fetchWorkspaceChat).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Undo restore' }))
    expect(screen.getByRole('button', { name: 'Undo restore' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Undo restore' }))
    expect(api.undoWorkspaceChatRestore).toHaveBeenCalledTimes(1)
    expect(api.undoWorkspaceChatRestore).toHaveBeenCalledWith(config, 'project-a', 'chat-a')
    await act(async () => finishUndo({ written: 1, deleted: 0, failed: [] }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo restore' })).toBeNull())
    expect(vi.mocked(api.fetchWorkspaceChat).mock.calls.length).toBeGreaterThan(fetchesBefore)
  })

  it('keeps the undo offer with the error when Undo restore fails, and dismisses it', async () => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(apiError('files_restored', 'Files were restored but not sent.'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    await screen.findByRole('button', { name: 'Undo restore' })
    vi.mocked(api.undoWorkspaceChatRestore).mockRejectedValue(apiError('chat_busy', 'busy'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo restore' }))
    expect(await screen.findByText('A turn is running here or another conversation is using this folder. Try again when it finishes.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('button', { name: 'Undo restore' })).toBeNull()
  })

  it('clears the undo offer when the next message is sent', async () => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(apiError('files_restored', 'Files were restored but not sent.'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    await screen.findByRole('button', { name: 'Undo restore' })
    vi.mocked(api.sendWorkspaceChatMessage).mockResolvedValue({ session: { ...session, status: 'running' }, message: { ...prompt, id: 'u9', text: 'Next' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message agent' }), { target: { value: 'Next' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo restore' })).toBeNull())
  })

  it('switches versions through the dialog and refetches', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [editedPrompt, reply], events: [], requests: [], cursor: 1 })
    open(); await selectConversation()
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    await screen.findByRole('dialog')
    expect(screen.getByRole('dialog', { name: 'Switch version' })).toBeDefined()
    expect(api.previewWorkspaceChatRewind).not.toHaveBeenCalled()
    vi.mocked(api.activateWorkspaceChatBranch).mockResolvedValue({ session, messages: [prompt], events: [], requests: [] })
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [{ ...prompt, text: 'Old version' }], events: [], requests: [], cursor: 3 })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Switch' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.activateWorkspaceChatBranch).toHaveBeenCalledWith(config, 'project-a', 'chat-a', 'b1', false)
    expect(await screen.findByText('Old version')).toBeDefined()
  })

  it('disables Edit and Regenerate with a reason while a turn runs', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [prompt, reply], events: [], requests: [], cursor: 1 })
    open(); await selectConversation()
    for (const name of ['Edit message', 'Regenerate response']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', 'Wait for the current turn to finish')
    }
  })

  it('hides the files option for Maestro and never restores files there', async () => {
    const maestro = { ...session, project_id: '__orchestrator__' }
    useAppStore.setState({ projects: [{ id: '__orchestrator__', name: 'Maestro', root_path: '', remote_url: '' }] })
    vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [maestro] })
    vi.mocked(api.fetchWorkspaceChatModels).mockResolvedValue({ project_id: '__orchestrator__', provider: 'codex', observation: 'provider_catalog', models: [] })
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: maestro, messages: [prompt, reply], events: [], requests: [], cursor: 1 })
    vi.mocked(api.editWorkspaceChatMessage).mockResolvedValue({ session: maestro, message: editedPrompt })
    open('__orchestrator__'); await selectConversation('__orchestrator__')
    await editTo('Fix the other bug')
    expect(within(dialog()).queryByRole('radio', { name: /Conversation and files/ })).toBeNull()
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: 'Edit and re-run' })).toBeEnabled())
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    await waitFor(() => expect(api.editWorkspaceChatMessage).toHaveBeenCalled())
    expect(vi.mocked(api.editWorkspaceChatMessage).mock.calls[0][3].restore_files).toBe(false)
    expect(vi.mocked(api.editWorkspaceChatMessage).mock.calls[0][1]).toBe('__orchestrator__')
  })

  it('Escape inside the message editor never interrupts a running turn', async () => {
    open(); await selectConversation()
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    vi.mocked(api.sendWorkspaceChatMessage).mockResolvedValue({ session: { ...session, status: 'running' }, message: { ...prompt, id: 'u9', text: 'Next' } })
    vi.mocked(api.stopWorkspaceChatTurn).mockResolvedValue({ session: { ...session, status: 'stopping' } })
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [prompt, reply], events: [], requests: [], cursor: 2 })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message agent' }), { target: { value: 'Next' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByRole('button', { name: 'Stop current turn' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), { key: 'Escape' })
    expect(api.stopWorkspaceChatTurn).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message agent' }), { key: 'Escape' })
    await waitFor(() => expect(api.stopWorkspaceChatTurn).toHaveBeenCalledTimes(1))
  })
})
