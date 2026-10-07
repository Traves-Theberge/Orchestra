import type { ComponentType, ReactNode } from 'react'
import { Pause, Pencil, Play, Trash2 } from 'lucide-react'
import type { Automation } from '@core/api/client'
import { cn } from '@core/utils/cn'
import { Button } from '@ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@ui/dialog'
import { runStatusMeta, toneDotClass } from '../lib/status'

/** 11px uppercase caption used for field labels and column headers. */
export function Caption({ children, className, htmlFor }: { children: ReactNode; className?: string; htmlFor?: string }) {
  const classes = cn('text-[11px] font-medium uppercase tracking-wide text-muted-foreground', className)
  return htmlFor ? <label htmlFor={htmlFor} className={classes}>{children}</label> : <span className={classes}>{children}</span>
}

export function StatusDot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-1.5 shrink-0 rounded-full', className)} />
}

/** Run status pill: dot + label (+ skip reason). Red only for failures. */
export function RunStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = runStatusMeta(status)
  return (
    <span
      data-testid="run-status"
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] leading-4',
        meta.tone === 'failure' ? 'border-red-500/30 bg-red-500/10 text-red-500' : 'border-border bg-muted/30 text-muted-foreground',
        meta.tone === 'success' && 'text-foreground',
        className,
      )}
    >
      <StatusDot className={toneDotClass(meta.tone)} />
      {meta.label}
      {meta.detail ? <span className="text-muted-foreground/80">· {meta.detail}</span> : null}
    </span>
  )
}

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px]', enabled ? 'text-foreground' : 'text-muted-foreground')}>
      <StatusDot className={enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'} />
      {enabled ? 'Enabled' : 'Paused'}
    </span>
  )
}

export function Chip({ icon: Icon, children, title, onClick }: { icon?: ComponentType<{ className?: string }>; children: ReactNode; title?: string; onClick?: () => void }) {
  const classes = 'inline-flex max-w-[160px] items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[11px] text-muted-foreground'
  const content = <>{Icon ? <Icon className="size-3 shrink-0" /> : null}<span className="truncate">{children}</span></>
  if (onClick) {
    return <button type="button" title={title} onClick={event => { event.stopPropagation(); onClick() }} className={cn(classes, 'hover:bg-muted hover:text-foreground')}>{content}</button>
  }
  return <span title={title} className={classes}>{content}</span>
}

type MenuItemComponent = ComponentType<{ onSelect?: (event: Event) => void; variant?: 'default' | 'destructive'; children?: ReactNode }>

export type AutomationMenuHandlers = {
  onRunNow: (automation: Automation) => void
  onEdit: (automation: Automation) => void
  onTogglePaused: (automation: Automation) => void
  onDelete: (automation: Automation) => void
}

/** Shared item list for the row kebab (DropdownMenu) and right-click (ContextMenu). */
export function AutomationMenuItems({ automation, Item, Separator, handlers }: {
  automation: Automation
  Item: MenuItemComponent
  Separator: ComponentType
  handlers: AutomationMenuHandlers
}) {
  return (
    <>
      <Item onSelect={() => handlers.onRunNow(automation)}><Play />Run now</Item>
      <Item onSelect={() => handlers.onEdit(automation)}><Pencil />Edit</Item>
      <Item onSelect={() => handlers.onTogglePaused(automation)}>{automation.enabled ? <><Pause />Pause</> : <><Play />Resume</>}</Item>
      <Separator />
      <Item variant="destructive" onSelect={() => handlers.onDelete(automation)}><Trash2 />Delete</Item>
    </>
  )
}

export const DELETE_AUTOMATION_COPY = 'Deletes the automation and its run history. Worktrees created by runs are kept.'

export function DeleteAutomationDialog({ automation, pending, onCancel, onConfirm }: {
  automation: Automation | null
  pending?: boolean
  onCancel: () => void
  onConfirm: (automation: Automation) => void
}) {
  return (
    <Dialog open={!!automation} onOpenChange={open => { if (!open) onCancel() }}>
      <DialogContent srTitle="Delete automation" showCloseButton={false} className="max-w-md gap-5 p-5">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Delete “{automation?.name}”?</DialogTitle>
          <DialogDescription className="text-[13px]">{DELETE_AUTOMATION_COPY}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" size="sm" disabled={pending} onClick={() => automation && onConfirm(automation)}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ErrorStrip({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-500">
      <span className="min-w-0 truncate">{message}</span>
      {onRetry ? <button type="button" onClick={onRetry} className="shrink-0 underline-offset-2 hover:underline">Retry</button> : null}
    </div>
  )
}
