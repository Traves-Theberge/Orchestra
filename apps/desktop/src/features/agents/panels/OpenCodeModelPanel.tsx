import { useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { Button } from '@ui/button'
import type { ProviderModelConfig } from '@core/api/client'
import { MODELS_BY_PROVIDER } from '../constants'

interface OpenCodeModelPanelProps {
  modelConfig: ProviderModelConfig
  configContent: string
  saving: string | null
  onSave: (model: ProviderModelConfig) => Promise<void>
}

export function OpenCodeModelPanel({ modelConfig, configContent, saving, onSave }: OpenCodeModelPanelProps) {
  const [model, setModel] = useState(modelConfig.model)
  const [smallModel, setSmallModel] = useState(modelConfig.effort)

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

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Models</h3>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">OpenCode uses <code className="font-mono">model</code> and <code className="font-mono">small_model</code> in <code className="font-mono">opencode.json</code>.</p>
        </div>
        {isDirty ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest animate-pulse">Unsaved</span>
            <Button size="sm" variant="ghost" onClick={() => { setModel(modelConfig.model); setSmallModel(modelConfig.effort) }} className="h-7 text-[10px]">
              <RotateCcw size={10} className="mr-1" /> Discard
            </Button>
            <Button
              size="sm"
              onClick={() => onSave({ ...modelConfig, model, effort: smallModel })}
              disabled={!!saving}
              className="h-7 bg-primary text-primary-foreground font-bold uppercase text-[10px] px-4 rounded-lg"
            >
              {saving ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />}
              Save
            </Button>
          </div>
        ) : null}
      </div>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Primary Model</h4>
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
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Small Model</h4>
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
  )
}
