import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createIssue, createProjectGitHubIssue, deleteIssue, fetchIssues, fetchIssueDetail, updateIssue, updateProjectGitHubIssue, type IssueListItem } from '@core/api/client'
import { useAppStore, resetAppStore } from '@core/store'
import { useIssueActions } from './use-issue-actions'

vi.mock('@core/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@core/api/client')>(),
  fetchIssueDetail: vi.fn(),
  createIssue: vi.fn(), deleteIssue: vi.fn(), fetchIssues: vi.fn(async () => []),
  updateIssue: vi.fn(async () => ({})), updateProjectGitHubIssue: vi.fn(async () => ({})),
  createProjectGitHubIssue: vi.fn(),
}))
const config = { baseUrl: 'http://localhost:4010', apiToken: 'fixture' }
const owner = { ...config, projectId: 'p2' }
function setup() {
  const opts = {
    onRefresh: vi.fn(async () => {}), executeIssueLookup: vi.fn(async () => {}), issueLookupId: '',
    setIssueLookupId: vi.fn(), setIssueLookupResult: vi.fn(), setIssueLookupError: vi.fn(),
    setIssueLookupPending: vi.fn(), setErrorMessage: vi.fn(), setStatusMessage: vi.fn(),
  }
  const hook = renderHook(() => useIssueActions(config, opts))
  return { ...hook, opts }
}
beforeEach(() => {
  resetAppStore()
  vi.clearAllMocks()
  useAppStore.setState({ config, activeProjectId: 'p2', allBoardIssues: [
    { id: 'gh-one', identifier: 'GH-7', project_id: 'p1', title: 'Wrong project', state: 'Backlog' },
    { id: 'gh-two', identifier: 'GH-7', project_id: 'p2', title: 'Right project', state: 'Backlog' },
  ] })
})

describe('GitHub task mutation ownership', () => {
  beforeEach(() => {
    const backlog = useAppStore.getState().allBoardIssues.map(issue => ({ ...issue, url: `https://github.com/owner/${issue.project_id}/issues/7` }))
    useAppStore.setState({ projects: [
      { id: 'p1', name: 'One', root_path: '/one', remote_url: '', github_owner: 'owner', github_repo: 'p1', github_token: 'fixture' },
      { id: 'p2', name: 'Two', root_path: '/two', remote_url: '', github_owner: 'owner', github_repo: 'p2', github_token: 'fixture' },
    ], selectedProjectID: 'p2', githubBacklogIssues: backlog, allBoardIssues: backlog })
  })
  it('promotes the selected repository issue and links its exact existing GitHub URL', async () => {
    vi.mocked(createIssue).mockResolvedValue({ id: 'local', identifier: 'ORC-1', project_id: 'p2', state: 'Backlog' })
    const { result } = setup()
    await act(() => result.current.handleIssueUpdate('GH-7', { state: 'Backlog' }))
    expect(createIssue).toHaveBeenCalledWith(config, expect.objectContaining({ project_id: 'p2', title: 'Right project' }))
    expect(updateIssue).toHaveBeenCalledWith(config, 'ORC-1', { url: 'https://github.com/owner/p2/issues/7' })
    expect(updateProjectGitHubIssue).not.toHaveBeenCalled()
  })
  it('closes and dismisses only the selected stable virtual issue', async () => {
    const { result } = setup()
    await act(() => result.current.handleIssueDelete('gh-two'))
    expect(updateProjectGitHubIssue).toHaveBeenCalledWith(config, 'p2', 7, { state: 'closed' })
    expect(deleteIssue).not.toHaveBeenCalled()
    expect(useAppStore.getState().githubBacklogIssues).toEqual([expect.objectContaining({ id: 'gh-one', project_id: 'p1' })])
  })
  it('fails closed for ambiguous labels within the selected project', async () => {
    useAppStore.setState({ allBoardIssues: [...useAppStore.getState().allBoardIssues, { id: 'duplicate', identifier: 'GH-7', project_id: 'p2', state: 'Backlog' }] })
    const { result, opts } = setup()
    await act(() => result.current.handleIssueUpdate('GH-7', { title: 'Change' }))
    expect(createIssue).not.toHaveBeenCalled()
    expect(updateIssue).not.toHaveBeenCalled()
    expect(opts.setErrorMessage).toHaveBeenCalledWith(expect.stringContaining('ambiguous'))
  })
  it('refuses a GitHub URL for a different registered repository before promotion', async () => {
    useAppStore.setState({ allBoardIssues: useAppStore.getState().allBoardIssues.map(issue => issue.project_id === 'p2' ? { ...issue, url: 'https://github.com/owner/p1/issues/7' } : issue) })
    const { result, opts } = setup()
    await act(() => result.current.handleIssueUpdate('gh-two', { title: 'Change' }))
    expect(createIssue).not.toHaveBeenCalled()
    expect(opts.setErrorMessage).toHaveBeenCalledWith(expect.stringContaining('does not match'))
  })
  it('stops promotion follow-up after a backend switch without linking or replaying', async () => {
    let resolve!: (value: IssueListItem) => void
    vi.mocked(createIssue).mockImplementation(() => new Promise(done => { resolve = done }))
    const { result, opts } = setup()
    let mutation!: Promise<void>
    act(() => { mutation = result.current.handleIssueUpdate('gh-two', { title: 'Change' }) })
    act(() => useAppStore.setState({ config: { ...config, apiToken: 'other' } }))
    await act(async () => { resolve({ identifier: 'ORC-1', project_id: 'p2', state: 'Backlog' }); await mutation })
    expect(updateIssue).not.toHaveBeenCalled()
    expect(fetchIssues).not.toHaveBeenCalled()
    expect(opts.setErrorMessage).toHaveBeenCalledWith(expect.stringContaining('may have landed'))
  })
  it('retains the virtual task when closing its GitHub issue fails', async () => {
    vi.mocked(updateProjectGitHubIssue).mockRejectedValueOnce(new Error('request failed'))
    const { result, opts } = setup()
    await act(async () => { await expect(result.current.handleIssueDelete('gh-two')).rejects.toThrow('request failed') })
    expect(useAppStore.getState().githubBacklogIssues).toHaveLength(2)
    expect(deleteIssue).not.toHaveBeenCalled()
    expect(opts.setErrorMessage).toHaveBeenCalledWith(expect.stringContaining('request failed'))
  })
  it('does not publish a new GitHub issue after task creation changes backend', async () => {
    let resolve!: (value: IssueListItem) => void
    vi.mocked(createIssue).mockImplementation(() => new Promise(done => { resolve = done }))
    const { result, opts } = setup()
    let mutation!: Promise<void>
    act(() => { mutation = result.current.handleTaskSubmit({ title: 'New', description: '', assignee_id: '', project_id: 'p2', state: 'Backlog' }) })
    act(() => useAppStore.setState({ config: { ...config, baseUrl: 'http://localhost:4020' } }))
    await act(async () => { resolve({ id: 'new', identifier: 'ORC-2', project_id: 'p2', state: 'Backlog' }); await mutation })
    expect(createProjectGitHubIssue).not.toHaveBeenCalled()
    expect(opts.setErrorMessage).toHaveBeenCalledWith(expect.stringContaining('may have landed'))
  })
  it('does not link a promoted task returned with the wrong project owner', async () => {
    vi.mocked(createIssue).mockResolvedValue({ id: 'wrong', identifier: 'ORC-2', project_id: 'p1', state: 'Backlog' })
    const { result, opts } = setup()
    await act(() => result.current.handleIssueUpdate('gh-two', { title: 'Change' }))
    expect(updateIssue).not.toHaveBeenCalled()
    expect(opts.setErrorMessage).toHaveBeenCalledWith(expect.stringContaining('does not match'))
  })
  it('does not dismiss the task after its pending close changes project', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof updateProjectGitHubIssue>>) => void
    vi.mocked(updateProjectGitHubIssue).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { result } = setup()
    let mutation!: Promise<void>
    act(() => { mutation = result.current.handleIssueDelete('gh-two') })
    act(() => useAppStore.setState({ selectedProjectID: 'p1', activeProjectId: 'p1' }))
    await act(async () => { resolve({ number: 7, title: 'Right project', body: '', state: 'closed', html_url: 'https://github.com/owner/p2/issues/7', user: { login: 'fixture', avatar_url: '' }, labels: [], created_at: '', updated_at: '' }); await expect(mutation).rejects.toThrow('may have landed') })
    expect(useAppStore.getState().githubBacklogIssues).toHaveLength(2)
  })
})
describe('project-owned task inspection', () => {
  it('resolves repeated GitHub labels inside the supplied project', async () => {
    const { result, opts } = setup()
    await act(() => result.current.handleInspectIssueFromList('GH-7', owner))
    expect(opts.setIssueLookupResult).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'gh-two', project_id: 'p2' }))
    expect(fetchIssueDetail).not.toHaveBeenCalled()
  })
  it('uses the stable GitHub cache ID and refuses ambiguous unscoped labels', async () => {
    const { result, opts } = setup()
    await act(() => result.current.handleInspectIssueFromList('gh-two', owner))
    expect(opts.setIssueLookupResult).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'gh-two' }))
    await act(() => result.current.handleInspectIssueFromList('GH-7'))
    expect(opts.setIssueLookupResult).toHaveBeenLastCalledWith(null)
    expect(opts.setIssueLookupError).toHaveBeenLastCalledWith(expect.stringContaining('more than one project'))
  })
  it('rejects a fetched task owned by another project without changing explorer root', async () => {
    vi.mocked(fetchIssueDetail).mockResolvedValue({ id: 'stable', project_id: 'p1', state: 'Todo' })
    const { result, opts } = setup()
    await act(() => result.current.handleInspectIssueFromList('stable', owner))
    expect(fetchIssueDetail).toHaveBeenCalledWith(config, 'stable')
    expect(opts.setIssueLookupResult).toHaveBeenLastCalledWith(null)
    expect(opts.setIssueLookupError).toHaveBeenLastCalledWith(expect.stringContaining('another project'))
    expect(useAppStore.getState().explorerRoot).toBeNull()
  })
  it('discards late details after the backend identity changes', async () => {
    let resolve!: (value: IssueListItem) => void
    vi.mocked(fetchIssueDetail).mockImplementation(() => new Promise(done => { resolve = done }))
    const { result, opts } = setup()
    let lookup!: Promise<void>
    act(() => { lookup = result.current.handleInspectIssueFromList('stable', owner) })
    act(() => useAppStore.setState({ config: { ...config, apiToken: 'different' } }))
    await act(async () => { resolve({ id: 'stable', project_id: 'p2', state: 'Todo' }); await lookup })
    expect(opts.setIssueLookupResult).toHaveBeenLastCalledWith(null)
    expect(opts.setIssueLookupResult).toHaveBeenCalledTimes(1)
  })
})
