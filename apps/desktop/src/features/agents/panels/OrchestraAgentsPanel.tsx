import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowUpRight, Bot, ChevronRight, LayoutTemplate, Loader2, Plus, RefreshCw } from 'lucide-react'
import {
  fetchAgentSkills, fetchHarnessCapabilities, fetchMcpServerStatus, fetchUnifiedAgents,
  type BackendConfig, type HarnessCapabilities, type OrchestraAgent,
} from '@core/api/client'
import { useAppStore } from '@core/store'
import { Button } from '@ui/button'
import { Dialog, DialogContent } from '@ui/dialog'
import { HarnessIcon } from '@ui/HarnessIcon'
import { Popover, PopoverContent, PopoverTrigger } from '@ui/popover'
import { AppTooltip } from '@ui/tooltip-wrapper'
import type { MultiSelectOption } from '../components/MultiSelect'
import { agentColor, harnessLabel } from '../lib/agent-display'
import { AGENT_TEMPLATES, type AgentTemplate } from '../lib/agent-templates'
import { useAgentsRevision } from '../lib/agents-events'
import { PROVIDERS } from '../constants'
import { OrchestraAgentEditor } from './OrchestraAgentEditor'

type Editing = { kind: 'new'; template?: AgentTemplate } | { kind: 'agent'; id: string } | null

const Caption = ({ children }: { children: ReactNode }) => <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</p>
const Badge = ({ children, title }: { children: ReactNode; title?: string }) => <span title={title} className="inline-flex shrink-0 items-center rounded border border-border/70 bg-muted/30 px-1.5 py-px text-[10.5px] text-muted-foreground">{children}</span>
const MODE_LABEL: Record<string, string> = { primary: 'Primary', subagent: 'Subagent', all: 'Primary + sub' }

function TemplateGrid({ onPick }: { onPick: (template: AgentTemplate) => void }) {
  return <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Agent templates">
    {AGENT_TEMPLATES.map(template => (
      <button key={template.id} type="button" onClick={() => onPick(template)} className="flex items-start gap-2.5 rounded-md border border-border bg-card px-3.5 py-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/30">
        <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: template.values.color }} />
        <span className="min-w-0"><span className="block text-[13px] font-medium">{template.values.name}</span><span className="block text-[12px] text-muted-foreground">{template.summary}</span></span>
      </button>
    ))}
  </div>
}

/** Orchestra (all harnesses) agents view: Orchestra-native agents are editable; harness agents are listed for reference. */
export function OrchestraAgentsPanel({ config, projectId = '' }: { config: BackendConfig; projectId?: string }) {
  const [agents, setAgents] = useState<OrchestraAgent[]>()
  const [capabilities, setCapabilities] = useState<HarnessCapabilities[]>([])
  const [skillOptions, setSkillOptions] = useState<MultiSelectOption[]>([])
  const [mcpOptions, setMcpOptions] = useState<MultiSelectOption[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<Editing>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const agentsRevision = useAgentsRevision()
  const projects = useAppStore(s => s.projects)
  const setProvider = useAppStore(s => s.setActiveAgentProvider)
  const setCategory = useAppStore(s => s.setActiveAgentCategory)

  useEffect(() => {
    let cancelled = false
    fetchUnifiedAgents(config, { projectId: projectId || undefined })
      .then(list => { if (!cancelled) { setAgents(list); setError('') } })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Agents unavailable') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [config, projectId, revision, agentsRevision])

  useEffect(() => {
    let cancelled = false
    // Editor options are advisory: each source may be missing on an older backend.
    void Promise.allSettled([fetchHarnessCapabilities(config), fetchAgentSkills(config, { projectId: projectId || undefined }), fetchMcpServerStatus(config)]).then(([caps, skills, servers]) => {
      if (cancelled) return
      setCapabilities(caps.status === 'fulfilled' ? caps.value : [])
      if (skills.status === 'fulfilled') {
        const seen = new Map<string, MultiSelectOption>()
        for (const skill of skills.value) if (!seen.has(skill.name)) seen.set(skill.name, { value: skill.name, label: skill.name, hint: skill.harness && skill.harness !== 'shared' ? harnessLabel(skill.harness) : 'shared' })
        setSkillOptions([{ value: '*', label: 'All skills', hint: '*' }, ...seen.values()])
      }
      if (servers.status === 'fulfilled') setMcpOptions(servers.value.filter(server => server.source === 'orchestra').map(server => ({ value: server.name, label: server.name, hint: server.status })))
    })
    return () => { cancelled = true }
  }, [config, projectId])

  const orchestra = useMemo(() => (agents ?? []).filter(agent => agent.source === 'orchestra').sort((a, b) => a.name.localeCompare(b.name)), [agents])
  const harnessGroups = useMemo(() => {
    const groups = new Map<string, OrchestraAgent[]>()
    for (const agent of agents ?? []) {
      const harness = (agent.harness || 'other').toLowerCase()
      if (agent.source === 'orchestra' || harness === 'gemini') continue
      groups.set(harness, [...(groups.get(harness) ?? []), agent])
    }
    return [...groups]
  }, [agents])
  const selected = editing?.kind === 'agent' ? agents?.find(agent => agent.id === editing.id) : undefined
  const projectName = projects.find(project => project.id === projectId)?.name
  const scopeLabel = (agent: OrchestraAgent) => agent.scope === 'project' ? 'Project' : 'Global'
  const openTemplate = (template: AgentTemplate) => { setTemplatesOpen(false); setEditing({ kind: 'new', template }) }
  const editInHarness = (harness: string) => {
    const provider = PROVIDERS.find(item => item.id === harness)
    if (!provider) return
    setProvider(provider.id)
    setCategory('agents')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-muted-foreground"><Bot className="size-4" /><span className="text-[11px] font-medium uppercase tracking-wide">Agents</span></div>
            <h2 className="text-[18px] font-semibold tracking-tight">Agents for every harness</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">A prompt, model, skills, MCP servers and permissions, applied on each harness that supports them. {projectName ? `Showing global agents and ${projectName}.` : 'Showing global agents.'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <AppTooltip content="Refresh"><Button variant="ghost" size="icon" aria-label="Refresh agents" className="size-8 text-muted-foreground" disabled={loading} onClick={() => { setLoading(true); setRevision(value => value + 1) }}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            </Button></AppTooltip>
            <Popover open={templatesOpen} onOpenChange={setTemplatesOpen}>
              <PopoverTrigger asChild><Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground"><LayoutTemplate className="size-3.5" />Templates</Button></PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-1">
                {AGENT_TEMPLATES.map(template => (
                  <button key={template.id} type="button" onClick={() => openTemplate(template)} className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted">
                    <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: template.values.color }} />
                    <span><span className="block text-[13px]">{template.values.name}</span><span className="block text-[11px] text-muted-foreground">{template.summary}</span></span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setEditing({ kind: 'new' })}><Plus className="size-3.5" />Create agent</Button>
          </div>
        </div>

        {error && <p role="alert" className="mb-4 text-[12px] text-red-500">{error}</p>}

        <section aria-label="Orchestra agents section" className="mb-8">
          <div className="mb-2 flex items-baseline gap-2"><Caption>Orchestra</Caption><span className="text-[11px] text-muted-foreground/70">editable · works across harnesses</span></div>
          {orchestra.length ? (
            <ul aria-label="Orchestra agents" className="divide-y divide-border/50">
              {orchestra.map(agent => (
                <li key={agent.id}>
                  <button type="button" onClick={() => setEditing({ kind: 'agent', id: agent.id })} className="group flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/30">
                    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: agentColor(agent.color, agent.id) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{agent.name}</span>
                      {agent.description && <span className="block truncate text-[12px] text-muted-foreground">{agent.description}</span>}
                    </span>
                    <Badge>{MODE_LABEL[agent.mode] ?? agent.mode}</Badge>
                    <Badge title={agent.scope === 'project' ? 'Only in this project' : 'Available in every project'}>{scopeLabel(agent)}</Badge>
                    <span className="flex w-24 shrink-0 items-center justify-end gap-1" aria-label={`Compatible harnesses: ${(agent.compatible_harnesses ?? []).map(harnessLabel).join(', ') || 'unknown'}`}>
                      {(agent.compatible_harnesses ?? []).filter(id => id.toLowerCase() !== 'gemini').map(id => <span key={id} title={harnessLabel(id)}><HarnessIcon id={id} size={13} /></span>)}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          ) : agents ? (
            <div className="rounded-lg border border-dashed border-border px-5 py-6">
              <h3 className="text-[14px] font-semibold">Create your first agent</h3>
              <p className="mt-1 text-[13px] text-muted-foreground">Start from a template or a blank agent. It shows up in the chat agent switcher, @ mentions and automations as soon as it is saved.</p>
              <div className="mt-4"><TemplateGrid onPick={openTemplate} /></div>
              <Button size="sm" variant="outline" className="mt-3 gap-1.5" onClick={() => setEditing({ kind: 'new' })}><Plus className="size-3.5" />Blank agent</Button>
            </div>
          ) : <p className="px-2 text-[12px] text-muted-foreground">Loading agents…</p>}
        </section>

        {harnessGroups.map(([harness, items]) => (
          <section key={harness} aria-label={`${harnessLabel(harness)} agents section`} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <HarnessIcon id={harness} size={13} /><Caption>{harnessLabel(harness)}</Caption>
              <span className="text-[11px] text-muted-foreground/70">applies only on {harnessLabel(harness)}</span>
              <span className="flex-1" />
              {PROVIDERS.some(item => item.id === harness) && <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => editInHarness(harness)}>Edit in {harnessLabel(harness)}<ArrowUpRight className="size-3" /></Button>}
            </div>
            <ul aria-label={`${harnessLabel(harness)} agents`} className="divide-y divide-border/50">
              {items.map(agent => (
                <li key={agent.id} className="flex items-center gap-3 px-2 py-2" title={agent.path}>
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: agentColor(agent.color, agent.id) }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{agent.name}</span>
                    {(agent.description || agent.unavailable_reason) && <span className="block truncate text-[12px] text-muted-foreground">{agent.selectable === false && agent.unavailable_reason ? agent.unavailable_reason : agent.description}</span>}
                  </span>
                  <Badge>{MODE_LABEL[agent.mode] ?? agent.mode}</Badge>
                  <Badge>{scopeLabel(agent)}</Badge>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Dialog open={!!editing && (editing.kind === 'new' || !!selected)} onOpenChange={next => { if (!next) setEditing(null) }}>
        <DialogContent srTitle={editing?.kind === 'new' ? 'Create agent' : `Edit agent ${selected?.name ?? ''}`} className="flex h-[min(760px,90vh)] w-[min(1080px,95vw)] max-w-none flex-col gap-0 overflow-hidden p-0">
          <header className="flex h-12 shrink-0 items-center gap-3 pl-5 pr-14">
            <h2 className="text-[13px] font-medium text-muted-foreground">{editing?.kind === 'new' ? editing.template ? `New agent from ${editing.template.values.name}` : 'New agent' : 'Edit agent'}</h2>
          </header>
          {editing && (editing.kind === 'new' || selected) && (
            <div className="min-h-0 flex-1">
              <OrchestraAgentEditor key={editing.kind === 'new' ? `new:${editing.template?.id ?? ''}` : selected!.id} config={config} agent={editing.kind === 'new' ? undefined : selected} projectId={projectId}
                template={editing.kind === 'new' ? editing.template?.values : undefined}
                capabilities={capabilities} skillOptions={skillOptions} mcpOptions={mcpOptions}
                onSaved={agent => { setAgents(previous => [...(previous ?? []).filter(item => item.id !== agent.id), agent]); setEditing(null) }}
                onDeleted={id => { setAgents(previous => previous?.filter(item => item.id !== id)); setEditing(null) }}
                onCancel={() => setEditing(null)} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
