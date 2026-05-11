import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { Button } from '@ui/button'
import type { FileResourceItem } from './FileResourcePanel'

interface GeminiSettingsPanelProps {
  items: FileResourceItem[]
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onCreate: () => Promise<void>
}

export function GeminiSettingsPanel({ items, saving, onSave, onCreate }: GeminiSettingsPanelProps) {
  const selected = items[0] ?? null
  const parsed = useMemo(() => safeParse(selected?.content ?? ''), [selected?.content])

  const [preferredEditor, setPreferredEditor] = useState(readString(parsed, ['general', 'preferredEditor']))
  const [vimMode, setVimMode] = useState(readBooleanString(parsed, ['general', 'vimMode']))
  const [disableAutoUpdate, setDisableAutoUpdate] = useState(readBooleanString(parsed, ['general', 'disableAutoUpdate']))
  const [disableUpdateNag, setDisableUpdateNag] = useState(readBooleanString(parsed, ['general', 'disableUpdateNag']))
  const [checkpointingEnabled, setCheckpointingEnabled] = useState(readBooleanString(parsed, ['general', 'checkpointing', 'enabled']))
  const [outputFormat, setOutputFormat] = useState(readString(parsed, ['output', 'format']))
  const [theme, setTheme] = useState(readString(parsed, ['ui', 'theme']))
  const [hideBanner, setHideBanner] = useState(readBooleanString(parsed, ['ui', 'hideBanner']))
  const [hideTips, setHideTips] = useState(readBooleanString(parsed, ['ui', 'hideTips']))
  const [hideFooter, setHideFooter] = useState(readBooleanString(parsed, ['ui', 'hideFooter']))
  const [showLineNumbers, setShowLineNumbers] = useState(readBooleanString(parsed, ['ui', 'showLineNumbers']))
  const [showCitations, setShowCitations] = useState(readBooleanString(parsed, ['ui', 'showCitations']))
  const [telemetryEnabled, setTelemetryEnabled] = useState(readBooleanString(parsed, ['telemetry', 'enabled']))
  const [telemetryTarget, setTelemetryTarget] = useState(readString(parsed, ['telemetry', 'target']))
  const [telemetryLogPrompts, setTelemetryLogPrompts] = useState(readBooleanString(parsed, ['telemetry', 'logPrompts']))
  const [telemetryOutfile, setTelemetryOutfile] = useState(readString(parsed, ['telemetry', 'outfile']))

  useEffect(() => {
    setPreferredEditor(readString(parsed, ['general', 'preferredEditor']))
    setVimMode(readBooleanString(parsed, ['general', 'vimMode']))
    setDisableAutoUpdate(readBooleanString(parsed, ['general', 'disableAutoUpdate']))
    setDisableUpdateNag(readBooleanString(parsed, ['general', 'disableUpdateNag']))
    setCheckpointingEnabled(readBooleanString(parsed, ['general', 'checkpointing', 'enabled']))
    setOutputFormat(readString(parsed, ['output', 'format']))
    setTheme(readString(parsed, ['ui', 'theme']))
    setHideBanner(readBooleanString(parsed, ['ui', 'hideBanner']))
    setHideTips(readBooleanString(parsed, ['ui', 'hideTips']))
    setHideFooter(readBooleanString(parsed, ['ui', 'hideFooter']))
    setShowLineNumbers(readBooleanString(parsed, ['ui', 'showLineNumbers']))
    setShowCitations(readBooleanString(parsed, ['ui', 'showCitations']))
    setTelemetryEnabled(readBooleanString(parsed, ['telemetry', 'enabled']))
    setTelemetryTarget(readString(parsed, ['telemetry', 'target']))
    setTelemetryLogPrompts(readBooleanString(parsed, ['telemetry', 'logPrompts']))
    setTelemetryOutfile(readString(parsed, ['telemetry', 'outfile']))
  }, [parsed])

  if (!selected) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/20">
        <div className="text-center space-y-2 max-w-md">
          <p className="text-sm font-bold uppercase tracking-widest">No settings found</p>
          <p className="text-[10px]">Gemini stores structured configuration in <code className="font-mono">settings.json</code>. Create that file for the selected scope to manage editor, UI, and telemetry settings here.</p>
          <Button size="sm" onClick={() => onCreate()} className="h-8 px-4 text-[11px]">Create Settings</Button>
        </div>
      </div>
    )
  }

  if (!parsed) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/20">
        <div className="text-center space-y-2 max-w-md">
          <p className="text-sm font-bold uppercase tracking-widest">Structured editing unavailable</p>
          <p className="text-[10px]">This Gemini settings file could not be parsed cleanly. Repair it in raw JSON before using the structured editor.</p>
        </div>
      </div>
    )
  }

  const isDirty =
    preferredEditor !== readString(parsed, ['general', 'preferredEditor']) ||
    vimMode !== readBooleanString(parsed, ['general', 'vimMode']) ||
    disableAutoUpdate !== readBooleanString(parsed, ['general', 'disableAutoUpdate']) ||
    disableUpdateNag !== readBooleanString(parsed, ['general', 'disableUpdateNag']) ||
    checkpointingEnabled !== readBooleanString(parsed, ['general', 'checkpointing', 'enabled']) ||
    outputFormat !== readString(parsed, ['output', 'format']) ||
    theme !== readString(parsed, ['ui', 'theme']) ||
    hideBanner !== readBooleanString(parsed, ['ui', 'hideBanner']) ||
    hideTips !== readBooleanString(parsed, ['ui', 'hideTips']) ||
    hideFooter !== readBooleanString(parsed, ['ui', 'hideFooter']) ||
    showLineNumbers !== readBooleanString(parsed, ['ui', 'showLineNumbers']) ||
    showCitations !== readBooleanString(parsed, ['ui', 'showCitations']) ||
    telemetryEnabled !== readBooleanString(parsed, ['telemetry', 'enabled']) ||
    telemetryTarget !== readString(parsed, ['telemetry', 'target']) ||
    telemetryLogPrompts !== readBooleanString(parsed, ['telemetry', 'logPrompts']) ||
    telemetryOutfile !== readString(parsed, ['telemetry', 'outfile'])

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Gemini Settings</h3>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">This panel edits documented Gemini <code className="font-mono">settings.json</code> categories like <code className="font-mono">general</code>, <code className="font-mono">output</code>, <code className="font-mono">ui</code>, and <code className="font-mono">telemetry</code>.</p>
          <p className="text-[10px] text-muted-foreground/35 mt-1 font-mono truncate">{selected.path}</p>
        </div>
        {isDirty ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest animate-pulse">Unsaved</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPreferredEditor(readString(parsed, ['general', 'preferredEditor']))
                setVimMode(readBooleanString(parsed, ['general', 'vimMode']))
                setDisableAutoUpdate(readBooleanString(parsed, ['general', 'disableAutoUpdate']))
                setDisableUpdateNag(readBooleanString(parsed, ['general', 'disableUpdateNag']))
                setCheckpointingEnabled(readBooleanString(parsed, ['general', 'checkpointing', 'enabled']))
                setOutputFormat(readString(parsed, ['output', 'format']))
                setTheme(readString(parsed, ['ui', 'theme']))
                setHideBanner(readBooleanString(parsed, ['ui', 'hideBanner']))
                setHideTips(readBooleanString(parsed, ['ui', 'hideTips']))
                setHideFooter(readBooleanString(parsed, ['ui', 'hideFooter']))
                setShowLineNumbers(readBooleanString(parsed, ['ui', 'showLineNumbers']))
                setShowCitations(readBooleanString(parsed, ['ui', 'showCitations']))
                setTelemetryEnabled(readBooleanString(parsed, ['telemetry', 'enabled']))
                setTelemetryTarget(readString(parsed, ['telemetry', 'target']))
                setTelemetryLogPrompts(readBooleanString(parsed, ['telemetry', 'logPrompts']))
                setTelemetryOutfile(readString(parsed, ['telemetry', 'outfile']))
              }}
              className="h-7 text-[10px]"
            >
              <RotateCcw size={10} className="mr-1" /> Discard
            </Button>
            <Button
              size="sm"
              onClick={() => onSave(selected.path, buildSettings(parsed, {
                preferredEditor,
                vimMode,
                disableAutoUpdate,
                disableUpdateNag,
                checkpointingEnabled,
                outputFormat,
                theme,
                hideBanner,
                hideTips,
                hideFooter,
                showLineNumbers,
                showCitations,
                telemetryEnabled,
                telemetryTarget,
                telemetryLogPrompts,
                telemetryOutfile,
              }))}
              disabled={saving === selected.path}
              className="h-7 bg-primary text-primary-foreground font-bold uppercase text-[10px] px-4 rounded-lg"
            >
              {saving === selected.path ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />}
              Save
            </Button>
          </div>
        ) : null}
      </div>

      <Section title="General">
        <TextField label="Preferred Editor" value={preferredEditor} onChange={setPreferredEditor} placeholder="code" />
        <BooleanField label="Vim Mode" value={vimMode} onChange={setVimMode} />
        <BooleanField label="Disable Auto Update" value={disableAutoUpdate} onChange={setDisableAutoUpdate} />
        <BooleanField label="Disable Update Nag" value={disableUpdateNag} onChange={setDisableUpdateNag} />
        <BooleanField label="Checkpointing Enabled" value={checkpointingEnabled} onChange={setCheckpointingEnabled} />
      </Section>

      <Section title="Output">
        <SelectField
          label="Format"
          value={outputFormat}
          onChange={setOutputFormat}
          options={['text', 'json']}
        />
      </Section>

      <Section title="UI">
        <TextField label="Theme" value={theme} onChange={setTheme} placeholder="GitHub" />
        <BooleanField label="Hide Banner" value={hideBanner} onChange={setHideBanner} />
        <BooleanField label="Hide Tips" value={hideTips} onChange={setHideTips} />
        <BooleanField label="Hide Footer" value={hideFooter} onChange={setHideFooter} />
        <BooleanField label="Show Line Numbers" value={showLineNumbers} onChange={setShowLineNumbers} />
        <BooleanField label="Show Citations" value={showCitations} onChange={setShowCitations} />
      </Section>

      <Section title="Telemetry">
        <BooleanField label="Enabled" value={telemetryEnabled} onChange={setTelemetryEnabled} />
        <SelectField label="Target" value={telemetryTarget} onChange={setTelemetryTarget} options={['local', 'gcp']} />
        <BooleanField label="Log Prompts" value={telemetryLogPrompts} onChange={setTelemetryLogPrompts} />
        <TextField label="Outfile" value={telemetryOutfile} onChange={setTelemetryOutfile} placeholder="~/.gemini/telemetry.log" />
      </Section>
      </div>
    </div>
  )
}

type SettingsDraft = {
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

function buildSettings(base: Record<string, unknown>, draft: SettingsDraft) {
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
      <h5 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">{label}</h5>
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
      <h5 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">{label}</h5>
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
