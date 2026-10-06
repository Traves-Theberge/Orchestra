import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, RotateCcw, Search, X } from 'lucide-react'
import type { WorkspaceChatProvider, WorkspaceChatModelCatalog } from '@core/api/client'
import { HarnessIcon } from '@ui/HarnessIcon'

type EffortOption = { reasoning_effort: string; description?: string }

export function HarnessPicker({ providers, provider, disabled, locked, catalog, model, effort, effortOptions = [], effortDisabled = false, onProvider, onModel, onEffort = () => {} }: {
  providers: WorkspaceChatProvider[]; provider: string; disabled: boolean; locked: boolean
  catalog?: WorkspaceChatModelCatalog; model: string; effort?: string
  effortOptions?: EffortOption[]; effortDisabled?: boolean
  onProvider: (id: string) => void; onModel: (model: string) => void; onEffort?: (effort: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const isSelected = (id: string) => id.toLowerCase() === provider.toLowerCase()
  const selected = providers.find(p => isSelected(p.id))
  const activeCatalog = catalog?.provider.toLowerCase() === provider.toLowerCase() ? catalog : undefined
  const selectedModel = activeCatalog?.models.find(m => m.model === model)
  const query = search.trim().toLowerCase()
  const models = activeCatalog?.models.filter(m => !m.hidden && `${m.display_name} ${m.model}`.toLowerCase().includes(query)) ?? []
  const availableCount = providers.filter(p => p.enabled).length

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) { setOpen(false); button.current?.focus() }
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); return }
      if (event.key === 'Tab' && popup.current) {
        const items = Array.from(popup.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus() }
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown, true) }
  }, [open])

  const close = () => { setOpen(false); button.current?.focus() }
  return <>
    <button ref={button} type="button" aria-label="Choose harness and model" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
      onClick={() => { setSearch(''); setOpen(value => !value) }}
      className={`flex min-w-0 max-w-60 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${open ? 'border-primary/40 bg-primary/10' : 'border-border/50 bg-background/70 hover:border-border hover:bg-accent/70'}`}>
      <HarnessIcon id={provider} size={16} />
      <span className="truncate">{selectedModel?.display_name || selectedModel?.model || selected?.label || (provider.toLowerCase() === 'gemini' ? 'Gemini' : provider) || 'Choose harness'}</span>
      {selectedModel && effort && <span className="hidden truncate text-[10px] font-normal capitalize text-primary sm:inline">{effort}</span>}
      <ChevronDown className={`size-3 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && !disabled && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]">
      <div ref={popup} role="dialog" aria-modal="true" aria-label="Harnesses and models" className="flex w-[620px] max-w-full max-h-[calc(100vh-32px)] min-h-0 flex-col overflow-hidden rounded-[20px] border border-border/80 bg-card shadow-[0_28px_90px_-18px_rgba(0,0,0,0.85)] ring-1 ring-white/10">
        <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/70"><HarnessIcon id={provider} size={20} /></span>
          <div className="min-w-0 flex-1"><h3 className="text-[15px] font-semibold tracking-tight">Agent setup</h3><p className="mt-0.5 text-[11px] text-muted-foreground">Choose a harness, model and reasoning level.</p></div>
          <button type="button" aria-label="Close harness picker" onClick={close} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-4" /></button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Harness</p><span className="text-[10px] text-muted-foreground">{availableCount} available</span></div>
          <div aria-label="Registered harnesses" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {providers.map(p => <button key={p.id} type="button" aria-label={`Use ${p.label}`} aria-pressed={isSelected(p.id)} disabled={!p.enabled || (locked && !isSelected(p.id))}
              title={!p.enabled ? p.reason || 'Harness unavailable' : locked && !isSelected(p.id) ? 'Finish the current operation before changing harness' : p.label}
              onClick={() => { onProvider(p.id); setSearch(''); input.current?.focus() }}
              className={`relative flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed ${isSelected(p.id) ? 'border-primary/60 bg-primary/15' : 'border-border/60 bg-transparent enabled:hover:border-primary/30 enabled:hover:bg-accent/60'}`}>
              <HarnessIcon id={p.id} size={20} /><span className="min-w-0 flex-1"><span className={`block truncate text-[11px] font-semibold ${p.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>{p.label}</span><span className="block text-[10px] text-muted-foreground">{p.enabled ? 'Available' : 'Unavailable'}</span></span>{isSelected(p.id) && <Check className="size-3.5 shrink-0 text-primary" />}
            </button>)}
          </div>

          <div className="my-4 border-t border-border/60" />
          <div className="mb-2 flex items-center gap-3"><p className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Model</p><label className="flex w-48 max-w-[55%] items-center gap-2 rounded-lg border border-border/70 bg-background/50 px-2.5 py-1.5 focus-within:border-primary/40"><Search className="size-3.5 text-muted-foreground" /><input ref={input} aria-label="Search models" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search models" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/70" /></label></div>
          <div role="listbox" aria-label="Model for next turn" className="grid max-h-[182px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2" onKeyDown={event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'))
            const current = items.findIndex(item => item === document.activeElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
            items[next]?.focus()
          }}>
            <button type="button" role="option" aria-selected={!model} onClick={() => onModel('')} className={`col-span-full flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${!model ? 'border-primary/60 bg-primary/15' : 'border-border/60 bg-transparent hover:border-primary/30 hover:bg-accent/60'}`}><span className="min-w-0 flex-1"><span className="block font-semibold">Provider default</span><span className="block truncate text-[10px] text-muted-foreground">Follow the session setting</span></span>{!model && <Check className="size-3.5 shrink-0 text-primary" />}</button>
            {models.map(m => <button type="button" role="option" aria-label={m.display_name || m.model} key={m.id || m.model} aria-selected={model === m.model} onClick={() => onModel(m.model)} className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${model === m.model ? 'border-primary/60 bg-primary/15' : 'border-border/60 bg-transparent hover:border-primary/30 hover:bg-accent/60'}`}><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{m.display_name || m.model}</span>{m.display_name !== m.model && <span className="block truncate text-[10px] text-muted-foreground">{m.model}</span>}</span>{model === m.model && <Check className="size-3.5 shrink-0 text-primary" />}</button>)}
            {!models.length && <p className="col-span-full rounded-xl border border-dashed border-border/70 px-3 py-4 text-[11px] leading-5 text-muted-foreground">{activeCatalog ? 'No matching models.' : selected?.conversation_mode === 'native_session' ? 'Model catalog is loading or unavailable. Provider default remains available.' : 'This harness uses its configured CLI model. Per-turn model selection is unavailable.'}</p>}
          </div>

          {selectedModel && effortOptions.length > 0 && <div className="mt-4 rounded-2xl border border-border/70 bg-background/40 p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Reasoning effort</p>
                <p className="mt-1.5 truncate text-[15px] font-semibold capitalize tracking-tight text-foreground">{effort || 'Provider default'}</p>
              </div>
              <button type="button" aria-label="Use provider default effort" aria-pressed={!effort} title="Use provider default effort" disabled={effortDisabled} onClick={() => onEffort('')}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 ${!effort ? 'border-primary/45 bg-primary/15 text-primary' : 'border-border/80 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}>
                <RotateCcw className="size-3" /> Default
              </button>
            </div>
            <div role="group" aria-label="Reasoning effort for next turn" className="mt-3 grid overflow-hidden rounded-xl border border-border/80 bg-card/80 p-1" style={{ gridTemplateColumns: `repeat(${effortOptions.length}, minmax(0, 1fr))` }}>
              {effortOptions.map((option, index) => {
                const active = effort === option.reasoning_effort
                return <button key={option.reasoning_effort} type="button" aria-label={`Set reasoning effort to ${option.reasoning_effort}`} aria-pressed={active} disabled={effortDisabled} title={option.description || option.reasoning_effort} onClick={() => onEffort(option.reasoning_effort)}
                  className={`relative flex min-w-0 flex-col items-center gap-1.5 rounded-lg px-0.5 py-2.5 transition-all focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 ${active ? 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.32),0_4px_12px_-8px_hsl(var(--primary))]' : 'text-muted-foreground hover:bg-accent/80 hover:text-foreground'}`}>
                  <span className={`flex size-5 items-center justify-center rounded-full border transition-colors ${active ? 'border-primary bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]' : 'border-border bg-background'}`}>
                    <span className={`rounded-full ${active ? 'size-1.5 bg-primary-foreground' : 'size-1 bg-muted-foreground/55'}`} />
                  </span>
                  <span className={`w-full truncate text-center text-[10px] font-medium capitalize leading-4 sm:text-[11px] ${active ? 'font-semibold' : ''}`}>{option.reasoning_effort === 'xhigh' ? 'X-high' : option.reasoning_effort}</span>
                  {index < effortOptions.length - 1 && <span aria-hidden="true" className="pointer-events-none absolute right-[-2px] top-3 bottom-3 w-px bg-border/45" />}
                </button>
              })}
            </div>
            <p className="mt-2.5 min-h-4 text-[11px] leading-4 text-muted-foreground">{effort ? effortOptions.find(option => option.reasoning_effort === effort)?.description || `Use ${effort} reasoning for the next turn.` : "Uses the provider's configured reasoning level."}</p>
          </div>}
          {locked && <p className="mt-4 text-[10px] leading-4 text-muted-foreground">Finish or resolve the current operation before changing harness.</p>}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-5 py-3"><p className="text-[10px] text-muted-foreground">Applies to your next turn</p><button type="button" onClick={close} className="rounded-lg bg-primary px-4 py-2 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90">Done</button></div>
      </div>
    </div>, document.body)}
  </>
}
