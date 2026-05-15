// apps/desktop/src/features/agents/panels/MCPPanel.tsx
import { lazy, Suspense, useId, useMemo, useReducer, useState } from 'react'

const Editor = lazy(() => import('@monaco-editor/react'))
import { useAppStore } from '@core/store'
import { Plus, Trash2, Power, PowerOff } from 'lucide-react'
import { Button } from '@ui/button'
import { Skeleton } from '@ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@ui/dialog'
import type { MCPServer, ProviderMCPServer } from '@core/api/client'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import { TOKENS } from '../tokens'
import type { Provider, Scope } from '../types'

const EMPTY_GLOBAL_SERVERS: readonly ProviderMCPServer[] = Object.freeze([])

interface MCPPanelProps {
  providerServers: ProviderMCPServer[]
  orchestraServers: MCPServer[]
  globalProviderServers?: ProviderMCPServer[]
  scope?: Scope
  projectName?: string | null
  onAddProvider: (name: string, command: string) => Promise<void>
  onUpdateProvider: (name: string, server: Partial<ProviderMCPServer>) => Promise<void>
  onToggleProvider: (name: string, enabled: boolean) => Promise<void>
  onDeleteProvider: (name: string) => Promise<void>
  onDeleteOrchestra: (name: string) => Promise<void>
  loading: boolean
  saving: string | null
  provider: Provider
}

const DEFAULT_SERVER_JSON = `{
  "command": "node",
  "args": []
}`

type ListItem = {
  key: string
  name: string
  kind: 'provider' | 'orchestra' | 'inherited'
  enabled?: boolean
  server: ProviderMCPServer | MCPServer
}

interface DialogState {
  createOpen: boolean
  createName: string
  savingItem: boolean
  deleteTarget: { name: string; kind: 'provider' | 'orchestra' } | null
}

type DialogAction =
  | { type: 'open_create' }
  | { type: 'set_create_name'; name: string }
  | { type: 'close_create' }
  | { type: 'create_start' }
  | { type: 'create_done' }
  | { type: 'open_delete'; target: { name: string; kind: 'provider' | 'orchestra' } }
  | { type: 'close_delete' }

const initialDialogState: DialogState = {
  createOpen: false,
  createName: '',
  savingItem: false,
  deleteTarget: null,
}

function dialogReducer(state: DialogState, action: DialogAction): DialogState {
  switch (action.type) {
    case 'open_create': return { ...state, createOpen: true }
    case 'set_create_name': return { ...state, createName: action.name }
    case 'close_create': return { ...state, createOpen: false, createName: '' }
    case 'create_start': return { ...state, savingItem: true }
    case 'create_done': return { ...state, savingItem: false, createOpen: false, createName: '' }
    case 'open_delete': return { ...state, deleteTarget: action.target }
    case 'close_delete': return { ...state, deleteTarget: null }
    default: return state
  }
}

function serverToJson(server: ProviderMCPServer | MCPServer): string {
  const { name: _name, ...rest } = server as Record<string, unknown>
  void _name
  return JSON.stringify(rest, null, 2)
}

export function MCPPanel({
  providerServers, orchestraServers, globalProviderServers = EMPTY_GLOBAL_SERVERS as ProviderMCPServer[],
  scope = 'GLOBAL', projectName = null,
  onAddProvider, onUpdateProvider, onToggleProvider, onDeleteProvider, onDeleteOrchestra,
  loading, saving, provider,
}: MCPPanelProps) {
  const items: ListItem[] = useMemo(() => {
    const provided = providerServers.map(s => ({
      key: `provider:${s.name}`,
      name: s.name,
      kind: 'provider' as const,
      enabled: s.enabled,
      server: s,
    }))
    const orchestra = orchestraServers.map(s => ({
      key: `orchestra:${s.name}`,
      name: s.name,
      kind: 'orchestra' as const,
      server: s,
    }))
    const providerNames = new Set(providerServers.map(p => p.name))
    const inherited = scope === 'PROJECT'
      ? globalProviderServers.flatMap(s => providerNames.has(s.name) ? [] : [{
            key: `inherited:${s.name}`,
            name: s.name,
            kind: 'inherited' as const,
            enabled: s.enabled,
            server: s,
          }])
      : []
    return [...provided, ...orchestra, ...inherited]
  }, [providerServers, orchestraServers, globalProviderServers, scope])

  const [dialog, dispatch] = useReducer(dialogReducer, initialDialogState)

  if (loading) {
    return <div className="p-6 space-y-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-[200px] w-full" /></div>
  }

  const total = items.length
  const eyebrow = scope === 'GLOBAL' ? 'Global / MCP Servers' : `${projectName ?? 'Project'} / MCP Servers`
  const sub = `.mcp.json · ${total} server${total === 1 ? '' : 's'}`

  const handleCreate = async () => {
    const n = dialog.createName.trim()
    if (!n) return
    dispatch({ type: 'create_start' })
    try {
      let parsed: { command?: string; args?: string[] }
      try { parsed = JSON.parse(DEFAULT_SERVER_JSON) } catch { parsed = {} }
      await onAddProvider(n, parsed.command ?? 'node')
    } finally {
      dispatch({ type: 'create_done' })
    }
  }

  const handleConfirmDelete = async () => {
    if (!dialog.deleteTarget) return
    if (dialog.deleteTarget.kind === 'provider') {
      await onDeleteProvider(dialog.deleteTarget.name)
    } else {
      await onDeleteOrchestra(dialog.deleteTarget.name)
    }
    dispatch({ type: 'close_delete' })
  }

  if (items.length === 0 && scope === 'PROJECT' && projectName) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader eyebrow={eyebrow} title="MCP servers" sub="No project MCP servers · inherits 0 from global" />
        <EmptyStateCard
          title="No MCP servers at this scope"
          description="Add an MCP server to extend this project's tools."
          ctaLabel="New server"
          onCreate={() => dispatch({ type: 'open_create' })}
        />
        <CreateDialog
          open={dialog.createOpen}
          name={dialog.createName}
          setName={(n) => dispatch({ type: 'set_create_name', name: n })}
          pending={dialog.savingItem}
          onCancel={() => dispatch({ type: 'close_create' })}
          onCreate={handleCreate}
        />
      </div>
    )
  }

  return (
    <MCPPanelLoaded
      key={items.map(i => i.key).join('|')}
      items={items}
      eyebrow={eyebrow}
      sub={sub}
      saving={saving}
      provider={provider}
      dialog={dialog}
      dispatch={dispatch}
      handleCreate={handleCreate}
      handleConfirmDelete={handleConfirmDelete}
      onUpdateProvider={onUpdateProvider}
      onToggleProvider={onToggleProvider}
    />
  )
}

interface MCPPanelLoadedProps {
  items: ListItem[]
  eyebrow: string
  sub: string
  saving: string | null
  provider: Provider
  dialog: DialogState
  dispatch: React.Dispatch<DialogAction>
  handleCreate: () => Promise<void>
  handleConfirmDelete: () => Promise<void>
  onUpdateProvider: (name: string, server: Partial<ProviderMCPServer>) => Promise<void>
  onToggleProvider: (name: string, enabled: boolean) => Promise<void>
}

function MCPPanelLoaded({
  items, eyebrow, sub, saving, provider, dialog, dispatch,
  handleCreate, handleConfirmDelete, onUpdateProvider, onToggleProvider,
}: MCPPanelLoadedProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(items[0]?.key ?? null)
  const effectiveSelectedKey = selectedKey && items.some(i => i.key === selectedKey)
    ? selectedKey
    : (items[0]?.key ?? null)
  const selected = items.find(i => i.key === effectiveSelectedKey) ?? null

  return (
    <MCPEditor
      key={selected?.key ?? '__none__'}
      selected={selected}
      items={items}
      selectedKey={effectiveSelectedKey}
      setSelectedKey={setSelectedKey}
      eyebrow={eyebrow}
      sub={sub}
      saving={saving}
      provider={provider}
      dialog={dialog}
      dispatch={dispatch}
      handleCreate={handleCreate}
      handleConfirmDelete={handleConfirmDelete}
      onUpdateProvider={onUpdateProvider}
      onToggleProvider={onToggleProvider}
    />
  )
}

interface MCPEditorProps {
  selected: ListItem | null
  items: ListItem[]
  selectedKey: string | null
  setSelectedKey: (key: string | null) => void
  eyebrow: string
  sub: string
  saving: string | null
  provider: Provider
  dialog: DialogState
  dispatch: React.Dispatch<DialogAction>
  handleCreate: () => Promise<void>
  handleConfirmDelete: () => Promise<void>
  onUpdateProvider: (name: string, server: Partial<ProviderMCPServer>) => Promise<void>
  onToggleProvider: (name: string, enabled: boolean) => Promise<void>
}

function MCPEditor({
  selected, items, selectedKey, setSelectedKey,
  eyebrow, sub, saving, provider, dialog, dispatch,
  handleCreate, handleConfirmDelete, onUpdateProvider, onToggleProvider,
}: MCPEditorProps) {
  const theme = useAppStore(s => s.theme)
  const editorSettings = useAppStore(s => s.editorSettings)
  const [content, setContent] = useState(selected ? serverToJson(selected.server) : '')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [error, setError] = useState('')

  const dirty = selected && selected.kind === 'provider'
    ? content !== serverToJson(selected.server)
    : false

  const handleSave = async () => {
    if (!selected || selected.kind !== 'provider') return
    setError('')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(content) as Record<string, unknown>
    } catch {
      setJsonError('Invalid JSON')
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setJsonError('Server config must be a JSON object')
      return
    }
    setJsonError(null)
    try {
      await onUpdateProvider(selected.name, {
        ...(parsed as Partial<ProviderMCPServer>),
        enabled: (selected.server as ProviderMCPServer).enabled,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
      <PanelHeader eyebrow={eyebrow} title="MCP servers" sub={sub} dirty={!!dirty} />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'open_create' })} className="w-full h-7 text-[10px]">
              <Plus size={10} className="mr-1" /> New server
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {items.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSelectedKey(item.key)}
                className={`w-full text-left px-2 py-1.5 rounded text-[11px] flex items-center gap-1.5 ${
                  item.key === selectedKey ? 'bg-foreground/[0.06] text-foreground' : 'text-foreground/65 hover:bg-foreground/[0.03]'
                }`}
              >
                <span className="truncate flex-1">{item.name}</span>
                {item.kind === 'provider' && (item.enabled ? <Power size={9} className="text-green-500/70" /> : <PowerOff size={9} className="text-muted-foreground/30" />)}
                {item.kind === 'orchestra' && <span className="text-[8.5px] font-mono uppercase text-foreground/30">(O)</span>}
                {item.kind === 'inherited' && <span className="text-[8.5px] font-mono uppercase text-foreground/30">(G)</span>}
              </button>
            ))}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {selected ? (
            <>
              <div className="text-[10px] text-foreground/45 font-mono flex items-center gap-2">
                <span>{selected.name}</span>
                {selected.kind === 'inherited' && <span>· inherited from global (read-only)</span>}
                {selected.kind === 'orchestra' && <span>· orchestra-managed (read-only here)</span>}
                {selected.kind === 'provider' && (
                  <button
                    type="button"
                    onClick={() => onToggleProvider(selected.name, !(selected.server as ProviderMCPServer).enabled)}
                    className="ml-auto inline-flex items-center gap-1 text-[10px] text-foreground/45 hover:text-foreground"
                  >
                    {(selected.server as ProviderMCPServer).enabled ? (
                      <><PowerOff size={10} /> Disable</>
                    ) : (
                      <><Power size={10} /> Enable</>
                    )}
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-0 rounded-md border border-border/30 overflow-hidden">
                <Suspense fallback={null}>
                  <Editor
                    language="json"
                    value={content}
                    theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                    onChange={(v) => {
                      if (v !== undefined && selected.kind === 'provider') {
                        setContent(v)
                        setJsonError(null)
                      }
                    }}
                    options={{
                      readOnly: selected.kind !== 'provider',
                      minimap: { enabled: false },
                      fontSize: editorSettings.fontSize,
                      fontFamily: editorSettings.fontFamily || undefined,
                      lineNumbers: 'on',
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                      padding: { top: 10, bottom: 10 },
                    }}
                  />
                </Suspense>
              </div>
              {jsonError && <p className="text-[10px] text-red-400 font-mono">{jsonError}</p>}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11px] text-foreground/30">
              Select a server or create one
            </div>
          )}
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={!!dirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={() => { setContent(selected ? serverToJson(selected.server) : ''); setJsonError(null) }}
        extraLeft={
          selected && selected.kind !== 'inherited' ? (
            <button
              type="button"
              onClick={() => dispatch({ type: 'open_delete', target: { name: selected.name, kind: selected.kind as 'provider' | 'orchestra' } })}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : undefined
        }
      />

      <CreateDialog
        open={dialog.createOpen}
        name={dialog.createName}
        setName={(n) => dispatch({ type: 'set_create_name', name: n })}
        pending={dialog.savingItem}
        onCancel={() => dispatch({ type: 'close_create' })}
        onCreate={handleCreate}
      />

      <Dialog open={!!dialog.deleteTarget} onOpenChange={(o) => !o && dispatch({ type: 'close_delete' })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete MCP server</DialogTitle>
            <DialogDescription>This removes the server from configuration. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{dialog.deleteTarget?.name}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => dispatch({ type: 'close_delete' })}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              <Trash2 size={14} className="mr-2" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="text-[9px] text-muted-foreground/30 font-mono">
        {provider} provider · (O) orchestra-managed · (G) inherited from global
      </div>
    </div>
  )
}

function CreateDialog({
  open, name, setName, pending, onCancel, onCreate,
}: {
  open: boolean
  name: string
  setName: (s: string) => void
  pending: boolean
  onCancel: () => void
  onCreate: () => void
}) {
  const nameId = useId()
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New MCP server</DialogTitle>
          <DialogDescription>Adds a server entry to .mcp.json. Edit the config in the JSON editor after creation.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label htmlFor={nameId} className="text-xs font-semibold text-foreground/60 mb-1.5 block">Server name</label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate()}
            className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm font-mono"
            placeholder="e.g. filesystem"
          />
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">Letters, numbers, hyphens, underscores only</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onCreate} disabled={!name.trim() || pending}>
            <Plus size={12} className="mr-2" /> {pending ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
