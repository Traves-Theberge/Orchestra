// apps/desktop/src/features/agents/panels/GeminiModelPanel.tsx
import { useEffect, useMemo, useState } from 'react'
import { PanelHeader } from '../components/PanelHeader'
import { PanelFooter } from '../components/PanelFooter'
import { ErrorStrip } from '../components/ErrorStrip'
import type { Scope } from '../types'
import type { ProviderModelConfig } from '@core/api/client'
import { EFFORT_LEVELS, MODELS_BY_PROVIDER } from '../constants'

interface GeminiModelPanelProps {
  modelConfig: ProviderModelConfig
  settingsContent: string
  scope: Scope
  projectName: string | null
  saving: string | null
  onSave: (model: ProviderModelConfig) => Promise<void>
}

export function GeminiModelPanel({ modelConfig, settingsContent, scope, projectName, saving, onSave }: GeminiModelPanelProps) {
  const [model, setModel] = useState(modelConfig.model)
  const [effort, setEffort] = useState(modelConfig.effort)
  const [error, setError] = useState('')

  useEffect(() => {
    setModel(modelConfig.model)
    setEffort(modelConfig.effort)
  }, [modelConfig])

  const sandboxMode = useMemo(() => {
    try {
      const parsed = JSON.parse(settingsContent) as Record<string, unknown>
      const tools = parsed.tools as Record<string, unknown> | undefined
      return typeof tools?.sandbox === 'string' ? tools.sandbox : ''
    } catch {
      return ''
    }
  }, [settingsContent])

  const isDirty = model !== modelConfig.model || effort !== modelConfig.effort

  const eyebrow = scope === 'GLOBAL' ? 'Global / Model' : `${projectName ?? 'Project'} / Model`

  const handleDiscard = () => {
    setModel(modelConfig.model)
    setEffort(modelConfig.effort)
  }

  const handleSave = async () => {
    setError('')
    try {
      await onSave({ ...modelConfig, model, effort })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  return (
    <div className="flex flex-col h-full p-[18px] space-y-[14px]">
      <PanelHeader
        eyebrow={eyebrow}
        title="Model"
        sub="Gemini model selection"
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
              {MODELS_BY_PROVIDER.gemini.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </section>

          <section className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-foreground/45">Thinking Mode</h4>
            <select
              value={effort}
              onChange={(event) => setEffort(event.target.value)}
              className="w-full max-w-xs px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Default</option>
              {EFFORT_LEVELS.gemini.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </section>

          <div className="rounded-lg border border-border/30 bg-muted/10 p-3 space-y-1">
            <p className="text-[11px] font-semibold">Settings Context</p>
            <p className="text-[10px] text-foreground/50">Sandbox mode in current settings: <span className="font-mono">{sandboxMode || 'default'}</span></p>
            <p className="text-[10px] text-foreground/50">Use the Settings panel for other Gemini <code className="font-mono">settings.json</code> keys like theme, checkpointing, editor, telemetry, and advanced tool config.</p>
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
