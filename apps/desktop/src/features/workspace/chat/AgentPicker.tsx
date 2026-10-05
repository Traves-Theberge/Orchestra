import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, Check, ChevronDown } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { fetchAgentCatalog, type AgentCatalog, type AgentSelection } from '@core/api/agent-catalog'
import type { BackendConfig } from '@core/api/types'

export function AgentPicker({ config, projectId, harness, disabled, selection, onChange }: {
  config: BackendConfig; projectId: string; harness: string; disabled: boolean
  selection?: AgentSelection; onChange: (selection?: AgentSelection) => void
}) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<{ left: number; top: number }>()
  const [cycleNotice, setCycleNotice] = useState('')
  const [catalog, setCatalog] = useState<{ key: string; data?: AgentCatalog; error?: string }>({ key: '' })
  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const key = JSON.stringify([config.baseUrl, config.apiToken, config.workspaceId, projectId, harness])
  useEffect(() => {
    if (!harness) return
    let cancelled = false
    void fetchAgentCatalog(config, projectId, harness, projectId === '__orchestrator__' ? 'global' : 'effective')
      .then(data => { if (!cancelled) setCatalog({ key, data }) })
      .catch(cause => { if (!cancelled) setCatalog({ key, error: cause instanceof Error ? cause.message : 'Catalog unavailable' }) })
    return () => { cancelled = true }
  }, [config, projectId, harness, key, open])
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
  const definitions = useMemo(() => data?.items.filter(item => item.kind === 'agent_definition') ?? [], [data])
  const selected = definitions.find(item => (item.agent_id || item.id) === selection?.agent_id && item.scope === selection?.agent_scope)
  const choose = (next?: AgentSelection) => { onChange(next); setOpen(false); button.current?.focus() }
  useEffect(() => {
    const cycle = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || disabled || open) return
      const target = event.target
      const footer = button.current?.closest('footer')
      if (!(target instanceof HTMLElement) || !(target === button.current || target.tagName === 'TEXTAREA' && footer?.contains(target))) return
      const primary = data?.selection_capability === 'selectable_primary' ? definitions.filter(item => item.selectable_as_primary && item.scope !== 'builtin') : []
      event.preventDefault()
      if (!primary.length) { setCycleNotice(data ? 'Default is the only supported mode.' : 'Agent modes unavailable.'); return }
      setCycleNotice('')
      const modes: Array<AgentSelection | undefined> = [undefined, ...primary.map(item => ({ agent_id: item.agent_id || item.id, agent_scope: item.scope as 'project' | 'global', agent_content_hash: item.content_hash, agent_format: item.format }))]
      const index = Math.max(0, modes.findIndex(mode => mode?.agent_id === selection?.agent_id && mode?.agent_scope === selection?.agent_scope))
      onChange(modes[(index + (event.shiftKey ? -1 : 1) + modes.length) % modes.length])
    }
    document.addEventListener('keydown', cycle)
    return () => document.removeEventListener('keydown', cycle)
  }, [data, definitions, selection, disabled, open, onChange])
  return <>
    <AppTooltip content="Agent mode · Tab to cycle supported modes" side="top"><button ref={button} type="button" aria-label="Choose agent mode" aria-haspopup="listbox" aria-expanded={open} disabled={disabled || !harness}
      onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); setRect({ left: bounds.left, top: bounds.top }); setOpen(current => !current) }} className="flex max-w-44 items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-[11px] disabled:opacity-40">
      <Bot size={14} /><span className="truncate">{selected?.display_name || selection?.agent_id || 'Default agent'}</span><ChevronDown size={12} />
    </button></AppTooltip>
    {cycleNotice && <span role="status" className="max-w-48 text-[10px] text-muted-foreground">{cycleNotice}</span>}
    {open && !disabled && rect && createPortal(<div ref={popup} role="listbox" aria-label="Agent modes" className="fixed z-[150] max-h-80 w-72 max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-border bg-popover p-1 shadow-xl"
      style={{ left: Math.max(8, Math.min(rect.left, window.innerWidth - 296)), bottom: Math.max(8, Math.min(window.innerHeight - rect.top + 8, window.innerHeight - 100)) }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); choose(selection); return }
        if (event.key === 'Tab') { setOpen(false); return }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')]
        const current = options.findIndex(option => option === document.activeElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
        options[next]?.focus()
      }}>
      <button type="button" role="option" aria-selected={!selection} onClick={() => choose()} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent focus:bg-accent"><span className="flex-1">Provider default</span>{!selection && <Check size={13} />}</button>
      {definitions.map(item => <button key={item.item_id || `${item.scope}:${item.agent_id}`} type="button" role="option" aria-selected={selected === item}
        disabled={!item.selectable_as_primary || data?.selection_capability !== 'selectable_primary' || item.scope === 'builtin'}
        onClick={() => { if (item.scope !== 'builtin' && (item.agent_id || item.id)) choose({ agent_id: item.agent_id || item.id, agent_scope: item.scope, agent_content_hash: item.content_hash, agent_format: item.format }) }}
        className="block w-full rounded px-2 py-2 text-left text-xs hover:bg-accent focus:bg-accent disabled:opacity-50">
        <span className="block font-medium">{item.display_name}</span><span className="block text-[10px] text-muted-foreground">{item.scope} · {item.mode || 'agent'}{!item.selectable_as_primary && ` · ${item.reason || 'Selection not supported by this harness'}`}</span>
      </button>)}
      {!definitions.length && <p className="px-2 py-2 text-xs text-muted-foreground">{catalog.key === key && catalog.error ? 'Agent catalog unavailable. Provider default is available.' : data ? 'No custom agents in this scope.' : 'Loading agents…'}</p>}
      {data?.selection_capability !== 'selectable_primary' && definitions.length > 0 && <p className="px-2 py-2 text-[10px] text-muted-foreground">{data?.reason || 'Custom agent selection is not verified for this harness.'}</p>}
    </div>, document.body)}
  </>
}
