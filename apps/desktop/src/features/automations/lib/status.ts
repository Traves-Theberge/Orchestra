import type { AutomationRunStatus } from '@core/api/client'

export type RunStatusTone = 'neutral' | 'active' | 'success' | 'failure' | 'muted'

export type RunStatusMeta = {
  label: string
  /** Secondary qualifier, e.g. the skip reason. */
  detail?: string
  tone: RunStatusTone
}

const STATUS_META: Record<AutomationRunStatus, RunStatusMeta> = {
  queued: { label: 'Queued', tone: 'neutral' },
  starting: { label: 'Starting', tone: 'active' },
  running: { label: 'Running', tone: 'active' },
  succeeded: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'failure' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  skipped_precheck: { label: 'Skipped', detail: 'precheck', tone: 'muted' },
  skipped_missed: { label: 'Skipped', detail: 'missed', tone: 'muted' },
  skipped_busy: { label: 'Skipped', detail: 'busy', tone: 'muted' },
  skipped_unavailable: { label: 'Skipped', detail: 'unavailable', tone: 'muted' },
}

export const RUN_STATUSES = Object.keys(STATUS_META) as AutomationRunStatus[]

export const ACTIVE_RUN_STATUSES: readonly AutomationRunStatus[] = ['queued', 'starting', 'running']

/** Status filter buckets shown in the Runs dashboard. */
export const RUN_STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'skipped', label: 'Skipped' },
] as const
export type RunStatusFilter = (typeof RUN_STATUS_FILTERS)[number]['value']

export function runStatusMeta(status: string | undefined | null): RunStatusMeta {
  if (status && status in STATUS_META) return STATUS_META[status as AutomationRunStatus]
  return { label: status ? status.replace(/_/g, ' ') : 'Unknown', tone: 'neutral' }
}

export function isRunActive(status: string | undefined | null): boolean {
  return !!status && (ACTIVE_RUN_STATUSES as readonly string[]).includes(status)
}

export function isRunSkipped(status: string | undefined | null): boolean {
  return !!status && status.startsWith('skipped_')
}

export function matchesRunStatusFilter(status: string, filter: RunStatusFilter): boolean {
  switch (filter) {
    case 'all': return true
    case 'active': return isRunActive(status)
    case 'skipped': return isRunSkipped(status)
    default: return status === filter
  }
}

/** Text classes for the status dot / label. Red is reserved for failures. */
export function toneDotClass(tone: RunStatusTone): string {
  switch (tone) {
    case 'success': return 'bg-emerald-500'
    case 'failure': return 'bg-red-500'
    case 'active': return 'bg-sky-500 animate-pulse'
    case 'muted': return 'bg-muted-foreground/40'
    default: return 'bg-muted-foreground/70'
  }
}
