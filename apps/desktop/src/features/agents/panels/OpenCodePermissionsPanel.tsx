// apps/desktop/src/features/agents/panels/OpenCodePermissionsPanel.tsx
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@ui/button'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'

interface OpenCodePermissionsPanelProps {
  configPath: string
  configContent: string
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
}

export function OpenCodePermissionsPanel({ configPath, configContent, scope, projectName, saving, onSave }: OpenCodePermissionsPanelProps) {
  const parsed = useMemo(() => safeParse(configContent), [configContent])
  const [defaultMode, setDefaultMode] = useState(readDefaultMode(parsed))
  const [allow, setAllow] = useState(readPermissionList(parsed, 'allow'))
  const [deny, setDeny] = useState(readPermissionList(parsed, 'deny'))
  const [ask, setAsk] = useState(readPermissionList(parsed, 'ask'))
  const [error, setError] = useState('')

  useEffect(() => {
    setDefaultMode(readDefaultMode(parsed))
    setAllow(readPermissionList(parsed, 'allow'))
    setDeny(readPermissionList(parsed, 'deny'))
    setAsk(readPermissionList(parsed, 'ask'))
    setError('')
  }, [parsed])

  const eyebrow = scope === 'GLOBAL' ? 'Global / Permissions' : `${projectName ?? 'Project'} / Permissions`

  if (!configPath) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="Permissions"
          sub="Writes to opencode.json"
        />
        <div className="flex flex-1 items-center justify-center text-muted-foreground/30">
          <div className="text-center space-y-2 max-w-md">
            <p className="text-sm font-bold uppercase tracking-widest">No config found</p>
            <p className="text-[10px]">Create OpenCode config first, then manage permission rules here.</p>
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
          sub={`Writes to ${configPath}`}
        />
        <div className="flex flex-1 items-center justify-center text-muted-foreground/30">
          <div className="text-center space-y-2 max-w-md">
            <p className="text-sm font-bold uppercase tracking-widest">Structured editing unavailable</p>
            <p className="text-[10px]">This OpenCode config could not be parsed cleanly. Use the Config panel raw editor first.</p>
          </div>
        </div>
      </div>
    )
  }

  const isDirty =
    defaultMode !== readDefaultMode(parsed) ||
    JSON.stringify(allow) !== JSON.stringify(readPermissionList(parsed, 'allow')) ||
    JSON.stringify(deny) !== JSON.stringify(readPermissionList(parsed, 'deny')) ||
    JSON.stringify(ask) !== JSON.stringify(readPermissionList(parsed, 'ask'))

  const handleDiscard = () => {
    setDefaultMode(readDefaultMode(parsed))
    setAllow(readPermissionList(parsed, 'allow'))
    setDeny(readPermissionList(parsed, 'deny'))
    setAsk(readPermissionList(parsed, 'ask'))
  }

  const handleSave = async () => {
    setError('')
    try {
      await onSave(configPath, buildOpenCodeConfig(parsed, defaultMode, allow, deny, ask))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Permissions"
        sub={`Writes to ${configPath}`}
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">

          <Field label="Default Permission Mode">
            <select
              value={defaultMode}
              onChange={(event) => setDefaultMode(event.target.value)}
              className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Rule Map</option>
              <option value="allow">allow</option>
              <option value="deny">deny</option>
              <option value="ask">ask</option>
            </select>
            <p className="text-[10px] text-muted-foreground/50 mt-1">When set, OpenCode uses a single global permission mode instead of per-tool rules.</p>
          </Field>

          <ListField label="Allow Rules" description="Tool rules that should run without prompting." items={allow} onChange={setAllow} placeholder="bash(git status)" disabled={defaultMode !== ''} />
          <ListField label="Deny Rules" description="Tool rules that should always be blocked." items={deny} onChange={setDeny} placeholder="bash(rm *)" disabled={defaultMode !== ''} />
          <ListField label="Ask Rules" description="Tool rules that should always prompt." items={ask} onChange={setAsk} placeholder="edit" disabled={defaultMode !== ''} />
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty}
        saving={saving === configPath}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}

function buildOpenCodeConfig(base: Record<string, unknown>, defaultMode: string, allow: string[], deny: string[], ask: string[]) {
  const next = structuredClone(base)
  if (defaultMode) {
    next.permission = defaultMode
    return `${JSON.stringify(next, null, 2)}\n`
  }

  const permission: Record<string, unknown> = {}
  writePermissionEntries(permission, allow, 'allow')
  writePermissionEntries(permission, deny, 'deny')
  writePermissionEntries(permission, ask, 'ask')
  next.permission = permission
  return `${JSON.stringify(next, null, 2)}\n`
}

function writePermissionEntries(target: Record<string, unknown>, entries: string[], action: 'allow' | 'deny' | 'ask') {
  for (const rule of entries) {
    const match = rule.match(/^([^()]+)\((.+)\)$/)
    if (match) {
      const tool = match[1]
      const pattern = match[2]
      const current = target[tool]
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        target[tool] = {}
      }
      ;(target[tool] as Record<string, unknown>)[pattern] = action
      continue
    }
    target[rule] = action
  }
}

function readDefaultMode(parsed: Record<string, unknown> | null): string {
  return parsed && typeof parsed.permission === 'string' ? parsed.permission : ''
}

function readPermissionList(parsed: Record<string, unknown> | null, desired: 'allow' | 'deny' | 'ask'): string[] {
  if (!parsed || typeof parsed.permission !== 'object' || parsed.permission === null || Array.isArray(parsed.permission)) return []
  const output: string[] = []
  for (const [tool, value] of Object.entries(parsed.permission as Record<string, unknown>)) {
    if (typeof value === 'string') {
      if (value === desired) output.push(tool)
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [pattern, action] of Object.entries(value as Record<string, unknown>)) {
        if (action === desired) output.push(`${tool}(${pattern})`)
      }
    }
  }
  return output
}

function safeParse(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
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
  label, description, items, onChange, placeholder, disabled,
}: { label: string, description: string, items: string[], onChange: (items: string[]) => void, placeholder: string, disabled?: boolean }) {
  const [draft, setDraft] = useState('')
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">{label}</h4>
        <p className="text-[10px] text-muted-foreground/50 mt-1">{description}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.length > 0 ? items.map((item) => (
          <button
            key={item}
            type="button"
            disabled={disabled}
            onClick={() => onChange(items.filter((entry) => entry !== item))}
            className="inline-flex items-center gap-1 rounded-md border border-border/30 bg-muted/20 px-2 py-1 text-[11px] font-mono disabled:opacity-50"
          >
            {item}
          </button>
        )) : <span className="text-[10px] italic text-muted-foreground/35">None</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          disabled={disabled}
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
          className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
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
