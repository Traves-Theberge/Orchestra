import * as React from 'react'
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui'
import { cn } from '@core/utils/cn'
import { menuContentClass, menuItemClass } from './menu-classes'

/** Root context menu (right-click) wrapping Radix UI ContextMenu. */
const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content className={cn(menuContentClass, className)} {...props} />
    </ContextMenuPrimitive.Portal>
  )
}

type ContextMenuItemProps = React.ComponentProps<typeof ContextMenuPrimitive.Item> & { variant?: 'default' | 'destructive' }

function ContextMenuItem({ className, variant = 'default', ...props }: ContextMenuItemProps) {
  return (
    <ContextMenuPrimitive.Item
      data-variant={variant}
      className={cn(menuItemClass, variant === 'destructive' && 'text-red-500 data-[highlighted]:bg-red-500/10 [&_svg]:!text-red-500', className)}
      {...props}
    />
  )
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}

export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger }
