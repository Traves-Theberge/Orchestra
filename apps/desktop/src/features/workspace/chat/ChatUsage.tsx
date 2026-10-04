import type { WorkspaceChatEvent } from '@core/api/client'
import { chatUsageObservation } from './chat-usage-observation'

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString() : 'unknown'

export function ChatUsage({ events }: { events: WorkspaceChatEvent[] }) {
  const usage = chatUsageObservation(events)
  if (!usage.event) return <span>Usage not observed for this turn</span>
  return <details className="max-w-full text-[10px] text-muted-foreground">
    <summary className="cursor-pointer">Provider thread: {count(usage.total.totalTokens)} tokens</summary>
    <div className="mt-1 space-y-1">
      <p>Latest response: {count(usage.last.inputTokens)} input · {count(usage.last.outputTokens)} output · {count(usage.last.cachedInputTokens)} cached input</p>
      <p>Reported context window: {count(usage.window)} tokens</p>
      <p>Thread accounting is separate from account quotas, estimated API costs and worker usage.</p>
    </div>
  </details>
}
