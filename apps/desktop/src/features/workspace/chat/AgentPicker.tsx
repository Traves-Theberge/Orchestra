import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Bot, ChevronDown, Lock, Search } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { fetchAgentCatalog, type AgentCatalog, type AgentCatalogItem, type AgentSelection } from '@core/api/agent-catalog'
import { fetchHarnessCapabilities, fetchUnifiedAgents, type HarnessCapabilities, type OrchestraAgent } from '@core/api/client'
import type { BackendConfig } from '@core/api/types'
import { agentColor, capabilityHint, findCapabilities, isPrimaryMode } from '@features/agents/lib/agent-display'
import { agentIdOf, isAgentSelectable, toAgentSelection as toSelection } from './agent-selection'
import { useAgentsRevision } from '@features/agents/lib/agents-events'

/** Orchestra agents carry their prompt, which the detail pane previews. */
type PickerItem = AgentCatalogItem & { prompt?: string }
/** One palette row; `item` is undefined for the default (Maestro / provider default) mode. */
type Row = { key: string; item?: PickerItem; group: string; enabled: boolean; reason?: string; hint?: string }

const EMPTY: PickerItem[] = []

/** Shapes an Orchestra agent from /agent-profiles like a catalog item so it lists and selects the same way. */
const toCatalogItem = (harness: string) => (agent: OrchestraAgent): PickerItem => ({
  id: agent.id, agent_id: agent.id, item_id: `orchestra:${agent.id}`, kind: 'agent_definition', harness, scope: agent.scope,
  path: agent.path ?? '', content_hash: agent.content_hash ?? '', format: agent.format ?? 'orchestra-markdown',
  display_name: agent.name, name: agent.name, description: agent.description ?? '', mode: agent.mode,
  selectable_as_primary: !!agent.selectable, selection_status: agent.selectable ? 'selectable_primary' : 'unavailable',
  source: 'orchestra', color: agent.color, model: agent.model, effort: agent.effort, skills: agent.skills, mcp_servers: agent.mcp_servers,
  selectable: !!agent.selectable, unavailable_reason: agent.unavailable_reason, prompt: agent.prompt,
})

const nameOf = (item: AgentCatalogItem) => item.display_name || item.name || agentIdOf(item)

function ColorDot({ item }: { item: AgentCatalogItem }) {
  return <span aria-hidden="true" data-agent-color className="size-2 shrink-0 rounded-full" style={{ backgroundColor: agentColor(item.color, agentIdOf(item)) }} />
}

/** Rounded initial tile tinted with the agent's color; the default mode gets a neutral bot glyph. */
function Avatar({ item, size }: { item?: AgentCatalogItem; size: number }) {
  if (!item) return <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-md bg-muted text-muted-foreground" style={{ width: size, height: size }}><Bot size={size * 0.55} /></span>
  const color = agentColor(item.color, agentIdOf(item))
  return <span aria-hidden="true" data-agent-color className="grid shrink-0 place-items-center rounded-md font-bold"
    style={{ width: size, height: size, fontSize: size * 0.45, color, backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }}>{nameOf(item).charAt(0).toUpperCase()}</span>
}

function highlight(text: string, query: string): ReactNode {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (at < 0) return text
  return <>{text.slice(0, at)}<mark className="rounded-sm bg-primary/25 text-foreground">{text.slice(at, at + query.length)}</mark>{text.slice(at + query.length)}</>
}

const Kbd = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-b-2 border-border/70 px-1 font-mono text-[10px]">{children}</kbd>

export function AgentPicker({ config, projectId, harness, disabled, selection, onChange }: {
  config: BackendConfig; projectId: string; harness: string; disabled: boolean
  selection?: AgentSelection; onChange: (selection?: AgentSelection) => void
}) {
  const isMaestroScope = projectId === '__orchestrator__'
  const defaultLabel = isMaestroScope ? 'Maestro' : 'Provider default'
  const defaultAvailableLabel = isMaestroScope ? 'Maestro is available.' : 'Provider default is available.'
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'all' | 'orchestra' | 'native'>('all')
  const [query, setQuery] = useState('')
  // null follows the active agent; a number is the row the user moved to.
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const [shake, setShake] = useState(0)
  const [flash, setFlash] = useState(false)
  const [cycleNotice, setCycleNotice] = useState('')
  const [catalog, setCatalog] = useState<{ key: string; data?: AgentCatalog; error?: string }>({ key: '' })
  const [capabilities, setCapabilities] = useState<{ key: string; list?: HarnessCapabilities[] }>({ key: '' })
  const [orchestra, setOrchestra] = useState<{ key: string; list: PickerItem[] }>({ key: '', list: [] })
  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const uid = useId()
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
    search.current?.focus()
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) { setOpen(false); button.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(false), 500)
    return () => window.clearTimeout(timer)
  }, [flash])
  const data = catalog.key === key ? catalog.data : undefined
  const caps = capabilities.key === backendKey ? findCapabilities(capabilities.list, harness) : undefined
  const orchestraItems = orchestra.key === key ? orchestra.list : EMPTY
  const definitions = useMemo(() => {
    const catalogItems: PickerItem[] = data?.items ?? []
    const listed = new Set(catalogItems.map(agentIdOf))
    // Orchestra agents first; an agent both sources return keeps its catalog entry.
    return [...orchestraItems.filter(item => !listed.has(agentIdOf(item))), ...catalogItems]
      .filter(item => item.kind === 'agent_definition' && isPrimaryMode(item.mode))
  }, [data, orchestraItems])
  const selected = definitions.find(item => agentIdOf(item) === selection?.agent_id && item.scope === selection?.agent_scope)
  const choose = (next?: AgentSelection) => { onChange(next); setOpen(false); setFlash(true); button.current?.focus() }
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
  const harnessLabel = harness ? harness.charAt(0).toUpperCase() + harness.slice(1).toLowerCase() : 'Harness'
  const groups = { all: definitions, orchestra: definitions.filter(item => item.source === 'orchestra'), native: definitions.filter(item => item.source !== 'orchestra') }
  const tabs: Array<{ id: typeof tab; label: string }> = [{ id: 'all', label: 'All' }, { id: 'orchestra', label: 'Orchestra' }, { id: 'native', label: harnessLabel }]
  // The palette lists the default mode, then Orchestra agents, then the harness's own agents.
  const needle = query.trim().toLowerCase()
  const matches = (...fields: Array<string | undefined>) => !needle || fields.some(field => field?.toLowerCase().includes(needle))
  const rows: Row[] = [
    ...(tab !== 'native' && matches(defaultLabel, 'default') ? [{ key: 'default', group: 'Default', enabled: true }] : []),
    ...groups[tab].filter(item => matches(nameOf(item), item.description, item.scope, item.model, item.source)).map(item => {
      const enabled = isAgentSelectable(item, data)
      return { key: item.item_id || `${item.scope}:${agentIdOf(item)}`, item, group: item.source === 'orchestra' ? 'Orchestra' : harnessLabel, enabled,
        reason: enabled ? undefined : item.unavailable_reason || item.reason || data?.reason || 'Selection not supported by this harness',
        hint: enabled ? capabilityHint(caps, harness, item.source) : undefined }
    }),
  ]
  const isActive = (row: Row) => row.item ? row.item === selected : !selection
  const current = rows.length ? Math.min(highlighted ?? Math.max(0, rows.findIndex(isActive)), rows.length - 1) : -1
  const focused = rows[current]
  const optionId = (index: number) => `${uid}-agent-${index}`
  useEffect(() => { if (open && current >= 0) document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' }) })
  const openPalette = () => { setQuery(''); setHighlighted(null); setOpen(value => !value) }
  const pick = (row?: Row) => {
    if (!row) return
    // An agent the harness can't apply stays highlighted and nudges its reason instead of closing.
    if (!row.enabled) { setShake(value => value + 1); return }
    choose(row.item ? toSelection(row.item) : undefined)
  }
  const move = (delta: number) => { if (rows.length) setHighlighted((current + delta + rows.length) % rows.length) }
  const emptyMessage = !definitions.length
    ? catalog.key === key && catalog.error
      ? `Agent catalog unavailable. ${defaultAvailableLabel}`
      : data ? `No custom agents in this scope. ${isMaestroScope ? 'Maestro remains available as the default.' : ''}` : `Loading agents… ${isMaestroScope ? 'Maestro is available.' : ''}`
    : needle && !rows.length ? `No agents match “${query.trim()}”`
      : !groups[tab].length ? tab === 'orchestra' ? 'No Orchestra agents yet. Create one on the Agents page.' : `No ${harnessLabel} agents in this scope.` : ''
  const meta = (label: string, value: ReactNode) => <><span className="text-muted-foreground">{label}</span><span className="min-w-0 break-words">{value}</span></>
  return <>
    <AppTooltip content={selectedHint ? `Agent · ${selectedHint}` : `${defaultLabel} · Tab cycles agents when the message is empty`} side="top"><button ref={button} type="button" aria-label="Choose agent mode" aria-haspopup="dialog" aria-expanded={open} disabled={disabled || !harness}
      onClick={openPalette}
      style={flash ? { boxShadow: `0 0 0 2px ${selected ? agentColor(selected.color, agentIdOf(selected)) : 'var(--ring)'}` } : undefined}
      className={`flex min-w-0 max-w-44 items-center gap-1.5 rounded-lg bg-muted/45 px-2 py-1.5 text-[11px] font-medium transition-[background-color,box-shadow] duration-300 hover:bg-muted disabled:opacity-40 ${open ? 'bg-muted text-foreground' : selected ? 'text-foreground' : 'text-muted-foreground'}`}>
      {selected ? <ColorDot item={selected} /> : <Bot size={12} className="shrink-0" />}
      <span className="truncate">{selected ? nameOf(selected) : selection ? selection.agent_id : defaultLabel}</span>
      <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button></AppTooltip>
    {cycleNotice && <span role="status" className="max-w-48 text-[10px] text-muted-foreground">{cycleNotice}</span>}
    {open && !disabled && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]">
      <div ref={popup} role="dialog" aria-modal="true" aria-label="Agents" className="@container max-h-[calc(100vh-32px)] w-[660px] max-w-full overflow-y-auto rounded-[20px] border border-border/80 bg-card text-card-foreground shadow-[0_28px_90px_-18px_rgba(0,0,0,0.85)] ring-1 ring-white/10"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          if (query) { setQuery(''); setHighlighted(0); return }
          setOpen(false); button.current?.focus(); return
        }
        if (event.key === 'ArrowDown' || event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); move(1) }
        else if (event.key === 'ArrowUp' || event.key === 'Tab') { event.preventDefault(); move(-1) }
        else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); if (rows.length) setHighlighted(event.key === 'Home' ? 0 : rows.length - 1) }
        else if (event.key === 'Enter') { event.preventDefault(); pick(focused) }
      }}>
      <div className="grid grid-cols-1 @[540px]:grid-cols-[minmax(200px,236px)_1fr]">
        <div className="col-span-full flex items-center gap-2.5 border-b border-border px-3.5 py-3">
          <Search size={15} className="shrink-0 text-muted-foreground" />
          <input ref={search} role="combobox" aria-label="Search agents" aria-expanded="true" aria-controls={`${uid}-list`} aria-activedescendant={current >= 0 ? optionId(current) : undefined} autoComplete="off" spellCheck={false}
            value={query} onChange={event => { setQuery(event.target.value); setHighlighted(0) }} placeholder="Switch agent…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          <span className="text-muted-foreground"><Kbd>esc</Kbd></span>
        </div>
        <div role="tablist" aria-label="Agent sources" className="col-span-full flex items-center gap-1 border-b border-border px-2.5 py-1.5">
          {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); setHighlighted(0); search.current?.focus() }}
            className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition-colors ${tab === item.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}>
            {item.label}<span className="tabular-nums text-[10px] opacity-60">{groups[item.id].length + (item.id === 'native' ? 0 : 1)}</span>
          </button>)}
        </div>
        <div id={`${uid}-list`} role="listbox" aria-label="Agent modes" className="max-h-52 overflow-auto p-1.5 @[540px]:h-[330px] @[540px]:max-h-none @[540px]:border-r @[540px]:border-border">
          {rows.map((row, index) => {
            const header = index === 0 || rows[index - 1].group !== row.group
            const label = row.item ? nameOf(row.item) : defaultLabel
            const color = row.item ? agentColor(row.item.color, agentIdOf(row.item)) : 'var(--muted-foreground)'
            return <div key={row.key}>
              {header && tab === 'all' && <div aria-hidden="true" className="flex justify-between px-2 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{row.group}<span>{rows.filter(other => other.group === row.group).length}</span></div>}
              <div id={optionId(index)} role="option" aria-selected={isActive(row)} aria-disabled={!row.enabled || undefined} title={row.reason ?? row.hint}
                onMouseMove={() => { if (index !== current) setHighlighted(index) }} onClick={() => { setHighlighted(index); pick(row) }}
                className={`relative flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] ${index === current ? 'bg-accent' : ''}`}>
                {index === current && <span aria-hidden="true" className="absolute -left-1.5 inset-y-1.5 w-[3px] rounded-full" style={{ backgroundColor: color }} />}
                <Avatar item={row.item} size={22} />
                <span className={`min-w-0 flex-1 truncate ${row.enabled ? '' : 'opacity-50'}`}>{highlight(label, query.trim())}</span>
                {isActive(row) ? <span aria-hidden="true" className="rounded-full px-1.5 text-[9px] font-semibold" style={{ color, backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }}>active</span>
                  : !row.enabled && <Lock aria-hidden="true" size={11} className="shrink-0 text-muted-foreground/70" />}
              </div>
            </div>
          })}
          {emptyMessage && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{emptyMessage}</p>}
          {data?.selection_capability !== 'selectable_primary' && definitions.length > 0 && !definitions.some(item => typeof item.selectable === 'boolean') && <p className="px-2 py-2 text-[10px] text-muted-foreground">{data?.reason || 'Custom agent selection is not verified for this harness.'}</p>}
        </div>
        <div role="region" aria-label="Agent details" aria-live="polite" className="flex flex-col gap-3.5 border-t border-border p-4 @[540px]:h-[330px] @[540px]:overflow-auto @[540px]:border-t-0">
          {!focused ? <p className="py-6 text-center text-xs text-muted-foreground">Try another name, model or scope.</p> : <>
            <div className="flex items-center gap-3">
              <Avatar item={focused.item} size={38} />
              <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 text-[15px] font-semibold"><span className="truncate">{focused.item ? nameOf(focused.item) : defaultLabel}</span>
                  <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] font-medium text-muted-foreground">{focused.item ? focused.item.source === 'orchestra' ? 'orchestra' : focused.item.scope : 'built-in'}</span></h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{isActive(focused) ? 'Active now' : focused.enabled ? 'Available' : 'Unavailable'}</p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{focused.item ? focused.item.description || 'No description.' : isMaestroScope ? 'Orchestrator. Plans, delegates to sub-agents, and dispatches work across providers.' : `${harnessLabel} with its own default behaviour.`}</p>
            {focused.reason && <p key={shake} role="alert" className={`rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11.5px] ${shake ? 'animate-[agent-shake_0.3s]' : ''}`}>{focused.reason}</p>}
            {focused.item && <div className="grid grid-cols-[70px_1fr] items-baseline gap-x-2.5 gap-y-1.5 text-[11.5px]">
              {meta('Model', <><code className="font-mono text-[11px]">{focused.item.model || 'inherit'}</code>{focused.item.effort && ` · ${focused.item.effort}`}</>)}
              {meta('Mode', focused.item.mode || 'agent')}
              {!!(focused.item.skills?.length || focused.item.mcp_servers?.length) && meta('Tools', <span className="flex flex-wrap gap-1">{[...focused.item.skills ?? [], ...(focused.item.mcp_servers ?? []).map(name => `mcp:${name}`)].map(name => <span key={name} className="rounded bg-muted px-1.5 text-[10px]">{name}</span>)}</span>)}
              {focused.item.path && meta('Source', <code className="font-mono text-[11px]">{focused.item.path}</code>)}
              {focused.hint && meta('Applied', focused.hint)}
            </div>}
            {focused.item?.prompt && <pre className="line-clamp-4 whitespace-pre-wrap rounded-lg bg-muted/60 px-3 py-2 font-mono text-[11px] leading-normal text-muted-foreground">{focused.item.prompt}</pre>}
            <div className="mt-auto flex">
              <button type="button" disabled={!focused.enabled || isActive(focused)} onClick={() => pick(focused)}
                className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:cursor-not-allowed disabled:opacity-35">{isActive(focused) ? 'Currently active' : 'Use agent ↵'}</button>
            </div>
          </>}
        </div>
        <div className="col-span-full flex items-center gap-3.5 border-t border-border px-3.5 py-2 text-[10.5px] text-muted-foreground">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span><span><Kbd>Tab</Kbd> next</span><span><Kbd>↵</Kbd> use agent</span>
          <span className="ml-auto">{definitions.length + 1} {definitions.length ? 'agents' : 'agent'}</span>
        </div>
      </div>
      </div>
    </div>, document.body)}
  </>
}
