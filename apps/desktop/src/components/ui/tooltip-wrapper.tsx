import * as Tooltip from '@radix-ui/react-tooltip'
import { type ReactNode } from 'react'

export function AppTooltip({ children, content, side = 'top' }: { children: ReactNode; content: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tooltip.Provider delayDuration={100}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={5}
            className="z-[150] select-none rounded-lg bg-popover border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-widest leading-none text-popover-foreground shadow-2xl animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 !opacity-100 block"
            style={{ backgroundColor: 'hsl(var(--popover))' }}
          >
            <div className="relative z-10">{content}</div>
            <Tooltip.Arrow className="fill-popover" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
