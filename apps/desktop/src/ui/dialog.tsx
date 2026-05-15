import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@core/utils/cn'

/** Root dialog component wrapping Radix UI Dialog. */
const Dialog = DialogPrimitive.Root
/** Trigger element that opens the dialog when clicked. */
const DialogTrigger = DialogPrimitive.Trigger
/** Portal that renders dialog content outside the normal DOM hierarchy. */
const DialogPortal = DialogPrimitive.Portal
/** Button that closes the dialog when clicked. */
const DialogClose = DialogPrimitive.Close

/** Semi-transparent backdrop overlay rendered behind the dialog content. */
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-black/50', className)}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/** Centered dialog panel with overlay, close button, and animated entry. */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { srTitle?: string; showCloseButton?: boolean }
>(({ className, children, srTitle = 'Dialog', showCloseButton = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      aria-describedby={props['aria-describedby'] ?? undefined}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border border-border bg-card p-6 shadow-lg duration-200 sm:rounded-lg',
        className,
      )}
      {...props}
    >
      <DialogPrimitive.Title className="sr-only">{srTitle}</DialogPrimitive.Title>
      {children}
      {showCloseButton ? (
        <DialogClose className="absolute right-6 top-[18px] rounded-lg p-1.5 text-muted-foreground/30 hover:text-foreground hover:bg-muted/20 transition-all z-50">
          <X className="size-5" />
        </DialogClose>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

/** Stacked layout container for dialog title and description. */
function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-y-1.5 text-left', className)} {...props} />
}

/** Right-aligned action bar at the bottom of a dialog. */
function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-x-2', className)} {...props} />
}

/** Styled heading for dialog content. */
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold', className)} {...props} />)
DialogTitle.displayName = DialogPrimitive.Title.displayName

/** Muted description text beneath the dialog title. */
const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
