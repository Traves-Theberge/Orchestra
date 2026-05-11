// apps/desktop/src/features/agents/panels/PermissionsPanel.tsx
import { useState, useEffect, useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@ui/button'
import { CustomDropdown } from '@layout/shared/controls'
import type { ProviderPermissions } from '@core/api/client'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import { InheritedField } from '../components/InheritedField'
import { APPROVAL_MODES } from '../constants'
import type { Provider, Scope } from '../types'

interface PermissionsPanelProps {
  permissions: ProviderPermissions
  globalPermissions?: ProviderPermissions | null
  scope?: Scope
  projectName?: string | null
  saving: string | null
  onSave: (perms: ProviderPermissions) => Promise<void>
  provider: Provider
}

const EMPTY_PERMS: ProviderPermissions = { approval_mode: 'default', allow: [], deny: [], ask: [] }

export function PermissionsPanel({
  permissions, globalPermissions, scope = 'GLOBAL', projectName = null,
  saving, onSave, provider,
}: PermissionsPanelProps) {
  const [mode, setMode] = useState(permissions.approval_mode)
  const [allow, setAllow] = useState<string[]>(permissions.allow)
  const [deny, setDeny] = useState<string[]>(permissions.deny)
  const [ask, setAsk] = useState<string[]>(permissions.ask)
  const [newAllow, setNewAllow] = useState('')
  const [newDeny, setNewDeny] = useState('')
  const [newAsk, setNewAsk] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setMode(permissions.approval_mode)
    setAllow(permissions.allow)
    setDeny(permissions.deny)
    setAsk(permissions.ask)
    setError('')
  }, [permissions])

  const isDirty = mode !== permissions.approval_mode ||
    JSON.stringify(allow) !== JSON.stringify(permissions.allow) ||
    JSON.stringify(deny) !== JSON.stringify(permissions.deny) ||
    JSON.stringify(ask) !== JSON.stringify(permissions.ask)

  const handleSave = useCallback(async () => {
    setError('')
    try {
      await onSave({ ...permissions, approval_mode: mode, allow, deny, ask })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }, [permissions, mode, allow, deny, ask, onSave])

  const handleDiscard = useCallback(() => {
    setMode(permissions.approval_mode)
    setAllow(permissions.allow)
    setDeny(permissions.deny)
    setAsk(permissions.ask)
    setError('')
  }, [permissions])

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

  const inheritedPerms = globalPermissions ?? EMPTY_PERMS
  const fieldInheritedArray = (field: 'allow' | 'deny' | 'ask') =>
    scope === 'PROJECT' && (permissions[field]?.length ?? 0) === 0 && (inheritedPerms[field]?.length ?? 0) > 0

  const fieldInheritedMode = scope === 'PROJECT'
    && (!permissions.approval_mode || permissions.approval_mode === 'default')
    && !!inheritedPerms.approval_mode

  const setFromGlobalArray = (field: 'allow' | 'deny' | 'ask', setter: (v: string[]) => void) => {
    setter([...(inheritedPerms[field] ?? [])])
  }

  const setModeFromGlobal = () => {
    setMode(inheritedPerms.approval_mode || 'default')
  }

  const eyebrow = scope === 'GLOBAL' ? 'Global / Permissions' : `${projectName ?? 'Project'} / Permissions`
  const sub = provider === 'claude' || provider === '8gent'
    ? 'Writes to .claude/settings.json :: permissions'
    : 'Control which tools this provider can use'

  const renderList = (
    label: string,
    description: string,
    field: 'allow' | 'deny' | 'ask',
    items: string[],
    setItems: (v: string[]) => void,
    newValue: string,
    setNewValue: (v: string) => void,
  ) => (
    <div className="space-y-1.5">
      <label className="text-[10px] uppercase tracking-wider text-foreground/45">{label}</label>
      <p className="text-[10px] text-muted-foreground/50">{description}</p>
      <InheritedField
        inherited={fieldInheritedArray(field)}
        inheritedValue={(inheritedPerms[field] ?? []).join(', ') || '—'}
        onSetHere={() => setFromGlobalArray(field, setItems)}
      >
        <div>
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
      </InheritedField>
    </div>
  )

  const modeOptions = APPROVAL_MODES[provider] ?? APPROVAL_MODES.claude

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Permissions"
        sub={sub}
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Permission mode */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase tracking-wider text-foreground/45">Permission mode</label>
            <InheritedField
              inherited={fieldInheritedMode}
              inheritedValue={inheritedPerms.approval_mode || '—'}
              onSetHere={setModeFromGlobal}
            >
              <CustomDropdown
                className="w-full"
                value={mode}
                options={modeOptions}
                onChange={setMode}
                placeholder="Permission mode"
              />
            </InheritedField>
          </div>

          {renderList('Allow', 'Tools that are auto-approved without prompting', 'allow', allow, setAllow, newAllow, setNewAllow)}
          {renderList('Deny', 'Tools that are always blocked (takes precedence over allow)', 'deny', deny, setDeny, newDeny, setNewDeny)}
          {renderList('Ask', 'Tools that always prompt for confirmation', 'ask', ask, setAsk, newAsk, setNewAsk)}
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}
