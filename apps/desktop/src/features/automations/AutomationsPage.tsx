import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDownUp, CalendarClock, ChevronDown, FolderTree, History, ListTodo, MoreHorizontal, Plus, RefreshCw, Search, X } from 'lucide-react'
import type { Automation, AutomationRun, BackendConfig } from '@core/api/client'
import { cn } from '@core/utils/cn'
import { useNow } from '@/hooks/use-now'
import { Button } from '@ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@ui/context-menu'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@ui/dropdown-menu'
import { HarnessIcon } from '@ui/HarnessIcon'
import { Input } from '@ui/input'
import { useAutomationActions, useAutomations } from './hooks/use-automations'
import { formatAbsolute, formatRelative } from './lib/schedule'
import { runStatusMeta } from './lib/status'
import { AUTOMATION_TEMPLATES, type AutomationTemplate } from './lib/templates'
import { AutomationDetail, type AutomationDetailTab } from './components/AutomationDetail'
import { AutomationEditorDialog } from './components/AutomationEditorDialog'
import { RunDetail } from './components/RunDetail'
import { RunsDashboard } from './components/RunsDashboard'
import { AutomationMenuItems, Chip, DeleteAutomationDialog, EnabledBadge, ErrorStrip, StatusDot, type AutomationMenuHandlers } from './components/shared'

type View =
  | { kind: 'list' }
  | { kind: 'detail'; id: string; tab: AutomationDetailTab }
  | { kind: 'runs' }
  | { kind: 'run'; runId: string; run?: AutomationRun; back: Exclude<View, { kind: 'run' }> }

type EditorState = { open: boolean; key: number; automation?: Automation | null; template?: AutomationTemplate | null }

type StatusFilter = 'all' | 'enabled' | 'paused'
type LastRunFilter = 'all' | 'succeeded' | 'failed' | 'never'
type SortKey = 'name' | 'last_run'

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = { all: 'All', enabled: 'Enabled', paused: 'Paused' }
const LAST_RUN_FILTER_LABELS: Record<LastRunFilter, string> = { all: 'All', succeeded: 'Succeeded', failed: 'Failed', never: 'Never ran' }

function FilterPill<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (value: T) => void }) {
  const active = value !== 'all'
  return (
    <div className={cn('inline-flex h-7 items-center rounded-full border text-[12px]', active ? 'border-foreground/30 bg-muted/50 text-foreground' : 'border-border text-muted-foreground')}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`${label} filter`} className="inline-flex h-full items-center gap-1 rounded-full pl-2.5 pr-2 hover:text-foreground">
            {label}{active ? <span className="text-foreground">: {options[value]}</span> : null}
            {!active ? <ChevronDown className="size-3" /> : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {(Object.keys(options) as T[]).map(option => (
            <DropdownMenuCheckboxItem key={option} checked={option === value} onCheckedChange={() => onChange(option)}>{options[option]}</DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {active ? (
        <button type="button" aria-label={`Clear ${label} filter`} onClick={() => onChange('all' as T)} className="mr-1 rounded-full p-0.5 text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
      ) : null}
    </div>
  )
}

function TemplateGallery({ onTemplate, onBlank }: { onTemplate: (template: AutomationTemplate) => void; onBlank: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-14">
      <div className="mb-1 flex items-center gap-2 text-muted-foreground"><CalendarClock className="size-4" /><span className="text-[11px] font-medium uppercase tracking-wide">Automations</span></div>
      <h2 className="text-[18px] font-semibold tracking-tight">Start from a template</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">Schedule an agent to run a prompt on a cadence. Runs keep going until you pause them.</p>
      <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Automation templates">
        {AUTOMATION_TEMPLATES.map(template => (
          <button key={template.id} type="button" onClick={() => onTemplate(template)}
            className="flex flex-col items-start gap-1 rounded-md border border-border bg-card px-3.5 py-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/30">
            <span className="text-[13px] font-medium">{template.name}</span>
            <span className="text-[12px] text-muted-foreground">{template.summary}</span>
          </button>
        ))}
        <button type="button" onClick={onBlank}
          className="flex items-center gap-2 rounded-md border border-dashed border-border px-3.5 py-3 text-left text-[13px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground">
          <Plus className="size-4" />Add new
        </button>
      </div>
    </div>
  )
}

/** Automations section: list → detail → run drill-ins, runs dashboard and the editor dialog. */
export function AutomationsPage({ config, onOpenTask }: { config: BackendConfig; onOpenTask?: (identifier: string) => void }) {
  const { automations, loading, error, refresh, upsert, remove } = useAutomations(config)
  const actions = useAutomationActions(config, { onChanged: upsert, onDeleted: remove })
  const [view, setView] = useState<View>({ kind: 'list' })
  const [editor, setEditor] = useState<EditorState>({ open: false, key: 0 })
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [lastRunFilter, setLastRunFilter] = useState<LastRunFilter>('all')
  const [agentFilter, setAgentFilter] = useState('all')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false })
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([])
  const now = useNow(30_000)

  const openEditor = (automation?: Automation | null, template?: AutomationTemplate | null) =>
    setEditor(previous => ({ open: true, key: previous.key + 1, automation: automation ?? null, template: template ?? null }))

  const menuHandlers: AutomationMenuHandlers = {
    onRunNow: automation => { void actions.runNow(automation) },
    onEdit: automation => openEditor(automation),
    onTogglePaused: automation => { void actions.setPaused(automation, automation.enabled !== false) },
    onDelete: automation => setDeleteTarget(automation),
  }

  const confirmDelete = async (automation: Automation) => {
    setDeleting(true)
    const ok = await actions.remove(automation)
    setDeleting(false)
    if (!ok) return
    setDeleteTarget(null)
    if (view.kind === 'detail' && view.id === automation.id) setView({ kind: 'list' })
  }

  const agentOptions = useMemo(() => {
    const options: Record<string, string> = { all: 'All' }
    for (const automation of automations) if (automation.provider) options[automation.provider] = automation.provider
    return options
  }, [automations])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = automations.filter(automation => {
      const enabled = automation.enabled !== false
      if (statusFilter === 'enabled' && !enabled) return false
      if (statusFilter === 'paused' && enabled) return false
      if (lastRunFilter === 'never' && automation.last_run_at) return false
      if ((lastRunFilter === 'succeeded' || lastRunFilter === 'failed') && automation.last_run_status !== lastRunFilter) return false
      if (agentFilter !== 'all' && automation.provider !== agentFilter) return false
      if (!needle) return true
      return [automation.name, automation.prompt, automation.schedule_description, automation.project_name, automation.task_identifier, automation.task_title, automation.provider, automation.model]
        .join(' ').toLowerCase().includes(needle)
    })
    const direction = sort.desc ? -1 : 1
    return filtered.sort((a, b) => {
      if (sort.key === 'last_run') {
        const left = a.last_run_at ? Date.parse(a.last_run_at) : 0
        const right = b.last_run_at ? Date.parse(b.last_run_at) : 0
        if (left !== right) return (left - right) * direction
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * (sort.key === 'name' ? direction : 1)
    })
  }, [automations, query, statusFilter, lastRunFilter, agentFilter, sort])

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, index: number, automation: Automation) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = Math.min(visible.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))
      rowRefs.current[next]?.focus()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      setView({ kind: 'detail', id: automation.id, tab: 'overview' })
    }
  }

  const editorDialog = editor.open || editor.key > 0 ? (
    <AutomationEditorDialog
      key={editor.key}
      config={config}
      open={editor.open}
      automation={editor.automation}
      template={editor.template}
      onOpenChange={open => setEditor(previous => ({ ...previous, open }))}
      onSaved={saved => { upsert(saved); void refresh() }}
    />
  ) : null

  const deleteDialog = (
    <DeleteAutomationDialog automation={deleteTarget} pending={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={automation => void confirmDelete(automation)} />
  )

  const openRun = (run: AutomationRun, back: Exclude<View, { kind: 'run' }>) => setView({ kind: 'run', runId: run.id, run, back })

  // ---- Drill-in views -------------------------------------------------------
  if (view.kind === 'detail') {
    const automation = automations.find(candidate => candidate.id === view.id)
    if (automation) {
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <AutomationDetail
            config={config}
            automation={automation}
            initialTab={view.tab}
            onBack={() => setView({ kind: 'list' })}
            onEdit={menuHandlers.onEdit}
            onRunNow={menuHandlers.onRunNow}
            onTogglePaused={menuHandlers.onTogglePaused}
            onDelete={menuHandlers.onDelete}
            onOpenRun={run => openRun(run, { kind: 'detail', id: automation.id, tab: 'runs' })}
            onOpenTask={onOpenTask}
          />
          {editorDialog}
          {deleteDialog}
        </div>
      )
    }
  }

  if (view.kind === 'runs') {
    return <RunsDashboard config={config} onBack={() => setView({ kind: 'list' })} onOpenRun={run => openRun(run, { kind: 'runs' })} />
  }

  if (view.kind === 'run') {
    const back = view.back
    const automation = view.run ? automations.find(candidate => candidate.id === view.run?.automation_id) : undefined
    return (
      <RunDetail
        key={view.runId}
        config={config}
        runId={view.runId}
        initialRun={view.run}
        automation={automation}
        backLabel={back.kind === 'runs' ? 'Runs' : back.kind === 'detail' ? (automation?.name ?? 'Automation') : 'All automations'}
        onBack={() => setView(back)}
        onOpenTask={onOpenTask}
      />
    )
  }

  // ---- List ---------------------------------------------------------------
  const empty = !loading && !error && automations.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <h1 className="text-[14px] font-medium">Automations</h1>
        {automations.length ? <span className="text-[12px] text-muted-foreground">{automations.length}</span> : null}
        <div className="flex-1" />
        <Button variant="ghost" size="icon" tooltip="Refresh" aria-label="Refresh automations" onClick={() => void refresh()}><RefreshCw className="size-3.5" /></Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setView({ kind: 'runs' })}><History className="size-3.5" />Runs</Button>
        <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => openEditor()}><Plus className="size-3.5" />New automation</Button>
      </div>

      {error ? <div className="px-4 pt-3"><ErrorStrip message={error} onRetry={() => void refresh()} /></div> : null}

      {empty ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TemplateGallery onTemplate={template => openEditor(null, template)} onBlank={() => openEditor()} />
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3">
            <label className="relative w-60">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search automations" placeholder="Search automations" className="h-7 pl-8 text-[12px]" value={query} onChange={event => setQuery(event.target.value)} />
            </label>
            <FilterPill label="Status" value={statusFilter} options={STATUS_FILTER_LABELS} onChange={setStatusFilter} />
            <FilterPill label="Last run" value={lastRunFilter} options={LAST_RUN_FILTER_LABELS} onChange={setLastRunFilter} />
            <FilterPill label="Agent" value={agentFilter} options={agentOptions} onChange={setAgentFilter} />
            <div className="flex-1" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Sort automations" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground">
                  <ArrowDownUp className="size-3.5" />{sort.key === 'name' ? 'Name' : 'Last run'}{sort.desc ? ' ↓' : ' ↑'}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuCheckboxItem checked={sort.key === 'name'} onCheckedChange={() => setSort({ key: 'name', desc: false })}>Name</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={sort.key === 'last_run'} onCheckedChange={() => setSort({ key: 'last_run', desc: true })}>Last run</DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setSort(previous => ({ ...previous, desc: !previous.desc }))}>{sort.desc ? 'Ascending' : 'Descending'}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
            <table className="w-full min-w-[960px] border-separate border-spacing-0 text-[13px]" aria-label="Automations">
              <thead>
                <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="sticky left-0 top-0 z-20 border-b border-border bg-background py-2 pl-2 pr-3 font-medium">Name</th>
                  <th className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2 font-medium">Schedule</th>
                  <th className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2 font-medium">Link</th>
                  <th className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2 font-medium">Next run</th>
                  <th className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2 font-medium">Last run</th>
                  <th className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2 font-medium">Status</th>
                  <th className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2 font-medium">Agent</th>
                  <th className="sticky top-0 z-10 w-10 border-b border-border bg-background px-2 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading && !automations.length ? (
                  <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">Loading automations…</td></tr>
                ) : visible.length === 0 ? (
                  <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">No automations match the current filters.</td></tr>
                ) : visible.map((automation, index) => {
                  const enabled = automation.enabled !== false
                  const lastMeta = runStatusMeta(automation.last_run_status)
                  const failed = lastMeta.tone === 'failure'
                  return (
                    <ContextMenu key={automation.id}>
                      <ContextMenuTrigger asChild>
                        <tr
                          ref={element => { rowRefs.current[index] = element }}
                          tabIndex={0}
                          aria-label={automation.name}
                          onClick={() => setView({ kind: 'detail', id: automation.id, tab: 'overview' })}
                          onKeyDown={event => onRowKeyDown(event, index, automation)}
                          className="group cursor-default outline-none hover:bg-muted/30 focus-visible:bg-muted/50"
                        >
                          <td className="sticky left-0 z-[1] max-w-[260px] border-b border-border/60 bg-background py-2 pl-2 pr-3 group-hover:bg-muted/30 group-focus-visible:bg-muted/50">
                            <span className={cn('block truncate font-medium', !enabled && 'text-muted-foreground')}>{automation.name}</span>
                          </td>
                          <td className="max-w-[220px] truncate border-b border-border/60 px-3 py-2 text-muted-foreground">{automation.schedule_description || automation.schedule.kind}</td>
                          <td className="border-b border-border/60 px-3 py-2">
                            <span className="flex items-center gap-1">
                              {automation.project_id ? <Chip icon={FolderTree} title={automation.project_name}>{automation.project_name || 'Project'}</Chip> : null}
                              {automation.task_id ? <Chip icon={ListTodo} title={automation.task_title} onClick={onOpenTask ? () => onOpenTask(automation.task_identifier || automation.task_id || '') : undefined}>{automation.task_identifier || 'Task'}</Chip> : null}
                              {!automation.project_id && !automation.task_id ? <span className="text-muted-foreground/60">—</span> : null}
                            </span>
                          </td>
                          <td className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-muted-foreground">
                            {!enabled ? 'Paused' : automation.next_run_at ? <>{formatAbsolute(automation.next_run_at)}{now ? <span className="text-muted-foreground/70"> ({formatRelative(automation.next_run_at, now)})</span> : null}</> : '—'}
                          </td>
                          <td className="whitespace-nowrap border-b border-border/60 px-3 py-2">
                            {automation.last_run_at ? (
                              <span className={cn('inline-flex items-center gap-1.5', failed ? 'text-red-500' : 'text-muted-foreground')} title={lastMeta.label}>
                                <StatusDot className={failed ? 'bg-red-500' : lastMeta.tone === 'success' ? 'bg-emerald-500' : 'bg-muted-foreground/50'} />
                                {now ? formatRelative(automation.last_run_at, now) : formatAbsolute(automation.last_run_at)}
                                <span className="sr-only">{lastMeta.label}</span>
                              </span>
                            ) : <span className="text-muted-foreground/70">Never ran</span>}
                          </td>
                          <td className="whitespace-nowrap border-b border-border/60 px-3 py-2"><EnabledBadge enabled={enabled} /></td>
                          <td className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5"><HarnessIcon id={automation.provider} size={14} /><span className="max-w-[120px] truncate">{automation.model || automation.provider}</span></span>
                          </td>
                          <td className="border-b border-border/60 px-2 py-2 text-right" onClick={event => event.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button type="button" aria-label={`Actions for ${automation.name}`} className="rounded p-1 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
                                  <MoreHorizontal className="size-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                <AutomationMenuItems automation={automation} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} handlers={menuHandlers} />
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <AutomationMenuItems automation={automation} Item={ContextMenuItem} Separator={ContextMenuSeparator} handlers={menuHandlers} />
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {editorDialog}
      {deleteDialog}
    </div>
  )
}
