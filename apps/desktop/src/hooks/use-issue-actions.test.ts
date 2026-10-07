import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createIssue, createProjectGitHubIssue, deleteIssue, fetchIssues, fetchIssueDetail, fetchPRSnapshot, postOrchestratorControl, stopIssueSession, updateIssue, updateProjectGitHubIssue, type IssueListItem } from '@core/api/client'
import { useAppStore, resetAppStore } from '@core/store'
import { useIssueActions } from './use-issue-actions'

vi.mock('@core/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@core/api/client')>(),
  fetchIssueDetail: vi.fn(),
  fetchPRSnapshot: vi.fn(),
  postOrchestratorControl: vi.fn(),
  createIssue: vi.fn(), deleteIssue: vi.fn(), fetchIssues: vi.fn(async () => []),
  updateIssue: vi.fn(async () => ({})), updateProjectGitHubIssue: vi.fn(async () => ({})),
  createProjectGitHubIssue: vi.fn(),
  stopIssueSession: vi.fn(),
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

describe('Task stop retains work and holds execution', () => {
  it('confirms the held task without a second state or feedback mutation', async () => {
    const localTask = { id: 'local-task', identifier: 'ORC-1', project_id: 'p2', state: 'In Progress', plan: 'Keep this plan', feedback: 'Keep this feedback', pr_url: 'https://github.com/owner/repo/pull/7' }
    useAppStore.setState({ allBoardIssues: [localTask] })
    vi.mocked(stopIssueSession).mockResolvedValue(undefined)
    vi.mocked(fetchIssueDetail).mockResolvedValue({ ...localTask, state: 'Backlog' })
    const { result, opts } = setup()
    await act(() => result.current.handleStopSession('local-task'))
    expect(stopIssueSession).toHaveBeenCalledWith(config, 'local-task', undefined)
    expect(updateIssue).not.toHaveBeenCalled()
    expect(opts.setStatusMessage).toHaveBeenCalledWith(expect.stringContaining('Work retained in Backlog'))
    expect(opts.executeIssueLookup).toHaveBeenCalledWith('local-task')
  })
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

describe('human plan approval control', () => {
  const request = { operation: 'approve_plan' as const, project_id: 'p2', task_id: 'local-1', expected_state: 'Todo' as const, expected_plan_hash: 'sha256:plan', request_id: '8fd9e3ac-1f40-4ef6-b928-d06ca2af442e' }
  const localTask = { id: 'local-1', identifier: 'ORC-1', project_id: 'p2', state: 'Todo', plan_gate: { status: 'awaiting_approval', plan_hash: 'sha256:plan' } }

  beforeEach(() => {
    useAppStore.setState({ selectedProjectID: 'p2', allBoardIssues: [localTask] })
    vi.mocked(postOrchestratorControl).mockReset()
    vi.mocked(fetchIssueDetail).mockReset()
    vi.mocked(fetchIssueDetail).mockResolvedValue(localTask as IssueListItem)
  })

  it('checks the exact ready plan, records a stable approval, and refreshes its authoritative state', async () => {
    vi.mocked(postOrchestratorControl)
      .mockRejectedValueOnce(Object.assign(new Error('receipt not found'), { code: 'receipt_not_found' }))
      .mockResolvedValueOnce({ success: true, request_id: request.request_id, receipt_status: 'completed', data: { effect: 'plan_approved' } })
    vi.mocked(fetchIssueDetail)
      .mockResolvedValueOnce(localTask as IssueListItem)
      .mockResolvedValueOnce({ ...localTask, state: 'In Progress', plan_gate: { status: 'approved', plan_hash: 'sha256:plan' } } as IssueListItem)
    const { result, opts } = setup()

    await act(() => result.current.handleApprovePlan(request))

    expect(postOrchestratorControl).toHaveBeenNthCalledWith(1, config, { operation: 'receipt', request_id: request.request_id })
    expect(postOrchestratorControl).toHaveBeenNthCalledWith(2, config, request)
    expect(fetchIssueDetail).toHaveBeenNthCalledWith(1, config, 'ORC-1')
    expect(fetchIssueDetail).toHaveBeenNthCalledWith(2, config, 'ORC-1')
    expect(opts.setIssueLookupResult).toHaveBeenCalledWith(expect.objectContaining({ state: 'In Progress', plan_gate: { status: 'approved', plan_hash: 'sha256:plan' } }))
    expect(useAppStore.getState().allBoardIssues).toEqual([])
    expect(opts.setStatusMessage).toHaveBeenCalledWith(expect.stringContaining('Execution is queued'))
  })

  it('reconciles an unknown outcome by the same request ID and never resends approval', async () => {
    vi.mocked(postOrchestratorControl)
      .mockRejectedValueOnce(Object.assign(new Error('unknown'), { code: 'mutation_unknown' }))
      .mockRejectedValueOnce(Object.assign(new Error('still pending'), { code: 'mutation_unknown' }))
    const { result } = setup()

    await expect(act(() => result.current.handleApprovePlan(request))).rejects.toThrow('outcome is still unknown')

    expect(postOrchestratorControl).toHaveBeenCalledTimes(1)
    expect(postOrchestratorControl).toHaveBeenCalledWith(config, { operation: 'receipt', request_id: request.request_id })
    expect(fetchIssueDetail).not.toHaveBeenCalled()
  })

  it('confirms a timed-out approval from its completed receipt without replaying the mutation', async () => {
    vi.mocked(postOrchestratorControl)
      .mockRejectedValueOnce(Object.assign(new Error('receipt not found'), { code: 'receipt_not_found' }))
      .mockRejectedValueOnce(Object.assign(new Error('connection lost'), { code: 'mutation_unknown' }))
      .mockResolvedValueOnce({ success: true, request_id: request.request_id, receipt_status: 'completed', data: { effect: 'plan_approved' } })
    vi.mocked(fetchIssueDetail)
      .mockResolvedValueOnce(localTask as IssueListItem)
      .mockResolvedValueOnce({ ...localTask, state: 'In Progress', plan_gate: { status: 'approved', plan_hash: 'sha256:plan' } } as IssueListItem)
    const { result, opts } = setup()

    await act(() => result.current.handleApprovePlan(request))

    expect(postOrchestratorControl).toHaveBeenNthCalledWith(2, config, request)
    expect(postOrchestratorControl).toHaveBeenNthCalledWith(3, config, { operation: 'receipt', request_id: request.request_id })
    expect(postOrchestratorControl).toHaveBeenCalledTimes(3)
    expect(opts.setIssueLookupResult).toHaveBeenCalledWith(expect.objectContaining({ state: 'In Progress' }))
  })

  it('refuses stale gate data before sending a mutation', async () => {
    vi.mocked(postOrchestratorControl).mockRejectedValueOnce(Object.assign(new Error('receipt not found'), { code: 'receipt_not_found' }))
    vi.mocked(fetchIssueDetail).mockResolvedValueOnce({ ...localTask, plan_gate: { status: 'stale', plan_hash: 'sha256:other' } } as IssueListItem)
    const { result } = setup()

    await expect(act(() => result.current.handleApprovePlan(request))).rejects.toThrow('plan or task state changed')
    expect(postOrchestratorControl).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().allBoardIssues).toEqual([localTask])
  })
})

describe('provider-neutral replan control', () => {
  const request = { operation: 'replan' as const, project_id: 'p2', task_id: 'local-1', expected_state: 'Review' as const, expected_plan_hash: 'sha256:plan', feedback: 'Handle empty input', request_id: '7bc2bdea-428c-47af-829b-c31442893e4c' }
  const reviewTask = { id: 'local-1', identifier: 'ORC-1', project_id: 'p2', state: 'Review', plan_gate: { status: 'approved', plan_hash: 'sha256:plan' } }

  beforeEach(() => {
    useAppStore.setState({ selectedProjectID: 'p2', allBoardIssues: [reviewTask] })
    vi.mocked(postOrchestratorControl).mockReset()
    vi.mocked(fetchIssueDetail).mockReset()
    vi.mocked(fetchIssueDetail).mockResolvedValue(reviewTask as IssueListItem)
  })

  it('persists exact feedback, confirms Todo, and reports replan as queued but not started', async () => {
    vi.mocked(postOrchestratorControl)
      .mockRejectedValueOnce(Object.assign(new Error('receipt not found'), { code: 'receipt_not_found' }))
      .mockResolvedValueOnce({ success: true, request_id: request.request_id, receipt_status: 'completed', data: { effect: 'replan_requested', execution: 'not_started' } })
    vi.mocked(fetchIssueDetail)
      .mockResolvedValueOnce(reviewTask as IssueListItem)
      .mockResolvedValueOnce({ ...reviewTask, state: 'Todo', feedback: request.feedback, plan_gate: { status: 'stale', plan_hash: 'sha256:next' } } as IssueListItem)
    const { result, opts } = setup()

    await act(() => result.current.handleReplan(request))

    expect(postOrchestratorControl).toHaveBeenNthCalledWith(1, config, { operation: 'receipt', request_id: request.request_id })
    expect(postOrchestratorControl).toHaveBeenNthCalledWith(2, config, request)
    expect(opts.setIssueLookupResult).toHaveBeenCalledWith(expect.objectContaining({ state: 'Todo', feedback: request.feedback }))
    expect(opts.setStatusMessage).toHaveBeenCalledWith(expect.stringContaining('has not yet been observed'))
  })

  it('refuses changed task context before requesting a replan', async () => {
    vi.mocked(postOrchestratorControl).mockRejectedValueOnce(Object.assign(new Error('receipt not found'), { code: 'receipt_not_found' }))
    vi.mocked(fetchIssueDetail).mockResolvedValueOnce({ ...reviewTask, plan_gate: { status: 'stale', plan_hash: 'sha256:changed' } } as IssueListItem)
    const { result } = setup()

    await expect(act(() => result.current.handleReplan(request))).rejects.toThrow('context hash changed')
    expect(postOrchestratorControl).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().allBoardIssues).toEqual([reviewTask])
  })
})

describe('PR review gate controls', () => {
  const prUrl = 'https://github.com/owner/repo/pull/12'
  const headSha = 'a'.repeat(40)
  const project = { id: 'p2', name: 'Two', root_path: '/two', remote_url: '', github_owner: 'owner', github_repo: 'repo' }
  const reviewTask = { id: 'local-review', identifier: 'ORC-12', project_id: 'p2', state: 'Review', pr_url: prUrl, review_gate: { status: 'not_reviewed' } }
  const snapshot = (merged_at: string | null = null, sha = headSha) => ({ pr: { number: 12, html_url: prUrl, state: merged_at ? 'closed' : 'open', merged_at, head: { sha } }, diff: 'diff' })

  beforeEach(() => {
    useAppStore.setState({ selectedProjectID: 'p2', projects: [project], allBoardIssues: [reviewTask] })
    vi.mocked(postOrchestratorControl).mockReset()
    vi.mocked(fetchIssueDetail).mockReset()
    vi.mocked(fetchPRSnapshot).mockReset()
    vi.mocked(fetchIssues).mockResolvedValue([])
  })

  it('requests an asynchronous review only from a registered available provider and exact fresh head', async () => {
    const attemptId = 'a85d6f1e-a459-4b3d-8108-9a9b9ac92f41'
    vi.mocked(fetchIssueDetail)
      .mockResolvedValueOnce(reviewTask as IssueListItem)
      .mockResolvedValueOnce({ ...reviewTask, review_gate: { status: 'running', pr_url: prUrl, head_sha: headSha, attempt_id: attemptId, reviewer_provider: 'CODEX', reviewer_agent_id: 'provider-default' } } as IssueListItem)
    vi.mocked(fetchPRSnapshot).mockResolvedValue(snapshot() as Awaited<ReturnType<typeof fetchPRSnapshot>>)
    vi.mocked(postOrchestratorControl)
      .mockResolvedValueOnce({ success: true, data: { providers: [
        { provider: 'CODEX', available: true, reviewer_agent_id: 'provider-default' },
        { provider: 'CLAUDE', available: false, reason: 'No verified reviewer command', reviewer_agent_id: 'provider-default' },
      ] } })
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'receipt_not_found' }))
      .mockImplementationOnce(async (_config, request) => ({ success: true, request_id: 'request_id' in request ? request.request_id : '', receipt_status: 'completed', data: { review_gate: { status: 'running', pr_url: prUrl, head_sha: headSha, attempt_id: attemptId, reviewer_provider: 'CODEX', reviewer_agent_id: 'provider-default' } } }))

    const { result, opts } = setup()
    await act(() => result.current.handleRequestReview('local-review', 'CODEX'))

    expect(postOrchestratorControl).toHaveBeenNthCalledWith(1, config, { operation: 'reviewers' })
    expect(postOrchestratorControl).toHaveBeenNthCalledWith(3, config, expect.objectContaining({
      operation: 'request_review', project_id: 'p2', task_id: 'local-review', expected_state: 'Review',
      expected_pr_url: prUrl, expected_head_sha: headSha, provider: 'CODEX', reviewer_agent_id: 'provider-default',
      request_id: expect.any(String),
    }))
    expect(opts.setStatusMessage).toHaveBeenCalledWith(expect.stringContaining('reviewer completion is not yet observed'))
    expect(useAppStore.getState().allBoardIssues).toEqual([])
  })

  it('refuses a closed pull request before mutation', async () => {
    vi.mocked(fetchIssueDetail).mockResolvedValueOnce(reviewTask as IssueListItem)
    vi.mocked(postOrchestratorControl).mockResolvedValueOnce({ success: true, data: { providers: [{ provider: 'CODEX', available: true, reviewer_agent_id: 'provider-default' }] } })
    vi.mocked(fetchPRSnapshot).mockResolvedValue(snapshot('2026-10-05T10:00:00Z') as Awaited<ReturnType<typeof fetchPRSnapshot>>)
    const { result } = setup()

    await expect(act(() => result.current.handleRequestReview('local-review', 'CODEX'))).rejects.toThrow('Pull request is not open')
    expect(postOrchestratorControl).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().allBoardIssues).toEqual([reviewTask])
  })

  it('approves only the exact clean review attempt and keeps the task in Review', async () => {
    const attemptId = 'af420c9f-60ba-4427-a2b2-9750f504bc96'
    const cleanTask = { ...reviewTask, review_gate: { status: 'awaiting_human_approval', pr_url: prUrl, head_sha: headSha, attempt_id: attemptId } }
    const approvedGate = { status: 'approved', pr_url: prUrl, head_sha: headSha, attempt_id: attemptId }
    vi.mocked(fetchIssueDetail)
      .mockResolvedValueOnce(cleanTask as IssueListItem)
      .mockResolvedValueOnce({ ...cleanTask, review_gate: approvedGate } as IssueListItem)
    vi.mocked(fetchPRSnapshot).mockResolvedValue(snapshot() as Awaited<ReturnType<typeof fetchPRSnapshot>>)
    vi.mocked(postOrchestratorControl)
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'receipt_not_found' }))
      .mockImplementationOnce(async (_config, request) => ({ success: true, request_id: 'request_id' in request ? request.request_id : '', receipt_status: 'completed', data: { task_state: 'Review', review_gate: approvedGate } }))

    const { result, opts } = setup()
    await act(() => result.current.handleApproveReview('local-review'))

    expect(postOrchestratorControl).toHaveBeenNthCalledWith(2, config, expect.objectContaining({
      operation: 'approve_review', project_id: 'p2', task_id: 'local-review', expected_state: 'Review',
      expected_pr_url: prUrl, expected_head_sha: headSha, review_attempt_id: attemptId, request_id: expect.any(String),
    }))
    expect(opts.setIssueLookupResult).toHaveBeenCalledWith(expect.objectContaining({ state: 'Review', review_gate: approvedGate }))
    expect(opts.setStatusMessage).toHaveBeenCalledWith(expect.stringContaining('task remains in Review'))
  })

  it('keeps an approved review in Review and only completes after the exact approved head is merged', async () => {
    const attemptId = '08d2efc2-6a82-48d0-b25c-5c9476bb4ed4'
    const approvedTask = { ...reviewTask, review_gate: { status: 'approved', pr_url: prUrl, head_sha: headSha, attempt_id: attemptId } }
    vi.mocked(fetchIssueDetail)
      .mockResolvedValueOnce(approvedTask as IssueListItem)
      .mockResolvedValueOnce({ ...approvedTask, state: 'Done' } as IssueListItem)
    vi.mocked(fetchPRSnapshot).mockResolvedValue(snapshot('2026-10-05T10:00:00Z') as Awaited<ReturnType<typeof fetchPRSnapshot>>)
    vi.mocked(postOrchestratorControl)
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'receipt_not_found' }))
      .mockImplementationOnce(async (_config, request) => ({ success: true, request_id: 'request_id' in request ? request.request_id : '', receipt_status: 'completed', data: { task_state: 'Done', review_gate: { status: 'approved', pr_url: prUrl, head_sha: headSha, attempt_id: attemptId } } }))

    const { result, opts } = setup()
    await act(() => result.current.handleCompleteReview('local-review'))

    expect(postOrchestratorControl).toHaveBeenNthCalledWith(2, config, expect.objectContaining({
      operation: 'complete_review', project_id: 'p2', task_id: 'local-review', expected_state: 'Review',
      expected_pr_url: prUrl, expected_head_sha: headSha, review_attempt_id: attemptId, request_id: expect.any(String),
    }))
    expect(opts.setIssueLookupResult).toHaveBeenCalledWith(expect.objectContaining({ state: 'Done' }))
    expect(opts.setStatusMessage).toHaveBeenCalledWith(expect.stringContaining('confirmed merged'))
  })
})

describe('GitHub backlog inspection', () => {
  it('never asks the backend for a GitHub issue that left the backlog', async () => {
    useAppStore.setState({ allBoardIssues: [] })
    const { result, opts } = setup()
    await act(() => result.current.handleInspectIssueFromList('GH-188'))
    expect(fetchIssueDetail).not.toHaveBeenCalled()
    expect(opts.executeIssueLookup).not.toHaveBeenCalled()
    expect(opts.setIssueLookupError).toHaveBeenCalledWith(expect.stringContaining('no longer in the backlog'))
  })
})
