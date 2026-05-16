import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@core/utils/cn'

/** Class-variance-authority variants for the Badge component. */
const badgeVariants = cva('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-muted text-foreground',
      outline: 'text-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

/** Props for the {@link Badge} component, extending HTML div attributes with variant support. */
interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

/** Pill-shaped label component with variant-based styling (default, secondary, outline). */
function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge }
