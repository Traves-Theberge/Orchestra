import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { resetAppStore, useAppStore } from '@core/store'
import { fetchArchivedWorkspaceChat, fetchProjectWorktrees, fetchState, fetchWorkspaceChat, getProjectWorktreeRemoval, listWorkspaceChatArchives, listWorkspaceChatSessions, removeProjectWorktree, setWorkspaceChatArchived, stopWorkspaceChatTurn, type IssueListItem, type WorktreeRemovalReceipt } from '@core/api/client'
import { ProjectWorkspaceTree } from './ProjectWorkspaceTree'
import { WorkspaceChatArchiveControl } from './WorkspaceChatLifecycleControls'
vi.mock('@core/api/client', () => ({
  fetchProjectWorktrees: vi.fn(async () => ({ worktrees: [{ id: 'root', path: '/repo', branch: 'main', primary: true, is_main_worktree: true }, { id: 'child', path: '/child', branch: 'feature', primary: false, is_main_worktree: false }] })),
  getProjectWorktreeRemoval: vi.fn(),
  removeProjectWorktree: vi.fn(),
  listWorkspaceChatArchives: vi.fn(async () => ({ sessions: [] })),
  fetchArchivedWorkspaceChat: vi.fn(),
  fetchWorkspaceChat: vi.fn(),
  stopWorkspaceChatTurn: vi.fn(),
  setWorkspaceChatArchived: vi.fn(),
  fetchState: vi.fn(async () => ({ running: [] })),
  listWorkspaceChatSessions: vi.fn(async (config: { workspaceId: string }) => ({ sessions: config.workspaceId === 'child' ? [{ id: 'chat', project_id: 'p1', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Child chat', status: 'idle', conversation_mode: 'native_session' }, { id: 'bad', project_id: 'other', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Wrong owner', status: 'idle' }] : [] })),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchProjectWorktrees).mockReset().mockResolvedValue({ worktrees: [{ id: 'root', path: '/repo', branch: 'main', primary: true, is_main_worktree: true }, { id: 'child', path: '/child', branch: 'feature', primary: false, is_main_worktree: false }] } as Awaited<ReturnType<typeof fetchProjectWorktrees>>)
  vi.mocked(fetchState).mockReset().mockResolvedValue({ running: [] } as unknown as Awaited<ReturnType<typeof fetchState>>)
  vi.mocked(listWorkspaceChatSessions).mockReset().mockImplementation(async config => ({ sessions: config.workspaceId === 'child' ? [{ id: 'chat', project_id: 'p1', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Child chat', status: 'idle', conversation_mode: 'native_session' }, { id: 'bad', project_id: 'other', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Wrong owner', status: 'idle' }] : [] } as Awaited<ReturnType<typeof listWorkspaceChatSessions>>))
  vi.mocked(listWorkspaceChatArchives).mockReset().mockResolvedValue({ sessions: [] })
  vi.mocked(removeProjectWorktree).mockReset()
  vi.mocked(getProjectWorktreeRemoval).mockReset()
  vi.mocked(fetchArchivedWorkspaceChat).mockReset()
  vi.mocked(fetchWorkspaceChat).mockReset()
  vi.mocked(stopWorkspaceChatTurn).mockReset()
  vi.mocked(setWorkspaceChatArchived).mockReset()
  resetAppStore(); useAppStore.setState({ config: { baseUrl: 'http://localhost:4010', apiToken: 'fixture' }, activeProjectId: 'p1', projects: [{ id: 'p1', name: 'Repo', root_path: '/repo', remote_url: '' }], allBoardIssues: [{ id: 'task', project_id: 'p1', identifier: 'TASK-1', branch_name: 'feature', title: 'Ship' } as IssueListItem] })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('workspace cards', () => {
  it('closes the primary view without removing its project or workspace', async () => {
    useAppStore.setState({ selectedProjectID: 'p1', openProjectIds: ['p1'] })
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Repo workspace main' }))
    const selection = useAppStore.getState().workspaceSelections['http://localhost:4010::p1']
    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions for Repo workspace main' }))
    expect(screen.getByRole('menuitem', { name: /Remove worktree unavailable/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close workspace view' }))
    expect(useAppStore.getState().selectedProjectID).toBeNull()
    expect(useAppStore.getState().openProjectIds).not.toContain('p1')
    expect(useAppStore.getState().projects).toHaveLength(1)
    expect(useAppStore.getState().workspaceSelections['http://localhost:4010::p1']).toEqual(selection)
    expect(removeProjectWorktree).not.toHaveBeenCalled()
    expect(setWorkspaceChatArchived).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open Repo workspace main' }))
    expect(useAppStore.getState().selectedProjectID).toBe('p1')
  })
  it('closes an inactive child view without navigating away and reopens its retained conversation', async () => {
    useAppStore.setState({ selectedProjectID: 'p1' })
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    await screen.findByRole('button', { name: 'Open codex native chat Child chat' })
    fireEvent.click(screen.getByRole('button', { name: 'Workspace actions for Repo workspace feature' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close workspace view' }))
    expect(useAppStore.getState().activeProjectId).toBe('p1')
    expect(useAppStore.getState().selectedProjectID).toBe('p1')
    expect(screen.queryByRole('button', { name: 'Open codex native chat Child chat' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open Repo workspace feature' }))
    expect(screen.getByRole('button', { name: 'Open codex native chat Child chat' })).toBeVisible()
    expect(removeProjectWorktree).not.toHaveBeenCalled()
    expect(setWorkspaceChatArchived).not.toHaveBeenCalled()
  })
  it('selects child workspace and its exact owned conversation', async () => {
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open codex native chat Child chat' }))
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
    await screen.findByRole('button', { name: 'Open codex native chat Child chat' })
    vi.mocked(fetchProjectWorktrees).mockImplementationOnce(() => new Promise(() => {}))
    act(() => useAppStore.setState({ config: { baseUrl: 'http://localhost:4020', apiToken: 'other' } }))
    expect(screen.queryByRole('button', { name: 'Open codex native chat Child chat' })).toBeNull()
  })
  it('shows empty search result', () => {
    render(<ProjectWorkspaceTree query="missing" onSelect={vi.fn()} />)
    expect(screen.getByText('No matching projects')).toBeVisible()
  })
  it('offers removal only on non-primary worktrees and refreshes after confirmed removal', async () => {
    vi.mocked(removeProjectWorktree).mockResolvedValue({ request_id: 'req', project_id: 'p1', workspace_id: 'child', status: 'completed', path: '/child', branch: 'feature' } satisfies WorktreeRemovalReceipt)
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    await screen.findByRole('button', { name: 'Open Repo workspace main' })
    expect(screen.getByRole('button', { name: 'Workspace actions for Repo workspace main' })).toBeVisible()
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
    vi.mocked(fetchWorkspaceChat).mockResolvedValueOnce({ session: { id: 'chat', project_id: 'p1', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Child chat', status: 'idle', conversation_mode: 'native_session', lifecycle_version: 0 } as never, messages: [], requests: [] })
    vi.mocked(setWorkspaceChatArchived).mockResolvedValueOnce({ session: {} as Awaited<ReturnType<typeof listWorkspaceChatSessions>>['sessions'][number] })
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Archive conversation Child chat' }))
    expect(screen.getByRole('dialog', { name: 'Archive conversation?' })).toBeVisible()
    expect(screen.getByText(/This does not remove the worktree/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Archive conversation' }))
    await vi.waitFor(() => expect(setWorkspaceChatArchived).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'child' }), 'p1', 'chat', { workspace_id: 'child', cwd: '/child' }, 'idle', 0, true,
    ))
  })
  it('stops only the selected running conversation and archives after exact-session settlement', async () => {
    const session = { id: 'chat', project_id: 'p1', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Child chat', status: 'running', conversation_mode: 'native_session', lifecycle_version: 2 }
    vi.mocked(listWorkspaceChatSessions).mockImplementation(async config => ({ sessions: config.workspaceId === 'child' ? [session] : [] } as never))
    vi.mocked(fetchWorkspaceChat)
      .mockResolvedValueOnce({ session: { ...session }, messages: [], requests: [] } as never)
      .mockResolvedValueOnce({ session: { ...session, status: 'stopping' }, messages: [], requests: [] } as never)
      .mockResolvedValueOnce({ session: { ...session, status: 'idle' }, messages: [], requests: [] } as never)
    vi.mocked(stopWorkspaceChatTurn).mockResolvedValueOnce({ session: { ...session, status: 'stopping' } } as never)
    vi.mocked(setWorkspaceChatArchived).mockResolvedValueOnce({ session: { ...session, status: 'idle', archived: true } } as never)
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop and archive conversation Child chat' }))
    expect(screen.getByRole('dialog', { name: 'Archive conversation?' })).toBeVisible()
    expect(screen.getByText(/stop only this selected conversation/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Stop and archive conversation' }))
    await waitFor(() => expect(setWorkspaceChatArchived).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'child' }), 'p1', 'chat', { workspace_id: 'child', cwd: '/child' }, 'idle', 2, true,
    ))
    expect(stopWorkspaceChatTurn).toHaveBeenCalledOnce()
    expect(stopWorkspaceChatTurn).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'child' }), 'p1', 'chat')
    expect(fetchWorkspaceChat).toHaveBeenCalledTimes(3)
  })
  it('does not stop a turn that starts after an idle archive dialog was opened', async () => {
    const idle = { id: 'chat', project_id: 'p1', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Child chat', status: 'idle', conversation_mode: 'native_session', lifecycle_version: 0 }
    vi.mocked(listWorkspaceChatSessions).mockImplementation(async config => ({ sessions: config.workspaceId === 'child' ? [idle] : [] } as never))
    vi.mocked(fetchWorkspaceChat).mockResolvedValueOnce({ session: { ...idle, status: 'running' }, messages: [], requests: [] } as never)
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Archive conversation Child chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive conversation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('became active after the archive confirmation opened')
    expect(stopWorkspaceChatTurn).not.toHaveBeenCalled()
    expect(setWorkspaceChatArchived).not.toHaveBeenCalled()
  })
  it('does not treat a refreshed running row as explicit stop consent for an already-open idle dialog', async () => {
    const idle = { id: 'chat', project_id: 'p1', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Child chat', status: 'idle', lifecycle_version: 4, conversation_mode: 'native_session', created_at: '', updated_at: '' } as const
    const config = { baseUrl: 'http://localhost:4010', apiToken: 'fixture' }
    const { rerender } = render(<WorkspaceChatArchiveControl config={config} projectId="p1" workspaceId="child" cwd="/child" session={idle} onArchived={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Archive conversation Child chat' }))
    const running = { ...idle, status: 'running' as const, lifecycle_version: 5 }
    rerender(<WorkspaceChatArchiveControl config={config} projectId="p1" workspaceId="child" cwd="/child" session={running} onArchived={vi.fn()} />)
    vi.mocked(fetchWorkspaceChat).mockResolvedValueOnce({ session: running, messages: [], requests: [] } as never)
    fireEvent.click(screen.getByRole('button', { name: 'Stop and archive conversation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('became active after the archive confirmation opened')
    expect(stopWorkspaceChatTurn).not.toHaveBeenCalled()
    expect(setWorkspaceChatArchived).not.toHaveBeenCalled()
  })
  it('never stops unknown turns and leaves accepted or uncertain delivery visible', async () => {
    const unknown = { id: 'chat', project_id: 'p1', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'Unknown chat', status: 'unknown', conversation_mode: 'native_session' }
    vi.mocked(listWorkspaceChatSessions).mockImplementation(async config => ({ sessions: config.workspaceId === 'child' ? [unknown] : [] } as never))
    const { unmount } = render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Archive unavailable for conversation Unknown chat' })).toBeDisabled()
    expect(stopWorkspaceChatTurn).not.toHaveBeenCalled()
    unmount()

    const failed = { ...unknown, title: 'Unsettled chat', status: 'failed' as const }
    vi.mocked(listWorkspaceChatSessions).mockImplementation(async config => ({ sessions: config.workspaceId === 'child' ? [failed] : [] } as never))
    vi.mocked(fetchWorkspaceChat).mockResolvedValueOnce({ session: failed, messages: [{ id: 'm', session_id: 'chat', role: 'user', text: 'still uncertain', status: 'unknown' }], requests: [] } as never)
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Archive conversation Unsettled chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive conversation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This exact conversation still has an accepted or uncertain message/request')
    expect(setWorkspaceChatArchived).not.toHaveBeenCalled()
    expect(stopWorkspaceChatTurn).not.toHaveBeenCalled()
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
      { id: 'one', project_id: 'p1', workspace_id: 'root', workspace_path: '/repo', provider: 'codex', title: 'One', status: 'idle', conversation_mode: 'native_session' },
      { id: 'two', project_id: 'p1', workspace_id: 'root', workspace_path: '/repo', provider: 'claude', title: 'Two', status: 'idle', conversation_mode: 'native_session' },
    ] } as Awaited<ReturnType<typeof listWorkspaceChatSessions>>))
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Collapse workspace activity in root' }))
    expect(screen.queryByRole('button', { name: 'Open codex native chat One' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Repo workspace main' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Expand workspace activity in root' }))
    expect(screen.getByRole('button', { name: 'Open codex native chat One' })).toBeVisible()
  })
  it('labels transcript conversations distinctly and shows only path-bound terminals as unverified', async () => {
    vi.mocked(listWorkspaceChatSessions).mockImplementation(async config => ({ sessions: config.workspaceId === 'child' ? [{ id: 'log', project_id: 'p1', workspace_id: 'child', workspace_path: '/child', provider: 'codex', title: 'CLI replay', status: 'idle', conversation_mode: 'transcript_replay' }] : [] } as never))
    useAppStore.setState({ openTerminals: [{ id: 'feature-shell', title: 'Feature shell', projectId: 'p1', cwd: '/child' }, { id: 'unknown-shell', title: 'Unscoped shell', projectId: 'p1' }] })
    render(<ProjectWorkspaceTree query="" onSelect={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Open codex transcript CLI replay' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open codex transcript CLI replay' })).toHaveTextContent('idle')
    expect(screen.getByRole('status', { name: 'Terminal tab Feature shell; runtime state unverified' })).toBeVisible()
    expect(screen.queryByRole('status', { name: 'Terminal tab Unscoped shell; runtime state unverified' })).toBeNull()
    expect(screen.getByText('runtime unverified')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Archive conversation CLI replay' })).toBeVisible()
  })
})
