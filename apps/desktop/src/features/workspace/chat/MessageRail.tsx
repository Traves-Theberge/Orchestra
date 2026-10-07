import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { WorkspaceChatMessage } from '@core/api/client'

type RailItem = { message: WorkspaceChatMessage; reply: string }

const VIEWPORT_MARGIN = 8

/** Hover preview centred on its rail marker, nudged so it never leaves the visible window. */
function RailPreview({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  // Measure after layout and nudge in place (no re-render) so it stays inside the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { top, bottom } = el.getBoundingClientRect()
    const limit = window.innerHeight - VIEWPORT_MARGIN
    const delta = top < VIEWPORT_MARGIN ? VIEWPORT_MARGIN - top : bottom > limit ? limit - bottom : 0
    if (delta) el.style.transform = `translateY(calc(-50% + ${delta}px))`
  }, [])
  return <span ref={ref} aria-hidden="true" onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
    className="pointer-events-auto absolute left-8 top-1/2 z-30 block max-h-[calc(100vh-16px)] w-72 max-w-[calc(100vw-3rem)] cursor-text select-text overflow-hidden rounded-2xl border border-border/70 bg-popover/95 p-3.5 text-left text-popover-foreground shadow-[0_12px_38px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl"
    style={{ transform: 'translateY(-50%)' }}>
    {children}
  </span>
}

export function MessageRail({ messages, timelineRef }: { messages: WorkspaceChatMessage[]; timelineRef: RefObject<HTMLDivElement | null> }) {
  const items = useMemo(() => {
    const result: RailItem[] = []
    for (const message of messages) {
      if (message.role === 'user') result.push({ message, reply: '' })
      else if (message.role === 'assistant' && result.length) result[result.length - 1].reply = message.text
    }
    return result
  }, [messages])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [wideEnough, setWideEnough] = useState(true)

  useEffect(() => {
    const timeline = timelineRef.current
    if (!timeline) return
    const update = () => {
      setWideEnough(timeline.clientWidth >= 512)
      const cutoff = timeline.scrollTop + timeline.clientHeight * 0.35
      let current: string | null = items[0]?.message.id ?? null
      const rows = new Map(Array.from(timeline.querySelectorAll<HTMLElement>('[data-rail-message-id]'), node => [node.dataset.railMessageId, node]))
      for (const item of items) {
        const row = rows.get(item.message.id)
        const top = row ? row.getBoundingClientRect().top - timeline.getBoundingClientRect().top + timeline.scrollTop : Infinity
        if (top <= cutoff) current = item.message.id
      }
      setActiveId(current)
    }
    update()
    timeline.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(timeline)
    return () => { timeline.removeEventListener('scroll', update); observer?.disconnect() }
  }, [items, timelineRef])

  if (items.length < 3 || !wideEnough) return null

  const jump = (id: string) => {
    const timeline = timelineRef.current
    const row = Array.from(timeline?.querySelectorAll<HTMLElement>('[data-rail-message-id]') ?? []).find(node => node.dataset.railMessageId === id)
    if (!timeline || !row) return
    const top = row.getBoundingClientRect().top - timeline.getBoundingClientRect().top + timeline.scrollTop
    timeline.scrollTo({ top: Math.max(0, top - 24), behavior: 'smooth' })
    setActiveId(id)
  }

  return <nav aria-label="Conversation message navigator" className="absolute inset-y-3 left-0 z-20 hidden w-8 flex-col items-center justify-center gap-0.5 opacity-0 transition-opacity duration-200 ease-out hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none [@media(pointer:fine)]:flex">
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-border/40 to-transparent" />
    {items.map((item, index) => {
      const active = item.message.id === activeId
      const hovered = item.message.id === hoveredId
      const prompt = item.message.text.replace(/\s+/g, ' ').trim() || 'Message'
      const reply = item.reply.replace(/\s+/g, ' ').trim()
      return <button key={item.message.id} type="button" aria-label={`Jump to message ${index + 1}: ${prompt.slice(0, 80)}`} aria-current={active ? 'location' : undefined} onClick={() => jump(item.message.id)} onMouseEnter={() => setHoveredId(item.message.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(item.message.id)} onBlur={() => setHoveredId(null)} className="group/rail relative flex min-h-0 w-7 flex-1 items-center rounded-sm pl-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" style={{ maxHeight: 10 }}>
        <span className={`h-px rounded-full transition-[width,background-color] duration-150 ${active ? 'w-5 bg-primary' : hovered ? 'w-4 bg-foreground/80' : 'w-2.5 bg-muted-foreground/55'}`} />
        {hovered && <RailPreview>
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-primary/80">Message {index + 1} of {items.length}</span>
          <span className="block line-clamp-2 break-words text-[13px] font-medium leading-5">{prompt}</span>
          {reply && <span className="mt-2 block line-clamp-3 break-words border-t border-border/50 pt-2 text-xs leading-5 text-muted-foreground">{reply}</span>}
        </RailPreview>}
      </button>
    })}
  </nav>
}
