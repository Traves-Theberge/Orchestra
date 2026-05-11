// apps/desktop/src/features/agents/panels/MCPPanel.tsx
import { useState, useEffect, useMemo } from 'react'
import Editor from '@monaco-editor/react'
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

function serverToJson(server: ProviderMCPServer | MCPServer): string {
  // Exclude name (it's the key) and produce the config object
  const { name: _name, ...rest } = server as Record<string, unknown>
  void _name
  return JSON.stringify(rest, null, 2)
}

export function MCPPanel({
  providerServers, orchestraServers, globalProviderServers = [],
  scope = 'GLOBAL', projectName = null,
  onAddProvider, onUpdateProvider, onToggleProvider, onDeleteProvider, onDeleteOrchestra,
  loading, saving, provider,
}: MCPPanelProps) {
  const theme = useAppStore(s => s.theme)
  const editorSettings = useAppStore(s => s.editorSettings)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; kind: 'provider' | 'orchestra' } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [savingItem, setSavingItem] = useState(false)

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
    const inherited = scope === 'PROJECT'
      ? globalProviderServers
          .filter(g => !providerServers.some(p => p.name === g.name))
          .map(s => ({
            key: `inherited:${s.name}`,
            name: s.name,
            kind: 'inherited' as const,
            enabled: s.enabled,
            server: s,
          }))
      : []
    return [...provided, ...orchestra, ...inherited]
  }, [providerServers, orchestraServers, globalProviderServers, scope])

  useEffect(() => {
    if (!selectedKey && items.length > 0) setSelectedKey(items[0].key)
  }, [selectedKey, items])

  useEffect(() => {
    if (selectedKey && !items.find(i => i.key === selectedKey)) {
      setSelectedKey(items.length > 0 ? items[0].key : null)
    }
  }, [selectedKey, items])

  const selected = items.find(i => i.key === selectedKey) ?? null

  useEffect(() => {
    setContent(selected ? serverToJson(selected.server) : '')
    setJsonError(null)
    setError('')
  }, [selected])

  const dirty = selected && selected.kind === 'provider'
    ? content !== serverToJson(selected.server)
    : false

  if (loading) {
    return <div className="p-6 space-y-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-[200px] w-full" /></div>
  }

  const total = items.length
  const eyebrow = scope === 'GLOBAL' ? 'Global / MCP Servers' : `${projectName ?? 'Project'} / MCP Servers`
  const sub = `.mcp.json · ${total} server${total === 1 ? '' : 's'}`

  const handleCreate = async () => {
    const n = createName.trim()
    if (!n) return
    setSavingItem(true)
    try {
      let parsed: { command?: string; args?: string[] }
      try { parsed = JSON.parse(DEFAULT_SERVER_JSON) } catch { parsed = {} }
      await onAddProvider(n, parsed.command ?? 'node')
      setSelectedKey(`provider:${n}`)
      setCreateOpen(false)
      setCreateName('')
    } finally {
      setSavingItem(false)
    }
  }

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

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    if (deleteTarget.kind === 'provider') {
      await onDeleteProvider(deleteTarget.name)
    } else {
      await onDeleteOrchestra(deleteTarget.name)
    }
    setDeleteTarget(null)
    setSelectedKey(null)
  }

  if (items.length === 0 && scope === 'PROJECT' && projectName) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader eyebrow={eyebrow} title="MCP servers" sub="No project MCP servers · inherits 0 from global" />
        <EmptyStateCard
          title="No MCP servers at this scope"
          description="Add an MCP server to extend this project's tools."
          ctaLabel="New server"
          onCreate={() => setCreateOpen(true)}
        />
        <CreateDialog open={createOpen} name={createName} setName={setCreateName} pending={savingItem}
          onCancel={() => { setCreateOpen(false); setCreateName('') }}
          onCreate={handleCreate}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader eyebrow={eyebrow} title="MCP servers" sub={sub} dirty={!!dirty} />

      <div className="flex flex-1 min-h-0 gap-3">
        <aside className={`w-[220px] flex flex-col shrink-0 ${TOKENS.surfaceCard}`}>
          <div className="p-2 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen(true)} className="w-full h-7 text-[10px]">
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
              onClick={() => setDeleteTarget({ name: selected.name, kind: selected.kind as 'provider' | 'orchestra' })}
              className="text-[10px] text-foreground/40 hover:text-red-400 inline-flex items-center gap-1"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : undefined
        }
      />

      <CreateDialog
        open={createOpen}
        name={createName}
        setName={setCreateName}
        pending={savingItem}
        onCancel={() => { setCreateOpen(false); setCreateName('') }}
        onCreate={handleCreate}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete MCP server</DialogTitle>
            <DialogDescription>This removes the server from configuration. Cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-4 rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-mono text-primary">{deleteTarget?.name}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              <Trash2 size={14} className="mr-2" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hint about provider/orchestra/inherited badges */}
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
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New MCP server</DialogTitle>
          <DialogDescription>Adds a server entry to .mcp.json. Edit the config in the JSON editor after creation.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <label className="text-xs font-semibold text-foreground/60 mb-1.5 block">Server name</label>
          <input
            autoFocus
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
