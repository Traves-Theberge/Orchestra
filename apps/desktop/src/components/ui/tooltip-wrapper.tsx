import * as Tooltip from '@radix-ui/react-tooltip'
import { type ReactNode } from 'react'

export function AppTooltip({ children, content, side = 'top' }: { children: ReactNode; content: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={5}
            className="z-[110] select-none rounded-lg bg-zinc-900 px-3 py-2 text-[10px] font-bold uppercase tracking-widest leading-none text-zinc-50 shadow-2xl animate-in fade-in zoom-in-95 dark:bg-zinc-100 dark:text-zinc-900 border border-white/10 dark:border-black/10"
          >
            {content}
            <Tooltip.Arrow className="fill-zinc-900 dark:fill-zinc-100" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
