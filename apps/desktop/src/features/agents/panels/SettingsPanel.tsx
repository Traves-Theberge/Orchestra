// apps/desktop/src/features/agents/panels/SettingsPanel.tsx
import { useCallback, useReducer, useState } from 'react'
import { Code, Settings2, X } from 'lucide-react'
import { Button } from '@ui/button'
import { Skeleton } from '@ui/skeleton'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'
import { usePublishDirty } from '../hooks/use-publish-dirty'
import { ModelBehaviorSection } from './settings-sections/ModelBehaviorSection'
import { EnvVariablesSection } from './settings-sections/EnvVariablesSection'
import { PermissionsSection } from './settings-sections/PermissionsSection'

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

const isPresent = (v: unknown) => v !== undefined && v !== null && v !== ''

interface FormState {
  mode: 'structured' | 'raw'
  local: Record<string, unknown>
  rawJson: string
  rawError: string | null
}

type FormAction =
  | { type: 'reset'; settings: Record<string, unknown> }
  | { type: 'toggle_mode' }
  | { type: 'set_local'; local: Record<string, unknown> }
  | { type: 'set_raw'; raw: string }
  | { type: 'set_raw_error'; error: string | null }

function makeInitial(settings: Record<string, unknown>): FormState {
  return {
    mode: 'structured',
    local: settings,
    rawJson: JSON.stringify(settings, null, 2),
    rawError: null,
  }
}

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'reset':
      return {
        mode: state.mode,
        local: action.settings,
        rawJson: JSON.stringify(action.settings, null, 2),
        rawError: null,
      }
    case 'toggle_mode': {
      const nextMode = state.mode === 'structured' ? 'raw' : 'structured'
      if (nextMode === 'raw') {
        return { ...state, mode: nextMode, rawJson: JSON.stringify(state.local, null, 2), rawError: null }
      }
      return { ...state, mode: nextMode }
    }
    case 'set_local':
      return { ...state, local: action.local }
    case 'set_raw':
      return { ...state, rawJson: action.raw, rawError: null }
    case 'set_raw_error':
      return { ...state, rawError: action.error }
    default:
      return state
  }
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { settings, settingsExists, settingsPath, saving, onSave } = props
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

  return <SettingsForm key={JSON.stringify(settings)} {...props} />
}

function SettingsForm({
  settings,
  globalSettings,
  scope,
  projectName,
  settingsPath,
  saving,
  onSave,
}: SettingsPanelProps) {
  const [form, dispatch] = useReducer(formReducer, settings, makeInitial)
  const [error, setError] = useState('')

  const { mode, local, rawJson, rawError } = form

  const isDirty = JSON.stringify(local) !== JSON.stringify(settings)
  const isRawDirty = mode === 'raw' && rawJson !== JSON.stringify(settings, null, 2)
  const showDirty = mode === 'structured' ? isDirty : isRawDirty
  usePublishDirty(showDirty)

  const handleDiscard = useCallback(() => {
    dispatch({ type: 'reset', settings })
    setError('')
  }, [settings])

  const handleSave = useCallback(async () => {
    setError('')
    try {
      if (mode === 'raw') {
        let parsed: unknown
        try {
          parsed = JSON.parse(rawJson)
        } catch {
          dispatch({ type: 'set_raw_error', error: 'Invalid JSON' })
          return
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          dispatch({ type: 'set_raw_error', error: 'Settings must be a JSON object' })
          return
        }
        await onSave(parsed as Record<string, unknown>)
        dispatch({ type: 'set_local', local: parsed as Record<string, unknown> })
        dispatch({ type: 'set_raw_error', error: null })
      } else {
        await onSave(local)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }, [mode, rawJson, local, onSave])

  const updateField = useCallback((key: string, value: unknown) => {
    dispatch({ type: 'set_local', local: { ...local, [key]: value } })
  }, [local])

  const removePlugin = useCallback((plugin: string) => {
    const raw = local.enabledPlugins
    let next: unknown
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const obj = { ...(raw as Record<string, unknown>) }
      delete obj[plugin]
      next = Object.keys(obj).length > 0 ? obj : undefined
    } else if (Array.isArray(raw)) {
      const arr = (raw as string[]).filter(p => p !== plugin)
      next = arr.length > 0 ? arr : undefined
    } else {
      next = undefined
    }
    dispatch({ type: 'set_local', local: { ...local, enabledPlugins: next } })
  }, [local])

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
    dispatch({ type: 'set_local', local: { ...local, [key]: v ?? '' } })
  }

  const rawPlugins = local.enabledPlugins
  const plugins: string[] = Array.isArray(rawPlugins)
    ? (rawPlugins as string[])
    : (typeof rawPlugins === 'object' && rawPlugins !== null)
      ? Object.entries(rawPlugins as Record<string, unknown>).flatMap(([k, v]) => v === true ? [k] : [])
      : []

  const eyebrow = scope === 'GLOBAL' ? 'Global / Settings' : `${projectName ?? 'Project'} / Settings`
  const title = scope === 'GLOBAL' ? 'Global settings' : `Project settings · ${projectName ?? ''}`

  const modeToggle = (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => dispatch({ type: 'toggle_mode' })}
      className="h-7 text-[10px] gap-1.5"
    >
      {mode === 'structured' ? <Code size={10} /> : <Settings2 size={10} />}
      {mode === 'structured' ? 'Raw JSON' : 'Structured'}
    </Button>
  )

  return (
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
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
            onChange={(e) => dispatch({ type: 'set_raw', raw: e.target.value })}
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
              updateField={updateField}
              fieldInherited={fieldInherited}
              inheritedValueString={inheritedValueString}
              setFromGlobal={setFromGlobal}
            />

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
                        onClick={() => removePlugin(plugin)}
                        className="ml-0.5 rounded hover:bg-red-500/10 hover:text-red-400 transition-colors p-0.5"
                      >
                        <X size={8} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </section>

            <PermissionsSection local={local} updateField={updateField} />

            <EnvVariablesSection local={local} updateField={updateField} />
          </div>
        </div>
      )}

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={showDirty}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}
