import { useSyncExternalStore } from 'react'

/** Chat-only zoom: scales conversations, never the sidebar or the rest of the app. */
export type ChatZoomRequest = 'in' | 'out' | 'reset'

const STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
const KEY = 'orchestra.chat-zoom.v1'
const listeners = new Set<() => void>()

function read(): number {
  try {
    const value = Number(localStorage.getItem(KEY))
    return STEPS.includes(value) ? value : 1
  } catch { return 1 }
}

let factor = read()

export function stepChatZoom(current: number, request: ChatZoomRequest): number {
  if (request === 'reset') return 1
  if (request === 'in') return STEPS.find(step => step > current + 0.001) ?? STEPS[STEPS.length - 1]
  return [...STEPS].reverse().find(step => step < current - 0.001) ?? STEPS[0]
}

export function requestChatZoom(request: ChatZoomRequest) {
  const next = stepChatZoom(factor, request)
  if (next === factor) return
  factor = next
  try { localStorage.setItem(KEY, String(next)) } catch { /* zoom still applies this session */ }
  for (const listener of listeners) listener()
}

// Keyboard shortcuts, Ctrl+wheel and pinch arrive from the Electron main process.
if (typeof window !== 'undefined') window.orchestraDesktop?.onChatZoom?.(requestChatZoom)

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useChatZoom(): number {
  return useSyncExternalStore(subscribe, () => factor, () => 1)
}
