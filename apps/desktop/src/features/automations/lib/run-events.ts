import { toast } from 'sonner'
import type { AutomationRun } from '@core/api/client'
import { parseAutomationRun } from './schemas'

type Listener = (run: AutomationRun) => void

const listeners = new Set<Listener>()
const notifiedRunIds = new Set<string>()

/** Subscribes to AUTOMATION_RUN_UPDATED payloads (SSE) and local mutations. */
export function subscribeAutomationRuns(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Broadcasts a run update to every mounted automations view. */
export function publishAutomationRun(run: AutomationRun): void {
  for (const listener of listeners) listener(run)
}

export type AutomationNotifier = (title: string, body: string) => void

/**
 * Entry point for SSE `AUTOMATION_RUN_UPDATED` events. Publishes the run to
 * listeners and, once per run, raises an OS notification + toast when it
 * succeeds or fails.
 */
export function handleAutomationRunEvent(payload: unknown, notify?: AutomationNotifier): void {
  const run = parseAutomationRun(payload)
  if (!run) return
  publishAutomationRun(run)
  if (run.status !== 'succeeded' && run.status !== 'failed') return
  if (notifiedRunIds.has(run.id)) return
  notifiedRunIds.add(run.id)
  const name = run.title || `${run.automation_name || 'Automation'} run ${run.run_number}`
  if (run.status === 'succeeded') {
    notify?.('Automation finished', `${name} succeeded.`)
    toast.success(`${name} succeeded`)
  } else {
    notify?.('Automation failed', run.error ? `${name}: ${run.error}` : `${name} failed.`)
    toast.error(`${name} failed`, run.error ? { description: run.error } : undefined)
  }
}

/** Test helper. */
export function resetAutomationRunEvents(): void {
  listeners.clear()
  notifiedRunIds.clear()
}
