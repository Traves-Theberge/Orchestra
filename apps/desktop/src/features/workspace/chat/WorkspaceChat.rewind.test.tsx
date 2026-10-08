import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import { type ReactElement } from 'react'
import { act, cleanup, configure, fireEvent, getConfig, render as renderBase, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
  await screen.findByRole('button', { name: 'Rename conversation: Review changes' }, { timeout: 5000 })
  await screen.findByText('Fixed the bug', undefined, { timeout: 5000 })
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
// Under a full parallel run each render is slow; the 1 s findBy default flakes.
const asyncTimeout = getConfig().asyncUtilTimeout
beforeAll(() => { configure({ asyncUtilTimeout: 5000 }) })
afterAll(() => { configure({ asyncUtilTimeout: asyncTimeout }) })

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
    expect(screen.getByRole('button', { name: 'Undo restore' }).closest('[role="status"]')).toHaveTextContent('Files were restored to before that message.')
    expect(screen.getByRole('textbox', { name: 'Message agent' })).toHaveValue('my unsent draft')
    // The edited message replaced the original, so its editor is gone.
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull()
  })

  it('keeps the editor and its text when the dialog is cancelled', async () => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Fix the other bug')
    expect(api.editWorkspaceChatMessage).not.toHaveBeenCalled()
  })

  it('keeps the editor and its text when the files were restored but the message was not sent', async () => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(apiError('files_restored', 'Files were restored but not sent.'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Fix the other bug')
  })

  it('reuses one client message id for retries of a request and a new id for a new request', async () => {
    open(); await selectConversation()
    vi.mocked(api.regenerateWorkspaceChatResponse).mockRejectedValue(apiError('chat_busy', 'busy'))
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }))
    await within(await screen.findByRole('dialog')).findByText('1 file will change')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Regenerate' }))
    await within(dialog()).findByRole('alert')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(api.regenerateWorkspaceChatResponse).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: 'Regenerate' })).toBeEnabled())
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }))
    await within(await screen.findByRole('dialog')).findByText('1 file will change')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(api.regenerateWorkspaceChatResponse).toHaveBeenCalledTimes(3))
    const [first, retry, next] = vi.mocked(api.regenerateWorkspaceChatResponse).mock.calls.map(call => call[3].client_message_id)
    expect(retry).toBe(first)
    expect(next).not.toBe(first)
  })

  it.each([
    ['an aborted request', () => new DOMException('The operation was aborted.', 'AbortError')],
    ['a gateway timeout', () => apiError('request_failed', '504 Gateway Timeout')],
  ])('after %s refetches, closes the dialog and says so instead of offering a blind retry', async (_name, failure) => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(failure())
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [editedPrompt], events: [], requests: [], cursor: 7 })
    const fetchesBefore = vi.mocked(api.fetchWorkspaceChat).mock.calls.length
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('The request timed out. The conversation was refreshed; check it before trying again.')).toBeDefined()
    expect(vi.mocked(api.fetchWorkspaceChat).mock.calls.length).toBeGreaterThan(fetchesBefore)
    expect(await screen.findByText('Fix the other bug')).toBeDefined()
  })

  it('ignores a late preview of a request that was replaced', async () => {
    open(); await selectConversation()
    let finishFirst: (value: api.WorkspaceChatRewindPreview) => void = () => {}
    vi.mocked(api.previewWorkspaceChatRewind)
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
      .mockResolvedValueOnce(preview)
    await editTo('Fix the other bug')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }))
    await within(await screen.findByRole('dialog')).findByText('1 file will change')
    await act(async () => finishFirst({ ...preview, changes: [preview.changes[0], { path: 'b.ts', kind: 'create' }, { path: 'c.ts', kind: 'create' }] }))
    expect(within(dialog()).getByText('1 file will change')).toBeDefined()
    expect(within(dialog()).queryByText('3 files will change')).toBeNull()
  })

  it('re-checks for a running turn when confirming', async () => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    // A turn starts while the dialog is open.
    vi.mocked(api.sendWorkspaceChatMessage).mockResolvedValue({ session: { ...session, status: 'running' }, message: { ...prompt, id: 'u9', text: 'Next' } })
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [prompt, reply], events: [], requests: [], cursor: 2 })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message agent', hidden: true }), { target: { value: 'Next' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message', hidden: true }))
    await screen.findByRole('button', { name: 'Stop current turn', hidden: true })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Wait for the current turn to finish.')
    expect(api.editWorkspaceChatMessage).not.toHaveBeenCalled()
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

  it('a conversation switch closes the dialog, and an offer stays with its own conversation', async () => {
    const other: api.WorkspaceChatSession = { ...session, id: 'chat-b', title: 'Other conversation' }
    vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session, other] })
    vi.mocked(api.fetchWorkspaceChat).mockImplementation(async (_config, _project, id) => id === 'chat-b'
      ? { session: other, messages: [{ ...prompt, id: 'b-u1', session_id: 'chat-b', text: 'Other prompt' }], events: [], requests: [], cursor: 1 }
      : { session, messages: [prompt, reply], events: [], requests: [], cursor: 1 })
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(apiError('files_restored', 'Files were restored but not sent.'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    await screen.findByRole('button', { name: 'Undo restore' })
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }))
    await screen.findByRole('dialog')

    act(() => useAppStore.getState().requestWorkspaceConversation('project-a', 'chat-b'))
    await screen.findByText('Other prompt')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo restore' })).toBeNull()

    act(() => useAppStore.getState().requestWorkspaceConversation('project-a', 'chat-a'))
    await screen.findByText('Fixed the bug')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Undo restore' })).toBeDefined()
  })

  it('an offer never shows in, or undoes, another conversation', async () => {
    const other: api.WorkspaceChatSession = { ...session, id: 'chat-b', title: 'Other conversation' }
    vi.mocked(api.listWorkspaceChatSessions).mockResolvedValue({ sessions: [session, other] })
    vi.mocked(api.fetchWorkspaceChat).mockImplementation(async (_config, _project, id) => id === 'chat-b'
      ? { session: other, messages: [{ ...prompt, id: 'b-u1', session_id: 'chat-b', text: 'Other prompt' }], events: [], requests: [], cursor: 1 }
      : { session, messages: [prompt, reply], events: [], requests: [], cursor: 1 })
    let fail: (reason: unknown) => void = () => {}
    vi.mocked(api.editWorkspaceChatMessage).mockImplementation(() => new Promise((_resolve, reject) => { fail = reject }))
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    fireEvent.click(within(dialog()).getByRole('radio', { name: /Conversation and files/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    await waitFor(() => expect(api.editWorkspaceChatMessage).toHaveBeenCalled())
    // Asked mid-rewind; the chat switches once the rewind settles and the offer stays with chat-a.
    act(() => useAppStore.getState().requestWorkspaceConversation('project-a', 'chat-b'))
    await act(async () => fail(apiError('files_restored', 'Files were restored but not sent.')))
    await screen.findByText('Other prompt')
    expect(screen.queryByRole('button', { name: 'Undo restore' })).toBeNull()
    expect(api.undoWorkspaceChatRestore).not.toHaveBeenCalled()
  })

  it('clears the offer when a later turn starts', async () => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(apiError('files_restored', 'Files were restored but not sent.'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    await screen.findByRole('button', { name: 'Undo restore' })
    // A turn started elsewhere shows up on the next poll (a rename restarts polling).
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session: { ...session, status: 'running' }, messages: [prompt, reply], events: [], requests: [], cursor: 5 })
    vi.mocked(api.renameWorkspaceChatSession).mockResolvedValue({ ...session, title: 'Renamed' })
    fireEvent.click(screen.getByRole('button', { name: 'Rename conversation: Review changes' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Conversation name' }), { target: { value: 'Renamed' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Conversation name' }), { key: 'Enter' })
    await screen.findByRole('button', { name: 'Stop current turn' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo restore' })).toBeNull())
  })

  it('keeps the offer when the next message is rejected', async () => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(apiError('files_restored', 'Files were restored but not sent.'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    await screen.findByRole('button', { name: 'Undo restore' })
    vi.mocked(api.sendWorkspaceChatMessage).mockRejectedValue(apiError('chat_busy', 'busy'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message agent' }), { target: { value: 'Next' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByText(/Message was not accepted/)
    expect(screen.getByRole('button', { name: 'Undo restore' })).toBeDefined()
  })

  it('switching versions with files offers Undo restore', async () => {
    vi.mocked(api.fetchWorkspaceChat).mockResolvedValue({ session, messages: [editedPrompt, reply], events: [], requests: [], cursor: 1 })
    vi.mocked(api.activateWorkspaceChatBranch).mockResolvedValue({ session, messages: [prompt], events: [], requests: [] })
    open(); await selectConversation()
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    await screen.findByRole('dialog')
    fireEvent.click(within(dialog()).getByRole('radio', { name: /Conversation and files/ }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Switch' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.activateWorkspaceChatBranch).toHaveBeenCalledWith(config, 'project-a', 'chat-a', 'b1', true)
    const banner = screen.getByRole('button', { name: 'Undo restore' }).closest('[role="status"]')!
    expect(banner).toHaveTextContent('Files were restored to that version.')
    expect(banner).not.toHaveTextContent('before that message')
  })

  it('shows the backend text when Undo restore has nothing to undo', async () => {
    open(); await selectConversation()
    await editTo('Fix the other bug')
    await within(dialog()).findByText('1 file will change')
    vi.mocked(api.editWorkspaceChatMessage).mockRejectedValue(apiError('files_restored', 'Files were restored but not sent.'))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Edit and re-run' }))
    await screen.findByRole('button', { name: 'Undo restore' })
    vi.mocked(api.undoWorkspaceChatRestore).mockRejectedValue(apiError('checkpoint_unavailable', 'There is nothing to undo.'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo restore' }))
    expect(await screen.findByText('There is nothing to undo.')).toBeDefined()
    expect(screen.queryByText(/Choose Conversation only/)).toBeNull()
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
