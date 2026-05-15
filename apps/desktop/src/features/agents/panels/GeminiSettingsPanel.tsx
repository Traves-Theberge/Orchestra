// apps/desktop/src/features/agents/panels/GeminiSettingsPanel.tsx
import { useMemo, useReducer, useState } from 'react'
import type { ReactNode } from 'react'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import { EmptyStateCard } from '../components/EmptyStateCard'
import type { Scope } from '../types'
import type { FileResourceItem } from './FileResourcePanel'

interface GeminiSettingsPanelProps {
  items: FileResourceItem[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onCreate: () => Promise<void>
}

interface SettingsState {
  preferredEditor: string
  vimMode: string
  disableAutoUpdate: string
  disableUpdateNag: string
  checkpointingEnabled: string
  outputFormat: string
  theme: string
  hideBanner: string
  hideTips: string
  hideFooter: string
  showLineNumbers: string
  showCitations: string
  telemetryEnabled: string
  telemetryTarget: string
  telemetryLogPrompts: string
  telemetryOutfile: string
}

type SettingsField = keyof SettingsState

type SettingsAction =
  | { type: 'setField', field: SettingsField, value: string }
  | { type: 'reset', state: SettingsState }

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'setField':
      return { ...state, [action.field]: action.value }
    case 'reset':
      return action.state
    default:
      return state
  }
}

export function GeminiSettingsPanel({ items, scope, projectName, saving, onSave, onCreate }: GeminiSettingsPanelProps) {
  const selected = items[0] ?? null
  const parsed = useMemo(() => safeParse(selected?.content ?? ''), [selected?.content])

  const eyebrow = scope === 'GLOBAL' ? 'Global / Gemini Settings' : `${projectName ?? 'Project'} / Gemini Settings`

  if (!selected) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Gemini settings"
          sub="Writes to .gemini/settings.json"
        />
        <EmptyStateCard
          title="No settings found"
          description="Gemini stores structured configuration in settings.json. Create that file for the selected scope to manage editor, UI, and telemetry settings here."
          ctaLabel="Create Settings"
          onCreate={() => { void onCreate() }}
          pending={!!saving}
        />
      </div>
    )
  }

  if (!parsed) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Gemini settings"
          sub={`Writes to ${selected.path}`}
        />
        <div className="flex flex-1 items-center justify-center text-muted-foreground/30">
          <div className="text-center space-y-2 max-w-md">
            <p className="text-sm font-bold uppercase tracking-widest">Structured editing unavailable</p>
            <p className="text-[10px]">This Gemini settings file could not be parsed cleanly. Repair it in raw JSON before using the structured editor.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <SettingsEditor
      key={selected.content}
      selected={selected}
      parsed={parsed}
      eyebrow={eyebrow}
      saving={saving}
      onSave={onSave}
    />
  )
}

interface SettingsEditorProps {
  selected: FileResourceItem
  parsed: Record<string, unknown>
  eyebrow: string
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
}

function readBaseline(parsed: Record<string, unknown>): SettingsState {
  return {
    preferredEditor: readString(parsed, ['general', 'preferredEditor']),
    vimMode: readBooleanString(parsed, ['general', 'vimMode']),
    disableAutoUpdate: readBooleanString(parsed, ['general', 'disableAutoUpdate']),
    disableUpdateNag: readBooleanString(parsed, ['general', 'disableUpdateNag']),
    checkpointingEnabled: readBooleanString(parsed, ['general', 'checkpointing', 'enabled']),
    outputFormat: readString(parsed, ['output', 'format']),
    theme: readString(parsed, ['ui', 'theme']),
    hideBanner: readBooleanString(parsed, ['ui', 'hideBanner']),
    hideTips: readBooleanString(parsed, ['ui', 'hideTips']),
    hideFooter: readBooleanString(parsed, ['ui', 'hideFooter']),
    showLineNumbers: readBooleanString(parsed, ['ui', 'showLineNumbers']),
    showCitations: readBooleanString(parsed, ['ui', 'showCitations']),
    telemetryEnabled: readBooleanString(parsed, ['telemetry', 'enabled']),
    telemetryTarget: readString(parsed, ['telemetry', 'target']),
    telemetryLogPrompts: readBooleanString(parsed, ['telemetry', 'logPrompts']),
    telemetryOutfile: readString(parsed, ['telemetry', 'outfile']),
  }
}

function SettingsEditor({ selected, parsed, eyebrow, saving, onSave }: SettingsEditorProps) {
  const baseline = useMemo(() => readBaseline(parsed), [parsed])
  const [state, dispatch] = useReducer(settingsReducer, baseline)
  const [error, setError] = useState('')

  const bind = (field: SettingsField) => (value: string) => dispatch({ type: 'setField', field, value })

  const isDirty = (Object.keys(baseline) as SettingsField[]).some((key) => state[key] !== baseline[key])

  const handleDiscard = () => {
    dispatch({ type: 'reset', state: baseline })
  }

  const handleSave = async () => {
    setError('')
    try {
      await onSave(selected.path, buildSettings(parsed, state))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Gemini settings"
        sub={`Writes to ${selected.path}`}
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">
          <Section title="General">
            <TextField label="Preferred Editor" value={state.preferredEditor} onChange={bind('preferredEditor')} placeholder="code" />
            <BooleanField label="Vim Mode" value={state.vimMode} onChange={bind('vimMode')} />
            <BooleanField label="Disable Auto Update" value={state.disableAutoUpdate} onChange={bind('disableAutoUpdate')} />
            <BooleanField label="Disable Update Nag" value={state.disableUpdateNag} onChange={bind('disableUpdateNag')} />
            <BooleanField label="Checkpointing Enabled" value={state.checkpointingEnabled} onChange={bind('checkpointingEnabled')} />
          </Section>

          <Section title="Output">
            <SelectField
              label="Format"
              value={state.outputFormat}
              onChange={bind('outputFormat')}
              options={['text', 'json']}
            />
          </Section>

          <Section title="UI">
            <TextField label="Theme" value={state.theme} onChange={bind('theme')} placeholder="GitHub" />
            <BooleanField label="Hide Banner" value={state.hideBanner} onChange={bind('hideBanner')} />
            <BooleanField label="Hide Tips" value={state.hideTips} onChange={bind('hideTips')} />
            <BooleanField label="Hide Footer" value={state.hideFooter} onChange={bind('hideFooter')} />
            <BooleanField label="Show Line Numbers" value={state.showLineNumbers} onChange={bind('showLineNumbers')} />
            <BooleanField label="Show Citations" value={state.showCitations} onChange={bind('showCitations')} />
          </Section>

          <Section title="Telemetry">
            <BooleanField label="Enabled" value={state.telemetryEnabled} onChange={bind('telemetryEnabled')} />
            <SelectField label="Target" value={state.telemetryTarget} onChange={bind('telemetryTarget')} options={['local', 'gcp']} />
            <BooleanField label="Log Prompts" value={state.telemetryLogPrompts} onChange={bind('telemetryLogPrompts')} />
            <TextField label="Outfile" value={state.telemetryOutfile} onChange={bind('telemetryOutfile')} placeholder="~/.gemini/telemetry.log" />
          </Section>
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={saving === selected.path}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}

function buildSettings(base: Record<string, unknown>, draft: SettingsState) {
  const next = structuredClone(base)

  setNested(next, ['general', 'preferredEditor'], draft.preferredEditor.trim() || undefined)
  setNested(next, ['general', 'vimMode'], parseBooleanString(draft.vimMode))
  setNested(next, ['general', 'disableAutoUpdate'], parseBooleanString(draft.disableAutoUpdate))
  setNested(next, ['general', 'disableUpdateNag'], parseBooleanString(draft.disableUpdateNag))
  setNested(next, ['general', 'checkpointing', 'enabled'], parseBooleanString(draft.checkpointingEnabled))

  setNested(next, ['output', 'format'], draft.outputFormat.trim() || undefined)

  setNested(next, ['ui', 'theme'], draft.theme.trim() || undefined)
  setNested(next, ['ui', 'hideBanner'], parseBooleanString(draft.hideBanner))
  setNested(next, ['ui', 'hideTips'], parseBooleanString(draft.hideTips))
  setNested(next, ['ui', 'hideFooter'], parseBooleanString(draft.hideFooter))
  setNested(next, ['ui', 'showLineNumbers'], parseBooleanString(draft.showLineNumbers))
  setNested(next, ['ui', 'showCitations'], parseBooleanString(draft.showCitations))

  setNested(next, ['telemetry', 'enabled'], parseBooleanString(draft.telemetryEnabled))
  setNested(next, ['telemetry', 'target'], draft.telemetryTarget.trim() || undefined)
  setNested(next, ['telemetry', 'logPrompts'], parseBooleanString(draft.telemetryLogPrompts))
  setNested(next, ['telemetry', 'outfile'], draft.telemetryOutfile.trim() || undefined)

  pruneEmpty(next)
  return `${JSON.stringify(next, null, 2)}\n`
}

function safeParse(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

function readString(parsed: Record<string, unknown> | null, path: string[]): string {
  const value = readPath(parsed, path)
  return typeof value === 'string' ? value : ''
}

function readBooleanString(parsed: Record<string, unknown> | null, path: string[]): string {
  const value = readPath(parsed, path)
  return typeof value === 'boolean' ? String(value) : ''
}

function readPath(parsed: Record<string, unknown> | null, path: string[]): unknown {
  let current: unknown = parsed
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function setNested(root: Record<string, unknown>, path: string[], value: unknown) {
  let current: Record<string, unknown> = root
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]
    const next = current[key]
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }
  const leaf = path[path.length - 1]
  if (value === undefined) {
    delete current[leaf]
  } else {
    current[leaf] = value
  }
}

function parseBooleanString(value: string): boolean | undefined {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function pruneEmpty(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const child = record[key]
    if (pruneEmpty(child)) delete record[key]
    if (child && typeof child === 'object' && !Array.isArray(child) && Object.keys(child as Record<string, unknown>).length === 0) {
      delete record[key]
    }
  }
  return Object.keys(record).length === 0
}

function Section({ title, children }: { title: string, children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10 p-4 space-y-4">
      <div>
        <h4 className="text-[11px] font-semibold">{title}</h4>
      </div>
      {children}
    </div>
  )
}

function TextField({ label, value, onChange, placeholder }: { label: string, value: string, onChange: (value: string) => void, placeholder?: string }) {
  return (
    <section className="space-y-2">
      <h5 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">{label}</h5>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </section>
  )
}

function BooleanField({ label, value, onChange }: { label: string, value: string, onChange: (value: string) => void }) {
  return (
    <SelectField label={label} value={value} onChange={onChange} options={['true', 'false']} allowDefault />
  )
}

function SelectField({
  label, value, onChange, options, allowDefault = true,
}: { label: string, value: string, onChange: (value: string) => void, options: string[], allowDefault?: boolean }) {
  return (
    <section className="space-y-2">
      <h5 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">{label}</h5>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        {allowDefault ? <option value="">Default</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </section>
  )
}
