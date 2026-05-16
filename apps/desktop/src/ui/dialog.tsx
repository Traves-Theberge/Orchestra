import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@core/utils/cn'

/** Root dialog component wrapping Radix UI Dialog. */
const Dialog = DialogPrimitive.Root
/** Portal that renders dialog content outside the normal DOM hierarchy. */
const DialogPortal = DialogPrimitive.Portal
/** Button that closes the dialog when clicked. */
const DialogClose = DialogPrimitive.Close

type DialogOverlayProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
  ref?: React.Ref<React.ElementRef<typeof DialogPrimitive.Overlay>>
}

/** Semi-transparent backdrop overlay rendered behind the dialog content. */
const DialogOverlay = ({ className, ref, ...props }: DialogOverlayProps) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-black/50', className)}
    {...props}
  />
)
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  srTitle?: string
  showCloseButton?: boolean
  ref?: React.Ref<React.ElementRef<typeof DialogPrimitive.Content>>
}

/** Centered dialog panel with overlay, close button, and animated entry. */
const DialogContent = ({ className, children, srTitle = 'Dialog', showCloseButton = true, ref, ...props }: DialogContentProps) => (
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
)
DialogContent.displayName = DialogPrimitive.Content.displayName

/** Stacked layout container for dialog title and description. */
function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-y-1.5 text-left', className)} {...props} />
}

/** Right-aligned action bar at the bottom of a dialog. */
function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-x-2', className)} {...props} />
}

type DialogTitleProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> & {
  ref?: React.Ref<React.ElementRef<typeof DialogPrimitive.Title>>
}

/** Styled heading for dialog content. */
const DialogTitle = ({ className, ref, ...props }: DialogTitleProps) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold', className)} {...props} />
)
DialogTitle.displayName = DialogPrimitive.Title.displayName

type DialogDescriptionProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description> & {
  ref?: React.Ref<React.ElementRef<typeof DialogPrimitive.Description>>
}

/** Muted description text beneath the dialog title. */
const DialogDescription = ({ className, ref, ...props }: DialogDescriptionProps) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
)
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
