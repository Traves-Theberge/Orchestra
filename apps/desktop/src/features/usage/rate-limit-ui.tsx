import type { RateLimitWindow } from '@core/api/client'
import { useNow } from '@/hooks'

export function windowLabel(w: RateLimitWindow): string {
  if (w.window_minutes <= 360) return '5h'
  if (w.window_minutes >= 1440 * 6) return 'wk'
  if (w.window_minutes >= 1440) return `${Math.round(w.window_minutes / 1440)}d`
  return `${Math.round(w.window_minutes / 60)}h`
}

export function remainingPct(w: RateLimitWindow): number {
  return Math.max(0, Math.min(100, Math.round(100 - w.used_percent)))
}

// Color-code by remaining capacity: green >40%, yellow 20-40%, red <20%.
function barColor(leftPct: number): string {
  if (leftPct > 40) return 'bg-emerald-500'
  if (leftPct > 20) return 'bg-yellow-500'
  return 'bg-red-500'
}

function formatResetCountdown(resetsAt: number | undefined, now: number): string | null {
  if (!resetsAt || !now) return null
  const ms = resetsAt - now
  if (ms <= 0) return 'now'
  const totalMins = Math.floor(ms / 60_000)
  if (totalMins < 60) return `${totalMins}m`
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
  }
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

export function timeAgo(ms: number, now: number): string {
  if (!now) return ''
  const diff = now - ms
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// Orca-style mini progress bar: shows REMAINING capacity as filled grey.
export function MiniBar({ leftPct }: { leftPct: number }) {
  return (
    <span className="inline-block w-[44px] h-[6px] rounded-full bg-muted overflow-hidden align-middle">
      <span
        className="block h-full rounded-full bg-muted-foreground/60 transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, leftPct))}%` }}
      />
    </span>
  )
}

// Larger Session/Weekly progress section used in popovers and the Usage page.
export function WindowSection({
  w,
  label,
  variant = 'panel',
}: {
  w: RateLimitWindow
  label: string
  variant?: 'panel' | 'inverted'
}) {
  const now = useNow(60_000)
  const leftPct = remainingPct(w)
  const reset = formatResetCountdown(w.resets_at, now) ?? w.reset_description ?? null
  const baseText = variant === 'inverted' ? 'text-background' : 'text-foreground'
  const mutedText = variant === 'inverted' ? 'text-background/60' : 'text-muted-foreground'
  const trackBg = variant === 'inverted' ? 'bg-background/20' : 'bg-muted'

  return (
    <div className="space-y-1">
      <div className={`text-[12px] font-medium ${baseText}`}>{label}</div>
      <div className={`h-[6px] w-full overflow-hidden rounded-full ${trackBg}`}>
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor(leftPct)}`}
          style={{ width: `${Math.min(100, Math.max(0, leftPct))}%` }}
        />
      </div>
      <div className={`flex justify-between text-[11px] tabular-nums ${mutedText}`}>
        <span>{leftPct}% left</span>
        {reset && <span>Resets in {reset}</span>}
      </div>
    </div>
  )
}
