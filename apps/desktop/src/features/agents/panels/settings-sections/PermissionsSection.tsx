import { useState } from 'react'
import { Plus, X } from 'lucide-react'

interface PermissionsSectionProps {
  local: Record<string, unknown>
  updateField: (key: string, value: unknown) => void
}

function PermissionList({
  label,
  description,
  items,
  newValue,
  setNewValue,
  onAdd,
  onRemove,
}: {
  label: string
  description: string
  items: string[]
  newValue: string
  setNewValue: (v: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <div>
      <h5 className="text-[11px] font-semibold mb-0.5">{label}</h5>
      <p className="text-[10px] text-muted-foreground/40 mb-2">{description}</p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((item, i) => (
          <span key={`${item}#${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/30 border border-border/30 text-[11px] font-mono">
            {item}
            <button onClick={() => onRemove(i)} className="text-muted-foreground/40 hover:text-red-400">
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
          onKeyDown={e => e.key === 'Enter' && onAdd()}
          placeholder="e.g. Bash(npm run build)"
          className="flex-1 px-2 py-1 rounded-md bg-muted/10 border border-border/30 text-[11px] font-mono focus:outline-none focus:border-primary/30"
        />
        <button
          onClick={onAdd}
          className="size-6 rounded flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/30 transition-all"
        >
          <Plus size={10} />
        </button>
      </div>
    </div>
  )
}

export function PermissionsSection({ local, updateField }: PermissionsSectionProps) {
  const [newAllow, setNewAllow] = useState('')
  const [newDeny, setNewDeny] = useState('')
  const [newAsk, setNewAsk] = useState('')

  const permsObj = (typeof local.permissions === 'object' && local.permissions !== null && !Array.isArray(local.permissions))
    ? local.permissions as Record<string, unknown>
    : {}
  const allow = Array.isArray(permsObj.allow) ? (permsObj.allow as string[]) : []
  const deny = Array.isArray(permsObj.deny) ? (permsObj.deny as string[]) : []
  const ask = Array.isArray(permsObj.ask) ? (permsObj.ask as string[]) : []

  const update = (field: string, list: string[]) => {
    updateField('permissions', { ...permsObj, [field]: list })
  }

  const addTo = (field: string, list: string[], value: string, clear: () => void) => {
    const v = value.trim()
    if (v && !list.includes(v)) {
      update(field, [...list, v])
      clear()
    }
  }

  const removeFrom = (field: string, list: string[], index: number) => {
    update(field, list.filter((_, i) => i !== index))
  }

  return (
    <section className="space-y-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">Permissions</h4>
      <div className="space-y-4">
        <PermissionList
          label="Allow"
          description="Auto-approved without prompting"
          items={allow}
          newValue={newAllow}
          setNewValue={setNewAllow}
          onAdd={() => addTo('allow', allow, newAllow, () => setNewAllow(''))}
          onRemove={(i) => removeFrom('allow', allow, i)}
        />
        <PermissionList
          label="Deny"
          description="Always blocked (takes precedence)"
          items={deny}
          newValue={newDeny}
          setNewValue={setNewDeny}
          onAdd={() => addTo('deny', deny, newDeny, () => setNewDeny(''))}
          onRemove={(i) => removeFrom('deny', deny, i)}
        />
        <PermissionList
          label="Ask"
          description="Always prompt for confirmation"
          items={ask}
          newValue={newAsk}
          setNewValue={setNewAsk}
          onAdd={() => addTo('ask', ask, newAsk, () => setNewAsk(''))}
          onRemove={(i) => removeFrom('ask', ask, i)}
        />
      </div>
    </section>
  )
}
