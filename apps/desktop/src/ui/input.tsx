import * as React from 'react'
import { cn } from '@core/utils/cn'

export const inputClass = 'h-8 w-full rounded-md border border-border bg-background/60 px-2.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-500/60'

/** Compact text input matching the app's form density. */
function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return <input type={type} className={cn(inputClass, className)} {...props} />
}

export { Input }
