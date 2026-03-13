import { useEffect, useMemo, useRef, useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  Activity,
  Bot,
  Check,
  Clock,
  Cpu,
  ExternalLink,
  FileText,
  GitBranch,
  ListChecks,
  Play,
  Rows,
  Settings2,
  Sparkles,
  Square,
  Target,
  Terminal,
  Users,
  Wrench,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AppTooltip } from '@/components/ui/tooltip-wrapper'
import { CustomDropdown, PriorityIcon, PriorityLabel } from '@/components/app-shell/shared/controls'
import type { TimelineItem } from '@/components/app-shell/types'
import type { RunningEntry } from '@/lib/orchestra-types'
import { extractOperationalPlanItems, type IssueHook } from './IssueDetailUtils'
import type { IssueHistoryEntry, ToolSummary } from './types'

const AGENT_STATES = ['Todo', 'In Progress', 'Done']

export function OverviewTab({
  activeSessions,
  localProvider,
  setLocalProvider,
  identifier,
  issueId,
  title,
  localState,
  handleStateChange,
  localAssignee,
  availableAgents,
  handleAssigneeChange,
  prResult,
  handleCreatePR,
  prPending,
  onStopSession,
  onNavigate,
  description,
  reportContent,
  setActiveTab,
  timeline,
  allTools,
  disabledTools,
  handleToggleTool,
  issueHistory,
  getEventIcon,
  priority,
  branchName,
  updatedAt,
  issueUrl,
  hooks,
  getHookStatus,
  hookOutputs,
  setSelectedHookLog,
}: {
  activeSessions: RunningEntry[]
  localProvider: string
  setLocalProvider: (provider: string) => void
  identifier: string
  issueId: string
  title: string
  localState: string
  handleStateChange: (state: string) => Promise<void>
  localAssignee: string
  availableAgents: string[]
  handleAssigneeChange: (assignee: string) => Promise<void>
  prResult: { url: string; number: number } | null
  handleCreatePR: () => void
  prPending: boolean
  onStopSession?: (provider?: string) => Promise<void>
  onNavigate?: (section: string) => void
  description: string
  reportContent: string | null
  setActiveTab: (tab: 'overview' | 'changes' | 'logs' | 'artifacts' | 'activity') => void
  timeline: TimelineItem[]
  allTools: ToolSummary[]
  disabledTools: string[]
  handleToggleTool: (toolName: string) => Promise<void>
  issueHistory: IssueHistoryEntry[]
  getEventIcon: (kind: string) => React.ReactNode
  priority: number
  branchName: string
  updatedAt: string
  issueUrl: string
  hooks: IssueHook[]
  getHookStatus: (type: string) => string
  hookOutputs: Record<string, string>
  setSelectedHookLog: (value: { id: string; label: string; output: string } | null) => void
}) {
  const planItems = extractOperationalPlanItems(timeline, issueId, identifier, description)
  const completedPlanItems = planItems.filter((item) => item.done).length
  const totalPlanItems = planItems.length
  const remainingPlanItems = totalPlanItems - completedPlanItems
  const planProgress = totalPlanItems === 0 ? 0 : Math.round((completedPlanItems / totalPlanItems) * 100)
  const [newPlanItemSignatures, setNewPlanItemSignatures] = useState<Set<string>>(new Set())
  const previousPlanItemSignaturesRef = useRef<Set<string>>(new Set())

  const planItemSignatures = useMemo(() => {
    const seenByText = new Map<string, number>()
    return planItems.map((item) => {
      const keyText = item.text.trim().toLowerCase()
      const seenCount = seenByText.get(keyText) ?? 0
      seenByText.set(keyText, seenCount + 1)
      return `${keyText}::${seenCount}`
    })
  }, [planItems])

  useEffect(() => {
    const previous = previousPlanItemSignaturesRef.current
    const next = new Set(planItemSignatures)
    const added = planItemSignatures.filter((signature) => !previous.has(signature))

    if (added.length > 0 && previous.size > 0) {
      setNewPlanItemSignatures(new Set(added))
      const timer = window.setTimeout(() => {
        setNewPlanItemSignatures(new Set())
      }, 1400)
      previousPlanItemSignaturesRef.current = next
      return () => window.clearTimeout(timer)
    }

    previousPlanItemSignaturesRef.current = next
    return undefined
  }, [planItemSignatures])

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-3 pr-1">
      {activeSessions.length > 1 && (
        <div className="rounded-lg border border-border bg-muted/30 p-2 space-y-2 shrink-0">
          <div className="flex items-center gap-2">
            <Activity size={12} className="text-primary" />
            <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">Active Contexts</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {activeSessions.map((session) => {
              const sessionProvider = session.provider || 'default'
              return (
                <AppTooltip key={sessionProvider} content={`Switch view to ${sessionProvider} agent context`}>
                  <button
                    onClick={() => setLocalProvider(sessionProvider)}
                    className={`flex items-center gap-2 px-2 py-1 rounded-md border transition-all ${localProvider === sessionProvider ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-card/20 border-border text-muted-foreground hover:bg-muted/20'}`}
                  >
                    <Cpu size={10} />
                    <span className="text-[9px] font-bold uppercase tracking-tight">{sessionProvider}</span>
                  </button>
                </AppTooltip>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-background shadow-2xl flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center justify-between gap-4 p-3 bg-muted/30 border-b border-border shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="font-mono text-[9px] h-4 uppercase bg-primary/10 text-primary border-primary/20 px-1">
                {identifier}
              </Badge>
              <h3 className="truncate text-base font-black tracking-tight text-foreground">{title}</h3>
            </div>
            <div className="flex items-center gap-2">
              <AppTooltip content="Task State">
                <CustomDropdown
                  className="h-7 w-32 border-border bg-card text-[10px]"
                  value={localState}
                  options={AGENT_STATES.map((s) => ({ label: s, value: s }))}
                  onChange={(value) => void handleStateChange(String(value))}
                />
              </AppTooltip>
              <AppTooltip content="Active Agent">
                <CustomDropdown
                  className="h-7 w-48 border-border bg-card text-[10px]"
                  value={localAssignee.startsWith('agent-') ? localAssignee : availableAgents.includes(localAssignee) ? `agent-${localAssignee}` : localAssignee}
                  options={[
                    { label: 'Unassigned', value: 'Unassigned', icon: <Users className="h-3 w-3 text-muted-foreground" /> },
                    ...availableAgents.map((agent) => ({
                      label: `Agent: ${agent.charAt(0).toUpperCase() + agent.slice(1)}`,
                      value: `agent-${agent}`,
                      icon: <Bot className="h-3 w-3 text-primary/70" />,
                    })),
                  ]}
                  onChange={(value) => void handleAssigneeChange(String(value))}
                />
              </AppTooltip>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {localState === 'Done' && !prResult && (
              <Button variant="outline" size="sm" className="h-7 px-2 gap-1 border-primary/30 text-primary text-[10px]" onClick={handleCreatePR} disabled={prPending}>
                <GitBranch size={10} /> PR
              </Button>
            )}
            {(localState === 'Todo' || localState === 'Done') && (
              <Button variant="default" size="sm" className="h-7 px-3 gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-[10px]" onClick={() => void handleStateChange('In Progress')}>
                <Play size={10} fill="currentColor" /> RUN
              </Button>
            )}
            {localState === 'In Progress' && onStopSession && (
              <Button variant="outline" size="sm" className="h-7 border-red-500/30 text-red-500 text-[10px]" onClick={() => void onStopSession(localProvider)}>
                <Square size={8} fill="currentColor" className="mr-1" /> STOP
              </Button>
            )}
            {(localState === 'Retry' || localState === 'Blocked') && onNavigate && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 gap-1.5 border-amber-500/30 text-amber-500 hover:bg-amber-500/10 text-[10px] font-black uppercase tracking-widest"
                onClick={() => onNavigate('settings')}
              >
                <Settings2 size={10} />
                Update Credentials
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 grid grid-cols-12 divide-x divide-border overflow-hidden">
          <div className="col-span-8 flex flex-col divide-y divide-border overflow-hidden">
            {description && (
              <div className="p-3 shrink-0">
                <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">
                  <FileText size={10} /> Description
                </div>
                <div className="max-h-24 overflow-auto custom-scrollbar">
                  <p className="text-[11px] leading-relaxed text-muted-foreground/80">{description}</p>
                </div>
              </div>
            )}

            {reportContent && (
              <div className="p-3 bg-primary/5 border-b border-border/10">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-primary">
                    <FileText size={10} /> Autonomous Report
                  </div>
                  <Badge variant="outline" className="text-[7px] border-primary/20 text-primary px-1">Verified Summary</Badge>
                </div>
                <div className="bg-background/40 border border-primary/10 rounded-xl p-4 prose prose-invert prose-xs max-w-none overflow-hidden max-h-64 relative group">
                  <div className="text-[11px] leading-relaxed text-foreground/90 font-medium">
                    <SyntaxHighlighter language="markdown" style={oneDark} customStyle={{ background: 'transparent', padding: 0, margin: 0, fontSize: '11px' }}>
                      {reportContent.slice(0, 500) + (reportContent.length > 500 ? '...' : '')}
                    </SyntaxHighlighter>
                  </div>
                  {reportContent.length > 500 && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background/80 to-transparent flex items-end justify-center pb-2">
                      <button onClick={() => setActiveTab('artifacts')} className="text-[9px] font-black uppercase tracking-widest text-primary hover:underline">
                        Read Full Report
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="relative overflow-hidden border-b border-border/20 bg-gradient-to-br from-primary/10 via-primary/5 to-background/90 px-3 py-3">
              <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
              <div className="pointer-events-none absolute -bottom-10 left-10 h-20 w-20 rounded-full bg-emerald-400/10 blur-2xl" />

              <div className="relative mb-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-[0.18em] text-primary/80">
                    <ListChecks size={11} /> Operational Plan
                  </div>
                  <p className="mt-1 text-[9px] font-medium text-muted-foreground/70">
                    Live task checklist parsed from agent execution updates.
                  </p>
                </div>
                {totalPlanItems > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="h-4 px-1.5 text-[8px] font-black border-primary/20 bg-primary/10 text-primary">
                      {completedPlanItems}/{totalPlanItems}
                    </Badge>
                    <Badge variant="outline" className="h-4 px-1.5 text-[8px] font-black border-emerald-400/20 bg-emerald-500/10 text-emerald-400">
                      {planProgress}%
                    </Badge>
                    <Badge variant="outline" className="h-4 px-1.5 text-[8px] font-black border-border/50 bg-background/70 text-muted-foreground/80">
                      <Sparkles size={8} className="mr-1" /> live
                    </Badge>
                  </div>
                )}
              </div>

              {totalPlanItems > 0 && (
                <div className="relative mb-3 rounded-lg border border-primary/20 bg-background/60 p-2 shadow-sm backdrop-blur-sm">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-primary/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary via-primary/90 to-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.35)] transition-all duration-700"
                      style={{ width: `${planProgress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="text-[8px] font-black uppercase tracking-widest text-primary/60">
                      {planProgress === 100 ? 'Mission complete' : 'Execution in progress'}
                    </div>
                    <div className="flex items-center gap-2 text-[8px] font-bold text-muted-foreground/70">
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400">
                        <Check size={8} /> {completedPlanItems}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-amber-400">
                        <Target size={8} /> {remainingPlanItems}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="relative max-h-56 space-y-1.5 overflow-auto custom-scrollbar pr-1">
                {planItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-primary/20 bg-background/50 px-2.5 py-2.5">
                    <div className="mb-2 flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-primary/60">
                      <Sparkles size={9} className="animate-pulse" /> plan pending
                    </div>
                    <div className="space-y-1.5">
                      <div className="h-2 w-5/6 rounded bg-muted/50 animate-pulse" />
                      <div className="h-2 w-4/6 rounded bg-muted/40 animate-pulse" />
                      <div className="h-2 w-3/6 rounded bg-muted/30 animate-pulse" />
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground/55 italic">Waiting for agent to formulate a plan...</div>
                  </div>
                ) : (
                  planItems.map((item, idx) => {
                    const signature = planItemSignatures[idx]
                    const isNewPlanItem = newPlanItemSignatures.has(signature)

                    return (
                    <div
                      key={signature}
                      className={`group flex items-start gap-2 rounded-lg border px-2.5 py-2 transition-all duration-300 ${item.done ? 'border-primary/20 bg-primary/10 shadow-[inset_0_0_0_1px_rgba(var(--primary),0.12),0_8px_20px_rgba(0,0,0,0.12)]' : 'border-border/60 bg-background/70 hover:border-primary/25 hover:bg-background hover:shadow-[0_6px_18px_rgba(0,0,0,0.12)]'} ${isNewPlanItem ? 'ring-1 ring-primary/35 animate-pulse shadow-[0_0_0_1px_rgba(var(--primary),0.2),0_0_22px_rgba(var(--primary),0.18)]' : ''}`}
                      style={{ transitionDelay: `${Math.min(idx * 40, 220)}ms` }}
                    >
                      <span className={`mt-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border px-1 text-[8px] font-black tabular-nums ${item.done ? 'border-primary/30 bg-primary/15 text-primary/70' : 'border-border/70 bg-card text-muted-foreground/55'}`}>{idx + 1}</span>
                      <div className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border transition-colors ${item.done ? 'bg-primary border-primary text-primary-foreground shadow-[0_0_10px_rgba(var(--primary),0.5)]' : 'border-border bg-card group-hover:border-primary/30'}`}>
                        {item.done && <Check size={8} strokeWidth={4} />}
                      </div>
                      <span className={`text-[10px] font-semibold leading-tight transition-colors ${item.done ? 'text-foreground/50 line-through' : 'text-foreground/85'}`}>
                        {item.text}
                      </span>
                    </div>
                  )})
                )}
              </div>
            </div>

            <div className="p-3 flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-muted-foreground">
                  <Wrench size={10} /> Agent Capabilities
                </div>
                <span className="text-[8px] font-bold text-primary/60">{allTools.length - disabledTools.length} Enabled</span>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <div className="flex flex-wrap gap-1">
                  {allTools.map((tool) => {
                    const isDisabled = disabledTools.includes(tool.name)
                    return (
                      <button
                        key={tool.name}
                        onClick={() => void handleToggleTool(tool.name)}
                        className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase border transition-all ${isDisabled ? 'border-border text-muted-foreground/40 opacity-40' : 'border-primary/20 bg-primary/10 text-primary'}`}
                      >
                        {tool.name.includes('_') ? tool.name.split('_')[1] : tool.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="p-3 bg-muted/10 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-muted-foreground">
                  <Activity size={10} /> Runtime Pulse
                </div>
              </div>
              <div className="space-y-1">
                {issueHistory.slice(0, 2).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-2 py-1 rounded bg-muted/30 border border-border">
                    <div className="shrink-0 scale-75">{getEventIcon(item.kind)}</div>
                    <p className="text-[9px] font-bold text-muted-foreground/80 truncate flex-1">{item.message || item.kind}</p>
                    <span className="text-[7px] font-mono text-muted-foreground/40 tabular-nums">{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="col-span-4 flex flex-col divide-y divide-border bg-muted/10 overflow-hidden">
            <div className="grid grid-cols-1 divide-y divide-border shrink-0">
              <div className="p-2.5">
                <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground mb-1">Status & Priority</div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] font-bold text-foreground/90">
                    <div className={`h-1.5 w-1.5 rounded-full ${localState === 'In Progress' ? 'bg-amber-500 animate-pulse' : 'bg-primary'}`} />
                    {localState}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-bold text-foreground/90">
                    <PriorityIcon priority={priority} className="h-3 w-3" />
                    <PriorityLabel priority={priority} />
                  </div>
                </div>
              </div>
              <div className="p-2.5">
                <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground mb-1">Source Context</div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/60">
                    <GitBranch size={10} />
                    <span className="truncate">{branchName || 'main'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/60">
                    <Clock size={10} />
                    <span>{updatedAt ? new Date(updatedAt).toLocaleDateString() : 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-2.5 shrink-0">
              <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground mb-2">Remote System</div>
              {issueUrl ? (
                <a href={issueUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-1.5 rounded bg-primary/5 border border-primary/10 text-primary hover:bg-primary/10 transition-all">
                  <ExternalLink size={10} />
                  <span className="text-[9px] font-bold truncate">Open in Tracker</span>
                </a>
              ) : (
                <div className="text-[9px] text-muted-foreground/40 italic">No external link</div>
              )}
            </div>

            <div className="p-2.5 flex-1 flex flex-col overflow-hidden">
              <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground mb-2">Execution Hooks</div>
              <div className="space-y-1.5 overflow-auto custom-scrollbar pr-1">
                {hooks.map((hook) => {
                  const status = getHookStatus(hook.id)
                  const output = hookOutputs[hook.id]
                  return (
                    <div
                      key={hook.id}
                      className={`flex flex-col gap-1 p-1.5 rounded bg-muted/30 border transition-all ${output ? 'cursor-pointer hover:bg-muted/50 border-border/60' : 'border-border opacity-60'}`}
                      onClick={() => {
                        if (output) {
                          setSelectedHookLog({ id: hook.id, label: hook.label, output })
                        }
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[9px] font-bold text-foreground/90 truncate">{hook.label}</span>
                          {output && <Terminal size={8} className="text-primary/60 shrink-0" />}
                        </div>
                        <Badge variant="outline" className={`h-3 px-1 text-[6px] font-black uppercase ${status === 'completed' ? 'border-primary/20 text-primary' : status === 'active' ? 'border-amber-500/20 text-amber-500 animate-pulse' : status === 'failed' ? 'border-red-500/30 text-red-500' : 'text-muted-foreground/40 border-border'}`}>
                          {status}
                        </Badge>
                      </div>
                      {status === 'failed' && <p className="text-[8px] text-red-500/60 font-medium leading-none">Initialization failed</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
