import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, SquarePen } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { HarnessIcon } from '@ui/HarnessIcon'
import type { WorkspaceChatSession } from '@core/api/client'

function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

/** Switch between this scope's conversations or start a new one (Maestro has no Conversations tab). */
export function ConversationMenu({ sessions, currentId, disabled, onNew, onChoose }: {
  sessions: WorkspaceChatSession[]; currentId: string; disabled?: boolean
  onNew: () => void; onChoose: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const sorted = [...sessions].sort((a, b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at))
  const run = (action: () => void) => { setOpen(false); action() }
  const icon = 'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40'
  return <>
    <AppTooltip content="Conversations" side="bottom"><button ref={trigger} type="button" aria-label="Switch conversation" aria-haspopup="menu" aria-expanded={open} disabled={disabled}
      onClick={() => { const r = trigger.current?.getBoundingClientRect(); if (r) setAnchor({ left: r.left, top: r.bottom + 4 }); setOpen(value => !value) }} className={icon}>
      <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button></AppTooltip>
    <AppTooltip content="New conversation" side="bottom"><button type="button" aria-label="New conversation" disabled={disabled} onClick={onNew} className={icon}><SquarePen size={13} /></button></AppTooltip>
    {open && anchor && createPortal(<div ref={menu} role="menu" aria-label="Conversations"
      className="fixed z-[150] flex max-h-[min(420px,calc(100vh-16px))] w-80 max-w-[calc(100vw-16px)] flex-col rounded-lg border border-border bg-popover p-1 text-foreground shadow-xl"
      style={{ left: Math.max(8, Math.min(anchor.left, window.innerWidth - 328)), top: Math.min(anchor.top, window.innerHeight - 120) }}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
        event.preventDefault()
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        const index = items.findIndex(item => item === document.activeElement)
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }}>
      <button type="button" role="menuitem" onClick={() => run(onNew)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium hover:bg-accent focus:bg-accent focus:outline-none">
        <SquarePen size={13} className="text-muted-foreground" />New conversation
      </button>
      {sorted.length > 0 && <div className="my-1 h-px shrink-0 bg-border/60" />}
      <div className="min-h-0 overflow-auto">
        {sorted.map(session => <button key={session.id} type="button" role="menuitem" onClick={() => run(() => onChoose(session.id))}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent focus:bg-accent focus:outline-none">
          <HarnessIcon id={session.provider.toLowerCase()} size={13} />
          <span className="min-w-0 flex-1 truncate" title={session.title}>{session.title || 'Untitled conversation'}</span>
          {session.status === 'running' && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Working" />}
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{ago(session.updated_at || session.created_at)}</span>
          {session.id === currentId && <Check size={12} className="shrink-0 text-muted-foreground" />}
        </button>)}
        {!sorted.length && <p className="px-2 py-2 text-[12px] text-muted-foreground">No earlier conversations yet.</p>}
      </div>
    </div>, document.body)}
  </>
}
