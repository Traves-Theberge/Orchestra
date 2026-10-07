import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PanelRight, Search, X } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { useAppStore } from '@core/store'
import { getActiveWorkspaceContextId } from '@core/store/workspace-context'
import { FileExplorer } from './file-explorer/FileExplorer'
import { WorkspaceSearch } from './panels/WorkspaceSearch'
import { WorkspaceToolsControls } from './WorkspaceToolsControls'
import { ResizableInspector } from './ResizableInspector'
import { ToolbarTabSlotContext } from './tabs/toolbar-tab-slot'

export function WorkspaceToolSurface({ children, filesRequest, toolsOpen, onToggleTools, hasActiveTools = true, toolbarSlot, trailing }: { children: ReactNode; toolbarSlot?: HTMLElement | null; trailing?: ReactNode; filesRequest?: number; onRefreshTargetChange?: (target: HTMLSpanElement | null) => void; toolsOpen?: boolean; onToggleTools?: () => void; hasActiveTools?: boolean }) {
  const [inspector, setInspector] = useState<'files' | 'search' | null>(null)
  const [tabSlot, setTabSlot] = useState<HTMLDivElement | null>(null)
  const [lastFilesRequest, setLastFilesRequest] = useState<number | undefined>()
  const contextId = useAppStore(getActiveWorkspaceContextId)
  const config = useAppStore(state => state.config)
  if (filesRequest !== undefined && filesRequest !== lastFilesRequest) {
    setLastFilesRequest(filesRequest)
    setInspector('files')
  }
  // The file sidebar's own controls live inside its panel, not in the shared strip.
  const sidebarHeader = <div aria-label="File sidebar controls" className="flex h-8 shrink-0 items-center justify-end gap-0.5 px-1.5">
      <AppTooltip content="Search files" side="bottom"><button type="button" aria-label="Toggle workspace search" aria-pressed={inspector === 'search'} onClick={() => setInspector(current => current === 'search' ? 'files' : 'search')} className={`rounded p-1.5 hover:bg-muted ${inspector === 'search' ? 'text-foreground' : 'text-muted-foreground'}`}><Search size={13} /></button></AppTooltip>
      <AppTooltip content="Close file sidebar" side="bottom"><button type="button" aria-label="Close workspace file sidebar" onClick={() => setInspector(null)} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><X size={13} /></button></AppTooltip>
    </div>
  const sidebar = (body: ReactNode) => <div className="flex h-full min-h-0 flex-col">{sidebarHeader}<div className="min-h-0 flex-1">{body}</div></div>
  const toolbar = <div aria-label="Workspace tool controls" className={toolbarSlot ? 'flex h-full min-w-0 flex-1 items-center gap-1' : 'flex h-10 shrink-0 items-center gap-1 px-3 pt-1'}>
      <div ref={setTabSlot} data-testid="workspace-toolbar-tabs" className={trailing ? 'flex h-full min-w-0 items-center' : 'flex h-full min-w-0 flex-1 items-center'} />
      {trailing && <>{trailing}<span className="flex-1" /></>}
      <WorkspaceToolsControls inToolbar />
      {onToggleTools && <AppTooltip content="Hide workspace tools" side="bottom"><button type="button" onClick={onToggleTools} aria-label="Hide workspace tools" aria-pressed={toolsOpen} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"><PanelRight size={16} /></button></AppTooltip>}
    </div>
  const fullFilesView = inspector === 'files' && !hasActiveTools
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    {toolbarSlot ? (toolsOpen !== false && createPortal(toolbar, toolbarSlot)) : toolbar}
    <ResizableInspector storageKey={`orchestra:inspector-width:v1:${encodeURIComponent(config?.baseUrl ?? '')}:${encodeURIComponent(contextId)}`} mode={fullFilesView ? null : inspector} inspector={sidebar(inspector === 'search' ? <WorkspaceSearch /> : <FileExplorer />)}>
      {fullFilesView ? <section aria-label="Workspace files view" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{sidebar(<FileExplorer />)}</section> : <ToolbarTabSlotContext.Provider value={tabSlot}>{children}</ToolbarTabSlotContext.Provider>}
    </ResizableInspector>
  </div>
}
