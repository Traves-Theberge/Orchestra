import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Folder, Globe, PanelRight, Plus, Search, Terminal, X } from 'lucide-react'
import { AppTooltip } from '@ui/tooltip-wrapper'
import { useAppStore } from '@core/store'
import { getActiveWorkspaceContextId, selectedProjectWorkspace } from '@core/store/workspace-context'
import { FileExplorer } from './file-explorer/FileExplorer'
import { WorkspaceSearch } from './panels/WorkspaceSearch'
import { WorkspaceToolsControls } from './WorkspaceToolsControls'
import { ResizableInspector } from './ResizableInspector'

export function WorkspaceToolSurface({ children, filesRequest, onAddTerminal, onRefreshTargetChange, toolsOpen, onToggleTools, hasActiveTools = true }: { children: ReactNode; filesRequest?: number; onAddTerminal?: () => void; onRefreshTargetChange?: (target: HTMLSpanElement | null) => void; toolsOpen?: boolean; onToggleTools?: () => void; hasActiveTools?: boolean }) {
  const [inspector, setInspector] = useState<'files' | 'search' | null>(null)
  const [lastFilesRequest, setLastFilesRequest] = useState<number | undefined>()
  const contextId = useAppStore(getActiveWorkspaceContextId)
  const config = useAppStore(state => state.config)
  const explorerRoot = useAppStore(state => state.explorerRoot)
  const workspace = useAppStore(state => selectedProjectWorkspace(state))
  const [menu, setMenu] = useState<{ left: number; top: number; contextId: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  if (menu && menu.contextId !== contextId) setMenu(null)
  useEffect(() => {
    if (!menu) return
    popup.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setMenu(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(null); trigger.current?.focus() }
    }
    const resize = () => setMenu(null)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('resize', resize)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', resize) }
  }, [menu])
  const dismiss = () => { setMenu(null); trigger.current?.focus() }
  const createMarkdown = async () => {
    dismiss()
    const before = useAppStore.getState()
    const owner = getActiveWorkspaceContextId(before)
    const root = selectedProjectWorkspace(before)?.path || before.explorerRoot
    const backend = before.config
    if (!root || !backend?.baseUrl) { setError('Select a workspace with a connected backend to create a document.'); return }
    const filename = `Untitled-${crypto.randomUUID()}.md`
    const path = `${root.replace(/[\\/]+$/, '')}/${filename}`
    setCreating(true); setError('')
    try {
      const response = await fetch(`${backend.baseUrl}/api/v1/workspace/file?path=${encodeURIComponent(path)}`, {
        method: 'PUT', headers: { 'Content-Type': 'text/plain', ...(backend.apiToken ? { Authorization: `Bearer ${backend.apiToken}` } : {}) }, body: '# Untitled\n\n',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const now = useAppStore.getState()
      const currentRoot = selectedProjectWorkspace(now)?.path || now.explorerRoot
      if (getActiveWorkspaceContextId(now) === owner && currentRoot === root && now.config?.baseUrl === backend.baseUrl && now.config?.apiToken === backend.apiToken) {
        now.openFile(path, filename, undefined, owner)
      } else {
        setError(`Document created in the previous workspace: ${filename}. Select that workspace to open it.`)
      }
    } catch (cause) {
      setError(`Document creation was not confirmed (${cause instanceof Error ? cause.message : 'request failed'}). Check ${path} before trying again.`)
    } finally { setCreating(false) }
  }
  if (filesRequest !== undefined && filesRequest !== lastFilesRequest) {
    setLastFilesRequest(filesRequest)
    setInspector('files')
  }
  const toolbar = <div aria-label="Workspace tool controls" className="flex h-10 shrink-0 items-center gap-1 px-3 pt-1">
      <AppTooltip content="Files" side="bottom"><button type="button" aria-label="Toggle workspace files" aria-pressed={inspector === 'files'} onClick={() => { setInspector(current => current === 'files' ? null : 'files'); if (toolsOpen === false) onToggleTools?.() }} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><Folder size={13} /></button></AppTooltip>
      {inspector && <AppTooltip content="Search files" side="bottom"><button type="button" aria-label="Toggle workspace search" aria-pressed={inspector === 'search'} onClick={() => { setInspector(current => current === 'search' ? null : 'search'); if (toolsOpen === false) onToggleTools?.() }} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><Search size={13} /></button></AppTooltip>}
      {inspector && <AppTooltip content="Close file sidebar" side="bottom"><button type="button" aria-label="Close workspace file sidebar" onClick={() => setInspector(null)} className="rounded p-1 text-muted-foreground hover:bg-muted"><X size={12} /></button></AppTooltip>}
      <span className="flex-1" />
      <span ref={onRefreshTargetChange} className="flex items-center gap-1" />
      <AppTooltip content="Add workspace tool" side="bottom"><button ref={trigger} type="button" aria-label="Add workspace tool" aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          setMenu(current => current ? null : { left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 184)), contextId })
        }} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><Plus size={14} /></button></AppTooltip>
      {onToggleTools && <AppTooltip content="Hide workspace tools" side="bottom"><button type="button" onClick={onToggleTools} aria-label="Hide workspace tools" aria-pressed={toolsOpen} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"><PanelRight size={16} /></button></AppTooltip>}
      <WorkspaceToolsControls inToolbar />
    </div>
  const fullFilesView = inspector === 'files' && !hasActiveTools
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    {toolbar}
    {error && <p role="alert" className="px-3 py-1 text-xs text-destructive">{error}</p>}
    {creating && <p role="status" className="px-3 py-1 text-xs text-muted-foreground">Creating document…</p>}
    {menu && createPortal(<div ref={popup} role="menu" aria-label="Add workspace tool" className="fixed z-[100] w-56 max-w-[calc(100vw-16px)] rounded-lg border border-border bg-popover p-1 shadow-xl" style={{ left: menu.left, top: menu.top }} onKeyDown={event => {
      if (event.key === 'Tab') { setMenu(null); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
      const index = items.findIndex(item => item === document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }}>
      <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none" onClick={() => { dismiss(); setInspector('files'); if (toolsOpen === false) onToggleTools?.() }}><Folder size={14} />File viewer</button>
      <button type="button" role="menuitem" disabled={!onAddTerminal} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-40" onClick={() => { dismiss(); onAddTerminal?.() }}><Terminal size={14} />New terminal</button>
      <button type="button" role="menuitem" disabled={creating || !config?.baseUrl || !(workspace?.path || explorerRoot)} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-40" onClick={() => { void createMarkdown() }}><FileText size={14} />New markdown document</button>
      <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none" onClick={() => { dismiss(); const state = useAppStore.getState(); state.openBrowserTab(undefined, getActiveWorkspaceContextId(state)) }}><Globe size={14} />New browser tab</button>
    </div>, document.body)}
    <ResizableInspector storageKey={`orchestra:inspector-width:v1:${encodeURIComponent(config?.baseUrl ?? '')}:${encodeURIComponent(contextId)}`} mode={fullFilesView ? null : inspector} inspector={inspector === 'search' ? <WorkspaceSearch /> : <FileExplorer />}>
      {fullFilesView ? <section aria-label="Workspace files view" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"><FileExplorer /></section> : children}
    </ResizableInspector>
  </div>
}
