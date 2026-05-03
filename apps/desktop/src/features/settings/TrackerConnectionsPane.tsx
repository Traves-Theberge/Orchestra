// apps/desktop/src/features/settings/TrackerConnectionsPane.tsx
import { useCallback, useEffect, useState } from 'react'
import { CircleCheck, CircleX, Pencil, Plus, RefreshCcw, Tag, Trash2 } from 'lucide-react'
import type { BackendConfig } from '@core/api/client'
import { listTrackerConfigs, deleteTrackerConfig, testTrackerConfig } from '@core/api/client'
import type { TrackerConfig } from '@/entities/tracker/types'
import { TrackerConnectionDrawer } from './TrackerConnectionDrawer'

const SOURCE_DOT_CLASS: Record<string, string> = {
  github: 'bg-zinc-400',
  linear: 'bg-violet-400',
  jira: 'bg-blue-400',
  sqlite: 'bg-emerald-400',
  memory: 'bg-zinc-400',
}

type TestState = 'idle' | 'loading' | 'ok' | 'error'

interface Props {
  config: BackendConfig | null
}

/**
 * Lists tracker connections (Linear, Jira, GitHub) with status, test, edit, delete actions.
 * Slots into the Settings page Connections section.
 */
export function TrackerConnectionsPane({ config }: Props) {
  const [configs, setConfigs] = useState<TrackerConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<TrackerConfig | null>(null)
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [testErrors, setTestErrors] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!config) return
    setLoading(true)
    setError(null)
    try {
      const data = await listTrackerConfigs(config)
      setConfigs(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [config])

  useEffect(() => { void load() }, [load])

  const handleTest = async (cfg: TrackerConfig) => {
    if (!config) return
    setTestStates((s) => ({ ...s, [cfg.id]: 'loading' }))
    setTestErrors((s) => ({ ...s, [cfg.id]: '' }))
    try {
      const result = await testTrackerConfig(config, cfg.id)
      if (result.ok) {
        setTestStates((s) => ({ ...s, [cfg.id]: 'ok' }))
      } else {
        setTestStates((s) => ({ ...s, [cfg.id]: 'error' }))
        setTestErrors((s) => ({ ...s, [cfg.id]: result.error ?? 'unknown' }))
      }
    } catch (err) {
      setTestStates((s) => ({ ...s, [cfg.id]: 'error' }))
      setTestErrors((s) => ({ ...s, [cfg.id]: err instanceof Error ? err.message : String(err) }))
    }
  }

  const handleDelete = async (cfg: TrackerConfig) => {
    if (!config) return
    if (!confirm(`Delete connection "${cfg.display_name}"?`)) return
    try {
      await deleteTrackerConfig(config, cfg.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const openDrawer = (target: TrackerConfig | null) => {
    setEditTarget(target)
    setDrawerOpen(true)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">
            Trackers
          </span>
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground/40">
            {configs.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void load()}
            disabled={loading || !config}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium tracking-tight text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] disabled:opacity-40 transition-colors"
          >
            <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => openDrawer(null)}
            disabled={!config}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium tracking-tight text-foreground bg-foreground/[0.06] hover:bg-foreground/[0.1] disabled:opacity-40 transition-colors"
          >
            <Plus size={12} />
            Add connection
          </button>
        </div>
      </div>

      {error && <p className="text-[11.5px] text-destructive">{error}</p>}

      {configs.length === 0 ? (
        <div className="px-4 py-8 rounded-lg bg-foreground/[0.02] border border-border/30 text-center">
          <Tag size={20} className="mx-auto mb-2 text-muted-foreground/40" strokeWidth={1.75} />
          <p className="text-[12px] font-medium text-foreground/70">No tracker connections</p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">
            Add a Linear, Jira, or GitHub connection to dispatch agents at issues.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {configs.map((cfg) => {
            const dotClass = SOURCE_DOT_CLASS[cfg.type] ?? 'bg-zinc-400'
            const test = testStates[cfg.id] ?? 'idle'
            const testErr = testErrors[cfg.id]
            return (
              <div
                key={cfg.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border/40 bg-foreground/[0.01] hover:bg-foreground/[0.02] transition-colors"
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium truncate">{cfg.display_name}</div>
                  <div className="text-[11px] text-muted-foreground/70 truncate">
                    {cfg.type} · {cfg.endpoint || 'no endpoint'}
                    {!cfg.has_token && ' · no token'}
                  </div>
                </div>
                {test === 'ok' && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                    <CircleCheck size={12} /> Connected
                  </span>
                )}
                {test === 'error' && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] text-destructive"
                    title={testErr}
                  >
                    <CircleX size={12} /> Failed
                  </span>
                )}
                {test === 'loading' && (
                  <span className="text-[11px] text-muted-foreground">Testing…</span>
                )}
                <button
                  onClick={() => void handleTest(cfg)}
                  disabled={test === 'loading'}
                  className="text-[11px] text-muted-foreground/80 hover:text-foreground px-2 py-1 rounded hover:bg-foreground/[0.04] transition-colors"
                >
                  Test
                </button>
                <button
                  onClick={() => openDrawer(cfg)}
                  className="text-muted-foreground/80 hover:text-foreground p-1 rounded hover:bg-foreground/[0.04] transition-colors"
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => void handleDelete(cfg)}
                  className="text-destructive/70 hover:text-destructive p-1 rounded hover:bg-destructive/10 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {drawerOpen && (
        <TrackerConnectionDrawer
          config={config}
          existing={editTarget}
          onClose={() => setDrawerOpen(false)}
          onSaved={() => {
            setDrawerOpen(false)
            void load()
          }}
        />
      )}
    </div>
  )
}
