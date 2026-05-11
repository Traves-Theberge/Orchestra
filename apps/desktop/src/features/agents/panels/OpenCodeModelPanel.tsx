// apps/desktop/src/features/agents/panels/OpenCodeModelPanel.tsx
import { useEffect, useMemo, useState } from 'react'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'
import type { ProviderModelConfig } from '@core/api/client'
import { MODELS_BY_PROVIDER } from '../constants'

interface OpenCodeModelPanelProps {
  modelConfig: ProviderModelConfig
  configContent: string
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (model: ProviderModelConfig) => Promise<void>
}

export function OpenCodeModelPanel({ modelConfig, configContent, scope, projectName, saving, onSave }: OpenCodeModelPanelProps) {
  const [model, setModel] = useState(modelConfig.model)
  const [smallModel, setSmallModel] = useState(modelConfig.effort)
  const [error, setError] = useState('')

  useEffect(() => {
    setModel(modelConfig.model)
    setSmallModel(modelConfig.effort)
  }, [modelConfig])

  const providerInfo = useMemo(() => {
    try {
      const parsed = JSON.parse(configContent) as Record<string, unknown>
      const provider = typeof parsed.provider === 'string'
        ? parsed.provider
        : parsed.provider && typeof parsed.provider === 'object'
          ? 'custom provider block'
          : ''
      const small = typeof parsed.small_model === 'string' ? parsed.small_model : ''
      return { provider, small }
    } catch {
      return { provider: '', small: '' }
    }
  }, [configContent])

  const isDirty = model !== modelConfig.model || smallModel !== modelConfig.effort

  const eyebrow = scope === 'GLOBAL' ? 'Global / Model' : `${projectName ?? 'Project'} / Model`

  const handleDiscard = () => {
    setModel(modelConfig.model)
    setSmallModel(modelConfig.effort)
  }

  const handleSave = async () => {
    setError('')
    try {
      await onSave({ ...modelConfig, model, effort: smallModel })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Model"
        sub="OpenCode uses `model` and `small_model` in opencode.json"
        dirty={isDirty}
      />

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">

          <section className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Primary Model</h4>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full max-w-md px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Default</option>
              {MODELS_BY_PROVIDER.opencode.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </section>

          <section className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Small Model</h4>
            <input
              value={smallModel}
              onChange={(event) => setSmallModel(event.target.value)}
              placeholder="openai/gpt-5.3-codex-spark"
              className="w-full max-w-md h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </section>

          <div className="rounded-lg border border-border/30 bg-muted/10 p-3 space-y-1">
            <p className="text-[11px] font-semibold">Config Context</p>
            <p className="text-[10px] text-muted-foreground/50">Current provider setting: <span className="font-mono">{providerInfo.provider || 'default'}</span></p>
            <p className="text-[10px] text-muted-foreground/50">Current small model in config: <span className="font-mono">{providerInfo.small || 'default'}</span></p>
            <p className="text-[10px] text-muted-foreground/50">Use the Config panel for advanced provider blocks, reasoning options, instructions, permissions, and merged OpenCode config layers.</p>
          </div>
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
