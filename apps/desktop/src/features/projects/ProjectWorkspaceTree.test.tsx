import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useAppStore, resetAppStore } from '@core/store'
import { ProjectWorkspaceTree } from './ProjectWorkspaceTree'
import { fetchProjectWorktrees, type IssueListItem } from '@core/api/client'

vi.mock('@core/api/client', () => ({
  fetchProjectWorktrees: vi.fn(async () => ({ worktrees: [
    { path: '/repo', branch: 'main', head: 'abc', primary: true },
    { path: '/task', branch: 'task/one', head: 'abc', primary: false },
    { path: '/unlinked', branch: 'external', head: 'abc', primary: false },
  ] })),
  listWorkspaceChatSessions: vi.fn(async () => ({ sessions: [
    { id: 'chat1', project_id: 'p1', provider: 'codex', title: 'Build', status: 'idle' },
    { id: 'wrong', project_id: 'other', provider: 'claude', title: 'Wrong owner', status: 'idle' },
  ] })),
}))

beforeEach(() => {
  resetAppStore()
  useAppStore.setState({
    config: { baseUrl: 'http://localhost:4010', apiToken: 'fixture' },
    activeProjectId: 'p1',
    projects: [{ id: 'p1', name: 'Repo', root_path: '/repo', remote_url: '' }],
    allBoardIssues: [{ id: 'issue1', identifier: 'TASK-1', project_id: 'p1', branch_name: 'task/one', title: 'Ship', state: 'Todo' } as IssueListItem],
  })
})
afterEach(cleanup)

describe('ProjectWorkspaceTree navigation', () => {
  it('selects the exact observed conversation in its backend and registered root', async () => {
    const onSelect = vi.fn()
    render(<ProjectWorkspaceTree query="" onSelect={onSelect} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open codex conversation Build' }))
    expect(onSelect).toHaveBeenCalledWith('p1')
    expect(useAppStore.getState().explorerRoot).toBe('/repo')
    expect(useAppStore.getState().requestedWorkspaceConversation).toMatchObject({ baseUrl: 'http://localhost:4010', apiToken: 'fixture', projectId: 'p1', sessionId: 'chat1' })
    expect(screen.queryByText('Wrong owner')).toBeNull()
  })
  it('inspects the linked issue and keeps unlinked worktrees read only', async () => {
    const inspect = vi.fn()
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} onInspectTask={inspect} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Repo workspace task/one' }))
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ id: 'issue1', project_id: 'p1' }), { projectId: 'p1', baseUrl: 'http://localhost:4010', apiToken: 'fixture' })
    expect(screen.getByRole('button', { name: 'Open Repo workspace external' })).toBeDisabled()
    expect(useAppStore.getState().explorerRoot).toBeNull()
  })
  it('does not clear a newer conversation request with an older completion', () => {
    useAppStore.getState().requestWorkspaceConversation('p1', 'first')
    const first = useAppStore.getState().requestedWorkspaceConversation!.requestId
    useAppStore.getState().requestWorkspaceConversation('p1', 'second')
    useAppStore.getState().clearWorkspaceConversationRequest(first)
    expect(useAppStore.getState().requestedWorkspaceConversation?.sessionId).toBe('second')
  })
  it('collapses agent rows without navigating or hiding the owning branch', async () => {
    const onSelect = vi.fn()
    render(<ProjectWorkspaceTree query="" onSelect={onSelect} />)
    await screen.findByRole('button', { name: 'Open codex conversation Build' })
    fireEvent.click(screen.getByRole('button', { name: 'Collapse agent sessions in p1' }))
    expect(screen.queryByRole('button', { name: 'Open codex conversation Build' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Repo workspace main' })).toBeVisible()
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Expand agent sessions in p1' }))
    expect(screen.getByRole('button', { name: 'Open codex conversation Build' })).toBeVisible()
  })
  it('does not expose stale session controls after switching backend identity', async () => {
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    await screen.findByRole('button', { name: 'Open codex conversation Build' })
    vi.mocked(fetchProjectWorktrees).mockImplementationOnce(() => new Promise(() => {}))
    act(() => useAppStore.setState({ config: { baseUrl: 'http://localhost:4020', apiToken: 'other' } }))
    expect(screen.queryByRole('button', { name: 'Open codex conversation Build' })).toBeNull()
    expect(useAppStore.getState().requestedWorkspaceConversation).toBeNull()
  })
  it('shows an explicit empty search result', () => {
    render(<ProjectWorkspaceTree query="missing" onSelect={vi.fn()} />)
    expect(screen.getByText('No matching projects')).toBeVisible()
  })
})
