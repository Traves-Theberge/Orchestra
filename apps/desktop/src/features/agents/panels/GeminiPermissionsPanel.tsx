// apps/desktop/src/features/agents/panels/GeminiPermissionsPanel.tsx
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@ui/button'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'

interface GeminiPermissionsPanelProps {
  settingsPath: string
  settingsContent: string
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
}

export function GeminiPermissionsPanel({ settingsPath, settingsContent, scope, projectName, saving, onSave }: GeminiPermissionsPanelProps) {
  const parsed = useMemo(() => safeParse(settingsContent), [settingsContent])
  const [sandbox, setSandbox] = useState(readSandbox(parsed))
  const [allowed, setAllowed] = useState(readStringList(parsed, ['tools', 'allowed']))
  const [core, setCore] = useState(readStringList(parsed, ['tools', 'core']))
  const [excluded, setExcluded] = useState(readStringList(parsed, ['tools', 'exclude']))
  const [error, setError] = useState('')

  useEffect(() => {
    setSandbox(readSandbox(parsed))
    setAllowed(readStringList(parsed, ['tools', 'allowed']))
    setCore(readStringList(parsed, ['tools', 'core']))
    setExcluded(readStringList(parsed, ['tools', 'exclude']))
    setError('')
  }, [parsed])

  const eyebrow = scope === 'GLOBAL' ? 'Global / Permissions' : `${projectName ?? 'Project'} / Permissions`

  if (!settingsPath) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Permissions"
          sub="Writes to .gemini/settings.json"
        />
        <div className="flex flex-1 items-center justify-center text-muted-foreground/30">
          <div className="text-center space-y-2 max-w-md">
            <p className="text-sm font-bold uppercase tracking-widest">No settings found</p>
            <p className="text-[10px]">Create Gemini settings.json first, then configure tool permissions and sandbox settings here.</p>
          </div>
        </div>
      </div>
    )
  }

  if (!parsed) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Permissions"
          sub={`Writes to ${settingsPath}`}
        />
        <div className="flex flex-1 items-center justify-center text-muted-foreground/30">
          <div className="text-center space-y-2 max-w-md">
            <p className="text-sm font-bold uppercase tracking-widest">Structured editing unavailable</p>
            <p className="text-[10px]">This settings.json file could not be parsed cleanly. Use the Settings panel raw editor to repair it first.</p>
          </div>
        </div>
      </div>
    )
  }

  const isDirty =
    sandbox !== readSandbox(parsed) ||
    JSON.stringify(allowed) !== JSON.stringify(readStringList(parsed, ['tools', 'allowed'])) ||
    JSON.stringify(core) !== JSON.stringify(readStringList(parsed, ['tools', 'core'])) ||
    JSON.stringify(excluded) !== JSON.stringify(readStringList(parsed, ['tools', 'exclude']))

  const handleDiscard = () => {
    setSandbox(readSandbox(parsed))
    setAllowed(readStringList(parsed, ['tools', 'allowed']))
    setCore(readStringList(parsed, ['tools', 'core']))
    setExcluded(readStringList(parsed, ['tools', 'exclude']))
  }

  const handleSave = async () => {
    setError('')
    try {
      await onSave(settingsPath, buildGeminiSettings(parsed, sandbox, allowed, core, excluded))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Permissions"
        sub={`Writes to ${settingsPath}`}
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">
          <Field label="Sandbox">
            <select
              value={sandbox}
              onChange={(event) => setSandbox(event.target.value)}
              className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Default</option>
              <option value="true">true</option>
              <option value="false">false</option>
              <option value="docker">docker</option>
              <option value="podman">podman</option>
              <option value="sandbox-exec">sandbox-exec</option>
            </select>
          </Field>

          <ListField label="Allowed Tools" description="Explicit allowlist for tool discovery and execution." items={allowed} onChange={setAllowed} placeholder="run_shell_command" />
          <ListField label="Core Tools" description="Restrict the built-in core tool set." items={core} onChange={setCore} placeholder="read_file" />
          <ListField label="Excluded Tools" description="Hide tools from discovery entirely." items={excluded} onChange={setExcluded} placeholder="web_fetch" />
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={saving === settingsPath}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}

function buildGeminiSettings(base: Record<string, unknown>, sandbox: string, allowed: string[], core: string[], excluded: string[]) {
  const next = structuredClone(base)
  const tools = asRecord(next.tools)
  writeList(tools, 'allowed', allowed)
  writeList(tools, 'core', core)
  writeList(tools, 'exclude', excluded)
  if (sandbox.trim() === '') {
    delete tools.sandbox
  } else if (sandbox === 'true' || sandbox === 'false') {
    tools.sandbox = sandbox === 'true'
  } else {
    tools.sandbox = sandbox
  }
  next.tools = tools
  return `${JSON.stringify(next, null, 2)}\n`
}

function writeList(target: Record<string, unknown>, key: string, items: string[]) {
  if (items.length === 0) {
    delete target[key]
    return
  }
  target[key] = items
}

function readSandbox(parsed: Record<string, unknown> | null): string {
  const tools = asRecord(parsed?.tools)
  if (typeof tools.sandbox === 'boolean') return String(tools.sandbox)
  return typeof tools.sandbox === 'string' ? tools.sandbox : ''
}

function readStringList(parsed: Record<string, unknown> | null, path: string[]): string[] {
  let current: unknown = parsed
  for (const part of path) {
    current = asRecord(current)?.[part]
  }
  return Array.isArray(current) ? current.filter((item): item is string => typeof item === 'string') : []
}

function safeParse(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function Field({ label, children }: { label: string, children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">{label}</h4>
      {children}
    </section>
  )
}

function ListField({
  label, description, items, onChange, placeholder,
}: { label: string, description: string, items: string[], onChange: (items: string[]) => void, placeholder: string }) {
  const [draft, setDraft] = useState('')
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">{label}</h4>
        <p className="text-[10px] text-foreground/50 mt-1">{description}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.length > 0 ? items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(items.filter((entry) => entry !== item))}
            className="inline-flex items-center gap-1 rounded-md border border-border/30 bg-muted/20 px-2 py-1 text-[11px] font-mono"
          >
            {item}
          </button>
        )) : <span className="text-[10px] italic text-foreground/35">None</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              const next = draft.trim()
              if (next && !items.includes(next)) {
                onChange([...items, next])
                setDraft('')
              }
            }
          }}
          placeholder={placeholder}
          className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const next = draft.trim()
            if (next && !items.includes(next)) {
              onChange([...items, next])
              setDraft('')
            }
          }}
          className="h-9"
        >
          Add
        </Button>
      </div>
    </section>
  )
}
