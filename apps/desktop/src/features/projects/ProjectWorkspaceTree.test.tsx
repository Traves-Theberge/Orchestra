import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { resetAppStore, useAppStore } from '@core/store'
import { fetchProjectWorktrees, listWorkspaceChatSessions, type IssueListItem } from '@core/api/client'
import { ProjectWorkspaceTree } from './ProjectWorkspaceTree'
vi.mock('@core/api/client', () => ({
  fetchProjectWorktrees: vi.fn(async () => ({ worktrees: [{ id: 'root', path: '/repo', branch: 'main', primary: true, is_main_worktree: true }, { id: 'child', path: '/child', branch: 'feature', primary: false, is_main_worktree: false }] })),
  fetchState: vi.fn(async () => ({ running: [] })),
  listWorkspaceChatSessions: vi.fn(async (config: { workspaceId: string }) => ({ sessions: config.workspaceId === 'child' ? [{ id: 'chat', project_id: 'p1', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Child chat', status: 'idle' }, { id: 'bad', project_id: 'other', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Wrong owner', status: 'idle' }] : [] })),
}))
beforeEach(() => { resetAppStore(); useAppStore.setState({ config: { baseUrl: 'http://localhost:4010', apiToken: 'fixture' }, activeProjectId: 'p1', projects: [{ id: 'p1', name: 'Repo', root_path: '/repo', remote_url: '' }], allBoardIssues: [{ id: 'task', project_id: 'p1', identifier: 'TASK-1', branch_name: 'feature', title: 'Ship' } as IssueListItem] }) })
afterEach(cleanup)
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
  it('refreshes workspaces directly without an action menu', async () => {
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
