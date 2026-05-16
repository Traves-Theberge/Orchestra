import * as React from 'react'
import { cn } from '@core/utils/cn'

/** Bordered card container with rounded corners and shadow. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-sm', className)} {...props} />
}

/** Padded header section within a Card. */
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
}

/** Styled heading (h3) for the card title. */
export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-base font-semibold leading-none tracking-tight', className)} {...props}>
      {children ?? <span className="sr-only">Section</span>}
    </h3>
  )
}

/** Muted description paragraph beneath the card title. */
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />
}

/** Main body content area of a Card. */
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />
}

