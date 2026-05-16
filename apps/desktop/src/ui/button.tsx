import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@core/utils/cn'
import { AppTooltip } from './tooltip-wrapper'

/** Class-variance-authority variants for the Button component. */
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 !filter-none !blur-0 !backdrop-blur-none hover:!filter-none hover:!blur-0 hover:!backdrop-blur-none data-[state=closed]:!filter-none data-[state=delayed-open]:!filter-none data-[state=instant-open]:!filter-none data-[state=closed]:!blur-0 data-[state=delayed-open]:!blur-0 data-[state=instant-open]:!blur-0 data-[state=closed]:!backdrop-blur-none data-[state=delayed-open]:!backdrop-blur-none data-[state=instant-open]:!backdrop-blur-none [&_svg]:shrink-0 [&_svg]:!filter-none [&_svg]:!blur-0 [&_svg]:!backdrop-blur-none [&_svg]:transition-transform [&_svg]:duration-200 active:[&_svg]:scale-95 active:[&_.lucide-refresh-ccw]:rotate-180 active:[&_.lucide-refresh-cw]:rotate-180',
  {
    variants: {
      variant: {
        default: 'bg-white text-black hover:bg-white/90 shadow-sm',
        secondary: 'bg-muted text-foreground hover:bg-muted/80',
        outline: 'border border-border bg-transparent hover:bg-muted',
        ghost: 'hover:bg-muted hover:text-foreground bg-transparent',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-8 w-8 rounded-md p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

/** Props for the {@link Button} component, extending HTML button attributes with variant, size, and tooltip support. */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** When true, renders as a Radix Slot, passing props to its child element. */
  asChild?: boolean
  /** Optional tooltip text displayed on hover. */
  tooltip?: string
  ref?: React.Ref<HTMLButtonElement>
}

/**
 * Multi-variant button component with optional tooltip wrapping.
 * Supports default, secondary, outline, ghost, and destructive visual variants.
 */
const Button = ({ className, variant, size, asChild = false, tooltip, type, ref, ...props }: ButtonProps) => {
  const Comp = asChild ? Slot : 'button'
  const buttonType = asChild ? undefined : (type ?? 'button')
  const buttonContent = <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} type={buttonType} {...props} />

  if (tooltip) {
    return <AppTooltip content={tooltip}>{buttonContent}</AppTooltip>
  }

  return buttonContent
}
Button.displayName = 'Button'

export { Button }
