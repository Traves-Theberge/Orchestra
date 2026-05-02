import { useEffect, useState } from 'react'
import { listTrackerConfigs } from '@core/api/client'
import type { BackendConfig } from '@core/api/client'
import type { WorkItem, WorkItemFilter, TrackerConfig } from '@/entities/tracker/types'
import { useTrackerWorkItems } from '@/entities/tracker/use-tracker-work-items'
import { WorkItemBrowser } from './WorkItemBrowser'
import { WorkItemDetail } from './WorkItemDetail'
import { TrackerToolbar } from './TrackerToolbar'

interface Props {
  config: BackendConfig | null
}

/**
 * Two-pane tracker viewer: connection picker + Toolbar at top, browser on the
 * left, detail on the right. The shell is tracker-agnostic; tracker-specific
 * filter UI is delegated to TrackerToolbar.
 */
export function TrackerViewer({ config }: Props) {
  const [configs, setConfigs] = useState<TrackerConfig[]>([])
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null)
  const [filter, setFilter] = useState<WorkItemFilter>({})
  const [configsError, setConfigsError] = useState<string | null>(null)

  // Load the list of configured connections.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!config) {
        if (!cancelled) {
          setConfigs([])
          setActiveConfigId(null)
        }
        return
      }
      try {
        const data = await listTrackerConfigs(config)
        if (cancelled) return
        setConfigs(data)
        setActiveConfigId((prev) => prev ?? (data[0]?.id ?? null))
      } catch (err: unknown) {
        if (cancelled) return
        setConfigsError(err instanceof Error ? err.message : String(err))
      }
    }
    void run()
    return () => { cancelled = true }
  }, [config])

  const { items, loading, error } = useTrackerWorkItems(config, activeConfigId, filter)
  const activeConfig = configs.find((c) => c.id === activeConfigId) ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Connection selector */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background">
        <span className="text-sm font-medium">Tracker</span>
        <select
          value={activeConfigId ?? ''}
          onChange={(e) => {
            setActiveConfigId(e.target.value || null)
            setSelectedItem(null)
            setFilter({})
          }}
          className="text-sm bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {configs.length === 0 && <option value="">No connections configured</option>}
          {configs.map((c) => (
            <option key={c.id} value={c.id}>{c.display_name}</option>
          ))}
        </select>
        {configs.length === 0 && (
          <span className="text-xs text-muted-foreground">
            Add a connection in Settings → Connections
          </span>
        )}
        {configsError && (
          <span className="text-xs text-destructive">Failed to load connections: {configsError}</span>
        )}
        {error && (
          <span className="text-xs text-destructive">Failed to load items: {error.message}</span>
        )}
      </div>

      {/* Tracker-specific toolbar slot */}
      <TrackerToolbar config={activeConfig} filter={filter} onFilterChange={setFilter} />

      {/* Two-pane body */}
      <div className="flex flex-1 min-h-0">
        <div className="w-72 flex-shrink-0 border-r border-border overflow-hidden">
          <WorkItemBrowser
            items={items}
            loading={loading}
            selectedId={selectedItem?.id ?? null}
            onSelect={setSelectedItem}
            filter={filter}
            onFilterChange={setFilter}
          />
        </div>
        <div className="flex-1 overflow-hidden">
          <WorkItemDetail item={selectedItem} />
        </div>
      </div>
    </div>
  )
}
