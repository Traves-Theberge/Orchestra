import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { resetAppStore, useAppStore } from '@core/store'
import { createWorktreeJob, createWorkspaceChatSession, fetchProjectGitHubIssues, fetchWorktreeJob, listWorkspaceChatSessions } from '@core/api/client'
import { CreateWorktreeDialog } from './CreateWorktreeDialog'
import type { SelectedProjectWorkspace } from '@core/store/types'
const rootWorkspace: SelectedProjectWorkspace = { projectId: 'p1', workspaceId: 'root', path: 'C:/repo', branch: 'main', registered: true, isMain: true }
let requestId = ''
vi.mock('@core/api/client', () => ({
  fetchProjectGitBranches: vi.fn(async () => ({ current: 'main', branches: ['main', 'feature'] })),
  fetchProjectWorktrees: vi.fn(async () => ({ worktrees: [{ id: 'root', path: 'C:/repo', branch: 'main', primary: true, is_main_worktree: true }, { id: 'new', path: 'C:/repo-worktrees/preview', branch: 'preview', primary: false, is_main_worktree: false }] })),
  fetchProjectGitHubIssues: vi.fn(async () => ({ issues: [], has_more: false })),
  fetchWorkspaceChatProviders: vi.fn(async () => ({ providers: [{ id: 'codex', label: 'Codex', enabled: true }, { id: 'disabled', label: 'Disabled harness', enabled: false, reason: 'Not installed' }] })),
  fetchWorkspaceChatModels: vi.fn(async () => ({ models: [{ id: 'model', model: 'model', display_name: 'Real model' }] })),
  createWorktreeJob: vi.fn(async (_config, projectId, payload) => { requestId = payload.request_id; return { request_id: requestId, project_id: projectId, status: 'queued', message: 'Queued' } }),
  fetchWorktreeJob: vi.fn(async () => ({ request_id: requestId, project_id: 'p1', status: 'completed', workspace: { id: 'new', path: 'C:/repo-worktrees/preview', branch: 'preview', primary: false, is_main_worktree: false } })),
  createWorkspaceChatSession: vi.fn(async (_config, projectId, provider, id) => ({ id, project_id: projectId, provider, workspace_id: 'root', workspace_path: 'C:/repo' })),
  listWorkspaceChatSessions: vi.fn(async () => ({ sessions: [] })),
  toDisplayError: (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
}))
beforeEach(() => { localStorage.clear(); resetAppStore(); vi.clearAllMocks(); useAppStore.setState({ config: { baseUrl: 'http://localhost:4010', apiToken: 'secret' }, activeProjectId: 'p1', projects: [{ id: 'p1', name: 'Repo', root_path: 'C:/repo', remote_url: '' }] }) })
afterEach(cleanup)
async function chooseDropdown(label: string, option: string) {
  const group = screen.getByRole('group', { name: label })
  fireEvent.click(within(group).getByRole('button'))
  const listbox = await screen.findByRole('listbox', { name: label })
  fireEvent.click(within(listbox).getByRole('option', { name: option }))
}
describe('distinct workspace and agent creation', () => {
  it('creates only a Git workspace and selects the confirmed checkout', async () => {
    const close = vi.fn()
    render(<CreateWorktreeDialog open onOpenChange={close} initialProjectId="p1" />)
    fireEvent.change(screen.getByPlaceholderText('Type a name, #123, branch or GitHub issue URL'), { target: { value: 'preview' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /Create worktree/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /Create worktree/ }))
    await waitFor(() => expect(createWorktreeJob).toHaveBeenCalled())
    expect(vi.mocked(createWorktreeJob).mock.calls[0][2]).toMatchObject({ name: 'preview', branch: 'preview', base_ref: 'main' })
    expect(vi.mocked(createWorktreeJob).mock.calls[0][2]).not.toHaveProperty('task_id')
    expect(vi.mocked(createWorktreeJob).mock.calls[0][2]).not.toHaveProperty('provider')
    await waitFor(() => expect(close).toHaveBeenCalledWith(false), { timeout: 3500 })
    expect(useAppStore.getState().workspaceSelections['http://localhost:4010::p1'].workspaceId).toBe('new')
    expect(createWorkspaceChatSession).not.toHaveBeenCalled()
  })
  it('creates an agent in the existing workspace without a Git job or message', async () => {
    render(<CreateWorktreeDialog open onOpenChange={vi.fn()} mode="agent" initialWorkspace={rootWorkspace} />)
    await screen.findByRole('group', { name: 'Agent model' })
    await chooseDropdown('Agent model', 'Real model')
    fireEvent.click(screen.getByRole('button', { name: /Create agent/ }))
    await waitFor(() => expect(createWorkspaceChatSession).toHaveBeenCalled())
    expect(createWorkspaceChatSession).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'root' }), 'p1', 'codex', expect.any(String), { requested_model: 'model' })
    expect(createWorktreeJob).not.toHaveBeenCalled()
  })
  it('retains an uncertain job request and reconciles with GET without a second mutation', async () => {
    vi.mocked(createWorktreeJob).mockImplementationOnce(async (_config, _project, payload) => { requestId = payload.request_id; throw new Error('Disconnected') })
    render(<CreateWorktreeDialog open onOpenChange={vi.fn()} initialProjectId="p1" />)
    fireEvent.change(screen.getByPlaceholderText('Type a name, #123, branch or GitHub issue URL'), { target: { value: 'preview' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /Create worktree/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /Create worktree/ }))
    await screen.findByText('Check creation status')
    expect(Object.values(localStorage).join('')).not.toContain('secret')
    fireEvent.click(screen.getByText('Check creation status'))
    await waitFor(() => expect(fetchWorktreeJob).toHaveBeenCalledWith(expect.anything(), 'p1', requestId))
    expect(createWorktreeJob).toHaveBeenCalledTimes(1)
  })
  it('never retransmits an unconfirmed agent creation when checking status', async () => {
    vi.mocked(createWorkspaceChatSession).mockRejectedValueOnce(new Error('Disconnected'))
    render(<CreateWorktreeDialog open onOpenChange={vi.fn()} mode="agent" initialWorkspace={rootWorkspace} />)
    await screen.findByRole('group', { name: 'Agent' })
    await waitFor(() => expect(screen.getByRole('button', { name: /Create agent/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /Create agent/ }))
    await screen.findByText('Check creation status')
    fireEvent.click(screen.getByText('Check creation status'))
    await waitFor(() => expect(listWorkspaceChatSessions).toHaveBeenCalledTimes(2))
    expect(createWorkspaceChatSession).toHaveBeenCalledTimes(1)
    expect(createWorktreeJob).not.toHaveBeenCalled()
  })
  it('allows correcting a definitive pre-effect rejection without retaining an uncertain request', async () => {
    vi.mocked(createWorktreeJob).mockRejectedValueOnce(Object.assign(new Error('Selected harness unavailable'), { code: 'provider_unavailable' }))
    render(<CreateWorktreeDialog open onOpenChange={vi.fn()} initialProjectId="p1" />)
    fireEvent.change(screen.getByPlaceholderText('Type a name, #123, branch or GitHub issue URL'), { target: { value: 'preview' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /Create worktree/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /Create worktree/ }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: /Create worktree/ })).not.toBeDisabled()
    expect(screen.queryByText('Check creation status')).toBeNull()
    expect(localStorage.length).toBe(0)
  })
  it('renders every worktree source mode when GitHub returns a null issue list', async () => {
    vi.mocked(fetchProjectGitHubIssues).mockResolvedValueOnce({ issues: null as unknown as [], has_more: false })
    render(<CreateWorktreeDialog open onOpenChange={vi.fn()} initialProjectId="p1" />)
    for (const source of ['Smart', 'GitHub', 'Branch', 'Name']) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(source) }))
      if (source === 'GitHub') expect(screen.getByPlaceholderText('#123 or GitHub issue URL')).toBeInTheDocument()
      if (source === 'Branch') expect(screen.getByRole('group', { name: 'Source branch' })).toBeInTheDocument()
      if (source === 'Name') expect(screen.getByPlaceholderText('Worktree name')).toBeInTheDocument()
    }
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('keeps custom select options inside the open dialog and changes the base branch', async () => {
    render(<CreateWorktreeDialog open onOpenChange={vi.fn()} initialProjectId="p1" />)
    const group = screen.getByRole('group', { name: 'Base branch' })
    fireEvent.click(within(group).getByRole('button'))
    const dialog = screen.getByRole('dialog')
    const listbox = await screen.findByRole('listbox', { name: 'Base branch' })
    expect(dialog).toContainElement(listbox)
    const feature = await within(listbox).findByRole('option', { name: 'feature' })
    fireEvent.click(feature)
    expect(within(screen.getByRole('group', { name: 'Base branch' })).getByRole('button')).toHaveTextContent('feature')
    expect(dialog).toBeInTheDocument()
  })
})
