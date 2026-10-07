import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FolderTree, GitBranch, LayoutTemplate, ListTodo, Network } from 'lucide-react'
import { toast } from 'sonner'
import {
  createAutomation,
  fetchUnifiedAgents,
  fetchWorkspaceChatModels,
  fetchWorkspaceChatProviders,
  toDisplayError,
  updateAutomation,
  type Automation,
  type BackendConfig,
  type OrchestraAgent,
  type WorkspaceChatModelCatalog,
  type WorkspaceChatProvider,
} from '@core/api/client'
import { useAppStore } from '@core/store'
import { Button } from '@ui/button'
import { Dialog, DialogContent } from '@ui/dialog'
import { Input } from '@ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/select'
import { ToggleGroup, ToggleGroupItem } from '@ui/toggle-group'
import { HarnessPicker } from '@features/workspace/chat/HarnessPicker'
import { parseAutomation, validateAutomationForm, type AutomationFormErrors, type AutomationFormValues } from '../lib/schemas'
import { GRACE_OPTIONS, timezoneOptions } from '../lib/schedule'
import { initialFormValues } from '../lib/form'
import { AUTOMATION_TEMPLATES, type AutomationTemplate } from '../lib/templates'
import { MAESTRO_PROJECT_ID } from '../lib/navigation'
import { Combobox, type ComboboxOption } from './Combobox'
import { PromptEditor } from './PromptEditor'
import { ScheduleEditor } from './ScheduleEditor'
import { Caption } from './shared'
import { agentColor, agentDisplayName, isPrimaryMode } from '@features/agents/lib/agent-display'
import { useAgentsRevision } from '@features/agents/lib/agents-events'

const NO_AGENT = '__none__'

function RailSection({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Caption htmlFor={htmlFor}>{label}</Caption>
      {children}
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

export function AutomationEditorDialog({ config, open, automation, template, onOpenChange, onSaved }: {
  config: BackendConfig
  open: boolean
  automation?: Automation | null
  template?: AutomationTemplate | null
  onOpenChange: (open: boolean) => void
  onSaved: (automation: Automation) => void
}) {
  const editing = !!automation
  const [values, setValues] = useState<AutomationFormValues>(() => initialFormValues(automation, template))
  const [errors, setErrors] = useState<AutomationFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [providers, setProviders] = useState<WorkspaceChatProvider[]>([])
  const [catalog, setCatalog] = useState<WorkspaceChatModelCatalog | undefined>()
  const [agents, setAgents] = useState<OrchestraAgent[]>([])
  const agentsRevision = useAgentsRevision()
  const projects = useAppStore(s => s.projects)
  const issues = useAppStore(s => s.allBoardIssues)

  const set = <K extends keyof AutomationFormValues>(key: K, value: AutomationFormValues[K]) => {
    setValues(previous => ({ ...previous, [key]: value }))
    setErrors(previous => {
      if (!Object.keys(previous).some(errorKey => errorKey === key || errorKey.startsWith(`${String(key)}.`))) return previous
      const next = { ...previous }
      for (const errorKey of Object.keys(next)) if (errorKey === key || errorKey.startsWith(`${String(key)}.`)) delete next[errorKey]
      return next
    })
  }

  const chatProjectId = values.project_id || MAESTRO_PROJECT_ID

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchWorkspaceChatProviders(config, chatProjectId).then(result => {
      if (cancelled) return
      // Gemini is retired as a harness; legacy automations keep their stored value until edited.
      const list = (Array.isArray(result?.providers) ? result.providers : []).filter(provider => provider.id.toLowerCase() !== 'gemini')
      setProviders(list)
      setValues(previous => {
        if (previous.provider) return previous
        const preferred = list.find(provider => provider.enabled) ?? list[0]
        return preferred ? { ...previous, provider: preferred.id } : previous
      })
    }).catch(() => { if (!cancelled) setProviders([]) })
    return () => { cancelled = true }
  }, [config, chatProjectId, open])

  useEffect(() => {
    if (!open || !values.provider) return
    let cancelled = false
    fetchWorkspaceChatModels(config, chatProjectId, values.provider).then(result => {
      if (!cancelled && result && Array.isArray(result.models)) setCatalog(result)
    }).catch(() => { if (!cancelled) setCatalog(undefined) })
    return () => { cancelled = true }
  }, [config, chatProjectId, values.provider, open])

  useEffect(() => {
    if (!open || !values.provider) { setAgents([]); return }
    let cancelled = false
    void Promise.resolve().then(() => fetchUnifiedAgents(config, { projectId: values.project_id || undefined, harness: values.provider }))
      .then(list => { if (!cancelled) setAgents(list.filter(agent => isPrimaryMode(agent.mode))) })
      .catch(() => { if (!cancelled) setAgents([]) })
    return () => { cancelled = true }
  }, [config, values.project_id, values.provider, open, agentsRevision])

  const selectedModel = catalog?.provider.toLowerCase() === values.provider.toLowerCase() ? catalog.models.find(model => model.model === values.model) : undefined
  const effortOptions = selectedModel?.supported_reasoning_efforts ?? []

  const projectOptions: ComboboxOption[] = useMemo(() => [
    { value: '', label: 'No project (Maestro)', icon: <Network className="size-3.5 text-muted-foreground" /> },
    ...projects.map(project => ({ value: project.id, label: project.name, keywords: [project.root_path], icon: <FolderTree className="size-3.5 text-muted-foreground" /> })),
  ], [projects])

  const taskOptions: ComboboxOption[] = useMemo(() => {
    const scoped = values.project_id ? issues.filter(issue => !issue.project_id || issue.project_id === values.project_id) : issues
    const seen = new Set<string>()
    const options: ComboboxOption[] = [{ value: '', label: 'No task' }]
    for (const issue of scoped) {
      const id = issue.id || issue.issue_id || ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      const identifier = issue.identifier || issue.issue_identifier || ''
      options.push({ value: id, label: identifier ? `${identifier} · ${issue.title ?? ''}` : (issue.title ?? id), keywords: [identifier, issue.state ?? ''], hint: issue.state, icon: <ListTodo className="size-3.5 text-muted-foreground" /> })
    }
    if (values.task_id && !seen.has(values.task_id)) {
      options.push({ value: values.task_id, label: automation?.task_identifier ? `${automation.task_identifier} · ${automation.task_title}` : values.task_id })
    }
    return options
  }, [issues, values.project_id, values.task_id, automation])

  const timezones = useMemo(() => {
    const zones = timezoneOptions()
    const current = values.schedule.timezone
    return current && !zones.includes(current) ? [current, ...zones] : zones
  }, [values.schedule.timezone])
  const timezoneComboOptions = useMemo(() => timezones.map(zone => ({ value: zone, label: zone })), [timezones])

  const applyTemplate = (next: AutomationTemplate) => {
    setValues(previous => ({
      ...previous,
      name: next.name,
      prompt: next.prompt,
      schedule: { ...next.schedule, timezone: previous.schedule.timezone } as AutomationFormValues['schedule'],
      grace_minutes: next.grace_minutes,
    }))
    setErrors({})
    setTemplatesOpen(false)
  }

  const submit = async () => {
    const result = validateAutomationForm(values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setSaving(true)
    try {
      const response = editing && automation
        ? await updateAutomation(config, automation.id, result.input)
        : await createAutomation(config, result.input)
      const saved = parseAutomation(response)
      toast.success(editing ? 'Automation saved' : 'Automation created', { description: result.input.name })
      if (saved) onSaved(saved)
      onOpenChange(false)
    } catch (err) {
      const message = toDisplayError(err)
      setErrors({ form: message })
      toast.error(editing ? 'Could not save automation' : 'Could not create automation', { description: message })
    } finally {
      setSaving(false)
    }
  }

  const graceIsPreset = GRACE_OPTIONS.some(option => option.value === values.grace_minutes)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        srTitle={editing ? 'Edit automation' : 'New automation'}
        className="flex h-[min(760px,90vh)] w-[min(1080px,95vw)] max-w-none flex-col gap-0 overflow-hidden p-0"
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit() }
        }}
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border pl-5 pr-14">
          <h2 className="text-[13px] font-medium text-muted-foreground">{editing ? 'Edit automation' : 'New automation'}</h2>
          <div className="flex-1" />
          <Popover open={templatesOpen} onOpenChange={setTemplatesOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground"><LayoutTemplate className="size-3.5" />Use template</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-1">
              <div className="px-2 py-1.5"><Caption>Templates</Caption></div>
              {AUTOMATION_TEMPLATES.map(item => (
                <button key={item.id} type="button" onClick={() => applyTemplate(item)} className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left hover:bg-muted">
                  <span className="text-[13px]">{item.name}</span>
                  <span className="text-[11px] text-muted-foreground">{item.summary}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
            <div>
              <input
                aria-label="Automation name"
                autoFocus
                value={values.name}
                aria-invalid={!!errors.name}
                onChange={event => set('name', event.target.value)}
                placeholder="Untitled automation"
                className="w-full bg-transparent text-[20px] font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60"
              />
              {errors.name ? <p className="mt-1 text-[11px] text-red-500">{errors.name}</p> : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <Caption>Prompt</Caption>
              <div className="min-h-0 flex-1"><PromptEditor value={values.prompt} onChange={value => set('prompt', value)} invalid={!!errors.prompt} /></div>
              {errors.prompt ? <p className="text-[11px] text-red-500">{errors.prompt}</p> : null}
            </div>
          </div>

          <aside className="w-[320px] shrink-0 space-y-4 overflow-y-auto border-l border-border bg-muted/10 p-4" aria-label="Automation settings">
            <RailSection label="Agent">
              <HarnessPicker
                providers={providers}
                provider={values.provider}
                disabled={false}
                locked={false}
                catalog={catalog}
                model={values.model}
                effort={values.reasoning_effort}
                effortOptions={effortOptions}
                onProvider={id => { set('provider', id); set('model', ''); set('reasoning_effort', ''); set('agent_id', '') }}
                onModel={model => { set('model', model); set('reasoning_effort', '') }}
                onEffort={effort => set('reasoning_effort', effort)}
              />
              {errors.provider ? <p className="text-[11px] text-red-500">{errors.provider}</p> : null}
            </RailSection>

            <RailSection label="Agent profile" hint={values.agent_id ? undefined : 'Runs with the harness default.'}>
              <Select value={values.agent_id || NO_AGENT} onValueChange={value => set('agent_id', value === NO_AGENT ? '' : value)}>
                <SelectTrigger aria-label="Agent profile"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_AGENT}>Harness default</SelectItem>
                  {values.agent_id && !agents.some(agent => agent.id === values.agent_id) ? <SelectItem value={values.agent_id}>{agentDisplayName(values.agent_id)}</SelectItem> : null}
                  {agents.map(agent => (
                    <SelectItem key={agent.id} value={agent.id} disabled={agent.selectable === false} title={agent.selectable === false ? agent.unavailable_reason || 'Not supported by this harness' : agent.description}>
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: agentColor(agent.color, agent.id) }} />
                        {agent.name}
                        {agent.selectable === false ? <span className="text-[11px] text-muted-foreground">· {agent.unavailable_reason || 'unavailable'}</span> : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </RailSection>

            <RailSection label="Project" hint={values.project_id ? undefined : 'Runs in the Maestro scope.'}>
              <Combobox ariaLabel="Project" value={values.project_id} options={projectOptions} placeholder="No project (Maestro)" searchPlaceholder="Search projects…"
                onChange={value => { set('project_id', value); set('task_id', ''); if (!value) set('workspace_mode', 'project') }} />
            </RailSection>

            <RailSection label="Task link">
              <Combobox ariaLabel="Task link" value={values.task_id} options={taskOptions} placeholder="No task" searchPlaceholder="Search tasks…" emptyText="No tasks found." onChange={value => set('task_id', value)} />
            </RailSection>

            <RailSection label="Workspace">
              <ToggleGroup type="single" aria-label="Workspace" value={values.workspace_mode} disabled={!values.project_id}
                onValueChange={value => { if (value) set('workspace_mode', value as AutomationFormValues['workspace_mode']) }}>
                <ToggleGroupItem value="project" aria-label="Project root"><FolderTree />Project root</ToggleGroupItem>
                <ToggleGroupItem value="new_worktree" aria-label="New worktree"><GitBranch />New worktree</ToggleGroupItem>
              </ToggleGroup>
              {values.project_id && values.workspace_mode === 'new_worktree' ? (
                <Input aria-label="Base branch" placeholder="Base branch (project default)" value={values.base_branch} onChange={event => set('base_branch', event.target.value)} />
              ) : null}
            </RailSection>

            <RailSection label="Schedule">
              <ScheduleEditor config={config} schedule={values.schedule as Automation['schedule']} onChange={schedule => set('schedule', schedule as AutomationFormValues['schedule'])}
                error={errors['schedule.cron'] ?? errors['schedule.time'] ?? errors['schedule.minute'] ?? errors.schedule} />
            </RailSection>

            <RailSection label="Timezone">
              <Combobox ariaLabel="Timezone" value={values.schedule.timezone ?? ''} options={timezoneComboOptions} placeholder="Backend local time" searchPlaceholder="Search timezones…"
                onChange={value => set('schedule', { ...values.schedule, timezone: value } as AutomationFormValues['schedule'])} />
            </RailSection>

            <RailSection label="Grace period" hint="Missed runs within this window still run once.">
              <Select value={String(values.grace_minutes)} onValueChange={value => set('grace_minutes', Number(value))}>
                <SelectTrigger aria-label="Grace period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!graceIsPreset ? <SelectItem value={String(values.grace_minutes)}>{values.grace_minutes} minutes</SelectItem> : null}
                  {GRACE_OPTIONS.map(option => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </RailSection>

            <RailSection label="Precheck" hint="Optional shell command; a non-zero exit skips the scheduled run.">
              <Input aria-label="Precheck command" className="font-mono" placeholder="e.g. ./scripts/has-changes.sh" value={values.precheck.command}
                onChange={event => set('precheck', { ...values.precheck, command: event.target.value })} />
              <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                Timeout
                <Input aria-label="Precheck timeout seconds" type="number" min={1} max={3600} className="w-20" value={values.precheck.timeout_seconds}
                  onChange={event => set('precheck', { ...values.precheck, timeout_seconds: event.target.value === '' ? 0 : Number(event.target.value) })} />
                seconds
              </label>
              {errors['precheck.timeout_seconds'] ? <p className="text-[11px] text-red-500">{errors['precheck.timeout_seconds']}</p> : null}
            </RailSection>
          </aside>
        </div>

        <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-border px-5">
          {errors.form ? <p role="alert" className="min-w-0 flex-1 truncate text-[12px] text-red-500">{errors.form}</p>
            : <p className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">Once saved, runs automatically until paused.</p>}
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={() => void submit()}>{editing ? 'Save changes' : 'Create'}</Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

