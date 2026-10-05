import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { resetAppStore, useAppStore } from '@core/store'
import { fetchArchivedWorkspaceChat, fetchProjectWorktrees, fetchState, getProjectWorktreeRemoval, listWorkspaceChatArchives, listWorkspaceChatSessions, removeProjectWorktree, setWorkspaceChatArchived, type IssueListItem, type WorktreeRemovalReceipt } from '@core/api/client'
import { ProjectWorkspaceTree } from './ProjectWorkspaceTree'
vi.mock('@core/api/client', () => ({
  fetchProjectWorktrees: vi.fn(async () => ({ worktrees: [{ id: 'root', path: '/repo', branch: 'main', primary: true, is_main_worktree: true }, { id: 'child', path: '/child', branch: 'feature', primary: false, is_main_worktree: false }] })),
  getProjectWorktreeRemoval: vi.fn(),
  removeProjectWorktree: vi.fn(),
  listWorkspaceChatArchives: vi.fn(async () => ({ sessions: [] })),
  fetchArchivedWorkspaceChat: vi.fn(),
  setWorkspaceChatArchived: vi.fn(),
  fetchState: vi.fn(async () => ({ running: [] })),
  listWorkspaceChatSessions: vi.fn(async (config: { workspaceId: string }) => ({ sessions: config.workspaceId === 'child' ? [{ id: 'chat', project_id: 'p1', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Child chat', status: 'idle' }, { id: 'bad', project_id: 'other', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Wrong owner', status: 'idle' }] : [] })),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchProjectWorktrees).mockReset().mockResolvedValue({ worktrees: [{ id: 'root', path: '/repo', branch: 'main', primary: true, is_main_worktree: true }, { id: 'child', path: '/child', branch: 'feature', primary: false, is_main_worktree: false }] } as Awaited<ReturnType<typeof fetchProjectWorktrees>>)
  vi.mocked(fetchState).mockReset().mockResolvedValue({ running: [] } as unknown as Awaited<ReturnType<typeof fetchState>>)
  vi.mocked(listWorkspaceChatSessions).mockReset().mockImplementation(async config => ({ sessions: config.workspaceId === 'child' ? [{ id: 'chat', project_id: 'p1', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Child chat', status: 'idle' }, { id: 'bad', project_id: 'other', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Wrong owner', status: 'idle' }] : [] } as Awaited<ReturnType<typeof listWorkspaceChatSessions>>))
  vi.mocked(listWorkspaceChatArchives).mockReset().mockResolvedValue({ sessions: [] })
  vi.mocked(removeProjectWorktree).mockReset()
  vi.mocked(getProjectWorktreeRemoval).mockReset()
  vi.mocked(fetchArchivedWorkspaceChat).mockReset()
  vi.mocked(setWorkspaceChatArchived).mockReset()
  resetAppStore(); useAppStore.setState({ config: { baseUrl: 'http://localhost:4010', apiToken: 'fixture' }, activeProjectId: 'p1', projects: [{ id: 'p1', name: 'Repo', root_path: '/repo', remote_url: '' }], allBoardIssues: [{ id: 'task', project_id: 'p1', identifier: 'TASK-1', branch_name: 'feature', title: 'Ship' } as IssueListItem] })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('workspace cards', () => {
  it('selects child workspace and its exact owned conversation', async () => {
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open codex conversation Child chat' }))
    expect(useAppStore.getState().workspaceSelections['http://localhost:4010::p1']).toMatchObject({ workspaceId: 'child', path: '/child', registered: false })
    expect(useAppStore.getState().requestedWorkspaceConversation).toMatchObject({ workspaceId: 'child', sessionId: 'chat', projectId: 'p1' })
    expect(screen.queryByText('Wrong owner')).toBeNull()
    expect(screen.queryByText('1 agent')).toBeNull()
  })
  it('activates real workspace without inspecting task; task link is separate', async () => {
    const inspect = vi.fn()
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} onInspectTask={inspect} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Repo workspace feature' }))
    expect(useAppStore.getState().workspaceSelections['http://localhost:4010::p1'].path).toBe('/child')
    expect(inspect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect task TASK-1' }))
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ id: 'task' }), expect.objectContaining({ projectId: 'p1', baseUrl: 'http://localhost:4010' }))
  })
  it('opens worktree creation separately from task creation', () => {
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create worktree in Repo' }))
    expect(useAppStore.getState().createWorktreeDialogOpen).toBe(true)
    expect(useAppStore.getState().createTaskDialogOpen).toBe(false)
  })
  it('hides stale native conversation controls on backend switch', async () => {
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    await screen.findByRole('button', { name: 'Open codex conversation Child chat' })
    vi.mocked(fetchProjectWorktrees).mockImplementationOnce(() => new Promise(() => {}))
    act(() => useAppStore.setState({ config: { baseUrl: 'http://localhost:4020', apiToken: 'other' } }))
    expect(screen.queryByRole('button', { name: 'Open codex conversation Child chat' })).toBeNull()
  })
  it('shows empty search result', () => {
    render(<ProjectWorkspaceTree query="missing" onSelect={vi.fn()} />)
    expect(screen.getByText('No matching projects')).toBeVisible()
  })
  it('offers removal only on non-primary worktrees and refreshes after confirmed removal', async () => {
    vi.mocked(removeProjectWorktree).mockResolvedValue({ request_id: 'req', project_id: 'p1', workspace_id: 'child', status: 'completed', path: '/child', branch: 'feature' } satisfies WorktreeRemovalReceipt)
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    await screen.findByRole('button', { name: 'Open Repo workspace main' })
    expect(screen.queryByRole('button', { name: 'Workspace actions for Repo workspace main' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions for Repo workspace feature' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove worktree' }))
    expect(screen.getByRole('alertdialog', { name: 'Remove worktree?' })).toBeVisible()
    expect(screen.getByText('/child')).toBeVisible()
    vi.mocked(fetchProjectWorktrees).mockClear()
    vi.mocked(fetchProjectWorktrees).mockResolvedValue({ worktrees: [{ id: 'root', path: '/repo', branch: 'main', primary: true, is_main_worktree: true }] } as Awaited<ReturnType<typeof fetchProjectWorktrees>>)
    fireEvent.click(screen.getByTestId('remove-worktree-confirm'))
    await waitFor(() => expect(fetchProjectWorktrees).toHaveBeenCalled())
    expect(removeProjectWorktree).toHaveBeenCalledWith(expect.anything(), 'p1', 'child', expect.any(String))
    expect(fetchProjectWorktrees).toHaveBeenCalled()
  })
  it('reconciles an uncertain deletion by reading the same receipt without repeating DELETE', async () => {
    vi.mocked(removeProjectWorktree).mockRejectedValueOnce(new TypeError('network dropped'))
    vi.mocked(getProjectWorktreeRemoval).mockResolvedValueOnce({ request_id: 'req', project_id: 'p1', workspace_id: 'child', status: 'completed', path: '/child', branch: 'feature' } satisfies WorktreeRemovalReceipt)
    vi.stubGlobal('crypto', { ...crypto, randomUUID: () => 'stable-request-id' })
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Workspace actions for Repo workspace feature' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove worktree' }))
    vi.mocked(removeProjectWorktree).mockClear()
    vi.mocked(getProjectWorktreeRemoval).mockClear()
    fireEvent.click(screen.getByTestId('remove-worktree-confirm'))
    await screen.findByRole('button', { name: 'Open Repo workspace main' })
    expect(removeProjectWorktree).toHaveBeenCalledTimes(1)
    expect(getProjectWorktreeRemoval).toHaveBeenCalledWith(expect.anything(), 'p1', 'stable-request-id')
  })
  it('keeps an unknown deletion tied to its receipt and blocks a second DELETE', async () => {
    vi.mocked(removeProjectWorktree).mockRejectedValueOnce(new TypeError('network dropped'))
    vi.mocked(getProjectWorktreeRemoval).mockResolvedValueOnce({ request_id: 'stable-request-id', project_id: 'p1', workspace_id: 'child', status: 'unknown', path: '/child', branch: 'feature', message: 'Outcome unknown.' } satisfies WorktreeRemovalReceipt)
    vi.stubGlobal('crypto', { ...crypto, randomUUID: () => 'stable-request-id' })
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Workspace actions for Repo workspace feature' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove worktree' }))
    vi.mocked(removeProjectWorktree).mockClear()
    fireEvent.click(screen.getByTestId('remove-worktree-confirm'))
    expect(await screen.findByText('Outcome unknown.')).toBeVisible()
    expect(screen.getByTestId('remove-worktree-confirm')).toBeDisabled()
    expect(removeProjectWorktree).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions for Repo workspace feature' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Check removal status' }))
    expect(screen.getByRole('alertdialog', { name: 'Remove worktree?' })).toBeVisible()
    expect(screen.getByTestId('remove-worktree-confirm')).toBeDisabled()
    expect(removeProjectWorktree).toHaveBeenCalledTimes(1)
  })
  it('archives a native conversation as separate metadata-only action', async () => {
    vi.mocked(setWorkspaceChatArchived).mockResolvedValueOnce({ session: {} as Awaited<ReturnType<typeof listWorkspaceChatSessions>>['sessions'][number] })
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Archive conversation Child chat' }))
    expect(screen.getByRole('dialog', { name: 'Archive conversation?' })).toBeVisible()
    expect(screen.getByText(/This does not remove the worktree/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Archive conversation' }))
    await vi.waitFor(() => expect(setWorkspaceChatArchived).toHaveBeenCalledWith(
      expect.anything(), 'p1', 'chat', { workspace_id: 'child', cwd: '/child' }, 'idle', 0, true,
    ))
  })
  it('reads archived history from stored identity even after its checkout disappears', async () => {
    vi.mocked(listWorkspaceChatArchives).mockResolvedValueOnce({ sessions: [{ id: 'old', project_id: 'p1', workspace_id: 'gone', workspace_path: '/gone', provider: 'codex', title: 'Old chat', status: 'idle', conversation_mode: 'native', created_at: 'now', updated_at: 'now', archived: true, lifecycle_version: 1 }] })
    vi.mocked(fetchArchivedWorkspaceChat).mockResolvedValueOnce({ session: {} as never, messages: [{ id: 'msg', session_id: 'old', role: 'assistant', text: 'Retained answer', status: 'completed', created_at: 'now' }] })
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Archived conversations (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open archived conversation Old chat' }))
    expect(await screen.findByText('Retained answer')).toBeVisible()
    expect(screen.getByText(/checkout is no longer available/)).toBeVisible()
    expect(fetchArchivedWorkspaceChat).toHaveBeenCalledWith(expect.anything(), 'p1', 'old', 'gone', '/gone')
    expect(screen.queryByRole('button', { name: 'Restore conversation' })).toBeNull()
  })
  it('refreshes workspaces without opening the worktree menu', async () => {
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    await screen.findByRole('button', { name: 'Open Repo workspace main' })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Repo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh workspaces for Repo' }))
    expect(screen.getByRole('button', { name: 'Collapse Repo' })).toBeVisible()
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('shows a disclosure count only for multiple actual agents', async () => {
    vi.mocked(listWorkspaceChatSessions).mockImplementationOnce(async () => ({ sessions: [
      { id: 'one', project_id: 'p1', workspace_id: 'root', workspace_path: '/repo', provider: 'codex', title: 'One', status: 'idle' },
      { id: 'two', project_id: 'p1', workspace_id: 'root', workspace_path: '/repo', provider: 'claude', title: 'Two', status: 'idle' },
    ] } as Awaited<ReturnType<typeof listWorkspaceChatSessions>>))
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Collapse agent sessions in root' }))
    expect(screen.queryByRole('button', { name: 'Open codex conversation One' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Repo workspace main' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Expand agent sessions in root' }))
    expect(screen.getByRole('button', { name: 'Open codex conversation One' })).toBeVisible()
  })
})
