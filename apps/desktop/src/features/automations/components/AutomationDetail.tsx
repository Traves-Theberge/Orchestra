import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import type { Automation, AutomationRun, BackendConfig } from '@core/api/client'
import { useNow } from '@/hooks/use-now'
import { HarnessIcon } from '@ui/HarnessIcon'
import { Button } from '@ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ui/tabs'
import { useAutomationRuns } from '../hooks/use-automations'
import { formatAbsolute, formatRelative, graceLabel } from '../lib/schedule'
import { RunsList } from './RunsList'
import { Caption, EnabledBadge, ErrorStrip, RunStatusBadge } from './shared'

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border/70 px-3 py-2.5">
      <Caption>{label}</Caption>
      <div className="mt-1 truncate text-[13px]">{children}</div>
    </div>
  )
}

const PROMPT_PREVIEW_LINES = 8

export type AutomationDetailTab = 'overview' | 'runs'

export function AutomationDetail({ config, automation, initialTab = 'overview', onBack, onEdit, onRunNow, onTogglePaused, onDelete, onOpenRun, onOpenTask }: {
  config: BackendConfig
  automation: Automation
  initialTab?: AutomationDetailTab
  onBack: () => void
  onEdit: (automation: Automation) => void
  onRunNow: (automation: Automation) => void
  onTogglePaused: (automation: Automation) => void
  onDelete: (automation: Automation) => void
  onOpenRun: (run: AutomationRun) => void
  onOpenTask?: (identifier: string) => void
}) {
  const [tab, setTab] = useState<AutomationDetailTab>(initialTab)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const { runs, error, refresh } = useAutomationRuns(config, automation.id)
  const now = useNow(30_000)
  const totalTokens = useMemo(() => runs.reduce((sum, run) => sum + (run.usage?.total_tokens ?? 0), 0), [runs])
  const promptLines = automation.prompt.split('\n')
  const longPrompt = promptLines.length > PROMPT_PREVIEW_LINES || automation.prompt.length > 600
  const shownPrompt = promptExpanded || !longPrompt ? automation.prompt : promptLines.slice(0, PROMPT_PREVIEW_LINES).join('\n').slice(0, 600)

  const nextRun = !automation.enabled ? 'Paused' : automation.next_run_at ? `${formatAbsolute(automation.next_run_at)}${now ? ` (${formatRelative(automation.next_run_at, now)})` : ''}` : '—'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[13px] text-muted-foreground" onClick={onBack}><ArrowLeft className="size-3.5" />All automations</Button>
        <span className="text-muted-foreground/50">/</span>
        <h1 className="min-w-0 truncate text-[14px] font-medium">{automation.name}</h1>
        <EnabledBadge enabled={automation.enabled ?? true} />
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => onRunNow(automation)}><Play className="size-3.5" />Run now</Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => onEdit(automation)}><Pencil className="size-3.5" />Edit</Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => onTogglePaused(automation)}>
          {automation.enabled ? <><Pause className="size-3.5" />Pause</> : <><Play className="size-3.5" />Resume</>}
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-red-500 hover:text-red-500" onClick={() => onDelete(automation)}><Trash2 className="size-3.5" />Delete</Button>
      </div>

      <Tabs value={tab} onValueChange={value => setTab(value as AutomationDetailTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="px-4 pt-2">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runs">Runs{runs.length ? <span className="ml-1.5 text-[11px] text-muted-foreground">{runs.length}</span> : null}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-5 px-6 py-5">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
              <Metric label="Next run">{nextRun}</Metric>
              <Metric label="Last run">
                {automation.last_run_at
                  ? <span className="flex items-center gap-2">{automation.last_run_status ? <RunStatusBadge status={automation.last_run_status} /> : null}<span className="truncate text-muted-foreground">{formatAbsolute(automation.last_run_at)}</span></span>
                  : <span className="text-muted-foreground">Never ran</span>}
              </Metric>
              <Metric label="Schedule">{automation.schedule_description || automation.schedule.kind}</Metric>
              <Metric label="Agent"><span className="flex items-center gap-1.5"><HarnessIcon id={automation.provider} size={14} /><span className="truncate">{[automation.provider, automation.model].filter(Boolean).join(' · ')}{automation.reasoning_effort ? ` · ${automation.reasoning_effort}` : ''}</span></span></Metric>
              <Metric label="Project">{automation.project_name || (automation.project_id ? automation.project_id : <span className="text-muted-foreground">None (Maestro)</span>)}</Metric>
              <Metric label="Task">
                {automation.task_id ? (
                  onOpenTask ? <button type="button" className="truncate underline-offset-2 hover:underline" onClick={() => onOpenTask(automation.task_identifier || automation.task_id || '')}>{automation.task_identifier || automation.task_id}{automation.task_title ? ` · ${automation.task_title}` : ''}</button>
                    : <>{automation.task_identifier || automation.task_id}</>
                ) : <span className="text-muted-foreground">None</span>}
              </Metric>
              <Metric label="Workspace">{!automation.project_id ? 'Maestro' : automation.workspace_mode === 'new_worktree' ? `New worktree${automation.base_branch ? ` from ${automation.base_branch}` : ''}` : 'Project root'}</Metric>
              <Metric label="Grace">{graceLabel(automation.grace_minutes)}</Metric>
              <Metric label="Precheck">{automation.precheck?.command ? <code className="font-mono text-[12px]" title={automation.precheck.command}>{automation.precheck.command}</code> : <span className="text-muted-foreground">None</span>}</Metric>
              <Metric label="Tokens">{totalTokens ? totalTokens.toLocaleString() : '—'}</Metric>
            </div>

            <section aria-label="Prompt">
              <Caption>Prompt</Caption>
              <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 font-mono text-[12px] leading-5">{shownPrompt}{!promptExpanded && longPrompt ? '…' : ''}</pre>
              {longPrompt ? (
                <button type="button" className="mt-1.5 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setPromptExpanded(value => !value)}>
                  {promptExpanded ? 'Show less' : 'Show more'}
                </button>
              ) : null}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="runs" className="flex min-h-0 flex-1 flex-col">
          {error ? <div className="px-4 pt-3"><ErrorStrip message={error} onRetry={() => void refresh()} /></div> : null}
          <div className="m-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
            <RunsList runs={runs} showAutomation={false} onOpenRun={onOpenRun} emptyText="This automation has not run yet." />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
