// apps/desktop/src/features/agents/panels/OpenCodeConfigPanel.tsx
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@ui/button'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { EmptyStateCard } from '../components/EmptyStateCard'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'
import type { FileResourceItem } from './FileResourcePanel'

interface OpenCodeConfigPanelProps {
  items: FileResourceItem[]
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (path: string, content: string) => Promise<void>
  onCreate: () => Promise<void>
}

export function OpenCodeConfigPanel({ items, scope, projectName, saving, onSave, onCreate }: OpenCodeConfigPanelProps) {
  const selected = items[0] ?? null
  const parsed = useMemo(() => safeParse(selected?.content ?? ''), [selected?.content])
  const [autoupdate, setAutoupdate] = useState(readStringOrBoolean(parsed, 'autoupdate'))
  const [defaultAgent, setDefaultAgent] = useState(readString(parsed, 'default_agent'))
  const [share, setShare] = useState(readString(parsed, 'share'))
  const [disabledProviders, setDisabledProviders] = useState(readStringList(parsed, 'disabled_providers'))
  const [providerIds, setProviderIds] = useState(readObjectKeys(parsed, 'provider'))
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [providerConfigs, setProviderConfigs] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    setAutoupdate(readStringOrBoolean(parsed, 'autoupdate'))
    setDefaultAgent(readString(parsed, 'default_agent'))
    setShare(readString(parsed, 'share'))
    setDisabledProviders(readStringList(parsed, 'disabled_providers'))
    const nextProviderIds = readObjectKeys(parsed, 'provider')
    setProviderIds(nextProviderIds)
    const nextConfigs = buildProviderConfigDrafts(parsed)
    setProviderConfigs(nextConfigs)
    setSelectedProviderId((current) => (current && nextProviderIds.includes(current) ? current : (nextProviderIds[0] ?? '')))
    setError('')
  }, [parsed])

  const eyebrow = scope === 'GLOBAL' ? 'Global / OpenCode Config' : `${projectName ?? 'Project'} / OpenCode Config`

  if (!selected) {
    return (
      <div className="flex flex-col h-full p-[18px]">
        <PanelHeader
          eyebrow={eyebrow}
          title="OpenCode config"
          sub="Writes to opencode/config.json"
        />
        <EmptyStateCard
          title="No config at this scope"
          description="OpenCode configuration is merged from global and project config files. Create the primary config file for this scope to manage provider settings here."
          ctaLabel="Create Config"
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
          title="OpenCode config"
          sub={`Writes to ${selected.path}`}
        />
        <div className="flex flex-1 items-center justify-center text-muted-foreground/30">
          <div className="text-center space-y-2 max-w-md">
            <p className="text-sm font-bold uppercase tracking-widest">Structured editing unavailable</p>
            <p className="text-[10px]">This OpenCode config could not be parsed cleanly. Use raw editing in another pass if you need to preserve JSONC comments.</p>
          </div>
        </div>
      </div>
    )
  }

  const isDirty =
    autoupdate !== readStringOrBoolean(parsed, 'autoupdate') ||
    defaultAgent !== readString(parsed, 'default_agent') ||
    share !== readString(parsed, 'share') ||
    JSON.stringify(disabledProviders) !== JSON.stringify(readStringList(parsed, 'disabled_providers')) ||
    JSON.stringify(providerIds) !== JSON.stringify(readObjectKeys(parsed, 'provider')) ||
    JSON.stringify(normalizeProviderDrafts(providerConfigs, providerIds)) !== JSON.stringify(normalizeProviderDrafts(buildProviderConfigDrafts(parsed), readObjectKeys(parsed, 'provider')))

  const activeProviderDraft = selectedProviderId ? (providerConfigs[selectedProviderId] ?? '{}') : ''
  const activeProviderParseError = selectedProviderId ? readJSONError(activeProviderDraft) : ''

  const handleDiscard = () => {
    setAutoupdate(readStringOrBoolean(parsed, 'autoupdate'))
    setDefaultAgent(readString(parsed, 'default_agent'))
    setShare(readString(parsed, 'share'))
    setDisabledProviders(readStringList(parsed, 'disabled_providers'))
    const nextProviderIds = readObjectKeys(parsed, 'provider')
    setProviderIds(nextProviderIds)
    const nextConfigs = buildProviderConfigDrafts(parsed)
    setProviderConfigs(nextConfigs)
    setSelectedProviderId(nextProviderIds[0] ?? '')
  }

  const handleSave = async () => {
    setError('')
    try {
      await onSave(selected.path, buildConfig(parsed, autoupdate, defaultAgent, share, disabledProviders, providerIds, providerConfigs))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="OpenCode config"
        sub={`Writes to ${selected.path}`}
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">

          <Field label="Autoupdate">
            <select
              value={autoupdate}
              onChange={(event) => setAutoupdate(event.target.value)}
              className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Default</option>
              <option value="true">true</option>
              <option value="false">false</option>
              <option value="notify">notify</option>
            </select>
          </Field>

          <Field label="Default Agent">
            <input
              value={defaultAgent}
              onChange={(event) => setDefaultAgent(event.target.value)}
              placeholder="build"
              className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-[10px] text-muted-foreground/50 mt-1">OpenCode expects <code className="font-mono">default_agent</code>, not <code className="font-mono">defaultAgent</code>.</p>
          </Field>

          <Field label="Share">
            <select
              value={share}
              onChange={(event) => setShare(event.target.value)}
              className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Default</option>
              <option value="manual">manual</option>
              <option value="auto">auto</option>
              <option value="disabled">disabled</option>
            </select>
          </Field>

          <ListField
            label="Disabled Providers"
            description="Provider IDs to disable even if credentials are available."
            items={disabledProviders}
            onChange={setDisabledProviders}
            placeholder="gemini"
          />

          <ListField
            label="Configured Providers"
            description="Provider IDs present in the top-level provider block."
            items={providerIds}
            onChange={(nextIds) => {
              setProviderIds(nextIds)
              setProviderConfigs((current) => {
                const nextConfigs: Record<string, string> = {}
                for (const id of nextIds) {
                  nextConfigs[id] = current[id] ?? '{}'
                }
                return nextConfigs
              })
              setSelectedProviderId((current) => (current && nextIds.includes(current) ? current : (nextIds[0] ?? '')))
            }}
            placeholder="openai"
          />

          {providerIds.length > 0 ? (
            <div className="rounded-lg border border-border/30 bg-muted/10 p-4 space-y-3">
              <div>
                <h4 className="text-[11px] font-semibold">Provider Block</h4>
                <p className="text-[10px] text-muted-foreground/50 mt-1">Edit the nested <code className="font-mono">provider.{selectedProviderId || '<id>'}</code> object directly. This preserves OpenCode provider-native options without hardcoding every provider schema.</p>
              </div>

              <Field label="Selected Provider">
                <select
                  value={selectedProviderId}
                  onChange={(event) => setSelectedProviderId(event.target.value)}
                  className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {providerIds.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </Field>

              {selectedProviderId ? (
                <section className="space-y-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Provider Config JSON</h4>
                  <textarea
                    value={activeProviderDraft}
                    onChange={(event) => {
                      const value = event.target.value
                      setProviderConfigs((current) => ({ ...current, [selectedProviderId]: value }))
                    }}
                    className="min-h-[220px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
                    spellCheck={false}
                  />
                  {activeProviderParseError ? (
                    <p className="text-[10px] text-red-400">Provider block must be valid JSON: {activeProviderParseError}</p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground/50">Examples include API base URLs, model aliases, auth env vars, and provider-specific runtime options.</p>
                  )}
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <ErrorStrip message={error} onDismiss={() => setError('')} />

      <PanelFooter
        dirty={isDirty && !activeProviderParseError}
        saving={!!saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </div>
  )
}

function buildConfig(
  base: Record<string, unknown>,
  autoupdate: string,
  defaultAgent: string,
  share: string,
  disabledProviders: string[],
  providerIds: string[],
  providerConfigs: Record<string, string>,
) {
  const next = structuredClone(base)
  if (!autoupdate) {
    delete next.autoupdate
  } else if (autoupdate === 'true' || autoupdate === 'false') {
    next.autoupdate = autoupdate === 'true'
  } else {
    next.autoupdate = autoupdate
  }

  if (defaultAgent.trim()) next.default_agent = defaultAgent.trim()
  else delete next.default_agent

  if (share.trim()) next.share = share.trim()
  else delete next.share

  if (disabledProviders.length > 0) next.disabled_providers = disabledProviders
  else delete next.disabled_providers

  const existingProvider = next.provider
  const providerObj = existingProvider && typeof existingProvider === 'object' && !Array.isArray(existingProvider)
    ? structuredClone(existingProvider as Record<string, unknown>)
    : {}
  for (const key of Object.keys(providerObj)) {
    if (!providerIds.includes(key)) delete providerObj[key]
  }
  for (const id of providerIds) {
    const raw = providerConfigs[id] ?? '{}'
    const parsed = safeParse(raw)
    providerObj[id] = parsed ?? {}
  }
  if (Object.keys(providerObj).length > 0) next.provider = providerObj
  else delete next.provider

  return `${JSON.stringify(next, null, 2)}\n`
}

function safeParse(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

function readString(parsed: Record<string, unknown> | null, key: string): string {
  return parsed && typeof parsed[key] === 'string' ? parsed[key] as string : ''
}

function readStringOrBoolean(parsed: Record<string, unknown> | null, key: string): string {
  if (!parsed) return ''
  const value = parsed[key]
  if (typeof value === 'boolean') return String(value)
  return typeof value === 'string' ? value : ''
}

function readStringList(parsed: Record<string, unknown> | null, key: string): string[] {
  const value = parsed?.[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readObjectKeys(parsed: Record<string, unknown> | null, key: string): string[] {
  const value = parsed?.[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as Record<string, unknown>) : []
}

function buildProviderConfigDrafts(parsed: Record<string, unknown> | null): Record<string, string> {
  const provider = parsed?.provider
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return {}
  return Object.fromEntries(
    Object.entries(provider as Record<string, unknown>).map(([id, config]) => [id, JSON.stringify(config ?? {}, null, 2)]),
  )
}

function normalizeProviderDrafts(drafts: Record<string, string>, ids: string[]): Record<string, string> {
  const output: Record<string, string> = {}
  for (const id of ids) {
    output[id] = drafts[id] ?? '{}'
  }
  return output
}

function readJSONError(content: string): string {
  try {
    JSON.parse(content)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid JSON'
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
  label, description, items, onChange, placeholder,
}: { label: string, description: string, items: string[], onChange: (items: string[]) => void, placeholder: string }) {
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
            onClick={() => onChange(items.filter((entry) => entry !== item))}
            className="inline-flex items-center gap-1 rounded-md border border-border/30 bg-muted/20 px-2 py-1 text-[11px] font-mono"
          >
            {item}
          </button>
        )) : <span className="text-[10px] italic text-muted-foreground/35">None</span>}
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
