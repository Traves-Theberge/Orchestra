import type { WorkspaceChatEvent } from '@core/api/client'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function chatUsageObservation(events: WorkspaceChatEvent[]) {
  const lifecycle = [...events].reverse().find(e => e.turn_id && (e.type === 'turn/started' || e.type === 'turn/completed'))
  // Delayed observations remain in history but cannot replace a newer turn's meter.
  const event = [...events].reverse().find(e => e.type === 'thread/tokenUsage/updated' && (!lifecycle || e.turn_id === lifecycle.turn_id))
  const usage = object(event?.payload?.tokenUsage)
  return { event, total: object(usage.total), last: object(usage.last), window: usage.modelContextWindow }
}
