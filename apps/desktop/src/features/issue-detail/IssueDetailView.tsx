import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type Reducer } from 'react'
import { Activity, CheckCircle2, FileText, GitPullRequest, Github, Info, Loader2, Pencil, Terminal, X } from 'lucide-react'
import { TaskTimeline } from '@features/diagnostics/TaskTimeline'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'

import type { BackendConfig, IssueUpdatePayload, GitHubPR } from '@core/api/client'
import { fetchIssueHistory, fetchIssueDiff, fetchIssueLogs, fetchPRSnapshot, postOrchestratorControl, stopIssue, createGitHubPR } from '@core/api/client'
import type { SnapshotPayload } from '@core/api/types'
import type { TimelineItem } from '@layout/types'
import { AgentSelector } from '@layout/shared/controls'
import { AppTooltip } from '@ui/tooltip-wrapper'
import type { IssueDetailResult } from './types'
import { FeedbackDialog } from './FeedbackDialog'
import { PRCreateDialog } from './PRCreateDialog'
import { extractPlanFromText, parseDiff, type DiffFile, type PlanItem } from './IssueDetailUtils'
import { setCachedPlan } from './plan-cache'
import { SessionTimeline } from './SessionTimeline'
import { DescriptionEditor } from './DescriptionEditor'
import { useAppStore } from '@core/store'

const EMPTY_AGENTS: readonly string[] = []
const EMPTY_TIMELINE: readonly TimelineItem[] = []

function SidebarRow({ label, content }: { label: string; content: React.ReactNode }) {
  const labelId = useId()
  return (
    <div className="px-4 py-3 border-b border-border/20" aria-labelledby={labelId}>
      <span id={labelId} className="text-[9px] font-black uppercase tracking-[0.15em] text-muted-foreground/30 mb-1.5 block">{label}</span>
      {content}
    </div>
  )
}

function parsePullRequestIdentity(prUrl: string): { number: number; canonicalUrl: string } | null {
  try {
    const url = new URL(prUrl)
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash || !match) return null
    return { number: Number(match[3]), canonicalUrl: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` }
  } catch {
    return null
  }
}

type SessionState = {
  logs: string
  logsLoading: boolean
  diffFiles: DiffFile[]
  diffLoading: boolean
  activeDiffFile: string | null
}

type SessionAction =
  | { type: 'logs-loading'; value: boolean }
  | { type: 'logs'; value: string }
  | { type: 'diff-loading'; value: boolean }
  | { type: 'diff-files'; files: DiffFile[] }
  | { type: 'active-diff'; path: string | null }
  | { type: 'reset' }

const sessionReducer: Reducer<SessionState, SessionAction> = (state, action) => {
  switch (action.type) {
    case 'logs-loading':
      return { ...state, logsLoading: action.value }
    case 'logs':
      return { ...state, logs: action.value }
    case 'diff-loading':
      return { ...state, diffLoading: action.value }
    case 'diff-files':
      return {
        ...state,
        diffFiles: action.files,
        activeDiffFile: action.files.length > 0 ? action.files[0].path : state.activeDiffFile,
      }
    case 'active-diff':
      return { ...state, activeDiffFile: action.path }
    case 'reset':
      return { logs: '', logsLoading: false, diffFiles: [], diffLoading: false, activeDiffFile: null }
    default:
      return state
  }
}

type WorkflowState = {
  state: string
  assignee: string
  title: string
  description: string
  prUrl: string | null
}

type PlanApprovalRequest = {
  operation: 'approve_plan'
  project_id: string
  task_id: string
  expected_state: 'Todo'
  expected_plan_hash: string
  request_id: string
}

type PlanReplanRequest = {
  operation: 'replan'
  project_id: string
  task_id: string
  expected_state: 'Todo' | 'In Progress' | 'Review'
  expected_plan_hash: string
  feedback: string
  request_id: string
}

type ReviewCapability = { provider: string; available: boolean; reason?: string; reviewer_agent_id: 'provider-default' }

type WorkflowAction =
  | { type: 'set-assignee'; value: string }
  | { type: 'set-title'; value: string }
  | { type: 'set-description'; value: string }
  | { type: 'set-pr-url'; value: string | null }
  | { type: 'sync-from-result'; value: WorkflowState }

const workflowReducer: Reducer<WorkflowState, WorkflowAction> = (state, action) => {
  switch (action.type) {
    case 'set-assignee':
      return { ...state, assignee: action.value }
    case 'set-title':
      return { ...state, title: action.value }
    case 'set-description':
      return { ...state, description: action.value }
    case 'set-pr-url':
      return { ...state, prUrl: action.value }
    case 'sync-from-result':
      return action.value
    default:
      return state
  }
}

type UIState = {
  bottomTab: 'details' | 'plan' | 'output' | 'changes' | 'timeline'
  showStopConfirm: boolean
  showFeedback: boolean
  prDialogOpen: boolean
}

type UIAction =
  | { type: 'set-tab'; value: UIState['bottomTab'] }
  | { type: 'set-stop-confirm'; value: boolean }
  | { type: 'set-feedback'; value: boolean }
  | { type: 'set-pr-dialog'; value: boolean }

const uiReducer: Reducer<UIState, UIAction> = (state, action) => {
  switch (action.type) {
    case 'set-tab':
      return { ...state, bottomTab: action.value }
    case 'set-stop-confirm':
      return { ...state, showStopConfirm: action.value }
    case 'set-feedback':
      return { ...state, showFeedback: action.value }
    case 'set-pr-dialog':
      return { ...state, prDialogOpen: action.value }
    default:
      return state
  }
}

export function IssueDetailView({
  result,
  onUpdate,
  onStopSession,
  config,
  snapshot,
  onApprovePlan,
  onReplan,
  onRequestReview,
  onApproveReview,
  onCompleteReview,
  timeline: _timeline = EMPTY_TIMELINE,
  availableAgents = EMPTY_AGENTS,
  theme,
}: {
  result: IssueDetailResult | null
  onUpdate?: (updates: IssueUpdatePayload) => Promise<void>
  onStopSession?: (provider?: string) => Promise<void>
  config: BackendConfig | null
  snapshot: SnapshotPayload | null
  onApprovePlan?: (request: PlanApprovalRequest) => Promise<void>
  onReplan?: (request: PlanReplanRequest) => Promise<void>
  onRequestReview?: (provider: string) => Promise<void>
  onApproveReview?: () => Promise<void>
  onCompleteReview?: () => Promise<void>
  timeline?: readonly TimelineItem[]
  availableAgents?: readonly string[]
  theme?: 'light' | 'dark'
}) {
  void _timeline
  const typed = (result ?? {})
  const identifier = (typed.identifier as string) || (typed.issue_identifier as string) || ''
  const issueId = (typed.id as string) || (typed.issue_id as string) || ''
  const title = (typed.title as string) || 'No Title'
  const description = (typed.description as string) || ''
  const projectId = (typed.project_id as string) || ''
  const projectName = (typed.project_name as string) || ''
  const provider = (typed.provider as string) || ''

  const resultId = (typed.id as string) || (typed.issue_id as string) || ''
  const initialState = (typed.state as string) || 'Todo'

  const openBrowserTab = useAppStore((s) => s.openBrowserTab)
  const setActiveSection = useAppStore((s) => s.setActiveSection)
  const openInInternalBrowser = useCallback((url: string) => {
    setActiveSection('CONSOLE')
    openBrowserTab(url, projectId || undefined)
  }, [openBrowserTab, projectId, setActiveSection])

  const [workflow, dispatchWorkflow] = useReducer(workflowReducer, {
    state: initialState,
    assignee: (typed.assignee_id as string) || '',
    title,
    description,
    prUrl: (typed.pr_url as string) || null,
  })
  const { state: localState, assignee: localAssignee, title: localTitle, description: localDescription, prUrl } = workflow
  const isEditable = localState === 'Backlog'
  const [stateUpdateError, setStateUpdateError] = useState('')
  const [approvalError, setApprovalError] = useState('')
  const [stopError, setStopError] = useState('')
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [confirmedApprovalKey, setConfirmedApprovalKey] = useState('')
  const approvalRequestRef = useRef<{ key: string; requestId: string } | null>(null)
  const replanRequestRef = useRef<{ key: string; requestId: string } | null>(null)
  const [reviewCapabilities, setReviewCapabilities] = useState<ReviewCapability[]>([])
  const [reviewCapabilitiesLoading, setReviewCapabilitiesLoading] = useState(false)
  const [reviewCapabilitiesError, setReviewCapabilitiesError] = useState('')
  const [selectedReviewerProvider, setSelectedReviewerProvider] = useState('')
  const [reviewActionError, setReviewActionError] = useState('')
  const [reviewActionBusy, setReviewActionBusy] = useState(false)
  const [freshReviewSnapshot, setFreshReviewSnapshot] = useState<{ headSha: string; prUrl: string; merged: boolean } | null>(null)

  const [ui, dispatchUI] = useReducer(uiReducer, {
    bottomTab: 'details',
    showStopConfirm: false,
    showFeedback: false,
    prDialogOpen: false,
  })
  const { bottomTab, showStopConfirm, showFeedback, prDialogOpen } = ui

  const [session, dispatchSession] = useReducer(sessionReducer, undefined, () => ({
    logs: '',
    logsLoading: initialState !== 'Backlog',
    diffFiles: [],
    diffLoading: false,
    activeDiffFile: null,
  }))
  const { logs, logsLoading, diffFiles, diffLoading, activeDiffFile } = session

  // issueHistory was fetched but never rendered — kept in a ref so the fetch is preserved without re-renders.
  const issueHistoryRef = useRef<unknown[]>([])

  const incomingWorkflow: WorkflowState = {
    state: (typed.state as string) || 'Todo',
    assignee: (typed.assignee_id as string) || '',
    title: (typed.title as string) || 'No Title',
    description: (typed.description as string) || '',
    prUrl: (typed.pr_url as string) || null,
  }
  const syncedResult = useRef({ resultId, value: incomingWorkflow })
  useEffect(() => {
    const previous = syncedResult.current
    const sameTask = previous.resultId === resultId
    const next = { ...incomingWorkflow }
    if (sameTask) {
      for (const key of ['assignee', 'title', 'description'] as const) {
        const localValue = workflow[key]
        const previousValue = previous.value[key]
        const incomingValue = incomingWorkflow[key]
        // Keep an unsaved local edit, but accept server updates to fields the user has not changed.
        if (localValue !== previousValue && localValue !== incomingValue) next[key] = localValue as never
      }
    } else {
      setStateUpdateError('')
    }
    syncedResult.current = { resultId, value: incomingWorkflow }
    if (Object.keys(next).some(key => next[key as keyof WorkflowState] !== workflow[key as keyof WorkflowState])) {
      dispatchWorkflow({ type: 'sync-from-result', value: next })
    }
  }, [resultId, typed.state, typed.assignee_id, typed.title, typed.description, typed.pr_url, workflow.state, workflow.assignee, workflow.title, workflow.description, workflow.prUrl])

  // Extract operational plan from the most recent agent message that contains checkboxes.
  // Agent restates the plan with updated checkboxes as it progresses — we want the LATEST version.
  const planItems: PlanItem[] = useMemo(() => {
    // The plan field from the API is the source of truth — the backend updates it
    // during planning (Todo→InProgress) and after execution (InProgress→Review),
    // as well as live during execution when the agent restates checkboxes.
    const issuePlan = (typed.plan as string) || ''
    if (issuePlan) {
      const items = extractPlanFromText(issuePlan)
      if (items.length > 0) return items
    }

    // Fallback: extract from description (for issues created with inline checkboxes)
    const descPlan = extractPlanFromText(description)
    if (descPlan.length > 0) return descPlan

    return []
  }, [typed.plan, description])
  useEffect(() => {
    const cacheKey = issueId || identifier
    if (cacheKey && planItems.length > 0) {
      setCachedPlan(cacheKey, planItems)
    }
  }, [issueId, identifier, planItems])

  const completedCount = planItems.filter(i => i.done).length
  const matchesTask = (entry: { issue_id: string; issue_identifier: string }) =>
    (!!issueId && entry.issue_id === issueId) || (!!identifier && entry.issue_identifier === identifier)
  const runningEntry = snapshot?.running?.find(matchesTask)
  const retryEntry = snapshot?.retrying?.find(matchesTask)
  const isRunning = !!runningEntry
  const retryStatus = retryEntry ? `Retry scheduled${retryEntry.attempt > 0 ? ` · attempt ${retryEntry.attempt}` : ''}` : ''
  const queuedRun = !!runningEntry && (runningEntry.last_event === 'dispatch_queued' || runningEntry.last_event === 'retry_due' || !runningEntry.last_event)
  const claimedRun = !!runningEntry && runningEntry.last_event === 'run_claimed'
  const plannerHasStarted = isRunning && !queuedRun && !claimedRun
  const planGate = typed.plan_gate as { status?: string; plan_hash?: string; reason?: string } | undefined
  const gateStatus = planGate?.status || ''
  const unsupportedPlanReason = planGate?.reason || 'Plan approval is unavailable for this task source or harness'
  const planHash = planGate?.plan_hash || ''
  const approvalKey = `${projectId}\u0000${issueId}\u0000${planHash}`
  const canApprovePlan = localState === 'Todo' && gateStatus === 'awaiting_approval' && !!planHash && !!projectId && !!issueId && !!config && !!onApprovePlan && confirmedApprovalKey !== approvalKey
  const executionApprovalObserved = gateStatus === 'approved'
  const reviewGate = typed.review_gate as { status?: string; head_sha?: string; pr_url?: string; attempt_id?: string; reviewer_provider?: string; reviewer_agent_id?: string; feedback?: string } | undefined
  const reviewGateStatus = reviewGate?.status || 'not_reviewed'
  const reviewPRIdentity = parsePullRequestIdentity(prUrl || '')
  const canRequestReplan = !!config && !!projectId && !!issueId && !!onReplan && !!planHash && gateStatus !== 'unsupported' && !isRunning && !retryEntry &&
    ['Todo', 'In Progress', 'Review'].includes(localState) &&
    (localState === 'Review' || ['stale', 'failed', 'awaiting_approval', 'approved'].includes(gateStatus))
  const availableReviewers = reviewCapabilities.filter(capability => capability.available)
  const selectedReviewer = availableReviewers.find(capability => capability.provider === selectedReviewerProvider)
  const canRequestReview = localState === 'Review' && !!config && !!projectId && !!issueId && !!reviewPRIdentity && !!selectedReviewer && !!onRequestReview && !reviewActionBusy && !['running', 'awaiting_human_approval', 'approved'].includes(reviewGateStatus)
  const canApproveReview = localState === 'Review' && reviewGateStatus === 'awaiting_human_approval' && !!reviewGate?.attempt_id && !!reviewGate.head_sha && !!reviewGate.pr_url && !!onApproveReview && !reviewActionBusy
  const canCompleteReview = localState === 'Review' && reviewGateStatus === 'approved' && !!reviewGate?.attempt_id && !!reviewGate.head_sha && !!reviewGate.pr_url && freshReviewSnapshot?.merged === true && freshReviewSnapshot.headSha === reviewGate.head_sha && freshReviewSnapshot.prUrl === reviewGate.pr_url && !!onCompleteReview && !reviewActionBusy

  useEffect(() => {
    let active = true
    setReviewCapabilities([])
    setSelectedReviewerProvider('')
    setReviewCapabilitiesError('')
    if (!config || localState !== 'Review') return () => { active = false }
    setReviewCapabilitiesLoading(true)
    void postOrchestratorControl(config, { operation: 'reviewers' })
      .then(response => {
        if (!active) return
        if (!response.success) throw new Error(response.error?.message || 'Review capability was not confirmed.')
        const providers = response.data?.providers
        if (!Array.isArray(providers)) throw new Error('Review capability response did not include registered provider options.')
        setReviewCapabilities(providers)
      })
      .catch(error => { if (active) setReviewCapabilitiesError(error instanceof Error ? error.message : 'Review capability could not be checked.') })
      .finally(() => { if (active) setReviewCapabilitiesLoading(false) })
    return () => { active = false }
  }, [config, localState, projectId, issueId])

  useEffect(() => {
    let active = true
    setFreshReviewSnapshot(null)
    setReviewActionError('')
    if (!config || localState !== 'Review' || reviewGateStatus !== 'approved' || !projectId || !reviewGate?.head_sha || !reviewGate.pr_url) return () => { active = false }
    const identity = parsePullRequestIdentity(reviewGate.pr_url)
    if (!identity || identity.canonicalUrl !== reviewGate.pr_url) return () => { active = false }
    void fetchPRSnapshot(config, projectId, identity.number)
      .then(snapshot => {
        if (!active) return
        if (snapshot.pr.html_url !== reviewGate.pr_url || snapshot.pr.head.sha?.toLowerCase() !== reviewGate.head_sha?.toLowerCase()) {
          setReviewActionError('The pull request URL or head changed after review. This approval cannot complete the task.')
          return
        }
        setFreshReviewSnapshot({ headSha: snapshot.pr.head.sha || '', prUrl: snapshot.pr.html_url, merged: !!snapshot.pr.merged_at })
      })
      .catch(error => { if (active) setReviewActionError(error instanceof Error ? error.message : 'Current pull request merge state could not be confirmed.') })
    return () => { active = false }
  }, [config, localState, projectId, reviewGateStatus, reviewGate?.head_sha, reviewGate?.pr_url])

  useEffect(() => {
    if (!config || !identifier) return
    if (localState === 'Backlog') {
      issueHistoryRef.current = []
      return
    }
    fetchIssueHistory(config, identifier)
      .then((entries) => { issueHistoryRef.current = entries })
      .catch(() => { issueHistoryRef.current = [] })
  }, [config, identifier, localState])

  useEffect(() => {
    const handler = () => {
      if (!config || !identifier || localState === 'Backlog') return
      fetchIssueHistory(config, identifier)
        .then((entries) => { issueHistoryRef.current = entries })
        .catch(() => {})
    }
    window.addEventListener('orchestra-data-changed', handler)
    return () => window.removeEventListener('orchestra-data-changed', handler)
  }, [config, identifier, localState])

  useEffect(() => {
    if (!config || !identifier) return
    if (localState !== 'Backlog') {
      dispatchSession({ type: 'logs-loading', value: true })
      fetchIssueLogs(config, identifier, provider)
        .then((value) => dispatchSession({ type: 'logs', value }))
        .catch(() => dispatchSession({ type: 'logs', value: '' }))
        .finally(() => dispatchSession({ type: 'logs-loading', value: false }))
    }
    if (bottomTab === 'changes' && (isRunning || localState === 'In Progress' || localState === 'Review' || localState === 'Done')) {
      dispatchSession({ type: 'diff-loading', value: true })
      fetchIssueDiff(config, identifier, provider)
        .then(raw => {
          const files = parseDiff(raw)
          dispatchSession({ type: 'diff-files', files })
        })
        .catch(() => dispatchSession({ type: 'diff-files', files: [] }))
        .finally(() => dispatchSession({ type: 'diff-loading', value: false }))
    }
  }, [bottomTab, config, identifier, provider, localState, isRunning])

  const updateTaskState = async (newState: string) => {
    if (!onUpdate) {
      setStateUpdateError('Task status updates are unavailable. The task state has not changed.')
      return
    }
    setStateUpdateError('')
    try {
      await onUpdate({ state: newState })
    } catch {
      setStateUpdateError('Task status was not updated. Refresh the task before trying again.')
    }
  }

  const approveCurrentPlan = async () => {
    if (!onApprovePlan || gateStatus !== 'awaiting_approval' || !planHash || !projectId || !issueId || approvalBusy) return
    const key = `${projectId}\u0000${issueId}\u0000${planHash}`
    if (confirmedApprovalKey === key) return
    let request = approvalRequestRef.current
    if (!request || request.key !== key) {
      request = { key, requestId: crypto.randomUUID() }
      approvalRequestRef.current = request
    }
    setApprovalBusy(true)
    setApprovalError('')
    try {
      await onApprovePlan({
        operation: 'approve_plan',
        project_id: projectId,
        task_id: issueId,
        expected_state: 'Todo',
        expected_plan_hash: planHash,
        request_id: request.requestId,
      })
      setConfirmedApprovalKey(key)
    } catch (error) {
      const code = (error as { code?: string })?.code
      if (code && code !== 'mutation_unknown' && code !== 'request_failed' && code !== 'receipt_unavailable') approvalRequestRef.current = null
      setApprovalError(error instanceof Error ? error.message : 'Approval was not confirmed. Reconcile the request receipt before trying again.')
    } finally {
      setApprovalBusy(false)
    }
  }

  const handleAssigneeChange = async (newAssignee: string) => {
    dispatchWorkflow({ type: 'set-assignee', value: newAssignee })
    const agentName = newAssignee.replace('agent-', '')
    if (onUpdate) await onUpdate({ assignee_id: newAssignee, provider: agentName })
  }

  const confirmStop = async () => {
    if (!config) return
    setStopError('')
    try {
      if (onStopSession) await onStopSession()
      else {
        if (!issueId || !projectId) throw new Error('Reopen this task in its project before stopping it.')
        const stopped = await stopIssue(config, issueId || identifier)
        if ((stopped.id || stopped.issue_id) !== issueId || stopped.project_id !== projectId || stopped.state !== 'Backlog') throw new Error('Stop was not confirmed for this task. Refresh before continuing.')
        dispatchWorkflow({ type: 'sync-from-result', value: { ...workflow, state: stopped.state } })
      }
      dispatchUI({ type: 'set-stop-confirm', value: false })
    } catch (err) {
      setStopError(err instanceof Error ? err.message : 'Stop was not confirmed. Refresh before continuing.')
    }
  }

  const handleReject = async (feedback: string) => {
    if (!canRequestReplan || !onReplan || !['Todo', 'In Progress', 'Review'].includes(localState)) throw new Error('Replanning is not available for this task state or planning capability.')
    const key = `${projectId}\u0000${issueId}\u0000${localState}\u0000${planHash}\u0000${feedback.trim()}`
    let request = replanRequestRef.current
    if (!request || request.key !== key) {
      request = { key, requestId: crypto.randomUUID() }
      replanRequestRef.current = request
    }
    setApprovalError('')
    try {
      await onReplan({
        operation: 'replan', project_id: projectId, task_id: issueId,
        expected_state: localState as PlanReplanRequest['expected_state'],
        expected_plan_hash: planHash, feedback: feedback.trim(), request_id: request.requestId,
      })
      dispatchUI({ type: 'set-feedback', value: false })
    } catch (error) {
      const code = (error as { code?: string })?.code
      if (code && code !== 'mutation_unknown' && code !== 'request_failed' && code !== 'receipt_unavailable') replanRequestRef.current = null
      setApprovalError(error instanceof Error ? error.message : 'Replan outcome was not confirmed. Reconcile the same request receipt before trying again.')
      throw error
    }
  }

  const runReviewAction = async (action: () => Promise<void>) => {
    setReviewActionBusy(true)
    setReviewActionError('')
    try {
      await action()
    } catch (error) {
      setReviewActionError(error instanceof Error ? error.message : 'Review action was not confirmed. Inspect its receipt before trying again.')
    } finally {
      setReviewActionBusy(false)
    }
  }

  const createdAtIso = typeof typed.created_at === 'string' ? (typed.created_at as string) : ''
  const formattedCreatedAt = useMemo(
    () => (createdAtIso ? new Date(createdAtIso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'),
    [createdAtIso],
  )

  if (!result) {
    return <div className="h-full flex items-center justify-center text-muted-foreground/30 text-sm italic">No issue data.</div>
  }

  const tabItems = [
    { id: 'details' as const, label: 'Details', icon: Info, count: undefined },
    { id: 'plan' as const, label: 'Plan', icon: CheckCircle2, count: planItems.length > 0 ? planItems.length : undefined },
    { id: 'output' as const, label: 'Session', icon: Terminal, count: undefined },
    { id: 'changes' as const, label: 'Changes', icon: FileText, count: diffFiles.length > 0 ? diffFiles.length : undefined },
    { id: 'timeline' as const, label: 'Timeline', icon: Activity, count: undefined },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border/30">
        <div className="flex items-center gap-4 px-6 h-14 pr-12">
          <span className="shrink-0 font-mono text-[11px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/15">{identifier}</span>
          <h2 className="text-base font-semibold truncate flex-1 min-w-0">{localTitle}</h2>
          <div className="flex items-center gap-2 shrink-0">
          {localState === 'Review' && projectId && (
            <>
              {prUrl ? (
                <AppTooltip content="Open pull request in internal browser" side="bottom">
                  <button
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-600/20 transition-all"
                    onClick={() => openInInternalBrowser(prUrl)}
                  >
                    <GitPullRequest size={14} />
                    View PR
                  </button>
                </AppTooltip>
              ) : config && onUpdate ? (
                <AppTooltip content="Push branch and create a GitHub pull request" side="bottom">
                  <button
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all"
                    onClick={() => dispatchUI({ type: 'set-pr-dialog', value: true })}
                  >
                    <GitPullRequest size={14} />
                    Create PR
                  </button>
                </AppTooltip>
              ) : null}
              {canRequestReplan && <AppTooltip content="Return this task to planning with your feedback and existing task context" side="bottom">
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-muted/20 text-muted-foreground border border-border/30 hover:bg-muted/40 transition-colors"
                  onClick={() => dispatchUI({ type: 'set-feedback', value: true })}
                >
                  <Pencil size={12} />
                  Request Changes
                </button>
              </AppTooltip>}
              {canCompleteReview && <button type="button" disabled={reviewActionBusy} onClick={() => { if (onCompleteReview) void runReviewAction(onCompleteReview) }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors">{reviewActionBusy ? 'Confirming merge…' : 'Complete task'}</button>}
            </>
          )}
          {localState === 'Done' && onUpdate && (
            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Completed</span>
          )}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-0 border-y border-border/40 shrink-0">
        {tabItems.map((tab, idx) => (
          <button
            key={tab.id}
            onClick={() => dispatchUI({ type: 'set-tab', value: tab.id })}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-all border-b-2 ${
              idx < tabItems.length - 1 ? 'border-r border-border/20' : ''
            } ${
              bottomTab === tab.id
                ? 'border-b-primary text-primary bg-primary/5'
                : 'border-b-transparent text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/10'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`text-[9px] font-mono px-1 rounded ${bottomTab === tab.id ? 'text-primary/60' : 'text-muted-foreground/30'}`}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content (fills remaining space) ── */}
      <div className="flex-1 min-h-0 overflow-auto overflow-x-hidden custom-scrollbar">
        {bottomTab === 'timeline' && <TaskTimeline config={config} taskId={issueId} projectId={projectId} />}

        {/* Details */}
        {bottomTab === 'details' && (
          <div className="h-full flex">
            {/* Main content - editable */}
            <div className="flex-1 p-8 flex flex-col">
              {isEditable ? (
                <input
                  className="w-full bg-transparent text-xl font-bold text-foreground outline-none focus:outline-none placeholder:text-muted-foreground/20 mb-1"
                  value={localTitle}
                  onChange={e => dispatchWorkflow({ type: 'set-title', value: e.target.value })}
                  onBlur={() => { if (localTitle !== title && onUpdate) void onUpdate({ title: localTitle }) }}
                  placeholder="Task title..."
                />
              ) : (
                <span className="text-sm font-medium text-foreground">{localTitle}</span>
              )}
              <div className="w-12 h-0.5 bg-primary/30 rounded-full mb-4" />
              {isEditable ? (
                <DescriptionEditor
                  value={localDescription}
                  onChange={(value) => dispatchWorkflow({ type: 'set-description', value })}
                  onBlur={() => { if (localDescription !== description && onUpdate) void onUpdate({ description: localDescription }) }}
                  theme={theme}
                  projectId={projectId}
                />
              ) : (
                <div className="min-h-0 overflow-auto px-4 py-3">
                  <MarkdownRenderer content={localDescription || 'No description'} linkProjectId={projectId || undefined} className="break-words text-foreground/80 prose-headings:text-foreground prose-a:text-primary prose-pre:overflow-x-auto prose-pre:bg-muted/40" />
                </div>
              )}
              {(typed.feedback as string) && (
                <div className="mx-4 mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Pencil size={12} className="text-amber-500" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Review Feedback</span>
                  </div>
                  <p className="text-sm text-foreground/80 leading-relaxed">{typed.feedback as string}</p>
                </div>
              )}
            </div>

            {/* Sidebar properties */}
            <div className="w-56 lg:w-72 border-l border-border/40 shrink-0 overflow-y-auto bg-muted/5">
              <div className="px-4 py-3 border-b border-border/20">
                <div className="space-y-2">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Status</span>

                  {localState === 'Backlog' && (() => {
                    const missingTitle = !localTitle?.trim()
                    const missingDescription = !localDescription?.trim()
                    const missingAssignee = !localAssignee || localAssignee === 'Unassigned' || localAssignee === 'unassigned'
                    const missingProject = !projectId
                    const canMove = !missingTitle && !missingDescription && !missingAssignee && !missingProject
                    const issues = [
                      missingTitle && 'Title is required',
                      missingDescription && 'Description is required',
                      missingAssignee && 'Assign an agent before moving to Todo',
                      missingProject && 'Assign a project before moving to Todo',
                    ].filter(Boolean)

                    return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-muted-foreground/40" />
                        <span className="text-[11px] text-muted-foreground/60">Draft</span>
                      </div>
                      <button
                        onClick={() => { if (canMove) void updateTaskState('Todo') }}
                        disabled={!canMove}
                        className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      >
                        Move to Todo
                      </button>
                      {issues.length > 0 && (
                        <div className="space-y-1 pt-1">
                          {issues.map((msg, i) => (
                            <p key={`${msg}-${i}`} className="text-[9px] font-medium text-amber-500">{msg}</p>
                          ))}
                        </div>
                      )}
                    </div>
                    )
                  })()}

                  {localState === 'Todo' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${retryEntry || gateStatus === 'failed' ? 'bg-amber-500' : plannerHasStarted ? 'bg-blue-500 animate-pulse' : 'bg-muted-foreground/40'}`} />
                        <span role="status" aria-label="Task runtime status" className={`text-[11px] ${retryEntry || gateStatus === 'failed' ? 'text-amber-400' : plannerHasStarted ? 'text-blue-400' : 'text-muted-foreground/60'}`}>
                          {retryEntry ? retryStatus
                            : gateStatus === 'awaiting_approval' ? (confirmedApprovalKey === approvalKey ? 'Approval recorded · refreshing task state' : 'Plan ready · awaiting approval')
                              : gateStatus === 'approved' ? 'Plan approved · waiting for execution'
                                : gateStatus === 'stale' ? 'Plan changed · approval must be renewed'
                                  : gateStatus === 'failed' ? 'Planning failed'
                                    : gateStatus === 'unsupported' ? 'Planning capability unavailable'
                                      : queuedRun ? 'Queued for planning' : claimedRun ? 'Worker claimed · planning starting' : plannerHasStarted ? 'Planning' : 'Todo · no active run observed'}
                        </span>
                      </div>
                      {retryEntry?.error && <p className="text-[10px] text-amber-400/80 break-words">{retryEntry.error}</p>}
                      {canApprovePlan && <button type="button" onClick={() => { void approveCurrentPlan() }} disabled={approvalBusy} className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-all">{approvalBusy ? 'Recording approval…' : 'Approve plan'}</button>}
                      {canRequestReplan && <button type="button" onClick={() => dispatchUI({ type: 'set-feedback', value: true })} className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg border border-border/40 text-muted-foreground hover:bg-muted/20 transition-all">Request replan with feedback</button>}
                      {approvalError && <p role="alert" className="text-[10px] text-red-400 break-words">{approvalError}</p>}
                      <button onClick={() => dispatchUI({ type: 'set-stop-confirm', value: true })} className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all">
                        Stop task
                      </button>
                    </div>
                  )}

                  {localState === 'In Progress' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${retryEntry || !executionApprovalObserved ? 'bg-amber-500' : plannerHasStarted ? 'animate-pulse bg-amber-500' : 'bg-muted-foreground/40'}`} />
                        <span role="status" aria-label="Task runtime status" className={`text-[11px] ${retryEntry || !executionApprovalObserved ? 'text-amber-400' : plannerHasStarted ? 'text-amber-400' : 'text-muted-foreground/60'}`}>
                          {!executionApprovalObserved ? (gateStatus === 'unsupported' ? 'Execution blocked · planning capability unavailable' : 'Execution blocked · plan approval not observed')
                            : retryEntry ? retryStatus : queuedRun ? 'Queued for execution' : claimedRun ? 'Worker claimed · execution starting' : plannerHasStarted ? 'Executing' : 'Approved · awaiting execution'}
                        </span>
                      </div>
                      {retryEntry?.error && <p className="text-[10px] text-amber-400/80 break-words">{retryEntry.error}</p>}
                      <button onClick={() => dispatchUI({ type: 'set-stop-confirm', value: true })} className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all">
                        Stop task
                      </button>
                    </div>
                  )}

                  {localState === 'Review' && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 rounded-full ${reviewGateStatus === 'failed' || reviewGateStatus === 'interrupted' || reviewGateStatus === 'stale' ? 'bg-amber-500' : reviewGateStatus === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-purple-500'}`} />
                        <span role="status" aria-label="Review gate status" className={`text-[11px] ${reviewGateStatus === 'failed' || reviewGateStatus === 'interrupted' || reviewGateStatus === 'stale' ? 'text-amber-400' : reviewGateStatus === 'running' ? 'text-blue-400' : 'text-purple-400'}`}>
                          {reviewGateStatus === 'running' ? 'PR review running'
                            : reviewGateStatus === 'awaiting_human_approval' ? 'Review complete · awaiting your approval'
                              : reviewGateStatus === 'approved' ? (freshReviewSnapshot?.merged ? 'Review approved · merged PR observed' : 'Review approved · waiting for PR merge')
                                : reviewGateStatus === 'changes_requested' ? 'Changes requested · returned to planning'
                                  : reviewGateStatus === 'stale' ? 'PR head changed · review must be renewed'
                                    : reviewGateStatus === 'interrupted' ? 'PR review interrupted · retry available'
                                      : reviewGateStatus === 'failed' ? 'PR review failed · retry available'
                                        : prUrl ? 'PR ready for registered review' : 'Awaiting a linked pull request'}
                        </span>
                      </div>
                      {reviewGate?.feedback && <p className="text-[10px] text-amber-400/80 break-words">{reviewGate.feedback}</p>}
                      {canRequestReplan && <button type="button" onClick={() => dispatchUI({ type: 'set-feedback', value: true })} className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg border border-border/40 text-muted-foreground hover:bg-muted/20 transition-all">Request changes with feedback</button>}
                      {approvalError && <p role="alert" className="text-[10px] text-red-400 break-words">{approvalError}</p>}
                      {prUrl && config && (
                        <div className="space-y-2 border-t border-border/30 pt-3">
                          {reviewCapabilitiesLoading ? <p className="text-[10px] text-muted-foreground">Checking registered review capability…</p>
                            : reviewCapabilitiesError ? <p role="alert" className="text-[10px] text-amber-400 break-words">{reviewCapabilitiesError}</p>
                              : reviewCapabilities.length === 0 || availableReviewers.length === 0 ? <p className="text-[10px] text-muted-foreground/70">No registered verified PR reviewer is available. Review has not been started.</p>
                                : <>
                                  <label className="block text-[9px] font-bold uppercase tracking-widest text-muted-foreground" htmlFor="issue-reviewer-provider">Reviewer provider</label>
                                  <select id="issue-reviewer-provider" aria-label="Reviewer provider" value={selectedReviewerProvider} onChange={event => setSelectedReviewerProvider(event.target.value)} className="w-full rounded-lg border border-border/40 bg-background px-2 py-1.5 text-[11px] text-foreground">
                                    <option value="">Select a registered provider</option>
                                    {availableReviewers.map(capability => <option key={capability.provider} value={capability.provider}>{capability.provider} · provider default</option>)}
                                  </select>
                                  <button type="button" onClick={() => { if (selectedReviewerProvider && onRequestReview) void runReviewAction(() => onRequestReview(selectedReviewerProvider)) }} disabled={!canRequestReview} className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-all">
                                    {reviewActionBusy ? 'Requesting review…' : reviewGateStatus === 'failed' || reviewGateStatus === 'interrupted' || reviewGateStatus === 'stale' ? 'Retry PR review' : 'Request PR review'}
                                  </button>
                                  {reviewCapabilities.filter(capability => !capability.available).map(capability => <p key={capability.provider} className="text-[9px] text-muted-foreground/60">{capability.provider}: {capability.reason || 'review unavailable'}</p>)}
                                </>}
                          {canApproveReview && <button type="button" onClick={() => { if (onApproveReview) void runReviewAction(onApproveReview) }} disabled={reviewActionBusy} className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-all">Approve clean review</button>}
                          {reviewGateStatus === 'approved' && !freshReviewSnapshot?.merged && <p className="text-[10px] text-muted-foreground/70">Task remains in Review until the same pull request head is observed merged.</p>}
                          {reviewActionError && <p role="alert" className="text-[10px] text-red-400 break-words">{reviewActionError}</p>}
                        </div>
                      )}
                      {prUrl && (
                        <button
                          onClick={() => openInInternalBrowser(prUrl)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10 hover:bg-primary/10 transition-colors w-full text-left"
                        >
                          <GitPullRequest size={12} className="text-primary shrink-0" />
                          <span className="text-[10px] font-mono text-primary truncate">{prUrl.replace('https://github.com/', '')}</span>
                        </button>
                      )}
                    </div>
                  )}

                  {localState === 'Done' && (
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-emerald-500" />
                      <span className="text-[11px] text-emerald-400">Completed</span>
                    </div>
                  )}
                  {stateUpdateError && <p role="alert" className="mt-2 text-[10px] text-red-400">{stateUpdateError}</p>}
                </div>
              </div>
              {[
                ...(isEditable ? [
                  { label: 'Agent', content: (
                    <AgentSelector value={localAssignee} agents={availableAgents as string[]} onChange={handleAssigneeChange} direction="down" />
                  )},
                  { label: 'Project', content: (
                    <span className="text-[11px] font-bold text-foreground/80">{projectName || 'Unlinked'}</span>
                  )},
                ] : []),
                { label: 'Identifier', content: (
                  <span className="font-mono text-[11px] font-black text-primary/70">{identifier}</span>
                )},
                { label: 'Created', content: (
                  <span className="text-[11px] text-muted-foreground/50">
                    {formattedCreatedAt}
                  </span>
                )},
              ].map(({ label, content }) => (
                <SidebarRow key={label} label={label} content={content} />
              ))}
              {typed.url && typeof typed.url === 'string' && (typed.url as string).includes('github.com') && (
                <SidebarRow
                  label="GitHub"
                  content={
                    <button
                      onClick={() => openInInternalBrowser(typed.url as string)}
                      className="text-[11px] text-primary/60 hover:text-primary flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Github size={12} />
                      {(typed.url as string).replace('https://github.com/', '')}
                    </button>
                  }
                />
              )}
            </div>
          </div>
        )}

        {/* Plan */}
        {bottomTab === 'plan' && (
          <div className="h-full p-4">
            {planItems.length > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 min-w-[120px] bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(var(--primary),0.3)]" style={{ width: `${(completedCount / planItems.length) * 100}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">{completedCount}/{planItems.length} complete</span>
                  </div>
                </div>
                <div className="space-y-1">
                  {planItems.map((item, idx) => (
                    <div key={`${idx}-${item.text.slice(0, 32)}`} className={`flex items-start gap-3 py-2 px-3 rounded-lg ${item.done ? 'bg-primary/5' : 'hover:bg-muted/10'} transition-colors`}>
                      <div className={`mt-0.5 size-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${item.done ? 'bg-primary border-primary text-primary-foreground' : 'border-border/50'}`}>
                        {item.done && <CheckCircle2 size={12} />}
                      </div>
                      <div className={`text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-0 prose-code:text-primary/70 ${item.done ? 'text-muted-foreground/40 line-through opacity-50' : 'text-foreground'}`}>
                        <MarkdownRenderer content={item.text} linkProjectId={projectId} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground/20 gap-3">
                <CheckCircle2 size={36} />
                <p className="text-[10px] font-bold uppercase tracking-[0.2em]">
                  {gateStatus === 'awaiting_approval' ? 'Plan ready · human approval is required before execution' : gateStatus === 'stale' ? 'Plan context changed · a fresh plan must be reviewed' : gateStatus === 'unsupported' ? unsupportedPlanReason : !executionApprovalObserved && localState === 'In Progress' ? 'Execution is blocked until plan approval is observed' : retryEntry ? `A retry is scheduled after the last error${retryEntry.error ? `: ${retryEntry.error}` : ''}` : queuedRun ? `Run queued; ${localState === 'In Progress' ? 'execution' : 'planning'} has not started` : claimedRun ? `Worker claimed; waiting for ${localState === 'In Progress' ? 'execution' : 'planner'} output` : plannerHasStarted ? (localState === 'In Progress' ? 'Waiting for execution output...' : 'Waiting for agent to create plan...') : localState === 'Todo' ? 'No active run or plan observed' : 'No plan recorded'}
                </p>
                {plannerHasStarted && <Loader2 size={14} className="animate-spin-smooth text-primary/30" />}
              </div>
            )}
          </div>
        )}

        {/* Session — SSE event timeline for the issue's agent session */}
        {bottomTab === 'output' && (
          <SessionTimeline logs={logs} loading={logsLoading} />
        )}

        {/* Changes */}
        {bottomTab === 'changes' && (
          <div className="h-full">
            {diffLoading ? (
              <div className="h-full flex items-center justify-center"><Loader2 className="size-5 animate-spin-smooth text-primary/30" /></div>
            ) : diffFiles.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground/20 gap-3">
                <FileText size={36} />
                <p className="text-[10px] font-bold uppercase tracking-[0.2em]">No changes detected</p>
              </div>
            ) : (
              <div className="flex h-full">
                <div className="w-52 border-r border-border/30 shrink-0 overflow-auto bg-card/60">
                  <div className="p-2 text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/40 border-b border-border/20 px-3">
                    {diffFiles.length} file{diffFiles.length !== 1 ? 's' : ''} changed
                  </div>
                  {diffFiles.map(f => (
                    <button
                      key={f.path}
                      onClick={() => dispatchSession({ type: 'active-diff', path: f.path })}
                      className={`w-full text-left px-3 py-2 text-[11px] truncate transition-colors ${
                        activeDiffFile === f.path ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary' : 'text-muted-foreground hover:bg-muted/20'
                      }`}
                    >
                      {f.path.split('/').pop()}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-auto bg-card dark:bg-card">
                  <pre className="p-4 text-[11px] font-mono leading-[1.7]">
                    {(diffFiles.find(f => f.path === activeDiffFile)?.content || '').split('\n').map((line, i) => {
                      let bg = 'transparent'
                      let color = '#8b949e'
                      if (line.startsWith('+') && !line.startsWith('+++')) {
                        bg = 'rgba(63, 185, 80, 0.08)'
                        color = '#7ee787'
                      } else if (line.startsWith('-') && !line.startsWith('---')) {
                        bg = 'rgba(248, 81, 73, 0.08)'
                        color = '#ff7b72'
                      } else if (line.startsWith('@@')) {
                        bg = 'rgba(56, 139, 253, 0.06)'
                        color = '#79c0ff'
                      } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
                        color = '#484f58'
                      }
                      return (
                        <div key={`${i}:${line}`} style={{ background: bg }} className="px-3 -mx-4">
                          <span className="inline-block w-8 text-right mr-3 select-none" style={{ color: '#484f58' }}>{i + 1}</span>
                          <span style={{ color }}>{line}</span>
                        </div>
                      )
                    })}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showStopConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border/40 rounded-xl shadow-lg p-6 max-w-sm">
            <h3 className="text-sm font-semibold text-foreground mb-2">Stop task?</h3>
            <p className="text-[11px] text-muted-foreground mb-4">
              Stop active work and return to Backlog. Your plan, feedback, files, branch and PR stay intact. Starting again requires a new plan approval.
            </p>
            {stopError && <p role="alert" className="mb-3 text-xs text-destructive">{stopError}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => dispatchUI({ type: 'set-stop-confirm', value: false })} className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg text-muted-foreground hover:text-foreground transition-all">
                Cancel
              </button>
              <button onClick={confirmStop} className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all">
                Stop task
              </button>
            </div>
          </div>
        </div>
      )}

      {showFeedback && (
        <FeedbackDialog
          onSubmit={handleReject}
          onCancel={() => dispatchUI({ type: 'set-feedback', value: false })}
          hasPR={!!prUrl}
        />
      )}

      {config && projectId && (
        <PRCreateDialog
          open={prDialogOpen}
          onClose={() => dispatchUI({ type: 'set-pr-dialog', value: false })}
          onSubmit={async ({ title: prTitle, body, base, head, draft }) => {
            const result = await createGitHubPR(config, identifier, { title: prTitle, body, base, head })
            void draft
            const url = (result as { html_url?: string; url?: string }).html_url || result.url || ''
            dispatchWorkflow({ type: 'set-pr-url', value: url })
            dispatchUI({ type: 'set-pr-dialog', value: false })
            if (onUpdate) await onUpdate({ pr_url: url, state: 'Done' })
          }}
          issueTitle={localTitle}
          issueDescription={description}
          branchName={(typed.branch_name as string) || ''}
          config={config}
          projectId={projectId}
        />
      )}
    </div>
  )
}
