// apps/desktop/src/features/agents/panels/PermissionsPanel.tsx
import { useCallback, useId, useReducer, useState } from 'react'
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

const EMPTY_PERMS: ProviderPermissions = { approval_mode: 'default', allow: [], deny: [], ask: [] }

interface PermissionsPanelProps {
  permissions: ProviderPermissions
  globalPermissions?: ProviderPermissions | null
  scope?: Scope
  projectName?: string | null
  saving: string | null
  onSave: (perms: ProviderPermissions) => Promise<void>
  provider: Provider
}

type Field = 'allow' | 'deny' | 'ask'

interface FormState {
  approval_mode: string
  allow: string[]
  deny: string[]
  ask: string[]
}

type FormAction =
  | { type: 'reset'; perms: ProviderPermissions }
  | { type: 'set_mode'; mode: string }
  | { type: 'set_list'; field: Field; list: string[] }
  | { type: 'add_to'; field: Field; value: string }
  | { type: 'remove_at'; field: Field; index: number }

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'reset':
      return {
        approval_mode: action.perms.approval_mode,
        allow: action.perms.allow,
        deny: action.perms.deny,
        ask: action.perms.ask,
      }
    case 'set_mode':
      return { ...state, approval_mode: action.mode }
    case 'set_list':
      return { ...state, [action.field]: action.list }
    case 'add_to': {
      const v = action.value.trim()
      if (!v || state[action.field].includes(v)) return state
      return { ...state, [action.field]: [...state[action.field], v] }
    }
    case 'remove_at':
      return { ...state, [action.field]: state[action.field].filter((_, i) => i !== action.index) }
    default:
      return state
  }
}

function initForm(perms: ProviderPermissions): FormState {
  return {
    approval_mode: perms.approval_mode,
    allow: perms.allow,
    deny: perms.deny,
    ask: perms.ask,
  }
}

interface PermissionListProps {
  label: string
  description: string
  field: Field
  items: string[]
  newValue: string
  setNewValue: (v: string) => void
  inputId: string
  inherited: boolean
  inheritedValue: string
  onSetHere: () => void
  onAdd: (field: Field, value: string) => void
  onRemove: (field: Field, index: number) => void
}

function PermissionList({
  label,
  description,
  field,
  items,
  newValue,
  setNewValue,
  inputId,
  inherited,
  inheritedValue,
  onSetHere,
  onAdd,
  onRemove,
}: PermissionListProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="text-[10px] uppercase tracking-wider text-foreground/45">{label}</label>
      <p className="text-[10px] text-muted-foreground/50">{description}</p>
      <InheritedField
        inherited={inherited}
        inheritedValue={inheritedValue}
        onSetHere={onSetHere}
      >
        <div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {items.map((item, i) => (
              <span key={`${item}#${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/30 border border-border/30 text-[11px] font-mono">
                {item}
                <button onClick={() => onRemove(field, i)} className="text-muted-foreground/40 hover:text-red-400">
                  <X size={10} />
                </button>
              </span>
            ))}
            {items.length === 0 && <span className="text-[10px] text-muted-foreground/30 italic">None</span>}
          </div>
          <div className="flex gap-1.5">
            <input
              id={inputId}
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  onAdd(field, newValue)
                  setNewValue('')
                }
              }}
              placeholder="e.g. Bash(npm run build)"
              className="flex-1 px-2 py-1 rounded-md bg-muted/10 border border-border/30 text-[11px] font-mono focus:outline-none focus:border-primary/30"
            />
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => {
              onAdd(field, newValue)
              setNewValue('')
            }}>
              <Plus size={10} />
            </Button>
          </div>
        </div>
      </InheritedField>
    </div>
  )
}

export function PermissionsPanel(props: PermissionsPanelProps) {
  const signature = JSON.stringify(props.permissions)
  return <PermissionsPanelInner key={`${props.scope ?? 'GLOBAL'}:${signature}`} {...props} />
}

function PermissionsPanelInner({
  permissions, globalPermissions, scope = 'GLOBAL', projectName = null,
  saving, onSave, provider,
}: PermissionsPanelProps) {
  const [form, dispatch] = useReducer(formReducer, permissions, initForm)
  const [newAllow, setNewAllow] = useState('')
  const [newDeny, setNewDeny] = useState('')
  const [newAsk, setNewAsk] = useState('')
  const [error, setError] = useState('')
  const modeLabelId = useId()
  const allowInputId = useId()
  const denyInputId = useId()
  const askInputId = useId()

  const isDirty = form.approval_mode !== permissions.approval_mode ||
    JSON.stringify(form.allow) !== JSON.stringify(permissions.allow) ||
    JSON.stringify(form.deny) !== JSON.stringify(permissions.deny) ||
    JSON.stringify(form.ask) !== JSON.stringify(permissions.ask)

  const handleSave = useCallback(async () => {
    setError('')
    try {
      await onSave({
        ...permissions,
        approval_mode: form.approval_mode,
        allow: form.allow,
        deny: form.deny,
        ask: form.ask,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }, [permissions, form, onSave])

  const handleDiscard = useCallback(() => {
    dispatch({ type: 'reset', perms: permissions })
    setError('')
  }, [permissions])

  const inheritedPerms = globalPermissions ?? EMPTY_PERMS
  const fieldInheritedArray = (field: Field) =>
    scope === 'PROJECT' && (permissions[field]?.length ?? 0) === 0 && (inheritedPerms[field]?.length ?? 0) > 0

  const fieldInheritedMode = scope === 'PROJECT'
    && (!permissions.approval_mode || permissions.approval_mode === 'default')
    && !!inheritedPerms.approval_mode

  const setFromGlobalArray = (field: Field) => {
    dispatch({ type: 'set_list', field, list: [...(inheritedPerms[field] ?? [])] })
  }

  const setModeFromGlobal = () => {
    dispatch({ type: 'set_mode', mode: inheritedPerms.approval_mode || 'default' })
  }

  const eyebrow = scope === 'GLOBAL' ? 'Global / Permissions' : `${projectName ?? 'Project'} / Permissions`
  const sub = provider === 'claude' || provider === '8gent'
    ? 'Writes to .claude/settings.json :: permissions'
    : 'Control which tools this provider can use'

  const handleAdd = useCallback((field: Field, value: string) => {
    dispatch({ type: 'add_to', field, value })
  }, [])

  const handleRemove = useCallback((field: Field, index: number) => {
    dispatch({ type: 'remove_at', field, index })
  }, [])

  const modeOptions = APPROVAL_MODES[provider] ?? APPROVAL_MODES.claude

  return (
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Permissions"
        sub={sub}
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="space-y-1.5">
            <span id={modeLabelId} className="text-[10px] uppercase tracking-wider text-foreground/45">Permission mode</span>
            <InheritedField
              inherited={fieldInheritedMode}
              inheritedValue={inheritedPerms.approval_mode || '—'}
              onSetHere={setModeFromGlobal}
            >
              <div aria-labelledby={modeLabelId}>
                <CustomDropdown
                  className="w-full"
                  value={form.approval_mode}
                  options={modeOptions}
                  onChange={(mode) => dispatch({ type: 'set_mode', mode })}
                  placeholder="Permission mode"
                />
              </div>
            </InheritedField>
          </div>

          <PermissionList
            label="Allow"
            description="Tools that are auto-approved without prompting"
            field="allow"
            items={form.allow}
            newValue={newAllow}
            setNewValue={setNewAllow}
            inputId={allowInputId}
            inherited={fieldInheritedArray('allow')}
            inheritedValue={(inheritedPerms.allow ?? []).join(', ') || '—'}
            onSetHere={() => setFromGlobalArray('allow')}
            onAdd={handleAdd}
            onRemove={handleRemove}
          />
          <PermissionList
            label="Deny"
            description="Tools that are always blocked (takes precedence over allow)"
            field="deny"
            items={form.deny}
            newValue={newDeny}
            setNewValue={setNewDeny}
            inputId={denyInputId}
            inherited={fieldInheritedArray('deny')}
            inheritedValue={(inheritedPerms.deny ?? []).join(', ') || '—'}
            onSetHere={() => setFromGlobalArray('deny')}
            onAdd={handleAdd}
            onRemove={handleRemove}
          />
          <PermissionList
            label="Ask"
            description="Tools that always prompt for confirmation"
            field="ask"
            items={form.ask}
            newValue={newAsk}
            setNewValue={setNewAsk}
            inputId={askInputId}
            inherited={fieldInheritedArray('ask')}
            inheritedValue={(inheritedPerms.ask ?? []).join(', ') || '—'}
            onSetHere={() => setFromGlobalArray('ask')}
            onAdd={handleAdd}
            onRemove={handleRemove}
          />
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
