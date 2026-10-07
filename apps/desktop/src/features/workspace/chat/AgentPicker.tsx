import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, Check, ChevronDown } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { fetchAgentCatalog, type AgentCatalog, type AgentCatalogItem, type AgentSelection } from '@core/api/agent-catalog'
import { fetchHarnessCapabilities, fetchUnifiedAgents, type HarnessCapabilities, type OrchestraAgent } from '@core/api/client'
import type { BackendConfig } from '@core/api/types'
import { agentColor, capabilityHint, findCapabilities, isPrimaryMode } from '@features/agents/lib/agent-display'
import { agentIdOf, isAgentSelectable, toAgentSelection as toSelection } from './agent-selection'
import { useAgentsRevision } from '@features/agents/lib/agents-events'

const MAX_PILLS = 3
const EMPTY: AgentCatalogItem[] = []

/** Shapes an Orchestra agent from /agent-profiles like a catalog item so it lists and selects the same way. */
const toCatalogItem = (harness: string) => (agent: OrchestraAgent): AgentCatalogItem => ({
  id: agent.id, agent_id: agent.id, item_id: `orchestra:${agent.id}`, kind: 'agent_definition', harness, scope: agent.scope,
  path: agent.path ?? '', content_hash: agent.content_hash ?? '', format: agent.format ?? 'orchestra-markdown',
  display_name: agent.name, name: agent.name, description: agent.description ?? '', mode: agent.mode,
  selectable_as_primary: !!agent.selectable, selection_status: agent.selectable ? 'selectable_primary' : 'unavailable',
  source: 'orchestra', color: agent.color, model: agent.model, effort: agent.effort,
  selectable: !!agent.selectable, unavailable_reason: agent.unavailable_reason,
})

function ColorDot({ item }: { item: AgentCatalogItem }) {
  return <span aria-hidden="true" data-agent-color className="size-2 shrink-0 rounded-full" style={{ backgroundColor: agentColor(item.color, agentIdOf(item)) }} />
}

export function AgentPicker({ config, projectId, harness, disabled, selection, onChange }: {
  config: BackendConfig; projectId: string; harness: string; disabled: boolean
  selection?: AgentSelection; onChange: (selection?: AgentSelection) => void
}) {
  const isMaestroScope = projectId === '__orchestrator__'
  const defaultLabel = isMaestroScope ? 'Maestro' : 'Provider default'
  const defaultAvailableLabel = isMaestroScope ? 'Maestro is available.' : 'Provider default is available.'
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<{ left: number; top: number }>()
  const [cycleNotice, setCycleNotice] = useState('')
  const [catalog, setCatalog] = useState<{ key: string; data?: AgentCatalog; error?: string }>({ key: '' })
  const [capabilities, setCapabilities] = useState<{ key: string; list?: HarnessCapabilities[] }>({ key: '' })
  const [orchestra, setOrchestra] = useState<{ key: string; list: AgentCatalogItem[] }>({ key: '', list: [] })
  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const key = JSON.stringify([config.baseUrl, config.apiToken, config.workspaceId, projectId, harness])
  const backendKey = JSON.stringify([config.baseUrl, config.apiToken])
  const agentsRevision = useAgentsRevision()
  useEffect(() => {
    if (!harness) return
    let cancelled = false
    void fetchAgentCatalog(config, projectId, harness, projectId === '__orchestrator__' ? 'global' : 'effective')
      .then(data => { if (!cancelled) setCatalog({ key, data }) })
      .catch(cause => { if (!cancelled) setCatalog({ key, error: cause instanceof Error ? cause.message : 'Catalog unavailable' }) })
    return () => { cancelled = true }
  }, [config, projectId, harness, key, open, agentsRevision])
  // Orchestra-native agents are not part of a harness catalog; they come from agent-profiles.
  useEffect(() => {
    if (!harness) return
    let cancelled = false
    void Promise.resolve().then(() => fetchUnifiedAgents(config, { projectId: isMaestroScope ? undefined : projectId, harness }))
      .then(list => { if (!cancelled) setOrchestra({ key, list: list.filter(agent => agent.source === 'orchestra').map(toCatalogItem(harness)) }) })
      .catch(() => { if (!cancelled) setOrchestra({ key, list: [] }) })
    return () => { cancelled = true }
  }, [config, projectId, harness, key, open, agentsRevision, isMaestroScope])
  useEffect(() => {
    let cancelled = false
    // Capability hints are advisory; an older backend without the endpoint just omits them.
    void Promise.resolve().then(() => fetchHarnessCapabilities(config))
      .then(list => { if (!cancelled) setCapabilities({ key: backendKey, list }) })
      .catch(() => { if (!cancelled) setCapabilities({ key: backendKey, list: [] }) })
    return () => { cancelled = true }
  }, [config, backendKey])
  useEffect(() => {
    if (!open) return
    popup.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus()
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false) }
    const dismiss = () => setOpen(false)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', dismiss)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss) }
  }, [open])
  const data = catalog.key === key ? catalog.data : undefined
  const caps = capabilities.key === backendKey ? findCapabilities(capabilities.list, harness) : undefined
  const orchestraItems = orchestra.key === key ? orchestra.list : EMPTY
  const definitions = useMemo(() => {
    const catalogItems = data?.items ?? []
    const listed = new Set(catalogItems.map(agentIdOf))
    // Orchestra agents first; an agent both sources return keeps its catalog entry.
    return [...orchestraItems.filter(item => !listed.has(agentIdOf(item))), ...catalogItems]
      .filter(item => item.kind === 'agent_definition' && isPrimaryMode(item.mode))
  }, [data, orchestraItems])
  const selected = definitions.find(item => agentIdOf(item) === selection?.agent_id && item.scope === selection?.agent_scope)
  const choose = (next?: AgentSelection) => { onChange(next); setOpen(false); button.current?.focus() }
  useEffect(() => {
    const cycle = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || disabled || open) return
      const target = event.target
      const footer = button.current?.closest('footer')
      if (!(target instanceof HTMLElement)) return
      const composer = target instanceof HTMLTextAreaElement && !!footer?.contains(target)
      // Tab keeps its normal focus behaviour once the user has typed a draft.
      if (!(target === button.current || composer && target.value === '')) return
      const primary = definitions.filter(item => isAgentSelectable(item, data))
      event.preventDefault()
      if (!primary.length) {
        setCycleNotice(data
          ? isMaestroScope ? 'Maestro is the only supported mode.' : 'Default is the only supported mode.'
          : isMaestroScope ? 'Agent modes unavailable; Maestro is available.' : 'Agent modes unavailable.')
        return
      }
      setCycleNotice('')
      const modes: Array<AgentCatalogItem | undefined> = [undefined, ...primary]
      const index = Math.max(0, modes.findIndex(mode => mode ? agentIdOf(mode) === selection?.agent_id && mode.scope === selection?.agent_scope : !selection))
      const next = modes[(index + (event.shiftKey ? -1 : 1) + modes.length) % modes.length]
      onChange(next ? toSelection(next) : undefined)
    }
    document.addEventListener('keydown', cycle)
    return () => document.removeEventListener('keydown', cycle)
  }, [data, definitions, selection, disabled, open, onChange, isMaestroScope])
  const selectedHint = selected ? capabilityHint(caps, harness, selected.source) : undefined
  // Segmented pills for the first few applicable primary agents; the rest (and anything unavailable, with its reason) live in the overflow menu.
  const selectable = definitions.filter(item => isAgentSelectable(item, data))
  const pinned = selectable.slice(0, MAX_PILLS)
  if (selected && !pinned.includes(selected)) pinned.push(selected)
  const overflowCount = definitions.length - pinned.length
  const pill = (active: boolean) => `flex min-w-0 max-w-32 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${active ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}`
  return <>
    <div role="group" aria-label="Agent" className="flex min-w-0 items-center gap-0.5 rounded-lg bg-muted/45 p-0.5">
      <button type="button" aria-label={`Agent: ${defaultLabel}`} aria-pressed={!selection} disabled={disabled || !harness} title={`${defaultLabel} · Tab cycles agents when the message is empty`} onClick={() => onChange(undefined)} className={pill(!selection)}>
        <Bot size={12} className="shrink-0" /><span className="truncate">{defaultLabel}</span>
      </button>
      {pinned.map(item => <button key={item.item_id || `${item.scope}:${agentIdOf(item)}`} type="button" aria-label={`Agent: ${item.display_name || item.name}`} aria-pressed={selected === item} disabled={disabled}
        title={capabilityHint(caps, harness, item.source) || item.description || undefined} onClick={() => onChange(toSelection(item))} className={pill(selected === item)}>
        <ColorDot item={item} /><span className="truncate">{item.display_name || item.name}</span>
      </button>)}
      <AppTooltip content={selectedHint ? `Agent · ${selectedHint}` : 'All agents · Tab to cycle'} side="top"><button ref={button} type="button" aria-label="Choose agent mode" aria-haspopup="listbox" aria-expanded={open} disabled={disabled || !harness}
        onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); setRect({ left: bounds.left, top: bounds.top }); setOpen(current => !current) }} className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground disabled:opacity-40 ${open ? 'bg-background/70 text-foreground' : ''}`}>
        {!pinned.length && selection && <span className="max-w-28 truncate">{selection.agent_id}</span>}
        {overflowCount > 0 && <span className="tabular-nums">+{overflowCount}</span>}
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button></AppTooltip>
    </div>
    {cycleNotice && <span role="status" className="max-w-48 text-[10px] text-muted-foreground">{cycleNotice}</span>}
    {open && !disabled && rect && createPortal(<div ref={popup} role="listbox" aria-label="Agent modes" className="fixed z-[150] max-h-80 w-72 max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-border bg-popover p-1 shadow-xl"
      style={{ left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), bottom: Math.max(8, Math.min(window.innerHeight - rect.top + 8, window.innerHeight - 100)) }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus(); return }
        if (event.key === 'Tab') { setOpen(false); return }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')]
        const current = options.findIndex(option => option === document.activeElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
        options[next]?.focus()
      }}>
      <button type="button" role="option" aria-selected={!selection} onClick={() => choose()} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent focus:bg-accent"><span className="flex-1">{defaultLabel}</span>{!selection && <Check size={13} />}</button>
      {definitions.map(item => {
        const enabled = isAgentSelectable(item, data)
        const reason = item.unavailable_reason || item.reason || data?.reason || 'Selection not supported by this harness'
        const hint = enabled ? capabilityHint(caps, harness, item.source) : undefined
        return <button key={item.item_id || `${item.scope}:${agentIdOf(item)}`} type="button" role="option" aria-selected={selected === item}
          disabled={!enabled} title={enabled ? hint : reason}
          onClick={() => { if (enabled) choose(toSelection(item)) }}
          className="block w-full rounded px-2 py-2 text-left text-xs hover:bg-accent focus:bg-accent disabled:opacity-50">
          <span className="flex items-center gap-2 font-medium"><ColorDot item={item} /><span className="min-w-0 flex-1 truncate">{item.display_name || item.name}</span>{selected === item && <Check size={13} />}</span>
          <span className="block pl-4 text-[10px] text-muted-foreground">{item.source === 'orchestra' ? 'orchestra' : item.scope} · {item.mode || 'agent'}{!enabled && ` · ${reason}`}</span>
          {hint && <span className="block pl-4 text-[10px] text-muted-foreground/80">{hint}</span>}
        </button>
      })}
      {!definitions.length && <p className="px-2 py-2 text-xs text-muted-foreground">{catalog.key === key && catalog.error
        ? `Agent catalog unavailable. ${defaultAvailableLabel}`
        : data
          ? `No custom agents in this scope. ${isMaestroScope ? 'Maestro remains available as the default.' : ''}`
          : `Loading agents… ${isMaestroScope ? 'Maestro is available.' : ''}`}</p>}
      {data?.selection_capability !== 'selectable_primary' && definitions.length > 0 && !definitions.some(item => typeof item.selectable === 'boolean') && <p className="px-2 py-2 text-[10px] text-muted-foreground">{data?.reason || 'Custom agent selection is not verified for this harness.'}</p>}
    </div>, document.body)}
  </>
}
