import type { CSSProperties } from 'react'
import { Toaster as SonnerToaster, type ToasterProps } from 'sonner'
import { useAppStore } from '@core/store'

/** App-wide toast host themed with the active light/dark mode and app tokens. Mount once at the root. */
export function Toaster(props: ToasterProps) {
  const theme = useAppStore(s => s.theme)
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: '!bg-popover !text-popover-foreground !border-border !shadow-lg !text-[13px]',
          description: '!text-muted-foreground !text-xs',
          actionButton: '!bg-foreground !text-background',
          cancelButton: '!bg-muted !text-foreground',
        },
      }}
      style={{
        '--normal-bg': 'hsl(var(--popover))',
        '--normal-text': 'hsl(var(--popover-foreground))',
        '--normal-border': 'hsl(var(--border))',
      } as CSSProperties}
      {...props}
    />
  )
}
