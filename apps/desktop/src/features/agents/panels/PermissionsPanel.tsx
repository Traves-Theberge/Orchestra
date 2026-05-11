// apps/desktop/src/widgets/agents/panels/PermissionsPanel.tsx
import { useState, useEffect } from 'react'
import { Save, Loader2, RotateCcw, Plus, X } from 'lucide-react'
import { Button } from '@ui/button'
import type { ProviderPermissions } from '@core/api/client'
import { APPROVAL_MODES } from '../constants'
import type { Provider } from '../types'

interface PermissionsPanelProps {
  permissions: ProviderPermissions
  saving: string | null
  onSave: (perms: ProviderPermissions) => Promise<void>
  provider: Provider
}

export function PermissionsPanel({ permissions, saving, onSave, provider }: PermissionsPanelProps) {
  const [mode, setMode] = useState(permissions.approval_mode)
  const [allow, setAllow] = useState<string[]>(permissions.allow)
  const [deny, setDeny] = useState<string[]>(permissions.deny)
  const [ask, setAsk] = useState<string[]>(permissions.ask)
  const [newAllow, setNewAllow] = useState('')
  const [newDeny, setNewDeny] = useState('')
  const [newAsk, setNewAsk] = useState('')

  useEffect(() => {
    setMode(permissions.approval_mode)
    setAllow(permissions.allow)
    setDeny(permissions.deny)
    setAsk(permissions.ask)
  }, [permissions])

  const isDirty = mode !== permissions.approval_mode ||
    JSON.stringify(allow) !== JSON.stringify(permissions.allow) ||
    JSON.stringify(deny) !== JSON.stringify(permissions.deny) ||
    JSON.stringify(ask) !== JSON.stringify(permissions.ask)

  const handleSave = () => {
    onSave({ ...permissions, approval_mode: mode, allow, deny, ask })
  }

  const handleDiscard = () => {
    setMode(permissions.approval_mode)
    setAllow(permissions.allow)
    setDeny(permissions.deny)
    setAsk(permissions.ask)
  }

  const addToList = (list: string[], setList: (v: string[]) => void, value: string, setValue: (v: string) => void) => {
    const v = value.trim()
    if (v && !list.includes(v)) {
      setList([...list, v])
      setValue('')
    }
  }

  const removeFromList = (list: string[], setList: (v: string[]) => void, index: number) => {
    setList(list.filter((_, i) => i !== index))
  }

  const renderList = (
    label: string,
    description: string,
    items: string[],
    setItems: (v: string[]) => void,
    newValue: string,
    setNewValue: (v: string) => void,
  ) => (
    <div>
      <h4 className="text-xs font-bold mb-1">{label}</h4>
      <p className="text-[10px] text-muted-foreground/50 mb-2">{description}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/30 border border-border/30 text-[11px] font-mono">
            {item}
            <button onClick={() => removeFromList(items, setItems, i)} className="text-muted-foreground/40 hover:text-red-400">
              <X size={10} />
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="text-[10px] text-muted-foreground/30 italic">None</span>}
      </div>
      <div className="flex gap-1.5">
        <input
          value={newValue}
          onChange={e => setNewValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addToList(items, setItems, newValue, setNewValue)}
          placeholder="e.g. Bash(npm run build)"
          className="flex-1 px-2 py-1 rounded-md bg-muted/10 border border-border/30 text-[11px] font-mono focus:outline-none focus:border-primary/30"
        />
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => addToList(items, setItems, newValue, setNewValue)}>
          <Plus size={10} />
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-sm font-bold">Permissions</h3>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">Control which tools this provider can use</p>
        </div>
        {isDirty && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest animate-pulse">Unsaved</span>
            <Button size="sm" variant="ghost" onClick={handleDiscard} className="h-7 text-[10px]">
              <RotateCcw size={10} className="mr-1" /> Discard
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!!saving} className="h-7 bg-primary text-primary-foreground font-bold uppercase text-[10px] px-4 rounded-lg">
              {saving ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />}
              Save
            </Button>
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-bold mb-1.5">Permission Mode</h4>
        <select
          value={mode}
          onChange={e => setMode(e.target.value)}
          className="px-2 py-1.5 rounded-md bg-muted/10 border border-border/30 text-xs focus:outline-none focus:border-primary/30"
        >
          {(APPROVAL_MODES[provider] ?? APPROVAL_MODES.claude).map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-4">
        {renderList('Allow', 'Tools that are auto-approved without prompting', allow, setAllow, newAllow, setNewAllow)}
        {renderList('Deny', 'Tools that are always blocked (takes precedence over allow)', deny, setDeny, newDeny, setNewDeny)}
        {renderList('Ask', 'Tools that always prompt for confirmation', ask, setAsk, newAsk, setNewAsk)}
      </div>
      </div>
    </div>
  )
}
