import { useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { Button } from '@ui/button'
import type { ProviderModelConfig } from '@core/api/client'
import { EFFORT_LEVELS, MODELS_BY_PROVIDER } from '../constants'

interface GeminiModelPanelProps {
  modelConfig: ProviderModelConfig
  settingsContent: string
  saving: string | null
  onSave: (model: ProviderModelConfig) => Promise<void>
}

export function GeminiModelPanel({ modelConfig, settingsContent, saving, onSave }: GeminiModelPanelProps) {
  const [model, setModel] = useState(modelConfig.model)
  const [effort, setEffort] = useState(modelConfig.effort)

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

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Models</h3>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">Gemini model selection is stored in <code className="font-mono">settings.json</code> under <code className="font-mono">model</code>.</p>
        </div>
        {isDirty ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest animate-pulse">Unsaved</span>
            <Button size="sm" variant="ghost" onClick={() => { setModel(modelConfig.model); setEffort(modelConfig.effort) }} className="h-7 text-[10px]">
              <RotateCcw size={10} className="mr-1" /> Discard
            </Button>
            <Button
              size="sm"
              onClick={() => onSave({ ...modelConfig, model, effort })}
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
          {MODELS_BY_PROVIDER.gemini.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </section>

      <section className="space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">Thinking Mode</h4>
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
        <p className="text-[10px] text-muted-foreground/50">Sandbox mode in current settings: <span className="font-mono">{sandboxMode || 'default'}</span></p>
        <p className="text-[10px] text-muted-foreground/50">Use the Settings panel for other Gemini <code className="font-mono">settings.json</code> keys like theme, checkpointing, editor, telemetry, and advanced tool config.</p>
      </div>
      </div>
    </div>
  )
}
