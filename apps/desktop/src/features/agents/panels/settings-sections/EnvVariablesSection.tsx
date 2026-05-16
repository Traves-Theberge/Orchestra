import { useCallback, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@ui/button'

interface EnvVariablesSectionProps {
  local: Record<string, unknown>
  updateField: (key: string, value: unknown) => void
}

export function EnvVariablesSection({ local, updateField }: EnvVariablesSectionProps) {
  const [newEnvKey, setNewEnvKey] = useState('')
  const [newEnvValue, setNewEnvValue] = useState('')

  const envObj = (typeof local.env === 'object' && local.env !== null && !Array.isArray(local.env))
    ? local.env as Record<string, string>
    : {}

  const handleAddEnv = useCallback(() => {
    if (!newEnvKey.trim()) return
    const updated = { ...envObj, [newEnvKey.trim()]: newEnvValue }
    updateField('env', updated)
    setNewEnvKey('')
    setNewEnvValue('')
  }, [newEnvKey, newEnvValue, envObj, updateField])

  const handleRemoveEnv = useCallback((key: string) => {
    const { [key]: _, ...rest } = envObj
    void _
    updateField('env', Object.keys(rest).length > 0 ? rest : undefined)
  }, [envObj, updateField])

  const handleEnvValueChange = useCallback((key: string, value: string) => {
    updateField('env', { ...envObj, [key]: value })
  }, [envObj, updateField])

  return (
    <section className="space-y-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/40">Environment Variables</h4>

      {Object.keys(envObj).length === 0 && (
        <p className="text-[10px] text-muted-foreground/20">No environment variables set</p>
      )}

      <div className="space-y-1.5">
        {Object.entries(envObj).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2 group">
            <span className="text-[10px] font-mono font-bold text-primary/70 shrink-0 w-[140px] truncate">{key}</span>
            <input
              type="text"
              value={value}
              onChange={(e) => handleEnvValueChange(key, e.target.value)}
              className="flex-1 h-7 bg-muted/10 rounded-lg border border-border/30 px-3 font-mono text-[11px] text-foreground focus:outline-none focus:border-primary/30 transition-colors"
            />
            <button
              onClick={() => handleRemoveEnv(key)}
              className="size-5 rounded flex items-center justify-center text-muted-foreground/20 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 shrink-0"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="KEY"
          value={newEnvKey}
          onChange={(e) => setNewEnvKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddEnv()}
          className="w-[140px] h-7 bg-muted/10 rounded-lg border border-border/30 px-3 font-mono text-[10px] text-foreground placeholder:text-muted-foreground/20 focus:outline-none focus:border-primary/30 transition-colors"
        />
        <input
          type="text"
          placeholder="value"
          value={newEnvValue}
          onChange={(e) => setNewEnvValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddEnv()}
          className="flex-1 h-7 bg-muted/10 rounded-lg border border-border/30 px-3 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/20 focus:outline-none focus:border-primary/30 transition-colors"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={handleAddEnv}
          disabled={!newEnvKey.trim()}
          className="size-7 p-0 shrink-0"
        >
          <Plus size={12} />
        </Button>
      </div>
    </section>
  )
}
