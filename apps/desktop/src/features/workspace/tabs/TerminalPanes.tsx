import { Fragment, useRef } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '@core/store'
import { terminalSplitFor } from '@core/store/group-helpers'
import type { WorkspaceContextID } from '@core/store/types'
import { TerminalView } from '@features/terminal/TerminalView'
import { ResizeHandle } from '../ResizeHandle'

const MIN_PANE_FRACTION = 0.1

/**
 * The terminal(s) of one center terminal tab, side by side. Always rendered
 * (even for a single pane) with panes keyed by terminal id, so splitting or
 * closing a pane never remounts — and reconnects — the other shells.
 */
export function TerminalPanes({ projectId, tabId }: { projectId: WorkspaceContextID; tabId: string }) {
  // Select the raw entry (stable reference) and derive the default outside the selector.
  const stored = useAppStore(s => s.projectCenterTabs[projectId]?.terminalSplits?.[tabId])
  const split = stored ?? terminalSplitFor(undefined, tabId)
  const containerRef = useRef<HTMLDivElement>(null)
  const multi = split.panes.length > 1

  const resizeAt = (index: number, delta: number) => {
    const width = containerRef.current?.getBoundingClientRect().width ?? 0
    const current = useAppStore.getState().projectCenterTabs[projectId]?.terminalSplits?.[tabId]
    if (!width || !current) return
    const sizes = current.sizes.slice()
    const pair = sizes[index - 1] + sizes[index]
    const left = Math.min(Math.max(sizes[index - 1] + delta / width, MIN_PANE_FRACTION), pair - MIN_PANE_FRACTION)
    sizes[index - 1] = left
    sizes[index] = pair - left
    useAppStore.getState().resizeTerminalPanes(projectId, tabId, sizes)
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 min-w-0 flex-1">
      {split.panes.map((paneId, index) => (
        <Fragment key={paneId}>
          {index > 0 && <ResizeHandle direction="horizontal" onResize={delta => resizeAt(index, delta)} className="bg-border/60" />}
          <TerminalPane
            projectId={projectId}
            tabId={tabId}
            paneId={paneId}
            size={split.sizes[index] ?? 1 / split.panes.length}
            focused={multi && split.focusedId === paneId}
            showHeader={multi}
          />
        </Fragment>
      ))}
    </div>
  )
}

function TerminalPane({ projectId, tabId, paneId, size, focused, showHeader }: {
  projectId: WorkspaceContextID
  tabId: string
  paneId: string
  size: number
  focused: boolean
  showHeader: boolean
}) {
  const terminal = useAppStore(s => s.openTerminals.find(t => t.id === paneId))
  const config = useAppStore(s => s.config)
  const focus = () => useAppStore.getState().focusTerminalPane(projectId, tabId, paneId)
  const split = () => { useAppStore.getState().splitTerminalTab(projectId, tabId) }
  const cyclePane = (direction: 'next' | 'previous') => {
    const panes = useAppStore.getState().projectCenterTabs[projectId]?.terminalSplits?.[tabId]?.panes ?? []
    const at = panes.indexOf(paneId)
    if (at < 0 || panes.length < 2) return
    useAppStore.getState().focusTerminalPane(projectId, tabId, panes[(at + (direction === 'next' ? 1 : -1) + panes.length) % panes.length])
  }
  const title = terminal?.title || 'Shell'

  return (
    <div
      data-terminal-pane={paneId}
      aria-label={`Terminal pane ${title}`}
      className="flex min-h-0 min-w-0 flex-col"
      style={{ flex: `${size} 1 0px` }}
      onMouseDownCapture={focus}
      onFocusCapture={focus}
    >
      {showHeader && (
        <div className={`flex h-6 shrink-0 items-center gap-1 border-b border-border/60 pl-2 pr-1 text-[11px] ${focused ? 'text-foreground' : 'text-muted-foreground'}`}>
          <span className={`size-1.5 shrink-0 rounded-full ${focused ? 'bg-primary' : 'bg-transparent'}`} />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <button
            type="button"
            aria-label={`Close pane ${title}`}
            title="Close pane"
            onMouseDown={e => e.stopPropagation()}
            onClick={() => useAppStore.getState().closeTerminalPane(projectId, tabId, paneId)}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={11} />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {terminal && config && (
          <TerminalView
            sessionId={terminal.id}
            projectId={terminal.projectId}
            cwd={terminal.cwd}
            baseUrl={config.baseUrl}
            apiToken={config.apiToken}
            initialCommand={terminal.initialCommand}
            autoFocus={!showHeader || focused}
            onSplit={split}
            onFocusPane={cyclePane}
          />
        )}
      </div>
    </div>
  )
}
