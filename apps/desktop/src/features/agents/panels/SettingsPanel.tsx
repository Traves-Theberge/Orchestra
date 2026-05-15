// apps/desktop/src/features/agents/panels/SettingsPanel.tsx
import { useCallback, useId, useReducer, useState } from 'react'
import { Code, Settings2, Plus, X } from 'lucide-react'
import { Button } from '@ui/button'
import { Skeleton } from '@ui/skeleton'
import { CustomDropdown } from '@layout/shared/controls'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import { InheritedField } from '../components/InheritedField'
import type { Scope } from '../types'
import { usePublishDirty } from '../hooks/use-publish-dirty'

interface SettingsPanelProps {
  settings: Record<string, unknown>
  globalSettings: Record<string, unknown> | null
  scope: Scope
  projectName: string | null
  settingsPath: string
  settingsExists: boolean
  saving: string | null
  onSave: (settings: Record<string, unknown>) => Promise<void>
}

const MODEL_OPTIONS = [
  { value: 'sonnet', label: 'Sonnet (latest)' },
  { value: 'opus', label: 'Opus (latest)' },
  { value: 'haiku', label: 'Haiku (latest)' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-opus-4-6[1m]', label: 'Claude Opus 4.6 (1M context)' },
  { value: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

const PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'plan', label: 'Plan' },
  { value: 'auto', label: 'Auto' },
  { value: 'bypassPermissions', label: 'Bypass Permissions' },
]

const toggleTrackClasses = (on: boolean) =>
  `relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border/30 transition-colors ${on ? 'bg-primary' : 'bg-muted/20'}`
const toggleThumbClasses = (on: boolean) =>
  `pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`

const isPresent = (v: unknown) => v !== undefined && v !== null && v !== ''

type State = {
  mode: 'structured' | 'raw'
  local: Record<string, unknown>
  rawJson: string
  rawError: string | null
  error: string
  newEnvKey: string
  newEnvValue: string
}

type Action =
  | { type: 'reset'; settings: Record<string, unknown> }
  | { type: 'setMode'; value: 'structured' | 'raw' }
  | { type: 'setLocal'; value: Record<string, unknown> }
  | { type: 'setRawJson'; value: string }
  | { type: 'setRawError'; value: string | null }
  | { type: 'setError'; value: string }
  | { type: 'setNewEnvKey'; value: string }
  | { type: 'setNewEnvValue'; value: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return {
        ...state,
        local: action.settings,
        rawJson: JSON.stringify(action.settings, null, 2),
        rawError: null,
        error: '',
      }
    case 'setMode':
      return action.value === 'raw'
        ? { ...state, mode: action.value, rawJson: JSON.stringify(state.local, null, 2), rawError: null }
        : { ...state, mode: action.value }
    case 'setLocal':
      return { ...state, local: action.value }
    case 'setRawJson':
      return { ...state, rawJson: action.value, rawError: null }
    case 'setRawError':
      return { ...state, rawError: action.value }
    case 'setError':
      return { ...state, error: action.value }
    case 'setNewEnvKey':
      return { ...state, newEnvKey: action.value }
    case 'setNewEnvValue':
      return { ...state, newEnvValue: action.value }
    default:
      return state
  }
}

export function SettingsPanel(props: SettingsPanelProps) {
  return <SettingsPanelInner key={JSON.stringify(props.settings)} {...props} />
}

function SettingsPanelInner({
  settings,
  globalSettings,
  scope,
  projectName,
  settingsPath,
  settingsExists,
  saving,
  onSave,
}: SettingsPanelProps) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    mode: 'structured' as const,
    local: settings,
    rawJson: JSON.stringify(settings, null, 2),
    rawError: null,
    error: '',
    newEnvKey: '',
    newEnvValue: '',
  }))
  const { mode, local, rawJson, rawError, error, newEnvKey, newEnvValue } = state

  const isDirty = JSON.stringify(local) !== JSON.stringify(settings)
  const isRawDirty = mode === 'raw' && rawJson !== JSON.stringify(settings, null, 2)
  const showDirty = mode === 'structured' ? isDirty : isRawDirty
  usePublishDirty(showDirty)

  const handleDiscard = useCallback(() => {
    dispatch({ type: 'reset', settings })
  }, [settings])

  const handleSave = useCallback(async () => {
    dispatch({ type: 'setError', value: '' })
    try {
      if (mode === 'raw') {
        let parsed: unknown
        try {
          parsed = JSON.parse(rawJson)
        } catch {
          dispatch({ type: 'setRawError', value: 'Invalid JSON' })
          return
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          dispatch({ type: 'setRawError', value: 'Settings must be a JSON object' })
          return
        }
        await onSave(parsed as Record<string, unknown>)
        dispatch({ type: 'setLocal', value: parsed as Record<string, unknown> })
        dispatch({ type: 'setRawError', value: null })
      } else {
        await onSave(local)
      }
    } catch (e) {
      dispatch({ type: 'setError', value: e instanceof Error ? e.message : 'Failed to save' })
    }
  }, [mode, rawJson, local, onSave])

  const updateField = useCallback((key: string, value: unknown) => {
    dispatch({ type: 'setLocal', value: { ...local, [key]: value } })
  }, [local])

  const removePlugin = useCallback((plugin: string) => {
    const raw = local.enabledPlugins
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const obj = { ...(raw as Record<string, unknown>) }
      delete obj[plugin]
      dispatch({ type: 'setLocal', value: { ...local, enabledPlugins: Object.keys(obj).length > 0 ? obj : undefined } })
      return
    }
    const arr = Array.isArray(raw) ? (raw as string[]).filter(p => p !== plugin) : []
    dispatch({ type: 'setLocal', value: { ...local, enabledPlugins: arr.length > 0 ? arr : undefined } })
  }, [local])

  const envObj = (typeof local.env === 'object' && local.env !== null && !Array.isArray(local.env))
    ? local.env as Record<string, string>
    : {}

  const handleAddEnv = useCallback(() => {
    if (!newEnvKey.trim()) return
    const updated = { ...envObj, [newEnvKey.trim()]: newEnvValue }
    dispatch({ type: 'setLocal', value: { ...local, env: updated } })
    dispatch({ type: 'setNewEnvKey', value: '' })
    dispatch({ type: 'setNewEnvValue', value: '' })
  }, [newEnvKey, newEnvValue, envObj, local])

  const handleRemoveEnv = useCallback((key: string) => {
    const { [key]: _, ...rest } = envObj
    dispatch({ type: 'setLocal', value: { ...local, env: Object.keys(rest).length > 0 ? rest : undefined } })
  }, [envObj, local])

  const handleEnvValueChange = useCallback((key: string, value: string) => {
    dispatch({ type: 'setLocal', value: { ...local, env: { ...envObj, [key]: value } } })
  }, [envObj, local])

  const fieldInherited = (key: string) =>
    scope === 'PROJECT' && !isPresent(local[key])

  const inheritedValueString = (key: string): string => {
    const v = globalSettings?.[key]
    if (v === undefined || v === null || v === '') return '—'
    if (typeof v === 'boolean') return v ? 'on' : 'off'
    return String(v)
  }

  const setFromGlobal = (key: string) => {
    const v = globalSettings?.[key]
    dispatch({ type: 'setLocal', value: { ...local, [key]: v ?? '' } })
  }

  if (!settingsExists && Object.keys(settings).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/30">
        <Settings2 size={32} />
        <p className="text-sm font-bold uppercase tracking-widest">No settings file found</p>
        <p className="text-[10px] text-muted-foreground/20">{settingsPath}</p>
        <Button
          size="sm"
          onClick={() => onSave({})}
          disabled={!!saving}
          className="h-7 bg-primary text-primary-foreground font-bold uppercase text-[10px] px-4 rounded-lg mt-2"
        >
          Create File
        </Button>
      </div>
    )
  }

  if (saving === 'loading') {
    return <div className="p-6 space-y-3"><Skeleton className="h-6 w-48" /><Skeleton className="h-[300px] w-full" /></div>
  }

  const rawPlugins = local.enabledPlugins
  const plugins: string[] = Array.isArray(rawPlugins)
    ? (rawPlugins as string[])
    : (typeof rawPlugins === 'object' && rawPlugins !== null)
      ? collectEnabledPluginKeys(rawPlugins as Record<string, unknown>)
      : []

  const eyebrow = scope === 'GLOBAL' ? 'Global / Settings' : `${projectName ?? 'Project'} / Settings`
  const title = scope === 'GLOBAL' ? 'Global settings' : `Project settings · ${projectName ?? ''}`

  const modeToggle = (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => dispatch({ type: 'setMode', value: mode === 'structured' ? 'raw' : 'structured' })}
      className="h-7 text-[10px] gap-1.5"
    >
      {mode === 'structured' ? <Code size={10} /> : <Settings2 size={10} />}
      {mode === 'structured' ? 'Raw JSON' : 'Structured'}
    </Button>
  )

  return (
    <div className="flex flex-col h-full p-[18px] gap-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title={title}
        sub={`Writes to ${settingsPath}`}
        dirty={showDirty}
        rightSlot={modeToggle}
      />

      {mode === 'raw' ? (
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          <textarea
            value={rawJson}
            onChange={(e) => dispatch({ type: 'setRawJson', value: e.target.value })}
            className="flex-1 min-h-0 bg-muted/10 rounded-lg border border-border/30 px-4 py-3 font-mono text-[13px] leading-6 text-foreground focus:outline-none focus:border-primary/30 resize-none transition-colors"
            spellCheck={false}
          />
          {rawError && <p className="text-[10px] text-red-400 font-mono">{rawError}</p>}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="max-w-2xl mx-auto space-y-6">
            <ModelBehaviorSection
              local={local}
              fieldInherited={fieldInherited}
              inheritedValueString={inheritedValueString}
              setFromGlobal={setFromGlobal}
              updateField={updateField}
            />

            <PluginsSection plugins={plugins} onRemovePlugin={removePlugin} />

            <PermissionsSection local={local} updateField={updateField} />

            <EnvSection
              envObj={envObj}
              newEnvKey={newEnvKey}
              newEnvValue={newEnvValue}
              setNewEnvKey={(v) => dispatch({ type: 'setNewEnvKey', value: v })}
              setNewEnvValue={(v) => dispatch({ type: 'setNewEnvValue', value: v })}
              onAddEnv={handleAddEnv}
              onRemoveEnv={handleRemoveEnv}
              onEnvValueChange={handleEnvValueChange}
            />
          </div>
        </div>
      )}

      <ErrorStrip message={error} onDismiss={() => dispatch({ type: 'setError', value: '' })} />

      <PanelFooter
        dirty={showDirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}

function collectEnabledPluginKeys(obj: Record<string, unknown>): string[] {
  const result: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === true) result.push(k)
  }
  return result
}

/* ------------------------------------------------------------------ */
/*  Section subcomponents                                              */
/* ------------------------------------------------------------------ */

function ModelBehaviorSection({
  local, fieldInherited, inheritedValueString, setFromGlobal, updateField,
}: {
  local: Record<string, unknown>
  fieldInherited: (key: string) => boolean
  inheritedValueString: (key: string) => string
  setFromGlobal: (key: string) => void
  updateField: (key: string, value: unknown) => void
}) {
  const modelId = useId()
  const permModeId = useId()
  const thinkingId = useId()
  const voiceId = useId()

  return (
    <section className="space-y-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">Model & Behavior</h4>

      <div className="space-y-1.5">
        <span id={modelId} className="text-[10px] uppercase tracking-wider text-foreground/45">Model</span>
        <InheritedField
          inherited={fieldInherited('model')}
          inheritedValue={inheritedValueString('model')}
          onSetHere={() => setFromGlobal('model')}
        >
          <div aria-labelledby={modelId}>
            <CustomDropdown
              className="w-full"
              value={(local.model as string) ?? ''}
              options={[{ label: 'Default', value: '' }, ...MODEL_OPTIONS]}
              onChange={(val) => updateField('model', val || undefined)}
              placeholder="Select model"
            />
          </div>
        </InheritedField>
      </div>

      <div className="space-y-1.5">
        <span id={permModeId} className="text-[10px] uppercase tracking-wider text-foreground/45">Permission Mode</span>
        <InheritedField
          inherited={fieldInherited('permissionMode')}
          inheritedValue={inheritedValueString('permissionMode')}
          onSetHere={() => setFromGlobal('permissionMode')}
        >
          <div aria-labelledby={permModeId}>
            <CustomDropdown
              className="w-full"
              value={(local.permissionMode as string) ?? 'default'}
              options={PERMISSION_MODE_OPTIONS}
              onChange={(val) => updateField('permissionMode', val === 'default' ? undefined : val)}
              placeholder="Permission mode"
            />
          </div>
        </InheritedField>
      </div>

      <div className="space-y-1.5">
        <span id={thinkingId} className="text-[10px] uppercase tracking-wider text-foreground/45">Always Thinking</span>
        <InheritedField
          inherited={fieldInherited('alwaysThinkingEnabled')}
          inheritedValue={inheritedValueString('alwaysThinkingEnabled')}
          onSetHere={() => setFromGlobal('alwaysThinkingEnabled')}
        >
          <div className="flex items-center h-9 px-3 rounded-md border border-border/40 bg-background">
            <button
              type="button"
              aria-labelledby={thinkingId}
              onClick={() => updateField('alwaysThinkingEnabled', !local.alwaysThinkingEnabled)}
              className={toggleTrackClasses(!!local.alwaysThinkingEnabled)}
            >
              <span className={toggleThumbClasses(!!local.alwaysThinkingEnabled)} />
            </button>
            <span className="ml-3 text-[11px] text-foreground/70">
              {local.alwaysThinkingEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </InheritedField>
      </div>

      <div className="space-y-1.5">
        <span id={voiceId} className="text-[10px] uppercase tracking-wider text-foreground/45">Voice Input</span>
        <InheritedField
          inherited={fieldInherited('voiceEnabled')}
          inheritedValue={inheritedValueString('voiceEnabled')}
          onSetHere={() => setFromGlobal('voiceEnabled')}
        >
          <div className="flex items-center h-9 px-3 rounded-md border border-border/40 bg-background">
            <button
              type="button"
              aria-labelledby={voiceId}
              onClick={() => updateField('voiceEnabled', !local.voiceEnabled)}
              className={toggleTrackClasses(!!local.voiceEnabled)}
            >
              <span className={toggleThumbClasses(!!local.voiceEnabled)} />
            </button>
            <span className="ml-3 text-[11px] text-foreground/70">
              {local.voiceEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </InheritedField>
      </div>
    </section>
  )
}

function PluginsSection({ plugins, onRemovePlugin }: { plugins: string[]; onRemovePlugin: (p: string) => void }) {
  return (
    <section className="space-y-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">Plugins</h4>
      {plugins.length === 0 ? (
        <p className="text-[10px] text-muted-foreground/20">No plugins enabled</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {plugins.map(plugin => (
            <span
              key={plugin}
              className="inline-flex items-center gap-1 rounded-md bg-muted/10 border border-border/30 px-2 py-0.5 text-[10px] font-mono text-foreground/70"
            >
              {plugin}
              <button
                onClick={() => onRemovePlugin(plugin)}
                className="ml-0.5 rounded hover:bg-red-500/10 hover:text-red-400 transition-colors p-0.5"
              >
                <X size={8} />
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function EnvSection({
  envObj, newEnvKey, newEnvValue, setNewEnvKey, setNewEnvValue,
  onAddEnv, onRemoveEnv, onEnvValueChange,
}: {
  envObj: Record<string, string>
  newEnvKey: string
  newEnvValue: string
  setNewEnvKey: (v: string) => void
  setNewEnvValue: (v: string) => void
  onAddEnv: () => void
  onRemoveEnv: (key: string) => void
  onEnvValueChange: (key: string, value: string) => void
}) {
  return (
    <section className="space-y-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">Environment Variables</h4>

      {Object.keys(envObj).length === 0 && (
        <p className="text-[10px] text-muted-foreground/20">No environment variables set</p>
      )}

      <div className="space-y-1.5">
        {Object.entries(envObj).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2 group">
            <span className="text-[10px] font-mono font-bold text-primary/70 shrink-0 w-[140px] truncate">{key}</span>
            <input
              type="text"
              value={value}
              onChange={(e) => onEnvValueChange(key, e.target.value)}
              className="flex-1 h-7 bg-muted/10 rounded-lg border border-border/30 px-3 font-mono text-[11px] text-foreground focus:outline-none focus:border-primary/30 transition-colors"
            />
            <button
              onClick={() => onRemoveEnv(key)}
              className="size-5 rounded flex items-center justify-center text-muted-foreground/20 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 shrink-0"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="KEY"
          value={newEnvKey}
          onChange={(e) => setNewEnvKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddEnv()}
          className="w-[140px] h-7 bg-muted/10 rounded-lg border border-border/30 px-3 font-mono text-[10px] text-foreground placeholder:text-muted-foreground/20 focus:outline-none focus:border-primary/30 transition-colors"
        />
        <input
          type="text"
          placeholder="value"
          value={newEnvValue}
          onChange={(e) => setNewEnvValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddEnv()}
          className="flex-1 h-7 bg-muted/10 rounded-lg border border-border/30 px-3 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/20 focus:outline-none focus:border-primary/30 transition-colors"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={onAddEnv}
          disabled={!newEnvKey.trim()}
          className="h-7 size-7 p-0 shrink-0"
        >
          <Plus size={12} />
        </Button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Permissions Section                                                */
/* ------------------------------------------------------------------ */

type PermsListItem = { label: string; description: string; field: 'allow' | 'deny' | 'ask' }

const PERMS_LISTS: PermsListItem[] = [
  { label: 'Allow', description: 'Auto-approved without prompting', field: 'allow' },
  { label: 'Deny', description: 'Always blocked (takes precedence)', field: 'deny' },
  { label: 'Ask', description: 'Always prompt for confirmation', field: 'ask' },
]

function PermissionsSection({ local, updateField }: { local: Record<string, unknown>; updateField: (key: string, value: unknown) => void }) {
  const [newValues, setNewValues] = useState<{ allow: string; deny: string; ask: string }>({
    allow: '',
    deny: '',
    ask: '',
  })

  const permsObj = (typeof local.permissions === 'object' && local.permissions !== null && !Array.isArray(local.permissions))
    ? local.permissions as Record<string, unknown>
    : {}

  const update = (field: string, list: string[]) => {
    updateField('permissions', { ...permsObj, [field]: list })
  }

  const addTo = (field: 'allow' | 'deny' | 'ask', list: string[]) => {
    const v = newValues[field].trim()
    if (v && !list.includes(v)) {
      update(field, [...list, v])
      setNewValues(prev => ({ ...prev, [field]: '' }))
    }
  }

  const removeFrom = (field: 'allow' | 'deny' | 'ask', list: string[], index: number) => {
    update(field, list.filter((_, i) => i !== index))
  }

  return (
    <section className="space-y-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">Permissions</h4>
      <div className="space-y-4">
        {PERMS_LISTS.map(meta => {
          const items = Array.isArray(permsObj[meta.field]) ? (permsObj[meta.field] as string[]) : []
          return (
            <PermissionsListBlock
              key={meta.field}
              label={meta.label}
              description={meta.description}
              field={meta.field}
              items={items}
              newValue={newValues[meta.field]}
              setNewValue={(v) => setNewValues(prev => ({ ...prev, [meta.field]: v }))}
              onAdd={() => addTo(meta.field, items)}
              onRemove={(idx) => removeFrom(meta.field, items, idx)}
            />
          )
        })}
      </div>
    </section>
  )
}

function PermissionsListBlock({
  label, description, items, newValue, setNewValue, onAdd, onRemove,
}: {
  label: string
  description: string
  field: 'allow' | 'deny' | 'ask'
  items: string[]
  newValue: string
  setNewValue: (v: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  const inputId = useId()
  return (
    <div>
      <h5 id={inputId} className="text-[11px] font-semibold mb-0.5">{label}</h5>
      <p className="text-[10px] text-muted-foreground/40 mb-2">{description}</p>
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
          aria-labelledby={inputId}
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
