// apps/desktop/src/features/agents/panels/CodexModelPanel.tsx
import { useEffect, useMemo, useState } from 'react'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'
import type { ProviderModelConfig } from '@core/api/client'
import { EFFORT_LEVELS, MODELS_BY_PROVIDER } from '../constants'

interface CodexModelPanelProps {
  modelConfig: ProviderModelConfig
  configContent: string
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (model: ProviderModelConfig) => Promise<void>
  onSaveConfig: (content: string) => Promise<void>
}

type ProviderBlock = {
  name: string
  baseUrl: string
  wireApi: string
  envKey: string
  envKeyInstructions: string
  streamIdleTimeoutMs: string
  supportsWebsockets: string
}

export function CodexModelPanel({ modelConfig, configContent, scope, projectName, saving, onSave, onSaveConfig }: CodexModelPanelProps) {
  const [model, setModel] = useState(modelConfig.model)
  const [effort, setEffort] = useState(modelConfig.effort)
  const [provider, setProvider] = useState(readTomlScalar(configContent, 'model_provider'))
  const providerBlocks = useMemo(() => parseProviderBlocks(configContent), [configContent])
  const activeBlock = providerBlocks.find(block => block.name === provider) ?? { name: provider, baseUrl: '', wireApi: '', envKey: '', envKeyInstructions: '', streamIdleTimeoutMs: '', supportsWebsockets: '' }
  const [baseUrl, setBaseUrl] = useState(activeBlock.baseUrl)
  const [wireApi, setWireApi] = useState(activeBlock.wireApi)
  const [envKey, setEnvKey] = useState(activeBlock.envKey)
  const [envKeyInstructions, setEnvKeyInstructions] = useState(activeBlock.envKeyInstructions)
  const [streamIdleTimeoutMs, setStreamIdleTimeoutMs] = useState(activeBlock.streamIdleTimeoutMs)
  const [supportsWebsockets, setSupportsWebsockets] = useState(activeBlock.supportsWebsockets)
  const [error, setError] = useState('')

  useEffect(() => {
    setModel(modelConfig.model)
    setEffort(modelConfig.effort)
  }, [modelConfig])

  useEffect(() => {
    setProvider(readTomlScalar(configContent, 'model_provider'))
  }, [configContent])

  useEffect(() => {
    setBaseUrl(activeBlock.baseUrl)
    setWireApi(activeBlock.wireApi)
    setEnvKey(activeBlock.envKey)
  }, [activeBlock.baseUrl, activeBlock.wireApi, activeBlock.envKey, activeBlock.name])

  const isDirty =
    model !== modelConfig.model ||
    effort !== modelConfig.effort ||
    provider !== readTomlScalar(configContent, 'model_provider') ||
    baseUrl !== activeBlock.baseUrl ||
    wireApi !== activeBlock.wireApi ||
    envKey !== activeBlock.envKey ||
    envKeyInstructions !== activeBlock.envKeyInstructions ||
    streamIdleTimeoutMs !== activeBlock.streamIdleTimeoutMs ||
    supportsWebsockets !== activeBlock.supportsWebsockets

  const eyebrow = scope === 'GLOBAL' ? 'Global / Model' : `${projectName ?? 'Project'} / Model`

  const handleDiscard = () => {
    setModel(modelConfig.model)
    setEffort(modelConfig.effort)
    setProvider(readTomlScalar(configContent, 'model_provider'))
    setBaseUrl(activeBlock.baseUrl)
    setWireApi(activeBlock.wireApi)
    setEnvKey(activeBlock.envKey)
    setEnvKeyInstructions(activeBlock.envKeyInstructions)
    setStreamIdleTimeoutMs(activeBlock.streamIdleTimeoutMs)
    setSupportsWebsockets(activeBlock.supportsWebsockets)
  }

  const handleSave = async () => {
    setError('')
    try {
      await onSave({ ...modelConfig, model, effort })
      let nextConfig = writeTomlScalar(configContent, 'model_provider', provider)
      if (provider.trim()) {
        nextConfig = upsertProviderBlock(nextConfig, {
          name: provider.trim(),
          baseUrl,
          wireApi,
          envKey,
          envKeyInstructions,
          streamIdleTimeoutMs,
          supportsWebsockets,
        })
      }
      if (nextConfig !== configContent) {
        await onSaveConfig(nextConfig)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Model"
        sub="Codex model + reasoning effort"
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">

          <section className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Model</h4>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full max-w-md px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Default</option>
              {MODELS_BY_PROVIDER.codex.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </section>

          <section className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Reasoning Effort</h4>
            <select
              value={effort}
              onChange={(event) => setEffort(event.target.value)}
              className="w-full max-w-xs px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Default</option>
              {EFFORT_LEVELS.codex.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </section>

          <section className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Model Provider</h4>
            <input
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              placeholder="openai"
              className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </section>

          {provider.trim() ? (
            <div className="rounded-lg border border-border/30 bg-background px-3 py-3 space-y-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Provider Block</p>
                <p className="text-[10px] text-foreground/50 mt-1">Edits <code className="font-mono">[model_providers.{provider.trim()}]</code> in the current Codex config.</p>
              </div>
              <ProviderField label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder="https://api.openai.com/v1" />
              <ProviderField label="Wire API" value={wireApi} onChange={setWireApi} placeholder="responses" />
              <ProviderField label="Env Key" value={envKey} onChange={setEnvKey} placeholder="OPENAI_API_KEY" />
              <ProviderField label="Env Key Instructions" value={envKeyInstructions} onChange={setEnvKeyInstructions} placeholder="Set OPENAI_API_KEY before launching Codex." />
              <ProviderField label="Stream Idle Timeout Ms" value={streamIdleTimeoutMs} onChange={setStreamIdleTimeoutMs} placeholder="300000" />
              <BooleanField label="Supports WebSockets" value={supportsWebsockets} onChange={setSupportsWebsockets} />
            </div>
          ) : null}
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

function ProviderField({ label, value, onChange, placeholder }: { label: string, value: string, onChange: (value: string) => void, placeholder?: string }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">{label}</h4>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </section>
  )
}

function BooleanField({ label, value, onChange }: { label: string, value: string, onChange: (value: string) => void }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">{label}</h4>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        <option value="">Default</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    </section>
  )
}

function readTomlScalar(content: string, field: string): string {
  const pattern = new RegExp(`^${escapeRegExp(field)}\\s*=\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm')
  return content.match(pattern)?.[1]?.trim() ?? ''
}

function writeTomlScalar(content: string, field: string, value: string): string {
  const normalized = value.trim()
  const line = normalized ? `${field} = "${normalized}"` : ''
  const pattern = new RegExp(`^${escapeRegExp(field)}\\s*=.*$`, 'm')
  if (pattern.test(content)) {
    if (!line) return content.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
    return content.replace(pattern, line)
  }
  if (!line) return content
  return `${content.trimEnd()}\n${line}\n`
}

function parseProviderBlocks(content: string): ProviderBlock[] {
  const lines = content.split('\n')
  const blocks: ProviderBlock[] = []
  let current: ProviderBlock | null = null

  for (const line of lines) {
    const header = line.match(/^\[model_providers\.([^\]]+)\]\s*$/)
    if (header) {
      if (current) blocks.push(current)
      current = { name: header[1], baseUrl: '', wireApi: '', envKey: '', envKeyInstructions: '', streamIdleTimeoutMs: '', supportsWebsockets: '' }
      continue
    }
    if (!current) continue
    if (/^\[.*\]\s*$/.test(line)) {
      blocks.push(current)
      current = null
      continue
    }
    const scalar = line.match(/^([a-zA-Z0-9_.-]+)\s*=\s*["']?([^"'\n]+)["']?\s*$/)
    if (!scalar) continue
    if (scalar[1] === 'base_url') current.baseUrl = scalar[2].trim()
    if (scalar[1] === 'wire_api') current.wireApi = scalar[2].trim()
    if (scalar[1] === 'env_key') current.envKey = scalar[2].trim()
    if (scalar[1] === 'env_key_instructions') current.envKeyInstructions = scalar[2].trim()
    if (scalar[1] === 'stream_idle_timeout_ms') current.streamIdleTimeoutMs = scalar[2].trim()
    if (scalar[1] === 'supports_websockets') current.supportsWebsockets = scalar[2].trim()
  }

  if (current) blocks.push(current)
  return blocks
}

function upsertProviderBlock(content: string, block: ProviderBlock): string {
  const section = buildProviderSection(block)
  const pattern = new RegExp(`\\[model_providers\\.${escapeRegExp(block.name)}\\][\\s\\S]*?(?=\\n\\[[^\\n]+\\]|$)`, 'm')
  if (pattern.test(content)) {
    return content.replace(pattern, section).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
  }
  return `${content.trimEnd()}\n\n${section}\n`
}

function buildProviderSection(block: ProviderBlock): string {
  const lines = [`[model_providers.${block.name}]`]
  if (block.baseUrl.trim()) lines.push(`base_url = "${block.baseUrl.trim()}"`)
  if (block.wireApi.trim()) lines.push(`wire_api = "${block.wireApi.trim()}"`)
  if (block.envKey.trim()) lines.push(`env_key = "${block.envKey.trim()}"`)
  if (block.envKeyInstructions.trim()) lines.push(`env_key_instructions = "${block.envKeyInstructions.trim()}"`)
  if (block.streamIdleTimeoutMs.trim()) lines.push(`stream_idle_timeout_ms = ${block.streamIdleTimeoutMs.trim()}`)
  if (block.supportsWebsockets.trim()) lines.push(`supports_websockets = ${block.supportsWebsockets.trim()}`)
  return lines.join('\n')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
