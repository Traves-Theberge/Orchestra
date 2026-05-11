// apps/desktop/src/widgets/agents/panels/HooksPanel.tsx
import { useState, useEffect } from 'react'
import { Save, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@ui/button'
import { Skeleton } from '@ui/skeleton'
import { CustomDropdown } from '@layout/shared/controls'
import type { ProviderHook } from '@core/api/client'
import { HOOK_EVENTS_BY_PROVIDER } from '../constants'
import type { Provider } from '../types'

interface HooksPanelProps {
  hooks: ProviderHook[]
  onSave: (hooks: ProviderHook[]) => Promise<void>
  loading: boolean
  saving: string | null
  provider: Provider
}

export function HooksPanel({ hooks, onSave, loading, saving, provider }: HooksPanelProps) {
  const [localHooks, setLocalHooks] = useState(hooks)
  const [newEvent, setNewEvent] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newMatcher, setNewMatcher] = useState('')
  const events = HOOK_EVENTS_BY_PROVIDER[provider] ?? []
  const allowCustomEvents = provider === 'codex'

  // Sync from parent when hooks change (e.g. after save + reload)
  useEffect(() => { setLocalHooks(hooks) }, [hooks])

  if (loading) {
    return <div className="p-6 space-y-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-[200px] w-full" /></div>
  }

  if (events.length === 0 && !allowCustomEvents) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/20">
        <p className="text-sm font-bold uppercase tracking-widest">{provider} does not support hooks</p>
      </div>
    )
  }

  const handleAdd = () => {
    if (!newEvent || !newCommand.trim()) return
    setLocalHooks(prev => [...prev, { event: newEvent, command: newCommand.trim(), matcher: newMatcher.trim() || undefined, type: 'command' }])
    setNewEvent('')
    setNewCommand('')
    setNewMatcher('')
  }

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="max-w-2xl mx-auto w-full flex flex-col flex-1 min-h-0 gap-4">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-sm font-bold">Lifecycle Hooks</h3>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">Run commands on {provider} events</p>
        </div>
        <Button size="sm" onClick={() => onSave(localHooks)} disabled={saving === 'hooks'} className="h-7 bg-primary text-primary-foreground font-bold uppercase text-[10px] px-4 rounded-lg">
          {saving === 'hooks' ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />} Save
        </Button>
      </div>

      {/* Existing hooks */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
        {localHooks.length === 0 && (
          <p className="text-[10px] text-muted-foreground/20 py-4 text-center">No hooks configured</p>
        )}
        {localHooks.map((hook, i) => (
          <div key={i} className="flex items-center gap-2 group rounded-lg border border-border/20 px-3 py-2">
            <span className="text-[10px] font-bold text-primary/70 uppercase tracking-wider shrink-0 w-[120px] truncate">{hook.event}</span>
            <code className="text-[11px] font-mono text-foreground/70 flex-1 truncate">{hook.command}</code>
            {hook.matcher && <span className="text-[9px] text-muted-foreground/40 shrink-0">({hook.matcher})</span>}
            <button
              onClick={() => setLocalHooks(prev => prev.filter((_, idx) => idx !== i))}
              className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground/20 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 shrink-0"
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}
      </div>

      {/* Add new hook */}
      <div className="shrink-0 flex items-center gap-2 border-t border-border/20 pt-3">
        {allowCustomEvents ? (
          <input
            className="h-8 w-[150px] rounded-lg border border-border bg-background px-3 text-xs font-mono focus:ring-2 focus:ring-primary/20 outline-none"
            value={newEvent}
            onChange={e => setNewEvent(e.target.value)}
            placeholder="Event"
          />
        ) : (
          <CustomDropdown className="w-[150px]" direction="up" value={newEvent} options={events.map(e => ({ label: e, value: e }))} onChange={setNewEvent} placeholder="Event" />
        )}
        <input className="h-8 flex-1 rounded-lg border border-border bg-background px-3 text-xs font-mono focus:ring-2 focus:ring-primary/20 outline-none" value={newCommand} onChange={e => setNewCommand(e.target.value)} placeholder="Command" />
        <input className="h-8 w-[100px] rounded-lg border border-border bg-background px-3 text-xs font-mono focus:ring-2 focus:ring-primary/20 outline-none" value={newMatcher} onChange={e => setNewMatcher(e.target.value)} placeholder="Matcher" />
        <Button size="sm" variant="outline" className="h-8 text-[9px] font-bold uppercase" disabled={!newEvent || !newCommand.trim()} onClick={handleAdd}>
          <Plus size={10} className="mr-1" /> Add
        </Button>
      </div>
      </div>
    </div>
  )
}
