import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search, Terminal } from 'lucide-react'
import type { WorkspaceChatProvider, WorkspaceChatModelCatalog } from '@core/api/client'

export function HarnessPicker({ providers, provider, disabled, locked, catalog, model, onProvider, onModel }: {
  providers: WorkspaceChatProvider[]; provider: string; disabled: boolean; locked: boolean
  catalog?: WorkspaceChatModelCatalog; model: string
  onProvider: (id: string) => void; onModel: (model: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const selected = providers.find(p => p.id === provider)
  const selectedModel = catalog?.models.find(m => m.model === model)
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const close = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus() }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape, true) }
  }, [open])
  const query = search.trim().toLowerCase()
  const models = catalog?.models.filter(m => !m.hidden && `${m.display_name} ${m.model}`.toLowerCase().includes(query)) ?? []
  return <>
    <button ref={button} type="button" aria-label="Choose harness and model" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
      onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); setRect({ left: bounds.left, top: bounds.top }); setSearch(''); setOpen(value => !value) }} className="flex min-w-0 max-w-48 items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-[11px] disabled:opacity-40">
      <Terminal className="size-3.5 shrink-0" /><span className="truncate">{selectedModel?.display_name || selectedModel?.model || selected?.label || provider || 'Choose harness'}</span>{selectedModel && <span className="truncate text-[10px] text-muted-foreground">{selected?.label}</span>}<ChevronDown className="size-3 shrink-0" />
    </button>
    {open && !disabled && rect && createPortal(<div ref={popup} role="dialog" aria-label="Harnesses and models" className="fixed z-[100] flex overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      style={{ left: Math.max(8, Math.min(rect.left, window.innerWidth - 468)), bottom: Math.max(8, window.innerHeight - rect.top + 8), width: Math.min(460, window.innerWidth - 16), maxHeight: Math.min(420, Math.max(180, rect.top - 16)) }}>
      <div aria-label="Registered harnesses" className="w-36 shrink-0 overflow-y-auto border-r border-border p-1.5">
        {providers.map(p => <button key={p.id} type="button" aria-label={`Use ${p.label}`} aria-pressed={p.id === provider} disabled={!p.enabled || locked && p.id !== provider}
          title={!p.enabled ? p.reason || 'Harness unavailable' : locked && p.id !== provider ? 'Finish the current operation before changing harness' : p.label}
          onClick={() => { onProvider(p.id); setSearch('') }} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs disabled:opacity-40 ${p.id === provider ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'}`}>
          <span className="flex-1 break-words">{p.label}</span>{p.id === provider && <Check className="size-3 shrink-0" />}
        </button>)}
      </div>
      <div className="min-w-0 flex-1 p-2">
        <label className="mb-2 flex items-center gap-2 border-b border-border px-1 pb-2"><Search className="size-4 text-muted-foreground" /><input ref={input} aria-label="Search models" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
        <div role="listbox" aria-label="Model for next turn" className="max-h-64 overflow-auto" onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'))
          const current = options.findIndex(option => option === document.activeElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
          options[next]?.focus()
        }}>
          <button type="button" role="option" aria-selected={!model} onClick={() => { onModel(''); setOpen(false); button.current?.focus() }} className="mb-1 w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-accent"><span className="block font-medium">Provider default / current session</span><span className="text-[10px] text-muted-foreground">{selected?.label} · {selected?.conversation_mode === 'native_session' ? 'Native session' : 'Transcript replay'}</span></button>
          {models.map(m => <button type="button" role="option" aria-label={m.display_name || m.model} key={m.id || m.model} aria-selected={model === m.model} onClick={() => { onModel(m.model); setOpen(false); button.current?.focus() }} className={`mb-1 w-full rounded-lg px-2 py-2 text-left text-xs ${model === m.model ? 'bg-accent' : 'hover:bg-accent/60'}`}><span className="block font-medium">{m.display_name || m.model}</span><span className="text-[10px] text-muted-foreground">{selected?.label}</span></button>)}
          {!models.length && <p className="p-2 text-xs text-muted-foreground">{catalog ? 'No matching models.' : selected?.conversation_mode === 'native_session' ? 'Model catalog is loading or unavailable. Provider default remains available.' : 'This harness uses its configured CLI model. Per-turn model selection is unavailable.'}</p>}
        </div>
        {locked && <p className="mt-2 px-2 text-[10px] text-muted-foreground">Finish or resolve the current operation before changing harness.</p>}
      </div>
    </div>, document.body)}
  </>
}
