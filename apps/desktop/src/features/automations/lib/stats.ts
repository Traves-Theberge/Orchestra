import type { AutomationRun } from '@core/api/client'
import { parseTimestamp } from './schedule'

const HOUR = 3_600_000

export function computeRunStats(runs: AutomationRun[], now: number) {
  const within = (run: AutomationRun, ms: number) => {
    const at = parseTimestamp(run.finished_at || run.started_at || run.scheduled_for)
    return !!at && now - at.getTime() <= ms
  }
  const count = (status: string, ms: number) => runs.filter(run => run.status === status && within(run, ms)).length
  return {
    succeeded24h: count('succeeded', 24 * HOUR),
    failed24h: count('failed', 24 * HOUR),
    succeeded7d: count('succeeded', 7 * 24 * HOUR),
    failed7d: count('failed', 7 * 24 * HOUR),
  }
}
