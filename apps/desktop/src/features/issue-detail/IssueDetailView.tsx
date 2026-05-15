import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, FileText, GitPullRequest, Github, Info, Loader2, Pencil, Terminal, X } from 'lucide-react'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'

import type { BackendConfig, IssueUpdatePayload, IssueHistoryEntry } from '@core/api/client'
import { fetchIssueHistory, fetchIssueDiff, fetchIssueLogs, updateProjectGitHubIssue, stopIssue, createGitHubPR } from '@core/api/client'
import type { SnapshotPayload } from '@core/api/types'
import type { TimelineItem } from '@layout/types'
import { AgentSelector } from '@layout/shared/controls'
import { AppTooltip } from '@ui/tooltip-wrapper'
import type { IssueDetailResult } from './types'
import { FeedbackDialog } from './FeedbackDialog'
import { PRCreateDialog } from './PRCreateDialog'
import { extractOperationalPlanItems, extractPlanFromText, parseDiff, type DiffFile, type PlanItem } from './IssueDetailUtils'
import { getCachedPlan, setCachedPlan, clearCachedPlan } from './plan-cache'
import { SessionTimeline } from './SessionTimeline'
import { useAppStore } from '@core/store'

function SidebarRow({ label, content }: { label: string; content: React.ReactNode }) {
  const labelId = useId()
  return (
    <div className="px-4 py-3 border-b border-border/20" aria-labelledby={labelId}>
      <span id={labelId} className="text-[9px] font-black uppercase tracking-[0.15em] text-muted-foreground/30 mb-1.5 block">{label}</span>
      {content}
    </div>
  )
}

function DescriptionEditor({ value, onChange, onBlur, theme, projectId }: {
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  theme?: 'light' | 'dark'
  projectId?: string
}) {
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.selectionStart = textareaRef.current.value.length
    }
  }, [editing])

  if (editing) {
    return (
      <div className="flex-1 flex flex-col min-h-0 rounded-lg border border-primary/30 bg-muted/10 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 bg-muted/20 shrink-0">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Editing Markdown</span>
          <button
            className="text-[9px] font-bold uppercase tracking-widest text-primary/60 hover:text-primary transition-colors"
            onClick={() => setEditing(false)}
          >
            Preview
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="w-full flex-1 bg-transparent text-sm text-foreground font-mono outline-none focus:outline-none placeholder:text-muted-foreground/15 leading-relaxed resize-none p-4"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={() => { onBlur(); setEditing(false) }}
          placeholder="Describe what this task should accomplish...&#10;&#10;Supports **Markdown** formatting."
        />
      </div>
    )
  }

  if (!value.trim()) {
    return (
      <button
        className="flex-1 flex flex-col items-center justify-center rounded-lg border border-dashed border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-all cursor-text group"
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-5 text-muted-foreground/15 group-hover:text-primary/30 transition-colors mb-2" />
        <span className="text-sm text-muted-foreground/20 group-hover:text-muted-foreground/40 transition-colors">Click to add a description…</span>
      </button>
    )
  }

  return (
    <div
      className="flex-1 min-h-0 rounded-lg cursor-text transition-all group/md relative overflow-auto"
      onClick={() => setEditing(true)}
    >
      <div className="absolute top-2 right-2 opacity-0 group-hover/md:opacity-100 transition-opacity">
        <div className="flex items-center gap-1 rounded-md bg-muted/80 backdrop-blur px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 border border-border/30">
          <Pencil className="size-2.5" />
          Edit
        </div>
      </div>
      <div className={`prose ${theme === 'dark' ? 'prose-invert' : ''} prose-sm max-w-none text-foreground/70 leading-relaxed
        prose-headings:text-foreground prose-headings:font-bold prose-headings:tracking-tight
        prose-h1:text-lg prose-h1:border-b prose-h1:border-border/20 prose-h1:pb-2 prose-h1:mb-3
        prose-h2:text-base prose-h2:mb-2
        prose-h3:text-sm prose-h3:mb-1
        prose-p:mb-2 prose-p:text-foreground/60
        prose-a:text-primary prose-a:no-underline hover:prose-a:underline
        prose-strong:text-foreground/80 prose-strong:font-bold
        prose-code:text-[12px] prose-code:font-mono prose-code:bg-muted/40 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:border prose-code:border-border/20 prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-card dark:bg-card prose-pre:border prose-pre:border-border/20 prose-pre:rounded-lg
        prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-foreground/60
        prose-li:marker:text-muted-foreground/30
        prose-blockquote:border-l-primary/30 prose-blockquote:text-muted-foreground/50 prose-blockquote:italic prose-blockquote:not-italic prose-blockquote:font-normal
        prose-hr:border-border/20
        prose-img:rounded-lg prose-img:border prose-img:border-border/20
        prose-table:text-sm prose-th:text-foreground/70 prose-td:text-foreground/50
      `}>
        <MarkdownRenderer content={value} linkProjectId={projectId} />
      </div>
    </div>
  )
}

export function IssueDetailView({
  result,
  onUpdate,
  onStopSession,
  config,
  snapshot,
  timeline = [],
  availableAgents = [],
  theme,
}: {
  result: IssueDetailResult | null
  onUpdate?: (updates: IssueUpdatePayload) => Promise<void>
  onStopSession?: (provider?: string) => Promise<void>
  config: BackendConfig | null
  snapshot: SnapshotPayload | null
  timeline?: TimelineItem[]
  availableAgents?: string[]
  theme?: 'light' | 'dark'
}) {

  const typed = (result ?? {})
  const identifier = (typed.identifier as string) || (typed.issue_identifier as string) || ''
  const issueId = (typed.id as string) || (typed.issue_id as string) || ''
  const title = (typed.title as string) || 'No Title'
  const description = (typed.description as string) || ''
  const projectId = (typed.project_id as string) || ''
  const projectName = (typed.project_name as string) || ''
  const provider = (typed.provider as string) || ''

  const openBrowserTab = useAppStore((s) => s.openBrowserTab)
  const setActiveSection = useAppStore((s) => s.setActiveSection)
  const openInInternalBrowser = (url: string) => {
    setActiveSection('CONSOLE')
    openBrowserTab(url, projectId || undefined)
  }

  const [localState, setLocalState] = useState((typed.state as string) || 'Todo')
  const [localAssignee, setLocalAssignee] = useState((typed.assignee_id as string) || '')
  const [localTitle, setLocalTitle] = useState(title)
  const [localDescription, setLocalDescription] = useState(description)
  const [bottomTab, setBottomTab] = useState<'details' | 'plan' | 'output' | 'changes'>('details')
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [prDialogOpen, setPRDialogOpen] = useState(false)
  const [prUrl, setPrUrl] = useState<string | null>((typed.pr_url as string) || null)

  const isEditable = localState === 'Backlog'

  const [issueHistory, setIssueHistory] = useState<IssueHistoryEntry[]>([])
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(localState !== 'Backlog')
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([])
  const [diffLoading, setDiffLoading] = useState(false)
  const [activeDiffFile, setActiveDiffFile] = useState<string | null>(null)


  // Only sync state/assignee from result (these are set by dropdowns, not typed input)
  // Title and description are user-editable text - only set on initial load, not on re-fetches
  const resultId = (typed.id as string) || (typed.issue_id as string) || ''
  useEffect(() => {
    setLocalState((typed.state as string) || 'Todo')
    setLocalAssignee((typed.assignee_id as string) || '')
    setLocalTitle((typed.title as string) || 'No Title')
    setLocalDescription((typed.description as string) || '')
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

  // Fetch history on mount + poll while running (for live operational plan updates)
  // Skip fetching when in Backlog/Todo — no agent data to show
  useEffect(() => {
    if (!config || !identifier) return
    if (localState === 'Backlog') {
      setIssueHistory([])
      return
    }
    fetchIssueHistory(config, identifier)
      .then(setIssueHistory)
      .catch(() => setIssueHistory([]))
  }, [config, identifier, localState])

  // Refresh history when orchestrator data changes (SSE-driven, no polling)
  useEffect(() => {
    const handler = () => {
      if (!config || !identifier || localState === 'Backlog') return
      fetchIssueHistory(config, identifier)
        .then(setIssueHistory)
        .catch(() => {})
    }
    window.addEventListener('orchestra-data-changed', handler)
    return () => window.removeEventListener('orchestra-data-changed', handler)
  }, [config, identifier, localState])

  // Fetch tab-specific data
  useEffect(() => {
    if (!config || !identifier) return
    if (localState !== 'Backlog') {
      setLogsLoading(true)
      fetchIssueLogs(config, identifier, provider)
        .then(setLogs)
        .catch(() => setLogs(''))
        .finally(() => setLogsLoading(false))
    }
    if (bottomTab === 'changes' && (isRunning || localState === 'In Progress' || localState === 'Review' || localState === 'Done')) {
      setDiffLoading(true)
      fetchIssueDiff(config, identifier, provider)
        .then(raw => {
          const files = parseDiff(raw)
          setDiffFiles(files)
          if (files.length > 0) setActiveDiffFile(files[0].path)
        })
        .catch(() => setDiffFiles([]))
        .finally(() => setDiffLoading(false))
    }
  }, [bottomTab, config, identifier, provider, localState, isRunning])

  const handleStateChange = async (newState: string) => {
    setLocalState(newState)
    // Moving to Done or Todo while running → stop the agent session first
    if (newState !== 'In Progress' && isRunning && onStopSession) {
      await onStopSession(provider)
    }
    // Reset plan/activity/output when moving back to Backlog or Todo
    if (newState === 'Backlog' || newState === 'Todo') {
      setIssueHistory([])
      setLogs('')
      setDiffFiles([])
      setActiveDiffFile(null)
    }
    if (newState === 'Backlog') {
      clearCachedPlan(identifier)
    }
    if (onUpdate) await onUpdate({ state: newState })
  }

  const handleAssigneeChange = async (newAssignee: string) => {
    setLocalAssignee(newAssignee)
    const agentName = newAssignee.replace('agent-', '')
    if (onUpdate) await onUpdate({ assignee_id: newAssignee, provider: agentName })
  }

  const confirmStop = async () => {
    if (!config) return
    try {
      await stopIssue(config, identifier)
      setShowStopConfirm(false)
      setLocalState('Backlog')
      // Clear all session artifacts
      setIssueHistory([])
      setLogs('')
      setDiffFiles([])
      setActiveDiffFile(null)
      clearCachedPlan(issueId || identifier)
      onUpdate?.({ state: 'Backlog', feedback: '' })
    } catch (err) {
      console.error('stop failed', err)
    }
  }

  const handleReject = async (feedback: string) => {
    setShowFeedback(false)
    if (prUrl) {
      // PR exists — go straight to execution, no re-planning
      setLocalState('In Progress')
      onUpdate?.({ state: 'In Progress', feedback })
    } else {
      // No PR — re-plan with feedback context
      setLocalState('Todo')
      onUpdate?.({ state: 'Todo', feedback })
    }
  }

  if (!result) {
    return <div className="h-full flex items-center justify-center text-muted-foreground/30 text-sm italic">No issue data.</div>
  }

  const _stateColor = localState === 'Done' ? 'text-primary' : localState === 'In Progress' ? 'text-amber-500' : 'text-muted-foreground'
  const _stateDot = localState === 'Done' ? 'bg-primary' : localState === 'In Progress' ? 'bg-amber-500 animate-pulse' : 'bg-muted-foreground/40'

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
                    onClick={() => setPRDialogOpen(true)}
                  >
                    <GitPullRequest size={14} />
                    Create PR
                  </button>
                </AppTooltip>
              )}
              <AppTooltip content="Send feedback and re-dispatch the agent to make changes" side="bottom">
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-muted/20 text-muted-foreground border border-border/30 hover:bg-muted/40 transition-colors"
                  onClick={() => setShowFeedback(true)}
                >
                  <Pencil size={12} />
                  Request Changes
                </button>
              </AppTooltip>
              <AppTooltip content="Close this task and clean up the worktree" side="bottom">
                <button
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-red-500 border border-red-500/30 hover:bg-red-500/10 transition-colors"
                  onClick={async () => { await onUpdate({ state: 'Done' }); setLocalState('Done') }}
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
            onClick={() => setBottomTab(tab.id)}
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
                  onChange={e => setLocalTitle(e.target.value)}
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
                  onChange={setLocalDescription}
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
                          setLocalState('Todo')
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
                          setLocalState('In Progress')
                          if (onUpdate) await onUpdate({ state: 'In Progress' })
                        }}
                        className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-all"
                      >
                        Start Execution
                      </button>
                      <button onClick={() => setShowStopConfirm(true)} className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all">
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
                      <button onClick={() => setShowStopConfirm(true)} className="w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all">
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
                    <AgentSelector value={localAssignee} agents={availableAgents} onChange={handleAssigneeChange} direction="down" />
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
                    {(typed.created_at as string) ? new Date(typed.created_at as string).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
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
                      onClick={() => setActiveDiffFile(f.path)}
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
                        <div key={i} style={{ background: bg }} className="px-3 -mx-4">
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
              <button onClick={() => setShowStopConfirm(false)} className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-lg text-muted-foreground hover:text-foreground transition-all">
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
          onCancel={() => setShowFeedback(false)}
          hasPR={!!prUrl}
        />
      )}

      {config && projectId && (
        <PRCreateDialog
          open={prDialogOpen}
          onClose={() => setPRDialogOpen(false)}
          onSubmit={async ({ title: prTitle, body, base, head, draft }) => {
            const result = await createGitHubPR(config, identifier, { title: prTitle, body, base, head })
            void draft
            const url = (result as any).html_url || result.url || ''
            setPrUrl(url)
            setPRDialogOpen(false)
            // Auto-advance to Done after PR creation
            if (onUpdate) await onUpdate({ pr_url: url, state: 'Done' })
            setLocalState('Done')
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
