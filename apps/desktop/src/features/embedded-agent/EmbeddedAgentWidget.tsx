import { useEffect, useRef, useState, useCallback } from 'react'
import type { BackendConfig } from '@core/api/client'
import { EmbeddedAgentProvider, useEmbeddedAgent } from './EmbeddedAgentProvider'
import { EmbeddedAgentPanel } from './EmbeddedAgentPanel'

interface EmbeddedAgentWidgetProps {
  config: BackendConfig | null
  onNavigate: (section: string, id?: string) => void
  onOpenSettings?: () => void
  activeSection?: string
  selectedProjectId?: string
}

function AgentIcon({ className }: { className?: string }) {
  return (
    <img
      src="/Orchesta.png"
      alt="Orchestra"
      className={`${className ?? ''} invert dark:invert-0`}
      aria-hidden="true"
    />
  )
}

const STORAGE_KEY = 'orchestra-fab-pos'
const DEFAULT_POS = { right: 24, bottom: 24 }

function loadPos(): { right: number; bottom: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as { right: number; bottom: number }
  } catch { /* ignore */ }
  return DEFAULT_POS
}

function WidgetInner({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { isPanelOpen, togglePanel, isStreaming, watchMode } = useEmbeddedAgent()

  const [pos, setPos] = useState(loadPos)
  const dragging = useRef(false)
  const startMouse = useRef({ x: 0, y: 0 })
  const startPos = useRef(pos)
  const moved = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    moved.current = false
    startMouse.current = { x: e.clientX, y: e.clientY }
    startPos.current = pos
  }, [pos])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - startMouse.current.x
      const dy = e.clientY - startMouse.current.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true
      const newRight = Math.max(8, startPos.current.right - dx)
      const newBottom = Math.max(8, startPos.current.bottom - dy)
      setPos({ right: newRight, bottom: newBottom })
    }
    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false
        setPos(p => {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)) } catch { /* ignore */ }
          return p
        })
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePanel])

  return (
    <>
      {isPanelOpen && <EmbeddedAgentPanel onOpenSettings={onOpenSettings} />}

      {!isPanelOpen && (
        <button
          type="button"
          onMouseDown={onMouseDown}
          onClick={(e) => { if (moved.current) { e.preventDefault(); return } togglePanel() }}
          style={{ right: pos.right, bottom: pos.bottom }}
          className={`fixed z-50 grid h-14 w-14 place-items-center rounded-full border border-white/30 bg-white text-black shadow-lg shadow-black/25 transition-shadow duration-300 hover:shadow-xl hover:shadow-black/30 select-none cursor-grab active:cursor-grabbing ${
            isStreaming ? 'agent-fab-streaming' : ''
          }`}
          title="Orchestra Agent (Ctrl+.)"
        >
          <AgentIcon className="h-12 w-12" />
          {watchMode.unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white">
              {watchMode.unreadCount > 9 ? '9+' : watchMode.unreadCount}
            </span>
          )}
        </button>
      )}
    </>
  )
}

export function EmbeddedAgentWidget({ config, onNavigate, onOpenSettings, activeSection, selectedProjectId }: EmbeddedAgentWidgetProps) {
  return (
    <EmbeddedAgentProvider config={config} onNavigate={onNavigate} activeSection={activeSection} selectedProjectId={selectedProjectId}>
      <WidgetInner onOpenSettings={onOpenSettings} />
    </EmbeddedAgentProvider>
  )
}
