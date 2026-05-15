// apps/desktop/src/features/agents/panels/PermissionsPanel.tsx
import { useCallback, useId, useReducer } from 'react'
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

type ListField = 'allow' | 'deny' | 'ask'

type State = {
  mode: ProviderPermissions['approval_mode']
  allow: string[]
  deny: string[]
  ask: string[]
  newAllow: string
  newDeny: string
  newAsk: string
  error: string
}

type Action =
  | { type: 'reset'; perms: ProviderPermissions }
  | { type: 'setMode'; value: ProviderPermissions['approval_mode'] }
  | { type: 'setList'; field: ListField; value: string[] }
  | { type: 'setNew'; field: ListField; value: string }
  | { type: 'addTo'; field: ListField }
  | { type: 'removeAt'; field: ListField; index: number }
  | { type: 'setError'; value: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return {
        mode: action.perms.approval_mode,
        allow: action.perms.allow,
        deny: action.perms.deny,
        ask: action.perms.ask,
        newAllow: '',
        newDeny: '',
        newAsk: '',
        error: '',
      }
    case 'setMode':
      return { ...state, mode: action.value }
    case 'setList':
      return { ...state, [action.field]: action.value }
    case 'setNew': {
      const key = action.field === 'allow' ? 'newAllow' : action.field === 'deny' ? 'newDeny' : 'newAsk'
      return { ...state, [key]: action.value }
    }
    case 'addTo': {
      const list = state[action.field]
      const newKey = action.field === 'allow' ? 'newAllow' : action.field === 'deny' ? 'newDeny' : 'newAsk'
      const v = (state[newKey] as string).trim()
      if (!v || list.includes(v)) return state
      return { ...state, [action.field]: [...list, v], [newKey]: '' }
    }
    case 'removeAt': {
      const list = state[action.field]
      return { ...state, [action.field]: list.filter((_, i) => i !== action.index) }
    }
    case 'setError':
      return { ...state, error: action.value }
    default:
      return state
  }
}

type RenderListProps = {
  label: string
  description: string
  field: ListField
  items: string[]
  newValue: string
  onChangeNew: (v: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
  inheritedFlag: boolean
  inheritedValue: string
  onSetFromGlobal: () => void
  labelId: string
}

function RenderList({
  label, description, items, newValue, onChangeNew, onAdd, onRemove,
  inheritedFlag, inheritedValue, onSetFromGlobal, labelId,
}: RenderListProps) {
  return (
    <div className="space-y-1.5">
      <span id={labelId} className="text-[10px] uppercase tracking-wider text-foreground/45">{label}</span>
      <p className="text-[10px] text-muted-foreground/50">{description}</p>
      <InheritedField
        inherited={inheritedFlag}
        inheritedValue={inheritedValue}
        onSetHere={onSetFromGlobal}
      >
        <div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {items.map((item, i) => (
              <span key={item} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/30 border border-border/30 text-[11px] font-mono">
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
              aria-labelledby={labelId}
              value={newValue}
              onChange={e => onChangeNew(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onAdd()}
              placeholder="e.g. Bash(npm run build)"
              className="flex-1 px-2 py-1 rounded-md bg-muted/10 border border-border/30 text-[11px] font-mono focus:outline-none focus:border-primary/30"
            />
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onAdd}>
              <Plus size={10} />
            </Button>
          </div>
        </div>
      </InheritedField>
    </div>
  )
}

export function PermissionsPanel({
  permissions, globalPermissions, scope = 'GLOBAL', projectName = null,
  saving, onSave, provider,
}: PermissionsPanelProps) {
  return (
    <PermissionsPanelInner
      key={JSON.stringify(permissions)}
      permissions={permissions}
      globalPermissions={globalPermissions}
      scope={scope}
      projectName={projectName}
      saving={saving}
      onSave={onSave}
      provider={provider}
    />
  )
}

function PermissionsPanelInner({
  permissions, globalPermissions, scope, projectName, saving, onSave, provider,
}: Omit<PermissionsPanelProps, 'scope' | 'projectName'> & {
  scope: Scope
  projectName: string | null
}) {
  const modeId = useId()
  const allowLabelId = useId()
  const denyLabelId = useId()
  const askLabelId = useId()

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    mode: permissions.approval_mode,
    allow: permissions.allow,
    deny: permissions.deny,
    ask: permissions.ask,
    newAllow: '',
    newDeny: '',
    newAsk: '',
    error: '',
  }))

  const { mode, allow, deny, ask, newAllow, newDeny, newAsk, error } = state

  const isDirty = mode !== permissions.approval_mode ||
    JSON.stringify(allow) !== JSON.stringify(permissions.allow) ||
    JSON.stringify(deny) !== JSON.stringify(permissions.deny) ||
    JSON.stringify(ask) !== JSON.stringify(permissions.ask)

  const handleSave = useCallback(async () => {
    dispatch({ type: 'setError', value: '' })
    try {
      await onSave({ ...permissions, approval_mode: mode, allow, deny, ask })
    } catch (e) {
      dispatch({ type: 'setError', value: e instanceof Error ? e.message : 'Failed to save' })
    }
  }, [permissions, mode, allow, deny, ask, onSave])

  const handleDiscard = useCallback(() => {
    dispatch({ type: 'reset', perms: permissions })
  }, [permissions])

  const inheritedPerms = globalPermissions ?? EMPTY_PERMS
  const fieldInheritedArray = (field: ListField) =>
    scope === 'PROJECT' && (permissions[field]?.length ?? 0) === 0 && (inheritedPerms[field]?.length ?? 0) > 0

  const fieldInheritedMode = scope === 'PROJECT'
    && (!permissions.approval_mode || permissions.approval_mode === 'default')
    && !!inheritedPerms.approval_mode

  const setFromGlobalArray = (field: ListField) => {
    dispatch({ type: 'setList', field, value: [...(inheritedPerms[field] ?? [])] })
  }

  const setModeFromGlobal = () => {
    dispatch({ type: 'setMode', value: inheritedPerms.approval_mode || 'default' })
  }

  const eyebrow = scope === 'GLOBAL' ? 'Global / Permissions' : `${projectName ?? 'Project'} / Permissions`
  const sub = provider === 'claude' || provider === '8gent'
    ? 'Writes to .claude/settings.json :: permissions'
    : 'Control which tools this provider can use'

  const modeOptions = APPROVAL_MODES[provider] ?? APPROVAL_MODES.claude

  return (
    <div className="flex flex-col h-full p-[18px] gap-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Permissions"
        sub={sub}
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="space-y-1.5">
            <span id={modeId} className="text-[10px] uppercase tracking-wider text-foreground/45">Permission mode</span>
            <InheritedField
              inherited={fieldInheritedMode}
              inheritedValue={inheritedPerms.approval_mode || '—'}
              onSetHere={setModeFromGlobal}
            >
              <div aria-labelledby={modeId}>
                <CustomDropdown
                  className="w-full"
                  value={mode}
                  options={modeOptions}
                  onChange={(v) => dispatch({ type: 'setMode', value: v })}
                  placeholder="Permission mode"
                />
              </div>
            </InheritedField>
          </div>

          <RenderList
            label="Allow"
            description="Tools that are auto-approved without prompting"
            field="allow"
            items={allow}
            newValue={newAllow}
            onChangeNew={(v) => dispatch({ type: 'setNew', field: 'allow', value: v })}
            onAdd={() => dispatch({ type: 'addTo', field: 'allow' })}
            onRemove={(i) => dispatch({ type: 'removeAt', field: 'allow', index: i })}
            inheritedFlag={fieldInheritedArray('allow')}
            inheritedValue={(inheritedPerms.allow ?? []).join(', ') || '—'}
            onSetFromGlobal={() => setFromGlobalArray('allow')}
            labelId={allowLabelId}
          />
          <RenderList
            label="Deny"
            description="Tools that are always blocked (takes precedence over allow)"
            field="deny"
            items={deny}
            newValue={newDeny}
            onChangeNew={(v) => dispatch({ type: 'setNew', field: 'deny', value: v })}
            onAdd={() => dispatch({ type: 'addTo', field: 'deny' })}
            onRemove={(i) => dispatch({ type: 'removeAt', field: 'deny', index: i })}
            inheritedFlag={fieldInheritedArray('deny')}
            inheritedValue={(inheritedPerms.deny ?? []).join(', ') || '—'}
            onSetFromGlobal={() => setFromGlobalArray('deny')}
            labelId={denyLabelId}
          />
          <RenderList
            label="Ask"
            description="Tools that always prompt for confirmation"
            field="ask"
            items={ask}
            newValue={newAsk}
            onChangeNew={(v) => dispatch({ type: 'setNew', field: 'ask', value: v })}
            onAdd={() => dispatch({ type: 'addTo', field: 'ask' })}
            onRemove={(i) => dispatch({ type: 'removeAt', field: 'ask', index: i })}
            inheritedFlag={fieldInheritedArray('ask')}
            inheritedValue={(inheritedPerms.ask ?? []).join(', ') || '—'}
            onSetFromGlobal={() => setFromGlobalArray('ask')}
            labelId={askLabelId}
          />
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => dispatch({ type: 'setError', value: '' })} />

      <PanelFooter
        dirty={isDirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}
