// apps/desktop/src/widgets/agents/panels/MCPPanel.tsx
import { useState } from 'react'
import { Plus, Trash2, Server, Edit3, Power, PowerOff } from 'lucide-react'
import { Button } from '@ui/button'
import { Badge } from '@ui/badge'
import { Skeleton } from '@ui/skeleton'
import type { MCPServer, ProviderMCPServer } from '@core/api/client'
import type { Provider } from '../types'

interface MCPPanelProps {
  providerServers: ProviderMCPServer[]
  orchestraServers: MCPServer[]
  onAddProvider: (name: string, command: string) => Promise<void>
  onUpdateProvider: (name: string, server: Partial<ProviderMCPServer>) => Promise<void>
  onToggleProvider: (name: string, enabled: boolean) => Promise<void>
  onDeleteProvider: (name: string) => Promise<void>
  onDeleteOrchestra: (name: string) => Promise<void>
  loading: boolean
  saving: string | null
  provider: Provider
}

export function MCPPanel({ providerServers, orchestraServers, onAddProvider, onUpdateProvider, onToggleProvider, onDeleteProvider, onDeleteOrchestra, loading, saving, provider }: MCPPanelProps) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [editingServer, setEditingServer] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', command: '', enabled: true })

  if (loading) {
    return <div className="p-6 space-y-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-[200px] w-full" /></div>
  }

  const total = providerServers.length + orchestraServers.length

  const handleAdd = async () => {
    if (!name.trim() || !command.trim()) return
    await onAddProvider(name.trim(), command.trim())
    setName('')
    setCommand('')
  }

  const handleEdit = (server: ProviderMCPServer) => {
    setEditingServer(server.name)
    setEditForm({ name: server.name, command: server.command, enabled: server.enabled })
  }

  const handleUpdate = async () => {
    if (!editForm.name.trim() || !editForm.command.trim()) return
    await onUpdateProvider(editingServer!, {
      name: editForm.name.trim() !== editingServer ? editForm.name.trim() : undefined,
      command: editForm.command.trim(),
      enabled: editForm.enabled
    })
    setEditingServer(null)
  }

  const handleToggle = async (serverName: string, currentEnabled: boolean) => {
    await onToggleProvider(serverName, !currentEnabled)
  }

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="max-w-2xl mx-auto w-full flex flex-col flex-1 min-h-0 gap-4">
      <div>
        <h3 className="text-sm font-bold">MCP Servers</h3>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">{total} server{total !== 1 ? 's' : ''} connected</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
        {total === 0 && <p className="text-[10px] text-muted-foreground/20 py-4 text-center">No MCP servers configured</p>}

        {providerServers.map(s => (
          editingServer === s.name ? (
            <div key={s.name} className="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <input className="h-6 flex-1 rounded border border-border bg-background px-2 text-xs"
                  value={editForm.name}
                  onChange={e => setEditForm({...editForm, name: e.target.value})}
                  placeholder="Server name" />
                <label className="flex items-center gap-1 text-[10px]">
                  <input type="checkbox"
                    checked={editForm.enabled}
                    onChange={e => setEditForm({...editForm, enabled: e.target.checked})} />
                  Enabled
                </label>
              </div>
              <input className="h-6 w-full rounded border border-border bg-background px-2 text-xs font-mono"
                value={editForm.command}
                onChange={e => setEditForm({...editForm, command: e.target.value})}
                placeholder="npx -y @org/server" />
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="outline" className="h-6 text-[9px]" onClick={() => setEditingServer(null)}>Cancel</Button>
                <Button size="sm" className="h-6 text-[9px]" onClick={handleUpdate}>Save</Button>
              </div>
            </div>
          ) : (
            <div key={s.name} className={`flex items-center gap-2 group rounded-lg border px-3 py-2.5 ${s.enabled ? 'border-border/20' : 'border-border/10 opacity-60'}`}>
              <Server size={12} className={`shrink-0 ${s.enabled ? 'text-primary/50' : 'text-muted-foreground/30'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-semibold truncate">{s.name}</p>
                  {s.enabled ? (
                    <Power size={8} className="text-green-500 shrink-0" />
                  ) : (
                    <PowerOff size={8} className="text-muted-foreground/40 shrink-0" />
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground/40 font-mono truncate">{s.command}</p>
              </div>
              <Badge variant="outline" className="text-[8px] font-bold uppercase shrink-0">{provider}</Badge>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button onClick={() => handleToggle(s.name, s.enabled)}
                  className={`h-5 w-5 rounded flex items-center justify-center transition-all shrink-0 ${s.enabled ? 'text-orange-400 hover:bg-orange-500/10' : 'text-green-400 hover:bg-green-500/10'}`}
                  title={s.enabled ? 'Disable' : 'Enable'}>
                  {s.enabled ? <PowerOff size={10} /> : <Power size={10} />}
                </button>
                <button onClick={() => handleEdit(s)}
                  className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground/20 hover:text-blue-400 hover:bg-blue-500/10 transition-all shrink-0"
                  title="Edit">
                  <Edit3 size={10} />
                </button>
                <button onClick={() => onDeleteProvider(s.name)}
                  className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground/20 hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
                  title="Delete">
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          )
        ))}

        {orchestraServers.map(s => (
          <div key={s.name} className="flex items-center gap-2 group rounded-lg border border-border/20 px-3 py-2.5">
            <Server size={12} className="text-muted-foreground/30 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">{s.name}</p>
              <p className="text-[10px] text-muted-foreground/40 font-mono truncate">{s.command}</p>
            </div>
            <Badge variant="outline" className="text-[8px] font-bold uppercase shrink-0">orchestra</Badge>
            <button onClick={() => onDeleteOrchestra(s.name)} className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground/20 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 shrink-0">
              <Trash2 size={10} />
            </button>
          </div>
        ))}
      </div>

      {/* Add new */}
      <div className="shrink-0 flex items-center gap-2 border-t border-border/20 pt-3">
        <input className="h-8 w-[140px] rounded-lg border border-border bg-background px-3 text-xs focus:ring-2 focus:ring-primary/20 outline-none" value={name} onChange={e => setName(e.target.value)} placeholder="Server name" />
        <input className="h-8 flex-1 rounded-lg border border-border bg-background px-3 text-xs font-mono focus:ring-2 focus:ring-primary/20 outline-none" value={command} onChange={e => setCommand(e.target.value)} placeholder="npx -y @org/server" />
        <Button size="sm" variant="outline" className="h-8 text-[9px] font-bold uppercase" disabled={!name.trim() || !command.trim() || saving === 'mcp'} onClick={handleAdd}>
          <Plus size={10} className="mr-1" /> Add
        </Button>
      </div>
      </div>
    </div>
  )
}
