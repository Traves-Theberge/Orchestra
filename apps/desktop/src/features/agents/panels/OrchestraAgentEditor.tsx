import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import {
  createOrchestraAgent, deleteOrchestraAgent, toDisplayError, updateOrchestraAgent,
  type BackendConfig, type HarnessCapabilities, type OrchestraAgent,
} from '@core/api/client'
import { Button } from '@ui/button'
import { Input } from '@ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/select'
import { ToggleGroup, ToggleGroupItem } from '@ui/toggle-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ui/dialog'
import { HarnessIcon } from '@ui/HarnessIcon'
import { PromptEditor } from '@features/automations/components/PromptEditor'
import { MultiSelect, type MultiSelectOption } from '../components/MultiSelect'
import { agentColor, compatibilityPreview, harnessLabel } from '../lib/agent-display'
import { agentToForm, emptyAgentForm, validateAgentForm, type OrchestraAgentFormErrors, type OrchestraAgentFormValues } from '../lib/orchestra-agent-schema'
import { notifyAgentsChanged } from '../lib/agents-events'
import { useAppStore } from '@core/store'

const DEFAULT = '__default__'
const EFFORTS = ['low', 'medium', 'high', 'xhigh']

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor?: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
      {error ? <p className="text-[11px] text-red-500">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function OrchestraAgentEditor({ config, agent, projectId, template, capabilities, skillOptions, mcpOptions, onSaved, onDeleted, onCancel }: {
  config: BackendConfig
  /** Existing Orchestra agent; omitted for "Create agent". */
  agent?: OrchestraAgent
  /** Active project for project-scoped agents ('' in the global view). */
  projectId: string
  /** Starter values for a new agent. */
  template?: Partial<OrchestraAgentFormValues>
  capabilities: HarnessCapabilities[]
  skillOptions: MultiSelectOption[]
  mcpOptions: MultiSelectOption[]
  onSaved: (agent: OrchestraAgent) => void
  onDeleted: (id: string) => void
  onCancel: () => void
}) {
  const editing = !!agent
  const projects = useAppStore(s => s.projects)
  const [values, setValues] = useState<OrchestraAgentFormValues>(() => agent ? agentToForm(agent, projectId) : { ...emptyAgentForm(projectId ? 'project' : 'global', projectId), ...template, permissions: { ...emptyAgentForm().permissions, ...template?.permissions } })
  const [errors, setErrors] = useState<OrchestraAgentFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof OrchestraAgentFormValues>(key: K, value: OrchestraAgentFormValues[K]) => {
    setValues(previous => ({ ...previous, [key]: value }))
    setErrors(previous => {
      if (!Object.keys(previous).some(errorKey => errorKey === key || errorKey.startsWith(`${String(key)}.`))) return previous
      const next = { ...previous }
      for (const errorKey of Object.keys(next)) if (errorKey === key || errorKey.startsWith(`${String(key)}.`)) delete next[errorKey]
      return next
    })
  }
  const preview = compatibilityPreview(capabilities, values)
  const reported = agent?.compatible_harnesses?.map(id => id.toLowerCase())
  const targetProject = projects.find(project => project.id === values.project_id)
  const fileName = `${values.name.trim() || '<name>'}.md`
  const targetPath = values.scope === 'global' ? `~/.orchestra/agents/${fileName}` : targetProject ? `${targetProject.root_path.replace(/[\\/]+$/, '')}/.orchestra/agents/${fileName}` : `<project>/.orchestra/agents/${fileName}`

  const submit = async () => {
    const result = validateAgentForm(values)
    if (!result.ok) { setErrors(result.errors); return }
    setSaving(true)
    try {
      const saved = editing && agent ? await updateOrchestraAgent(config, agent.id, result.input) : await createOrchestraAgent(config, result.input)
      toast.success(editing ? 'Agent saved' : 'Agent created', { description: result.input.name })
      notifyAgentsChanged()
      onSaved(saved)
    } catch (cause) {
      const message = toDisplayError(cause)
      setErrors({ form: message })
      toast.error(editing ? 'Could not save agent' : 'Could not create agent', { description: message })
    } finally { setSaving(false) }
  }
  const remove = async () => {
    if (!agent) return
    setSaving(true)
    try {
      await deleteOrchestraAgent(config, agent.id)
      toast.success('Agent deleted', { description: agent.name })
      setConfirmDelete(false)
      notifyAgentsChanged()
      onDeleted(agent.id)
    } catch (cause) {
      const message = toDisplayError(cause)
      setErrors({ form: message })
      toast.error('Could not delete agent', { description: message })
    } finally { setSaving(false) }
  }

  return (
    <form aria-label={editing ? `Edit agent ${agent?.name}` : 'Create agent'} className="flex h-full min-h-0 flex-col" onSubmit={event => { event.preventDefault(); void submit() }}
      onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit() } }}>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: agentColor(values.color, values.name || 'new') }} />
            <input aria-label="Agent name" autoFocus={!editing} value={values.name} disabled={editing} aria-invalid={!!errors.name} onChange={event => set('name', event.target.value)} placeholder="agent-name"
              className="min-w-0 flex-1 bg-transparent text-[20px] font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60 disabled:opacity-80" />
          </div>
          {errors.name ? <p className="-mt-2 text-[11px] text-red-500">{errors.name}</p> : null}
          <Input aria-label="Description" value={values.description} aria-invalid={!!errors.description} onChange={event => set('description', event.target.value)} placeholder="What this agent is for (shown in pickers)" />
          {errors.description ? <p className="text-[11px] text-red-500">{errors.description}</p> : null}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Prompt</span>
            <div className="min-h-0 flex-1"><PromptEditor value={values.prompt} onChange={value => set('prompt', value)} invalid={!!errors.prompt} /></div>
            {errors.prompt ? <p className="text-[11px] text-red-500">{errors.prompt}</p> : null}
          </div>
        </div>

        <aside aria-label="Agent settings" className="w-[300px] shrink-0 space-y-4 overflow-y-auto bg-muted/10 p-4">
          <Field label="Scope" error={errors.project_id} hint={<span>Saved to <code data-testid="agent-path" className="break-all font-mono text-[10.5px] text-foreground/80">{targetPath}</code>{editing ? ' · scope is fixed once created' : ''}</span>}>
            <ToggleGroup type="single" aria-label="Scope" value={values.scope} disabled={editing} onValueChange={value => { if (!value) return; set('scope', value as OrchestraAgentFormValues['scope']); if (value === 'project' && !values.project_id && projects.length === 1) set('project_id', projects[0].id) }}>
              <ToggleGroupItem value="global" aria-label="Global" title="Available in every project">Global</ToggleGroupItem>
              <ToggleGroupItem value="project" aria-label="This project" disabled={!projects.length} title={projects.length ? 'Only in one project' : 'Add a project first to create project agents'}>This project</ToggleGroupItem>
            </ToggleGroup>
            {!projects.length && !editing ? <p className="text-[11px] text-muted-foreground">Project agents need a project; add one first.</p> : null}
            {values.scope === 'project' && (
              <Select value={values.project_id || undefined} disabled={editing} onValueChange={value => set('project_id', value)}>
                <SelectTrigger aria-label="Project"><SelectValue placeholder="Choose a project" /></SelectTrigger>
                <SelectContent>{projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Mode" hint={values.mode === 'subagent' ? 'Only reachable as an @mention or delegated task.' : values.mode === 'all' ? 'Selectable as primary and as a subagent.' : 'Selectable in the composer agent picker.'}>
            <ToggleGroup type="single" aria-label="Mode" value={values.mode} onValueChange={value => { if (value) set('mode', value as OrchestraAgentFormValues['mode']) }}>
              <ToggleGroupItem value="primary" aria-label="Primary">Primary</ToggleGroupItem>
              <ToggleGroupItem value="subagent" aria-label="Subagent">Subagent</ToggleGroupItem>
              <ToggleGroupItem value="all" aria-label="All">All</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field label="Color" htmlFor="agent-color" error={errors.color}>
            <div className="flex items-center gap-2">
              <input id="agent-color" type="color" aria-label="Agent color" value={values.color || agentColor('', values.name || 'new')} onChange={event => set('color', event.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent" />
              <Input aria-label="Color hex" value={values.color} placeholder="auto" onChange={event => set('color', event.target.value)} className="font-mono" />
            </div>
          </Field>
          <Field label="Model" htmlFor="agent-model" hint="Optional. A per-message model choice overrides it.">
            <Input id="agent-model" aria-label="Model" value={values.model} placeholder="Harness default" onChange={event => set('model', event.target.value)} />
          </Field>
          <Field label="Effort">
            <Select value={values.effort || DEFAULT} onValueChange={value => set('effort', value === DEFAULT ? '' : value)}>
              <SelectTrigger aria-label="Effort"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT}>Harness default</SelectItem>
                {[...EFFORTS, ...(values.effort && !EFFORTS.includes(values.effort) ? [values.effort] : [])].map(effort => <SelectItem key={effort} value={effort}>{effort === 'xhigh' ? 'X-high' : effort}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Skills">
            <MultiSelect label="Skills" options={skillOptions} value={values.skills} onChange={value => set('skills', value)} placeholder="No extra skills" emptyText="No skills found." />
          </Field>
          <Field label="MCP servers" hint="Narrows the enabled Orchestra servers for this agent.">
            <MultiSelect label="MCP servers" options={mcpOptions} value={values.mcp_servers} onChange={value => set('mcp_servers', value)} placeholder="All enabled servers" emptyText="No MCP servers found." />
          </Field>
          <Field label="Permissions" hint="Best effort per harness.">
            <div className="space-y-1.5">
              {(['edit', 'bash', 'webfetch'] as const).map(key => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-16 text-[12px] text-muted-foreground">{key}</span>
                  <Select value={values.permissions[key] || DEFAULT} onValueChange={value => set('permissions', { ...values.permissions, [key]: value === DEFAULT ? '' : value })}>
                    <SelectTrigger aria-label={`Permission ${key}`} size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT}>Harness default</SelectItem>
                      <SelectItem value="allow">Allow</SelectItem>
                      <SelectItem value="ask">Ask</SelectItem>
                      <SelectItem value="deny">Deny</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </Field>
          <Field label="Compatible harnesses">
            {preview.length ? (
              <ul aria-label="Compatible harnesses" className="space-y-1.5">
                {preview.map(row => (
                  <li key={row.harness} data-testid="compat-row" data-status={row.status} className="flex items-start gap-2 text-[12px]">
                    <HarnessIcon id={row.harness} size={14} />
                    <span className="min-w-0 flex-1">
                      <span className={row.status === 'unavailable' ? 'text-muted-foreground' : ''}>{harnessLabel(row.harness)}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {row.status === 'unavailable' ? row.note : `${row.mechanism ? `via ${row.mechanism}` : 'supported'}${row.missing.length ? ` · ignores ${row.missing.join(', ')}` : ''}`}
                        {reported && row.status !== 'unavailable' && !reported.includes(row.harness.toLowerCase()) ? ' · not reported compatible' : ''}
                      </span>
                    </span>
                    <span className={row.status === 'full' ? 'text-emerald-500' : row.status === 'partial' ? 'text-amber-500' : 'text-muted-foreground'}>{row.status === 'full' ? 'Full' : row.status === 'partial' ? 'Partial' : 'No'}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-muted-foreground">Harness capabilities unavailable.</p>}
          </Field>
        </aside>
      </div>
      <footer className="flex h-14 shrink-0 items-center gap-3 px-5">
        {errors.form ? <p role="alert" className="min-w-0 flex-1 truncate text-[12px] text-red-500">{errors.form}</p>
          : <p className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{values.scope === 'project' ? `Project agent${targetProject ? ` · ${targetProject.name}` : ''}` : 'Global agent · every project'} · Ctrl+Enter to save</p>}
        {editing && <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-red-500 hover:text-red-500" disabled={saving} onClick={() => setConfirmDelete(true)}><Trash2 className="size-3.5" />Delete</Button>}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving}>{editing ? 'Save changes' : 'Create agent'}</Button>
      </footer>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {agent?.name}?</DialogTitle>
            <DialogDescription>The agent file is removed. Conversations and automations that reference it fall back to the harness default.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Keep</Button>
            <Button variant="destructive" disabled={saving} onClick={() => void remove()}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}
