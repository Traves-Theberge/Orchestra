import { useRef, useState } from 'react'
import {
  createIssue,
  deleteIssue,
  fetchIssues,
  fetchIssueDetail,
  fetchPRSnapshot,
  postOrchestratorControl,
  fetchProjectGitHubIssues,
  fetchSessionDetail,
  stopIssueSession,
  toDisplayError,
  updateIssue,
  updateProjectGitHubIssue,
  createProjectGitHubIssue,
  type BackendConfig,
  type IssueCreatePayload,
  type IssueUpdatePayload,
  type IssueListItem,
  type OrchestratorControlRequest,
} from '@core/api/client'
import type { SessionDetail } from '@core/api/types'
import type { IssueDetailResult } from '@features/issue-detail/types'
import { useAppStore } from '@core/store'

export type IssueInspectionOwner = { projectId: string; baseUrl: string; apiToken: string }

interface UseIssueActionsOpts {
  onRefresh: () => Promise<void>
  executeIssueLookup: (id: string) => Promise<void>
  issueLookupId: string
  setIssueLookupId: (id: string) => void
  setIssueLookupResult: (r: IssueDetailResult | null) => void
  setIssueLookupError: (e: string) => void
  setIssueLookupPending: (p: boolean) => void
  setErrorMessage: (m: string) => void
  setStatusMessage: (m: string) => void
}

interface UseIssueActionsResult {
  handleIssueUpdate: (identifier: string, updates: IssueUpdatePayload) => Promise<void>
  handleApprovePlan: (request: Extract<OrchestratorControlRequest, { operation: 'approve_plan' }>) => Promise<void>
  handleReplan: (request: Extract<OrchestratorControlRequest, { operation: 'replan' }>) => Promise<void>
  handleRequestReview: (identifier: string, provider: string) => Promise<void>
  handleApproveReview: (identifier: string) => Promise<void>
  handleCompleteReview: (identifier: string) => Promise<void>
  handleStopSession: (identifier: string, provider?: string) => Promise<void>
  handleCreateIssue: (initialState: string) => void
  handleTaskSubmit: (payload: IssueCreatePayload) => Promise<void>
  handleIssueDelete: (identifier: string) => Promise<void>
  handleInspectIssueFromList: (issueIdentifier: string, owner?: IssueInspectionOwner) => Promise<void>
  handleInspectSession: (sessionId: string) => Promise<void>
  sessionLookupResult: SessionDetail | null
  sessionLookupPending: boolean
  sessionLookupError: string
}

/**
 * Encapsulates all issue CRUD, session management, and inspection handlers.
 * Reads store state via useAppStore.getState() to avoid stale closures.
 */
export function useIssueActions(
  config: BackendConfig | null,
  opts: UseIssueActionsOpts,
): UseIssueActionsResult {
  const [sessionLookupResult, setSessionLookupResult] = useState<SessionDetail | null>(null)
  const [sessionLookupPending, setSessionLookupPending] = useState(false)
  const [sessionLookupError, setSessionLookupError] = useState('')
  const issueInspectionSequence = useRef(0)
  const inspectedOwner = useRef<{ identifier: string; owner: IssueInspectionOwner } | null>(null)
  const reviewRequestIds = useRef(new Map<string, string>())
  const matchesIssue = (issue: IssueListItem, identifier: string) => [issue.id, issue.issue_id, issue.identifier, issue.issue_identifier].includes(identifier)
  const captureTaskTarget = (identifier: string) => {
    const state = useAppStore.getState()
    if (!config || state.config?.baseUrl !== config.baseUrl || state.config.apiToken !== config.apiToken) throw new Error('Backend changed. Refresh this task before changing it.')
    const selectedProject = state.selectedProjectID || (state.projects.some(project => project.id === state.activeProjectId) ? state.activeProjectId : null)
    const inspection = inspectedOwner.current?.identifier === identifier ? inspectedOwner.current.owner : null
    const projectId = inspection?.projectId || selectedProject
    if (inspection && (inspection.baseUrl !== config.baseUrl || inspection.apiToken !== config.apiToken || (selectedProject && selectedProject !== inspection.projectId))) throw new Error('Task context changed. Open it again from its project before changing it.')
    const globalMatches = state.allBoardIssues.filter(issue => matchesIssue(issue, identifier))
    const matches = globalMatches.filter(issue => !projectId || issue.project_id === projectId)
    if (globalMatches.length > 0 && matches.length === 0) throw new Error('Task belongs to another project. Open its workspace before changing it.')
    if (matches.length > 1) throw new Error('Task label is ambiguous. Open its project workspace before changing it.')
    const issue = matches[0]
    const virtual = identifier.startsWith('GH-') || globalMatches.some(issue => (issue.identifier || issue.issue_identifier || '').startsWith('GH-'))
    if (virtual && (!issue?.project_id || !projectId)) throw new Error('GitHub task requires an explicit project. Open its project workspace before changing it.')
    const repositoryKey = (projects: typeof state.projects) => {
      const project = projects.find(project => project.id === (issue?.project_id || projectId))
      return JSON.stringify([project?.id, project?.root_path, project?.github_owner, project?.github_repo])
    }
    const capturedRepository = repositoryKey(state.projects)
    const assertCurrent = () => {
      const current = useAppStore.getState()
      const currentProject = current.selectedProjectID || (current.projects.some(project => project.id === current.activeProjectId) ? current.activeProjectId : null)
      if (current.config?.baseUrl !== config.baseUrl || current.config.apiToken !== config.apiToken || (projectId && currentProject !== projectId) || repositoryKey(current.projects) !== capturedRepository) throw new Error('Task context changed while the request was pending. The action may have landed; refresh its original project before retrying.')
    }
    return { issue, virtual, assertCurrent }
  }
  const linkedGitHubTarget = (issue: IssueListItem) => {
    const project = useAppStore.getState().projects.find(project => project.id === issue.project_id)
    let url: URL
    try { url = new URL(issue.url || '') } catch { throw new Error('GitHub task link is missing or invalid. Refresh its project before changing it.') }
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/)
    if (!project?.github_owner || !project.github_repo || url.protocol !== 'https:' || url.hostname !== 'github.com' || !match || match[1].toLowerCase() !== project.github_owner.toLowerCase() || match[2].toLowerCase() !== project.github_repo.toLowerCase()) throw new Error('GitHub issue link does not match its registered repository. Refresh the project before changing it.')
    return { project, number: Number(match[3]) }
  }
  const pullRequestNumber = (value: string) => {
    let url: URL
    try { url = new URL(value) } catch { throw new Error('Task does not contain a valid pull request URL.') }
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash || !match || `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` !== value) throw new Error('Task pull request URL is not canonical. Refresh the task before review.')
    return Number(match[3])
  }
  const exactReviewSnapshot = async (projectId: string, prUrl: string, expectedHead?: string, requireMerged = false) => {
    const number = pullRequestNumber(prUrl)
    const snapshot = await fetchPRSnapshot(config!, projectId, number)
    const head = snapshot.pr.head.sha || ''
    if (snapshot.pr.number !== number || snapshot.pr.html_url !== prUrl || !/^[a-f0-9]{40}$/i.test(head) || expectedHead && head.toLowerCase() !== expectedHead.toLowerCase()) throw new Error('Fresh pull request snapshot does not match the exact task URL and expected head SHA.')
    if (requireMerged && !snapshot.pr.merged_at) throw new Error('The exact pull request head is not confirmed merged. Task completion was not requested.')
    if (!requireMerged && (snapshot.pr.state !== 'open' || snapshot.pr.merged_at)) throw new Error('Pull request is not open for review. Refresh its current state before continuing.')
    return snapshot.pr
  }
  const reviewReceipt = async (
    key: string,
    buildRequest: (requestId: string) => Extract<OrchestratorControlRequest, { operation: 'request_review' | 'approve_review' | 'complete_review' }>,
  ) => {
    let requestId = reviewRequestIds.current.get(key)
    if (!requestId) {
      requestId = crypto.randomUUID()
      reviewRequestIds.current.set(key, requestId)
    }
    const unknown = () => new Error(`Review action outcome is unknown for request ${requestId}. Refresh this task and reconcile the same receipt before trying again.`)
    try {
      const prior = await postOrchestratorControl(config!, { operation: 'receipt', request_id: requestId })
      if (prior.success && prior.receipt_status === 'completed' && prior.request_id === requestId) return prior
      if (prior.receipt_status === 'pending' || prior.receipt_status === 'unknown') throw unknown()
      reviewRequestIds.current.delete(key)
      throw new Error(prior.error?.message || 'Review action receipt was rejected.')
    } catch (error) {
      const code = (error as { code?: string })?.code
      if (code === 'mutation_unknown') throw unknown()
      if (code !== 'receipt_not_found') {
        if (code && code !== 'request_failed' && code !== 'receipt_unavailable') reviewRequestIds.current.delete(key)
        throw error
      }
    }
    try {
      const result = await postOrchestratorControl(config!, buildRequest(requestId))
      if (result.success && result.receipt_status === 'completed' && result.request_id === requestId) return result
      if (result.receipt_status === 'pending' || result.receipt_status === 'unknown') throw unknown()
      reviewRequestIds.current.delete(key)
      throw new Error(result.error?.message || 'Review action was rejected.')
    } catch (error) {
      const code = (error as { code?: string })?.code
      if (!code || code === 'mutation_unknown' || code === 'request_failed') {
        try {
          const reconciled = await postOrchestratorControl(config!, { operation: 'receipt', request_id: requestId })
          if (reconciled.success && reconciled.receipt_status === 'completed' && reconciled.request_id === requestId) return reconciled
          if (reconciled.receipt_status === 'pending' || reconciled.receipt_status === 'unknown') throw unknown()
          reviewRequestIds.current.delete(key)
          throw new Error(reconciled.error?.message || 'Review action receipt was rejected.')
        } catch (receiptError) {
          if ((receiptError as { code?: string })?.code !== 'receipt_not_found') throw unknown()
        }
        throw unknown()
      }
      reviewRequestIds.current.delete(key)
      throw error
    }
  }

  const handleIssueUpdate = async (identifier: string, updates: IssueUpdatePayload) => {
    if (!config) return
    try {
      const target = captureTaskTarget(identifier)
      // If this is a GitHub backlog issue, promote to local task linked to the SAME GitHub issue
      if (target.virtual) {
        const ghIssue = target.issue
        if (ghIssue) {
          linkedGitHubTarget(ghIssue)
          const updatesRec = updates as Record<string, unknown>
          const newIssue = await createIssue(config, {
            title: updatesRec.title as string || ghIssue.title || '',
            description: updatesRec.description as string || ghIssue.description || '',
            state: updatesRec.state as string || 'Backlog',
            assignee_id: updatesRec.assignee_id as string || '',
            project_id: ghIssue.project_id || '',
            provider: updatesRec.provider as string || '',
          })
          target.assertCurrent()
          if (newIssue.project_id !== ghIssue.project_id || !newIssue.identifier) throw new Error('Created task response does not match the original project. The task may have been created; inspect that project before retrying.')
          const ghUrl = ghIssue.url || ''
          if (newIssue?.identifier && ghUrl) {
            await updateIssue(config, newIssue.identifier, { url: ghUrl } as IssueUpdatePayload)
            target.assertCurrent()
          }
          opts.setStatusMessage(`${identifier} linked to ${newIssue?.identifier || 'local task'}`)
          const updatedIssues = await fetchIssues(config)
          target.assertCurrent()
          useAppStore.getState().setBoardIssues(updatedIssues)
          await opts.onRefresh()
          target.assertCurrent()
          if (newIssue?.identifier) {
            opts.setIssueLookupId(newIssue.identifier)
            await opts.executeIssueLookup(newIssue.identifier)
          }
          return
        }
      }

      await updateIssue(config, identifier, updates)
      target.assertCurrent()

      const updatesRec = updates as Record<string, unknown>
      const issue = target.issue
      if (issue?.project_id && issue.url?.includes('github.com')) {
        const { project, number } = linkedGitHubTarget(issue)
        const sync = {
          ...(updatesRec.title ? { title: updatesRec.title as string } : {}),
          ...(updatesRec.description ? { body: updatesRec.description as string } : {}),
          ...(updatesRec.state && (updatesRec.state === 'Done' || issue.state === 'Done') ? { state: updatesRec.state === 'Done' ? 'closed' : 'open' } : {}),
        }
        if (project.github_token && Object.keys(sync).length > 0) {
          await updateProjectGitHubIssue(config, project.id, number, sync)
          target.assertCurrent()
        }
      }
      const updatedIssues = await fetchIssues(config)
      target.assertCurrent()
      useAppStore.getState().setBoardIssues(updatedIssues)
      await opts.onRefresh()
      target.assertCurrent()
      await opts.executeIssueLookup(identifier)
    } catch (err) {
      opts.setErrorMessage(`update issue failed: ${toDisplayError(err)}`)
    }
  }

  const handleApprovePlan: UseIssueActionsResult['handleApprovePlan'] = async (request) => {
    if (!config) throw new Error('Backend unavailable. The plan was not approved.')
    const target = captureTaskTarget(request.task_id)
    if (target.virtual || !target.issue) throw new Error('Plan approval is available only for a local Orchestra task.')
    const identity = target.issue
    const stableId = identity.id || identity.issue_id || ''
    const identifier = identity.identifier || identity.issue_identifier || stableId
    if (!stableId || stableId !== request.task_id || identity.project_id !== request.project_id || !identifier) throw new Error('Task identity changed. Reopen the task in its project before approving the plan.')

    let receipt
    try {
      const prior = await postOrchestratorControl(config, { operation: 'receipt', request_id: request.request_id })
      if (!prior.success || prior.receipt_status !== 'completed' || prior.request_id !== request.request_id || prior.data?.effect !== 'plan_approved') {
        throw new Error(prior.error?.message || `Approval receipt ${request.request_id} is not complete; refresh this task before taking another action.`)
      }
      receipt = prior
    } catch (error) {
      target.assertCurrent()
      const code = (error as { code?: string })?.code
      if (code === 'mutation_unknown') throw new Error(`Approval outcome is still unknown for request ${request.request_id}. Refresh the task and inspect this receipt before trying again.`)
      if (code !== 'receipt_not_found') throw error
    }

    if (!receipt) {
      const fresh = await fetchIssueDetail(config, identifier)
      target.assertCurrent()
      const freshId = fresh.id || fresh.issue_id || ''
      const freshGate = fresh.plan_gate as { status?: string; plan_hash?: string } | undefined
      if (freshId !== request.task_id || fresh.project_id !== request.project_id) throw new Error('Fresh task read returned a different task or project. No approval was sent.')
      if (fresh.state !== 'Todo' || freshGate?.status !== 'awaiting_approval' || freshGate.plan_hash !== request.expected_plan_hash) throw new Error('The plan or task state changed. Refresh the task before approving the current plan.')

      const approveRequest: OrchestratorControlRequest = request
      try {
        receipt = await postOrchestratorControl(config, approveRequest)
      } catch (error) {
        target.assertCurrent()
        const code = (error as { code?: string })?.code
        if (code && code !== 'mutation_unknown') throw error
        try {
          receipt = await postOrchestratorControl(config, { operation: 'receipt', request_id: request.request_id })
        } catch {
          throw new Error(`Approval outcome is unknown for request ${request.request_id}. Refresh this task and reconcile the same receipt before trying again.`)
        }
      }
    }
    target.assertCurrent()
    if (!receipt.success || receipt.receipt_status !== 'completed' || receipt.request_id !== request.request_id || receipt.data?.effect !== 'plan_approved') {
      const message = receipt.error?.message || (receipt.receipt_status === 'pending' || receipt.receipt_status === 'unknown'
        ? `Approval outcome is still unknown for request ${request.request_id}. Refresh the task and inspect this receipt before trying again.`
        : 'The approval receipt was not confirmed. Refresh the task before trying again.')
      throw new Error(message)
    }

    const confirmed = await fetchIssueDetail(config, identifier)
    target.assertCurrent()
    const confirmedId = confirmed.id || confirmed.issue_id || ''
    const confirmedGate = confirmed.plan_gate as { status?: string; plan_hash?: string } | undefined
    if (confirmedId !== request.task_id || confirmed.project_id !== request.project_id || confirmed.state !== 'In Progress' || confirmedGate?.status !== 'approved' || confirmedGate.plan_hash !== request.expected_plan_hash) {
      throw new Error(`Approval receipt ${request.request_id} completed, but the refreshed task does not confirm the approved plan. Refresh this task before taking another action.`)
    }
    opts.setIssueLookupResult({ ...identity, ...confirmed } as IssueDetailResult)
    opts.setStatusMessage(`Plan approved for ${identifier}. Execution is queued; worker activity is not yet confirmed.`)
    const issues = await fetchIssues(config)
    target.assertCurrent()
    useAppStore.getState().setBoardIssues(issues)
  }

  const handleReplan: UseIssueActionsResult['handleReplan'] = async (request) => {
    if (!config) throw new Error('Backend unavailable. The replan was not requested.')
    const feedback = request.feedback.trim()
    if (!feedback) throw new Error('Enter feedback before requesting a replan.')
    const target = captureTaskTarget(request.task_id)
    if (target.virtual || !target.issue) throw new Error('Replanning is available only for a local Orchestra task.')
    const identity = target.issue
    const stableId = identity.id || identity.issue_id || ''
    const identifier = identity.identifier || identity.issue_identifier || stableId
    if (!stableId || stableId !== request.task_id || identity.project_id !== request.project_id || !identifier) throw new Error('Task identity changed. Reopen the task in its project before requesting a replan.')

    let receipt
    try {
      const prior = await postOrchestratorControl(config, { operation: 'receipt', request_id: request.request_id })
      if (!prior.success || prior.receipt_status !== 'completed' || prior.request_id !== request.request_id || prior.data?.effect !== 'replan_requested') {
        throw new Error(prior.error?.message || `Replan receipt ${request.request_id} is not complete; refresh this task before taking another action.`)
      }
      receipt = prior
    } catch (error) {
      target.assertCurrent()
      const code = (error as { code?: string })?.code
      if (code === 'mutation_unknown') throw new Error(`Replan outcome is still unknown for request ${request.request_id}. Refresh the task and inspect this receipt before trying again.`)
      if (code !== 'receipt_not_found') throw error
    }

    if (!receipt) {
      const fresh = await fetchIssueDetail(config, identifier)
      target.assertCurrent()
      const freshId = fresh.id || fresh.issue_id || ''
      const freshGate = fresh.plan_gate as { status?: string; plan_hash?: string } | undefined
      if (freshId !== request.task_id || fresh.project_id !== request.project_id) throw new Error('Fresh task read returned a different task or project. No replan was sent.')
      if (fresh.state !== request.expected_state || freshGate?.status === 'unsupported' || freshGate?.plan_hash !== request.expected_plan_hash) throw new Error('The task state, planning capability, or context hash changed. Refresh before requesting a replan.')

      try {
        receipt = await postOrchestratorControl(config, request)
      } catch (error) {
        target.assertCurrent()
        const code = (error as { code?: string })?.code
        if (code && code !== 'mutation_unknown') throw error
        try {
          receipt = await postOrchestratorControl(config, { operation: 'receipt', request_id: request.request_id })
        } catch {
          throw new Error(`Replan outcome is unknown for request ${request.request_id}. Refresh this task and reconcile the same receipt before trying again.`)
        }
      }
    }
    target.assertCurrent()
    if (!receipt.success || receipt.receipt_status !== 'completed' || receipt.request_id !== request.request_id || receipt.data?.effect !== 'replan_requested') {
      const message = receipt.error?.message || (receipt.receipt_status === 'pending' || receipt.receipt_status === 'unknown'
        ? `Replan outcome is still unknown for request ${request.request_id}. Refresh the task and inspect this receipt before trying again.`
        : 'The replan receipt was not confirmed. Refresh the task before trying again.')
      throw new Error(message)
    }

    const confirmed = await fetchIssueDetail(config, identifier)
    target.assertCurrent()
    const confirmedId = confirmed.id || confirmed.issue_id || ''
    const confirmedFeedback = typeof confirmed.feedback === 'string' ? confirmed.feedback.trim() : ''
    if (confirmedId !== request.task_id || confirmed.project_id !== request.project_id || confirmed.state !== 'Todo' || confirmedFeedback !== feedback) {
      throw new Error(`Replan receipt ${request.request_id} completed, but the refreshed task does not confirm Todo with the submitted feedback.`)
    }
    opts.setIssueLookupResult({ ...identity, ...confirmed } as IssueDetailResult)
    opts.setStatusMessage(`Replan requested for ${identifier}. Planning activity has not yet been observed.`)
    const issues = await fetchIssues(config)
    target.assertCurrent()
    useAppStore.getState().setBoardIssues(issues)
  }

  const handleRequestReview: UseIssueActionsResult['handleRequestReview'] = async (identifier, provider) => {
    if (!config || !provider.trim()) throw new Error('Select an available registered review provider first.')
    const target = captureTaskTarget(identifier)
    if (target.virtual || !target.issue) throw new Error('PR review is available only for an exact local Orchestra task.')
    const stableId = target.issue.id || target.issue.issue_id || ''
    const issueIdentifier = target.issue.identifier || target.issue.issue_identifier || stableId
    if (!stableId || !issueIdentifier || !target.issue.project_id) throw new Error('Task identity is incomplete. Reopen it from its project before requesting review.')
    const fresh = await fetchIssueDetail(config, issueIdentifier)
    target.assertCurrent()
    const freshPRURL = typeof fresh.pr_url === 'string' ? fresh.pr_url : ''
    if ((fresh.id || fresh.issue_id) !== stableId || fresh.project_id !== target.issue.project_id || fresh.state !== 'Review' || !freshPRURL) throw new Error('Fresh task read does not confirm the exact Review task and linked pull request.')
    const inventory = await postOrchestratorControl(config, { operation: 'reviewers' })
    target.assertCurrent()
    const capability = inventory.data?.providers?.find(item => item.provider === provider && item.available && item.reviewer_agent_id === 'provider-default')
    if (!inventory.success || !capability) throw new Error(inventory.error?.message || `No verified provider-default review capability is available for ${provider}.`)
    const pr = await exactReviewSnapshot(target.issue.project_id, freshPRURL)
    target.assertCurrent()
    const gate = fresh.review_gate as { status?: string; head_sha?: string; pr_url?: string; attempt_id?: string } | undefined
    if (gate?.status === 'running' || gate?.status === 'awaiting_human_approval' || gate?.status === 'approved') throw new Error('A review for this pull request head is already running or settled.')
    const key = `request_review\u0000${target.issue.project_id}\u0000${stableId}\u0000${freshPRURL}\u0000${pr.head.sha}\u0000${provider}`
    const result = await reviewReceipt(key, requestId => ({
      operation: 'request_review', request_id: requestId, project_id: target.issue!.project_id!, task_id: stableId,
      expected_state: 'Review', expected_pr_url: freshPRURL, expected_head_sha: pr.head.sha!, provider, reviewer_agent_id: capability.reviewer_agent_id,
    }))
    target.assertCurrent()
    const admittedGate = result.data?.review_gate
    if (!admittedGate || !admittedGate.attempt_id || admittedGate.pr_url !== freshPRURL || admittedGate.head_sha?.toLowerCase() !== pr.head.sha?.toLowerCase() || admittedGate.reviewer_provider !== provider || admittedGate.reviewer_agent_id !== 'provider-default') throw new Error(`Review receipt ${result.request_id || ''} did not confirm the requested task, pull request, head and provider.`)
    const confirmed = await fetchIssueDetail(config, issueIdentifier)
    target.assertCurrent()
    const confirmedGate = confirmed.review_gate as { status?: string; head_sha?: string; pr_url?: string; attempt_id?: string; reviewer_provider?: string; reviewer_agent_id?: string } | undefined
    const findingsSettled = confirmedGate?.status === 'changes_requested' && confirmed.state === 'Todo'
    if ((confirmed.id || confirmed.issue_id) !== stableId || confirmed.project_id !== target.issue.project_id || !['Review', 'Todo'].includes(confirmed.state) || !confirmedGate || confirmedGate.attempt_id !== admittedGate.attempt_id || confirmedGate.pr_url !== freshPRURL || confirmedGate.head_sha?.toLowerCase() !== pr.head.sha?.toLowerCase() || !findingsSettled && confirmedGate.reviewer_provider !== provider) throw new Error('The review attempt was accepted, but the refreshed task does not confirm its exact review identity.')
    opts.setIssueLookupResult({ ...target.issue, ...confirmed } as IssueDetailResult)
    opts.setStatusMessage(findingsSettled ? `Review findings returned ${issueIdentifier} to planning with feedback.` : `Review attempt ${admittedGate.attempt_id} accepted; reviewer completion is not yet observed.`)
    const issues = await fetchIssues(config)
    target.assertCurrent()
    useAppStore.getState().setBoardIssues(issues)
  }

  const handleApproveReview: UseIssueActionsResult['handleApproveReview'] = async (identifier) => {
    if (!config) throw new Error('Backend unavailable. Review approval was not submitted.')
    const target = captureTaskTarget(identifier)
    if (target.virtual || !target.issue) throw new Error('Review approval is available only for an exact local task.')
    const stableId = target.issue.id || target.issue.issue_id || ''
    const issueIdentifier = target.issue.identifier || target.issue.issue_identifier || stableId
    const projectId = target.issue.project_id || ''
    const fresh = await fetchIssueDetail(config, issueIdentifier)
    target.assertCurrent()
    const gate = fresh.review_gate as { status?: string; head_sha?: string; pr_url?: string; attempt_id?: string } | undefined
    if ((fresh.id || fresh.issue_id) !== stableId || fresh.project_id !== projectId || fresh.state !== 'Review' || gate?.status !== 'awaiting_human_approval' || !gate.attempt_id || !gate.head_sha || !gate.pr_url) throw new Error('Fresh task read does not confirm a clean review awaiting your approval.')
    await exactReviewSnapshot(projectId, gate.pr_url, gate.head_sha)
    target.assertCurrent()
    const key = `approve_review\u0000${projectId}\u0000${stableId}\u0000${gate.pr_url}\u0000${gate.head_sha}\u0000${gate.attempt_id}`
    const result = await reviewReceipt(key, requestId => ({ operation: 'approve_review', request_id: requestId, project_id: projectId, task_id: stableId, expected_state: 'Review', expected_pr_url: gate.pr_url!, expected_head_sha: gate.head_sha!, review_attempt_id: gate.attempt_id! }))
    target.assertCurrent()
    if (result.data?.task_state !== 'Review' || result.data.review_gate?.status !== 'approved' || result.data.review_gate.attempt_id !== gate.attempt_id || result.data.review_gate.head_sha?.toLowerCase() !== gate.head_sha.toLowerCase() || result.data.review_gate.pr_url !== gate.pr_url) throw new Error('Review approval receipt does not confirm the exact approved attempt.')
    const confirmed = await fetchIssueDetail(config, issueIdentifier)
    target.assertCurrent()
    const confirmedGate = confirmed.review_gate as typeof gate
    if ((confirmed.id || confirmed.issue_id) !== stableId || confirmed.project_id !== projectId || confirmed.state !== 'Review' || confirmedGate?.status !== 'approved' || confirmedGate.attempt_id !== gate.attempt_id || confirmedGate.head_sha?.toLowerCase() !== gate.head_sha.toLowerCase() || confirmedGate.pr_url !== gate.pr_url) throw new Error('Approval completed, but the refreshed task does not confirm that exact review attempt.')
    opts.setIssueLookupResult({ ...target.issue, ...confirmed } as IssueDetailResult)
    opts.setStatusMessage('Review approved. The task remains in Review until this same pull request head is observed merged.')
    const issues = await fetchIssues(config)
    target.assertCurrent()
    useAppStore.getState().setBoardIssues(issues)
  }

  const handleCompleteReview: UseIssueActionsResult['handleCompleteReview'] = async (identifier) => {
    if (!config) throw new Error('Backend unavailable. Task completion was not submitted.')
    const target = captureTaskTarget(identifier)
    if (target.virtual || !target.issue) throw new Error('Review completion is available only for an exact local task.')
    const stableId = target.issue.id || target.issue.issue_id || ''
    const issueIdentifier = target.issue.identifier || target.issue.issue_identifier || stableId
    const projectId = target.issue.project_id || ''
    const fresh = await fetchIssueDetail(config, issueIdentifier)
    target.assertCurrent()
    const gate = fresh.review_gate as { status?: string; head_sha?: string; pr_url?: string; attempt_id?: string } | undefined
    if ((fresh.id || fresh.issue_id) !== stableId || fresh.project_id !== projectId || fresh.state !== 'Review' || gate?.status !== 'approved' || !gate.attempt_id || !gate.head_sha || !gate.pr_url) throw new Error('Fresh task read does not confirm an approved Review attempt.')
    await exactReviewSnapshot(projectId, gate.pr_url, gate.head_sha, true)
    target.assertCurrent()
    const key = `complete_review\u0000${projectId}\u0000${stableId}\u0000${gate.pr_url}\u0000${gate.head_sha}\u0000${gate.attempt_id}`
    const result = await reviewReceipt(key, requestId => ({ operation: 'complete_review', request_id: requestId, project_id: projectId, task_id: stableId, expected_state: 'Review', expected_pr_url: gate.pr_url!, expected_head_sha: gate.head_sha!, review_attempt_id: gate.attempt_id! }))
    target.assertCurrent()
    if (result.data?.task_state !== 'Done' || result.data.review_gate?.status !== 'approved' || result.data.review_gate.attempt_id !== gate.attempt_id || result.data.review_gate.head_sha?.toLowerCase() !== gate.head_sha.toLowerCase() || result.data.review_gate.pr_url !== gate.pr_url) throw new Error('Completion receipt does not confirm the exact approved review and merged head.')
    const confirmed = await fetchIssueDetail(config, issueIdentifier)
    target.assertCurrent()
    const confirmedGate = confirmed.review_gate as typeof gate
    if ((confirmed.id || confirmed.issue_id) !== stableId || confirmed.project_id !== projectId || confirmed.state !== 'Done' || confirmedGate?.status !== 'approved' || confirmedGate.attempt_id !== gate.attempt_id || confirmedGate.head_sha?.toLowerCase() !== gate.head_sha.toLowerCase() || confirmedGate.pr_url !== gate.pr_url) throw new Error('Completion receipt landed, but the refreshed task does not confirm the exact merged review.')
    opts.setIssueLookupResult({ ...target.issue, ...confirmed } as IssueDetailResult)
    opts.setStatusMessage(`Task ${issueIdentifier} completed after the approved pull request head was confirmed merged.`)
    const issues = await fetchIssues(config)
    target.assertCurrent()
    useAppStore.getState().setBoardIssues(issues)
  }

  const handleStopSession = async (identifier: string, provider?: string) => {
    if (!config) return
    try {
      const target = captureTaskTarget(identifier)
      if (target.virtual) throw new Error('GitHub backlog issues have no local agent session. Promote this task before stopping a session.')
      await stopIssueSession(config, identifier, provider)
      target.assertCurrent()
      const stopped = await fetchIssueDetail(config, identifier)
      target.assertCurrent()
      if ((stopped.id || stopped.issue_id) !== (target.issue.id || target.issue.issue_id) || stopped.project_id !== target.issue.project_id || stopped.state !== 'Backlog') throw new Error('Stop was requested, but the exact task is not confirmed in Backlog. Refresh before continuing.')
      opts.setStatusMessage(`Session for ${identifier} stopped. Work retained in Backlog; a new plan approval is required.`)
      const updatedIssues = await fetchIssues(config)
      target.assertCurrent()
      useAppStore.getState().setBoardIssues(updatedIssues)
      await opts.onRefresh()
      target.assertCurrent()
      await opts.executeIssueLookup(identifier)
    } catch (err) {
      opts.setErrorMessage(`stop session failed: ${toDisplayError(err)}`)
      throw err
    }
  }

  const handleCreateIssue = (initialState: string) => {
    useAppStore.getState().openCreateTaskDialog({ state: initialState })
  }

  const handleTaskSubmit = async (payload: IssueCreatePayload) => {
    if (!config) return
    try {
      const project = useAppStore.getState().projects.find(p => p.id === payload.project_id)
      const repository = JSON.stringify([project?.id, project?.root_path, project?.github_owner, project?.github_repo])
      const assertCreationContext = () => {
        const current = useAppStore.getState()
        const currentProject = current.projects.find(p => p.id === payload.project_id)
        if (current.config?.baseUrl !== config.baseUrl || current.config.apiToken !== config.apiToken || JSON.stringify([currentProject?.id, currentProject?.root_path, currentProject?.github_owner, currentProject?.github_repo]) !== repository) throw new Error('Project or backend changed while creating the task. Creation may have landed; refresh the original project before retrying.')
      }
      assertCreationContext()
      const localIssue = await createIssue(config, payload)
      assertCreationContext()

      // If project is GitHub-connected, also create a GitHub issue and link it
      if (project?.github_token && project.github_owner && project.github_repo) {
        try {
          if (localIssue.project_id !== project.id || !(localIssue.identifier || localIssue.issue_identifier || localIssue.id)) throw new Error('Created task identity does not match the requested project.')
          const ghIssue = await createProjectGitHubIssue(config, project.id, {
            title: payload.title,
            body: payload.description || '',
          })
          assertCreationContext()
          linkedGitHubTarget({ ...localIssue, project_id: payload.project_id, url: ghIssue.html_url })
          const issueId = localIssue?.identifier || localIssue?.issue_identifier || ''
          if (issueId && ghIssue.html_url) {
            await updateIssue(config, issueId, { url: ghIssue.html_url } as IssueUpdatePayload)
            assertCreationContext()
          }
        } catch (error) {
          throw new Error(`Local task ${localIssue.identifier || localIssue.id || ''} was created; GitHub publication or linking failed: ${toDisplayError(error)} Inspect the original project before retrying.`)
        }
      }
      assertCreationContext()

      opts.setStatusMessage(`Task "${payload.title}" created.`)

      const updatedIssues = await fetchIssues(config)
      assertCreationContext()
      useAppStore.getState().setBoardIssues(updatedIssues)

      if (project?.github_token) {
        try {
          await fetchProjectGitHubIssues(config, project.id, 'open')
        } catch {
          // non-critical
        }
      }
      assertCreationContext()

      void opts.onRefresh()
    } catch (err) {
      opts.setErrorMessage(`create task failed: ${toDisplayError(err)}`)
    }
  }

  const handleIssueDelete = async (identifier: string) => {
    if (!config) return
    try {
      const target = captureTaskTarget(identifier)
      const issueToClose = target.issue
      if (issueToClose?.project_id && issueToClose.url?.includes('github.com')) {
        const { project, number } = linkedGitHubTarget(issueToClose)
        if (project.github_token) {
          await updateProjectGitHubIssue(config, project.id, number, { state: 'closed' })
          target.assertCurrent()
        }
      }
      if (target.virtual) {
        const keepOther = (issue: IssueListItem) => issue.project_id !== issueToClose?.project_id || !matchesIssue(issue, identifier)
        useAppStore.getState().setBoardIssues(useAppStore.getState().boardIssues.filter(keepOther))
        useAppStore.getState().setGithubBacklogIssues(useAppStore.getState().githubBacklogIssues.filter(keepOther))
        opts.setStatusMessage(`GitHub issue ${identifier} dismissed from board.`)
        await opts.onRefresh()
        target.assertCurrent()
      } else {
        await deleteIssue(config, identifier)
        target.assertCurrent()
        opts.setStatusMessage(`Task ${identifier} deleted.`)
        useAppStore.getState().setBoardIssues(useAppStore.getState().boardIssues.filter(issue => !matchesIssue(issue, identifier)))
        const currentSnapshot = useAppStore.getState().snapshot
        if (currentSnapshot) useAppStore.getState().setSnapshot({
          ...currentSnapshot,
          running: currentSnapshot.running.filter(run => run.issue_identifier !== identifier),
          retrying: currentSnapshot.retrying.filter(run => run.issue_identifier !== identifier),
        })
        useAppStore.getState().setOpenTerminals(useAppStore.getState().openTerminals.filter(terminal => terminal.id !== `issue-${identifier}`))
        const updatedIssues = await fetchIssues(config)
        target.assertCurrent()
        useAppStore.getState().setBoardIssues(updatedIssues)
        await opts.onRefresh()
        target.assertCurrent()
      }
      if (opts.issueLookupId === identifier) { opts.setIssueLookupResult(null); opts.setIssueLookupId('') }
    } catch (err) {
      opts.setErrorMessage(`delete issue failed: ${toDisplayError(err)}`)
      throw err
    }
  }
  const handleInspectIssueFromList = async (issueIdentifier: string, owner?: IssueInspectionOwner) => {
    const sequence = ++issueInspectionSequence.current
    const current = () => {
      const currentConfig = useAppStore.getState().config
      return sequence === issueInspectionSequence.current && (!owner || (currentConfig?.baseUrl === owner.baseUrl && currentConfig.apiToken === owner.apiToken && useAppStore.getState().activeProjectId === owner.projectId))
    }
    if (owner && (!config || config.baseUrl !== owner.baseUrl || config.apiToken !== owner.apiToken || !current())) return
    inspectedOwner.current = owner ? { identifier: issueIdentifier, owner } : null
    opts.setIssueLookupId(issueIdentifier)
    opts.setIssueLookupResult(null)
    opts.setIssueLookupError('')
    opts.setIssueLookupPending(false)
    useAppStore.getState().setInspectDialogOpen(true)

    // For GitHub backlog issues, populate directly from cached data instead of API
    const cachedMatches = useAppStore.getState().allBoardIssues.filter(i =>
        (!owner || i.project_id === owner.projectId) && (i.identifier === issueIdentifier || i.issue_identifier === issueIdentifier || i.id === issueIdentifier)
    )
    if (issueIdentifier.startsWith('GH-') || cachedMatches.some(issue => (issue.identifier || issue.issue_identifier || '').startsWith('GH-'))) {
      const candidates = cachedMatches
      if (candidates.length > 1) {
        opts.setIssueLookupError('This issue label exists in more than one project. Open it from its project workspace.')
        return
      }
      const ghIssue = candidates[0]
      if (ghIssue) {
        const projects = useAppStore.getState().projects
        opts.setIssueLookupResult({
          ...ghIssue,
          project_name: projects.find(p => p.id === ghIssue.project_id)?.name || '',
        } as IssueDetailResult)
        return
      }
    }

    if (owner && config) {
      opts.setIssueLookupPending(true)
      try {
        const issue = await fetchIssueDetail(config, issueIdentifier)
        if (!current()) return
        if (issue.project_id !== owner.projectId || ![issue.id, issue.issue_id, issue.identifier, issue.issue_identifier].includes(issueIdentifier)) {
          throw new Error('Task response belongs to another project or task. Refresh the workspace before opening it.')
        }
        opts.setIssueLookupResult(issue as IssueDetailResult)
      } catch (error) {
        if (current()) opts.setIssueLookupError(toDisplayError(error))
      } finally {
        if (current()) opts.setIssueLookupPending(false)
      }
      return
    }
    await opts.executeIssueLookup(issueIdentifier)
  }

  const handleInspectSession = async (sessionId: string) => {
    if (!config) return
    useAppStore.getState().setSessionInspectDialogOpen(true)
    setSessionLookupPending(true)
    setSessionLookupError('')
    try {
      const result = await fetchSessionDetail(config, sessionId)
      setSessionLookupResult(result)
    } catch (err) {
      setSessionLookupError(toDisplayError(err))
    } finally {
      setSessionLookupPending(false)
    }
  }

  return {
    handleIssueUpdate,
    handleApprovePlan,
    handleReplan,
    handleRequestReview,
    handleApproveReview,
    handleCompleteReview,
    handleStopSession,
    handleCreateIssue,
    handleTaskSubmit,
    handleIssueDelete,
    handleInspectIssueFromList,
    handleInspectSession,
    sessionLookupResult,
    sessionLookupPending,
    sessionLookupError,
  }
}
