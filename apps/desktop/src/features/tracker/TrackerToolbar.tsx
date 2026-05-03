import type { TrackerConfig, WorkItemFilter } from '@/entities/tracker/types'

interface ToolbarProps {
  config: TrackerConfig | null
  filter: WorkItemFilter
  onFilterChange: (filter: WorkItemFilter) => void
}

const LINEAR_STATES = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Cancelled']
const GITHUB_STATES = ['open', 'closed']

/**
 * Per-tracker toolbar slot rendered above the WorkItemBrowser.
 * Routes to a tracker-specific filter UI based on `config.type`.
 * Returns null when no config is selected.
 */
export function TrackerToolbar({ config, filter, onFilterChange }: ToolbarProps) {
  if (!config) return null
  switch (config.type) {
    case 'linear':
      return <StateSelectToolbar states={LINEAR_STATES} filter={filter} onFilterChange={onFilterChange} />
    case 'jira':
      return <JiraToolbar filter={filter} onFilterChange={onFilterChange} />
    case 'github':
      return <StateSelectToolbar states={GITHUB_STATES} filter={filter} onFilterChange={onFilterChange} />
    default:
      return null
  }
}

interface StateSelectProps {
  states: string[]
  filter: WorkItemFilter
  onFilterChange: (filter: WorkItemFilter) => void
}

function StateSelectToolbar({ states, filter, onFilterChange }: StateSelectProps) {
  const active = filter.states?.[0] ?? ''
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background">
      <span className="text-xs text-muted-foreground">State:</span>
      <select
        value={active}
        onChange={(e) =>
          onFilterChange({ ...filter, states: e.target.value ? [e.target.value] : undefined })
        }
        className="text-xs bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All</option>
        {states.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  )
}

interface JiraProps {
  filter: WorkItemFilter
  onFilterChange: (filter: WorkItemFilter) => void
}

/**
 * Jira workflows are arbitrary, so we expose a free-text state filter rather
 * than a fixed dropdown. Users type the literal Jira status name (e.g.
 * "In Progress", "Code Review").
 */
function JiraToolbar({ filter, onFilterChange }: JiraProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background">
      <span className="text-xs text-muted-foreground">State:</span>
      <input
        type="text"
        placeholder="e.g. In Progress"
        value={filter.states?.[0] ?? ''}
        onChange={(e) =>
          onFilterChange({ ...filter, states: e.target.value ? [e.target.value] : undefined })
        }
        className="text-xs bg-background border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring w-40"
      />
    </div>
  )
}
