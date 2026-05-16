import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '@core/store'
import { ResizeHandle } from '../ResizeHandle'

type RightSidebarProps = {
  children?: ReactNode
}

export function RightSidebar({ children }: RightSidebarProps) {
  const rightSidebarOpen = useAppStore(s => s.rightSidebarOpen)
  const rightSidebarWidth = useAppStore(s => s.rightSidebarWidth)
  const setRightSidebarWidth = useAppStore(s => s.setRightSidebarWidth)
  const setRightSidebarOpen = useAppStore(s => s.setRightSidebarOpen)

  if (!rightSidebarOpen) return null

  return (
    <div className="flex h-full flex-shrink-0" style={{ width: rightSidebarWidth }}>
      {/* Resize handle on left edge */}
      <ResizeHandle
        direction="horizontal"
        onResize={(delta) => setRightSidebarWidth(useAppStore.getState().rightSidebarWidth - delta)}
      />

      {/* Sidebar content */}
      <div className="flex flex-col h-full bg-background border-l border-border flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-medium text-foreground">Issue Detail</span>
          <button
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            onClick={() => setRightSidebarOpen(false)}
            aria-label="Close issue detail"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto">
          {children ?? (
            <p className="p-3 text-xs text-muted-foreground">No task selected</p>
          )}
        </div>
      </div>
    </div>
  )
}
