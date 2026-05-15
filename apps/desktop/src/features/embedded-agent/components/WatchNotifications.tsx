import { Bell, BellOff, X, ChevronRight } from 'lucide-react'
import type { WatchNotification } from '../hooks/use-watch-mode'

interface WatchNotificationsProps {
  enabled: boolean
  onToggle: () => void
  notifications: WatchNotification[]
  onDismiss: (id: string) => void
  onDismissAll: () => void
  onAction: (action: string, params: Record<string, unknown>) => void
}

const TYPE_COLORS: Record<string, string> = {
  completion: 'border-emerald-500/30 bg-emerald-500/5',
  failure: 'border-red-500/30 bg-red-500/5',
  retry: 'border-amber-500/30 bg-amber-500/5',
  stall: 'border-orange-500/30 bg-orange-500/5',
  info: 'border-primary/20 bg-primary/5',
}

const TYPE_LABELS: Record<string, string> = {
  completion: 'Done',
  failure: 'Failed',
  retry: 'Retrying',
  stall: 'Stalled',
  info: 'Info',
}

export function WatchNotifications({
  enabled,
  onToggle: _onToggle,
  notifications,
  onDismiss,
  onDismissAll,
  onAction,
}: WatchNotificationsProps) {
  const visible = notifications.filter((n) => !n.dismissed)

  if (visible.length === 0 && enabled) return null

  return (
    <div className="space-y-1 px-3 pt-2">
      {visible.length > 1 && (
        <button
          onClick={onDismissAll}
          className="text-[9px] text-muted-foreground/50 hover:text-foreground transition-colors uppercase tracking-wider"
        >
          Dismiss all
        </button>
      )}
      {visible.map((notif) => (
        <div
          key={notif.id}
          className={`rounded-lg border px-2.5 py-2 text-[11px] transition-all ${TYPE_COLORS[notif.type] || TYPE_COLORS.info}`}
        >
          <div className="flex items-start justify-between gap-1.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-foreground/60">
                  {TYPE_LABELS[notif.type] || notif.type}
                </span>
                <span className="font-bold text-foreground/80 truncate">{notif.title}</span>
              </div>
              <p className="mt-0.5 text-foreground/60 line-clamp-2">{notif.message}</p>
              {notif.actions && notif.actions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {notif.actions.map((a, i) => (
                    <button
                      key={`${a.action}-${a.label}-${i}`}
                      onClick={() => onAction(a.action, a.params || {})}
                      className="inline-flex items-center gap-0.5 rounded-md bg-foreground/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground/70 hover:bg-foreground/10 hover:text-foreground transition-colors"
                    >
                      {a.label}
                      <ChevronRight className="size-2.5" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => onDismiss(notif.id)}
              className="shrink-0 text-foreground/30 hover:text-foreground/60 transition-colors"
            >
              <X className="size-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Small toggle button for the chat header */
export function WatchToggle({ enabled, onToggle, unreadCount }: { enabled: boolean; onToggle: () => void; unreadCount: number }) {
  return (
    <button
      onClick={onToggle}
      className={`relative flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
        enabled
          ? 'bg-primary/10 text-primary hover:bg-primary/20'
          : 'text-muted-foreground/50 hover:text-muted-foreground'
      }`}
      title={enabled ? 'Watch mode on (click to disable)' : 'Watch mode off (click to enable)'}
    >
      {enabled ? <Bell className="size-3" /> : <BellOff className="size-3" />}
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-primary text-[7px] text-primary-foreground">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  )
}
