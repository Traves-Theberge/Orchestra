import type { ReactNode } from 'react'
import { ArrowLeft, ListTodo, MessageSquare, RotateCcw, Square } from 'lucide-react'
import type { Automation, AutomationRun, BackendConfig } from '@core/api/client'
import { useNow } from '@/hooks/use-now'
import { Button } from '@ui/button'
import { MarkdownRenderer } from '@ui/MarkdownRenderer'
import { useAutomationActions, useAutomationRun } from '../hooks/use-automations'
import { openRunConversation } from '../lib/navigation'
import { formatAbsolute, formatDuration } from '../lib/schedule'
import { isRunActive } from '../lib/status'
import { Caption, ErrorStrip, RunStatusBadge } from './shared'

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Caption>{label}</Caption>
      <div className="mt-0.5 truncate text-[13px]">{children}</div>
    </div>
  )
}

/** Output body: markdown output, falling back to precheck output, then the error. */
function RunOutput({ run }: { run: AutomationRun }) {
  if (run.output.trim()) {
    return (
      <div className="space-y-3">
        <MarkdownRenderer content={run.output} className="prose prose-sm max-w-none dark:prose-invert" linkProjectId={run.project_id || undefined} />
        {run.output_truncated ? <p className="text-[11px] text-muted-foreground">Output truncated. Open the conversation for the full transcript.</p> : null}
        {run.error ? <ErrorStrip message={run.error} /> : null}
      </div>
    )
  }
  const precheckText = [run.precheck?.stdout, run.precheck?.stderr].filter(text => text && text.trim()).join('\n')
  if (run.precheck && precheckText) {
    return (
      <div className="space-y-2">
        <Caption>Precheck output · exit {run.precheck.exit_code}{run.precheck.duration_ms ? ` · ${run.precheck.duration_ms} ms` : ''}</Caption>
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 font-mono text-[12px]">{precheckText}</pre>
        {run.error ? <ErrorStrip message={run.error} /> : null}
      </div>
    )
  }
  if (run.error) return <pre className="whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/5 p-3 font-mono text-[12px] text-red-500">{run.error}</pre>
  return <p className="text-[13px] text-muted-foreground">{isRunActive(run.status) ? 'Waiting for output…' : 'No output.'}</p>
}

export function RunDetail({ config, runId, initialRun, automation, onBack, backLabel = 'Runs', onOpenTask }: {
  config: BackendConfig
  runId: string
  initialRun?: AutomationRun | null
  automation?: Automation | null
  onBack: () => void
  backLabel?: string
  onOpenTask?: (identifier: string) => void
}) {
  const { run, error, refresh } = useAutomationRun(config, runId, initialRun)
  const { runNow, cancelRun } = useAutomationActions(config)
  const now = useNow(isRunActive(run?.status) ? 1000 : 30_000)

  if (!run) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 items-center px-4">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[13px] text-muted-foreground" onClick={onBack}><ArrowLeft className="size-3.5" />{backLabel}</Button>
        </div>
        <div className="p-4">{error ? <ErrorStrip message={error} onRetry={() => void refresh()} /> : <p className="text-[13px] text-muted-foreground">Loading run…</p>}</div>
      </div>
    )
  }

  const active = isRunActive(run.status)
  const taskIdentifier = automation && automation.task_id === run.task_id ? automation.task_identifier : ''
  const taskRef = taskIdentifier || run.task_id
  const automationName = run.automation_name || automation?.name || 'Automation'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[13px] text-muted-foreground" onClick={onBack}><ArrowLeft className="size-3.5" />{backLabel}</Button>
        <span className="text-muted-foreground/50">/</span>
        <h1 className="min-w-0 truncate text-[14px] font-medium">{run.title || `${automationName} run ${run.run_number}`}</h1>
        <RunStatusBadge status={run.status} />
        <div className="flex-1" />
        {taskRef && onOpenTask ? (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => onOpenTask(taskRef)}><ListTodo className="size-3.5" />{taskIdentifier || 'Open task'}</Button>
        ) : null}
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" disabled={!run.chat_session_id} onClick={() => openRunConversation(run)}
          tooltip={run.chat_session_id ? undefined : 'No conversation for this run'}>
          <MessageSquare className="size-3.5" />Open conversation
        </Button>
        {active ? (
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void cancelRun(run)}><Square className="size-3.5" />Cancel</Button>
        ) : null}
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={active || !run.automation_id}
          onClick={() => void runNow({ id: run.automation_id, name: automationName })}>
          <RotateCcw className="size-3.5" />Rerun
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-5 px-6 py-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Meta label="Trigger">{run.trigger === 'manual' ? 'Manual' : 'Scheduled'}{run.occurrence_count > 1 ? ` · ×${run.occurrence_count}` : ''}</Meta>
            <Meta label="Scheduled for">{formatAbsolute(run.scheduled_for) || '—'}</Meta>
            <Meta label="Started">{formatAbsolute(run.started_at) || '—'}</Meta>
            <Meta label={run.finished_at ? 'Finished' : 'Duration'}>
              {run.finished_at ? formatAbsolute(run.finished_at) : run.started_at ? formatDuration(run.started_at, '', now || undefined) : '—'}
              {run.finished_at && run.started_at ? <span className="text-muted-foreground"> · {formatDuration(run.started_at, run.finished_at)}</span> : null}
            </Meta>
            <Meta label="Agent">{[run.provider, run.model].filter(Boolean).join(' · ') || '—'}</Meta>
            <Meta label="Workspace">{run.branch || run.workspace_path || (run.project_id ? 'Project root' : 'Maestro')}</Meta>
            <Meta label="Tokens">{run.usage?.total_tokens ? run.usage.total_tokens.toLocaleString() : '—'}</Meta>
            <Meta label="Run">#{run.run_number}</Meta>
          </div>
          {error ? <ErrorStrip message={error} onRetry={() => void refresh()} /> : null}
          <section aria-label="Run output" className="border-t border-border pt-4">
            <Caption>Output</Caption>
            <div className="mt-2"><RunOutput run={run} /></div>
          </section>
        </div>
      </div>
    </div>
  )
}
