import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type Reducer } from 'react'
import { CheckCircle2, FileText, GitPullRequest, Github, Info, Loader2, Pencil, Terminal, X } from 'lucide-react'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'

import type { BackendConfig, IssueUpdatePayload } from '@core/api/client'
import { fetchIssueHistory, fetchIssueDiff, fetchIssueLogs, stopIssue, createGitHubPR } from '@core/api/client'
import type { SnapshotPayload } from '@core/api/types'
import type { TimelineItem } from '@layout/types'
import { AgentSelector } from '@layout/shared/controls'
import { AppTooltip } from '@ui/tooltip-wrapper'
import type { IssueDetailResult } from './types'
import { FeedbackDialog } from './FeedbackDialog'
import { PRCreateDialog } from './PRCreateDialog'
import { extractPlanFromText, parseDiff, type DiffFile, type PlanItem } from './IssueDetailUtils'
import { setCachedPlan, clearCachedPlan } from './plan-cache'
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

type WorkflowAction =
  | { type: 'set-state'; value: string }
  | { type: 'set-assignee'; value: string }
  | { type: 'set-title'; value: string }
  | { type: 'set-description'; value: string }
  | { type: 'set-pr-url'; value: string | null }
  | { type: 'sync-from-result'; value: WorkflowState }

const workflowReducer: Reducer<WorkflowState, WorkflowAction> = (state, action) => {
  switch (action.type) {
    case 'set-state':
      return { ...state, state: action.value }
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
  bottomTab: 'details' | 'plan' | 'output' | 'changes'
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
  timeline: _timeline = EMPTY_TIMELINE,
  availableAgents = EMPTY_AGENTS,
  theme,
}: {
  result: IssueDetailResult | null
  onUpdate?: (updates: IssueUpdatePayload) => Promise<void>
  onStopSession?: (provider?: string) => Promise<void>
  config: BackendConfig | null
  snapshot: SnapshotPayload | null
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

  useEffect(() => {
    dispatchWorkflow({
      type: 'sync-from-result',
      value: {
        state: (typed.state as string) || 'Todo',
        assignee: (typed.assignee_id as string) || '',
        title: (typed.title as string) || 'No Title',
        description: (typed.description as string) || '',
        prUrl: (typed.pr_url as string) || null,
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultId])

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
  const isRunning = snapshot?.running?.some(r => r.issue_id === issueId || r.issue_identifier === identifier) ?? false

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

  const handleStateChange = async (newState: string) => {
    dispatchWorkflow({ type: 'set-state', value: newState })
    if (newState !== 'In Progress' && isRunning && onStopSession) {
      await onStopSession(provider)
    }
    if (newState === 'Backlog' || newState === 'Todo') {
      issueHistoryRef.current = []
      dispatchSession({ type: 'reset' })
    }
    if (newState === 'Backlog') {
      clearCachedPlan(identifier)
    }
    if (onUpdate) await onUpdate({ state: newState })
  }

  const handleAssigneeChange = async (newAssignee: string) => {
    dispatchWorkflow({ type: 'set-assignee', value: newAssignee })
    const agentName = newAssignee.replace('agent-', '')
    if (onUpdate) await onUpdate({ assignee_id: newAssignee, provider: agentName })
  }

  const confirmStop = async () => {
    if (!config) return
    try {
      await stopIssue(config, identifier)
      dispatchUI({ type: 'set-stop-confirm', value: false })
      dispatchWorkflow({ type: 'set-state', value: 'Backlog' })
      issueHistoryRef.current = []
      dispatchSession({ type: 'reset' })
      clearCachedPlan(issueId || identifier)
      onUpdate?.({ state: 'Backlog', feedback: '' })
    } catch (err) {
      console.error('stop failed', err)
    }
  }

  const handleReject = async (feedback: string) => {
    dispatchUI({ type: 'set-feedback', value: false })
    if (prUrl) {
      dispatchWorkflow({ type: 'set-state', value: 'In Progress' })
      onUpdate?.({ state: 'In Progress', feedback })
    } else {
      dispatchWorkflow({ type: 'set-state', value: 'Todo' })
      onUpdate?.({ state: 'Todo', feedback })
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
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border/30">
        <div className="flex items-center gap-4 px-6 h-14 pr-12">
          <span className="shrink-0 font-mono text-[11px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/15">{identifier}</span>
          <h2 className="text-base font-semibold truncate flex-1 min-w-0">{localTitle}</h2>
          <div className="flex items-center gap-2 shrink-0">
          {localState === 'Review' && config && projectId && onUpdate && (
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
              ) : (
                <AppTooltip content="Push branch and create a GitHub pull request" side="bottom">
                  <button
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all"
                    onClick={() => dispatchUI({ type: 'set-pr-dialog', value: true })}
                  >
                    <GitPullRequest size={14} />
                    Create PR
                  </button>
                </AppTooltip>
              )}
              <AppTooltip content="Send feedback and re-dispatch the agent to make changes" side="bottom">
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-muted/20 text-muted-foreground border border-border/30 hover:bg-muted/40 transition-colors"
                  onClick={() => dispatchUI({ type: 'set-feedback', value: true })}
                >
                  <Pencil size={12} />
                  Request Changes
                </button>
              </AppTooltip>
              <AppTooltip content="Close this task and clean up the worktree" side="bottom">
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-red-500 border border-red-500/30 hover:bg-red-500/10 transition-colors"
                  onClick={async () => { await onUpdate({ state: 'Done' }); dispatchWorkflow({ type: 'set-state', value: 'Done' }) }}
                >
                  <X size={12} />
                  Close
                </button>
              </AppTooltip>
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
                <div className="px-4 py-3 text-base text-foreground/80 whitespace-pre-wrap leading-relaxed">
                  {localDescription || 'No description'}
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
                        onClick={async () => {
                          if (!canMove) return
                          dispatchWorkflow({ type: 'set-state', value: 'Todo' })
                          if (onUpdate) await onUpdate({ state: 'Todo' })
                        }}
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
                        <span className="size-2 rounded-full bg-blue-500" />
                        <span className="text-[11px] text-blue-400">Planning</span>
                      </div>
                      <button
                        onClick={async () => {
                          dispatchWorkflow({ type: 'set-state', value: 'In Progress' })
                          if (onUpdate) await onUpdate({ state: 'In Progress' })
                        }}
                        className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-all"
                      >
                        Start Execution
                      </button>
                      <button onClick={() => dispatchUI({ type: 'set-stop-confirm', value: true })} className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all">
                        Stop &amp; Reset
                      </button>
                    </div>
                  )}

                  {localState === 'In Progress' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                        <span className="text-[11px] text-amber-400">Executing</span>
                      </div>
                      <button onClick={() => dispatchUI({ type: 'set-stop-confirm', value: true })} className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all">
                        Stop &amp; Reset
                      </button>
                    </div>
                  )}

                  {localState === 'Review' && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-purple-500" />
                        <span className="text-[11px] text-purple-400">{prUrl ? 'PR Created' : 'Awaiting Review'}</span>
                      </div>
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
                  {isRunning ? 'Waiting for agent to create plan...' : localState === 'Todo' ? 'Plan will appear when agent starts' : 'No plan recorded'}
                </p>
                {isRunning && <Loader2 size={14} className="animate-spin-smooth text-primary/30" />}
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
            <h3 className="text-sm font-semibold text-foreground mb-2">Stop &amp; Reset Task?</h3>
            <p className="text-[11px] text-muted-foreground mb-4">
              This will clear the plan and all changes. The task will return to Backlog for editing.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => dispatchUI({ type: 'set-stop-confirm', value: false })} className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg text-muted-foreground hover:text-foreground transition-all">
                Cancel
              </button>
              <button onClick={confirmStop} className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all">
                Stop &amp; Reset
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
            dispatchWorkflow({ type: 'set-state', value: 'Done' })
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
