// apps/desktop/src/features/agents/panels/CodexModelPanel.tsx
import { useMemo, useReducer } from 'react'
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

const EMPTY_BLOCK: ProviderBlock = {
  name: '',
  baseUrl: '',
  wireApi: '',
  envKey: '',
  envKeyInstructions: '',
  streamIdleTimeoutMs: '',
  supportsWebsockets: '',
}

type FormState = {
  model: string
  effort: string
  provider: string
  baseUrl: string
  wireApi: string
  envKey: string
  envKeyInstructions: string
  streamIdleTimeoutMs: string
  supportsWebsockets: string
  error: string
}

type FormAction =
  | { type: 'set-model', value: string }
  | { type: 'set-effort', value: string }
  | { type: 'set-provider', value: string }
  | { type: 'set-base-url', value: string }
  | { type: 'set-wire-api', value: string }
  | { type: 'set-env-key', value: string }
  | { type: 'set-env-key-instructions', value: string }
  | { type: 'set-stream-idle-timeout', value: string }
  | { type: 'set-supports-websockets', value: string }
  | { type: 'set-error', value: string }
  | { type: 'reset', state: FormState }

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'set-model': return { ...state, model: action.value }
    case 'set-effort': return { ...state, effort: action.value }
    case 'set-provider': return { ...state, provider: action.value }
    case 'set-base-url': return { ...state, baseUrl: action.value }
    case 'set-wire-api': return { ...state, wireApi: action.value }
    case 'set-env-key': return { ...state, envKey: action.value }
    case 'set-env-key-instructions': return { ...state, envKeyInstructions: action.value }
    case 'set-stream-idle-timeout': return { ...state, streamIdleTimeoutMs: action.value }
    case 'set-supports-websockets': return { ...state, supportsWebsockets: action.value }
    case 'set-error': return { ...state, error: action.value }
    case 'reset': return action.state
  }
}

function initialFormState(modelConfig: ProviderModelConfig, configContent: string): FormState {
  const provider = readTomlScalar(configContent, 'model_provider')
  const blocks = parseProviderBlocks(configContent)
  const activeBlock = blocks.find(block => block.name === provider) ?? { ...EMPTY_BLOCK, name: provider }
  return {
    model: modelConfig.model,
    effort: modelConfig.effort,
    provider,
    baseUrl: activeBlock.baseUrl,
    wireApi: activeBlock.wireApi,
    envKey: activeBlock.envKey,
    envKeyInstructions: activeBlock.envKeyInstructions,
    streamIdleTimeoutMs: activeBlock.streamIdleTimeoutMs,
    supportsWebsockets: activeBlock.supportsWebsockets,
    error: '',
  }
}

export function CodexModelPanel(props: CodexModelPanelProps) {
  const key = `${props.modelConfig.model}::${props.modelConfig.effort}::${props.configContent}`
  return <CodexModelPanelInner key={key} {...props} />
}

function CodexModelPanelInner({ modelConfig, configContent, scope, projectName, saving, onSave, onSaveConfig }: CodexModelPanelProps) {
  const providerBlocks = useMemo(() => parseProviderBlocks(configContent), [configContent])
  const baselineProvider = readTomlScalar(configContent, 'model_provider')
  const activeBlock = providerBlocks.find(block => block.name === baselineProvider) ?? { ...EMPTY_BLOCK, name: baselineProvider }

  const [state, dispatch] = useReducer(formReducer, undefined as never, () => initialFormState(modelConfig, configContent))

  const isDirty =
    state.model !== modelConfig.model ||
    state.effort !== modelConfig.effort ||
    state.provider !== baselineProvider ||
    state.baseUrl !== activeBlock.baseUrl ||
    state.wireApi !== activeBlock.wireApi ||
    state.envKey !== activeBlock.envKey ||
    state.envKeyInstructions !== activeBlock.envKeyInstructions ||
    state.streamIdleTimeoutMs !== activeBlock.streamIdleTimeoutMs ||
    state.supportsWebsockets !== activeBlock.supportsWebsockets

  const eyebrow = scope === 'GLOBAL' ? 'Global / Model' : `${projectName ?? 'Project'} / Model`

  const handleDiscard = () => {
    dispatch({ type: 'reset', state: initialFormState(modelConfig, configContent) })
  }

  const handleSave = async () => {
    dispatch({ type: 'set-error', value: '' })
    try {
      await onSave({ ...modelConfig, model: state.model, effort: state.effort })
      let nextConfig = writeTomlScalar(configContent, 'model_provider', state.provider)
      if (state.provider.trim()) {
        nextConfig = upsertProviderBlock(nextConfig, {
          name: state.provider.trim(),
          baseUrl: state.baseUrl,
          wireApi: state.wireApi,
          envKey: state.envKey,
          envKeyInstructions: state.envKeyInstructions,
          streamIdleTimeoutMs: state.streamIdleTimeoutMs,
          supportsWebsockets: state.supportsWebsockets,
        })
      }
      if (nextConfig !== configContent) {
        await onSaveConfig(nextConfig)
      }
    } catch (e) {
      dispatch({ type: 'set-error', value: e instanceof Error ? e.message : 'Failed to save' })
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] gap-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Model"
        sub="Codex model + reasoning effort"
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">

          <section className="space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">Model</h4>
            <select
              value={state.model}
              onChange={(event) => dispatch({ type: 'set-model', value: event.target.value })}
              className="w-full max-w-md px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Default</option>
              {MODELS_BY_PROVIDER.codex.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </section>

          <section className="space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">Reasoning Effort</h4>
            <select
              value={state.effort}
              onChange={(event) => dispatch({ type: 'set-effort', value: event.target.value })}
              className="w-full max-w-xs px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Default</option>
              {EFFORT_LEVELS.codex.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </section>

          <section className="space-y-2">
            <h4 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">Model Provider</h4>
            <input
              value={state.provider}
              onChange={(event) => dispatch({ type: 'set-provider', value: event.target.value })}
              placeholder="openai"
              className="w-full max-w-sm h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </section>

          {state.provider.trim() ? (
            <div className="rounded-lg border border-border/30 bg-background p-3 space-y-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Provider Block</p>
                <p className="text-[10px] text-foreground/50 mt-1">Edits <code className="font-mono">[model_providers.{state.provider.trim()}]</code> in the current Codex config.</p>
              </div>
              <ProviderField label="Base URL" value={state.baseUrl} onChange={(value) => dispatch({ type: 'set-base-url', value })} placeholder="https://api.openai.com/v1" />
              <ProviderField label="Wire API" value={state.wireApi} onChange={(value) => dispatch({ type: 'set-wire-api', value })} placeholder="responses" />
              <ProviderField label="Env Key" value={state.envKey} onChange={(value) => dispatch({ type: 'set-env-key', value })} placeholder="OPENAI_API_KEY" />
              <ProviderField label="Env Key Instructions" value={state.envKeyInstructions} onChange={(value) => dispatch({ type: 'set-env-key-instructions', value })} placeholder="Set OPENAI_API_KEY before launching Codex." />
              <ProviderField label="Stream Idle Timeout Ms" value={state.streamIdleTimeoutMs} onChange={(value) => dispatch({ type: 'set-stream-idle-timeout', value })} placeholder="300000" />
              <BooleanField label="Supports WebSockets" value={state.supportsWebsockets} onChange={(value) => dispatch({ type: 'set-supports-websockets', value })} />
            </div>
          ) : null}
        </div>
      </div>

      <ErrorStrip message={state.error} onDismiss={() => dispatch({ type: 'set-error', value: '' })} />

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
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">{label}</h4>
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
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">{label}</h4>
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
