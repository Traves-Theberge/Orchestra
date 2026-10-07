import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  cancelAutomationRun,
  deleteAutomation,
  getAutomationRun,
  listAutomationRuns,
  listAutomationRunsFor,
  listAutomations,
  pauseAutomation,
  previewAutomationSchedule,
  resumeAutomation,
  runAutomationNow,
  toDisplayError,
  type Automation,
  type AutomationRun,
  type AutomationSchedule,
  type AutomationSchedulePreview,
  type BackendConfig,
} from '@core/api/client'
import { isRunActive } from '../lib/status'
import { parseAutomation, parseAutomationRun, parseList } from '../lib/schemas'
import { publishAutomationRun, subscribeAutomationRuns } from '../lib/run-events'

/** Poll interval used while any visible run is active (SSE fallback). */
export const ACTIVE_POLL_MS = 5000

function usePollWhile(active: boolean, refresh: () => void) {
  const refreshRef = useRef(refresh)
  useEffect(() => { refreshRef.current = refresh }, [refresh])
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => refreshRef.current(), ACTIVE_POLL_MS)
    return () => window.clearInterval(id)
  }, [active])
}

function upsertRun(runs: AutomationRun[], run: AutomationRun): AutomationRun[] {
  const index = runs.findIndex(existing => existing.id === run.id)
  if (index === -1) return [run, ...runs]
  const next = runs.slice()
  next[index] = run
  return next
}

// ---------------------------------------------------------------------------
// Automations list
// ---------------------------------------------------------------------------

export function useAutomations(config: BackendConfig) {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const sequence = useRef(0)

  const refresh = useCallback(() => {
    const request = ++sequence.current
    return listAutomations(config).then(
      result => {
        if (request !== sequence.current) return
        setAutomations(parseList(result, parseAutomation))
        setError('')
        setLoading(false)
      },
      err => {
        if (request !== sequence.current) return
        setError(toDisplayError(err))
        setLoading(false)
      },
    )
  }, [config])

  useEffect(() => { void refresh() }, [refresh])

  // Refresh next-run / last-run columns whenever any run changes.
  useEffect(() => {
    let timer = 0
    const unsubscribe = subscribeAutomationRuns(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { void refresh() }, 250)
    })
    return () => { unsubscribe(); window.clearTimeout(timer) }
  }, [refresh])

  usePollWhile(automations.some(automation => isRunActive(automation.last_run_status)), refresh)

  const upsert = useCallback((automation: Automation) => {
    setAutomations(previous => {
      const index = previous.findIndex(existing => existing.id === automation.id)
      if (index === -1) return [...previous, automation]
      const next = previous.slice()
      next[index] = automation
      return next
    })
  }, [])
  const remove = useCallback((id: string) => setAutomations(previous => previous.filter(existing => existing.id !== id)), [])

  return { automations, loading, error, refresh, upsert, remove }
}

// ---------------------------------------------------------------------------
// Runs (all automations or one automation)
// ---------------------------------------------------------------------------

export function useAutomationRuns(config: BackendConfig, automationId?: string, limit = 500) {
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const sequence = useRef(0)

  const refresh = useCallback(() => {
    const request = ++sequence.current
    const load = automationId ? listAutomationRunsFor(config, automationId) : listAutomationRuns(config, { limit })
    return load.then(
      result => {
        if (request !== sequence.current) return
        setRuns(parseList(result, parseAutomationRun))
        setError('')
        setLoading(false)
      },
      err => {
        if (request !== sequence.current) return
        setError(toDisplayError(err))
        setLoading(false)
      },
    )
  }, [config, automationId, limit])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => subscribeAutomationRuns(run => {
    if (automationId && run.automation_id !== automationId) return
    setRuns(previous => upsertRun(previous, run))
  }), [automationId])

  usePollWhile(runs.some(run => isRunActive(run.status)), refresh)

  return { runs, loading, error, refresh }
}

export function useAutomationRun(config: BackendConfig, runId: string, initial?: AutomationRun | null) {
  const [run, setRun] = useState<AutomationRun | null>(initial ?? null)
  const [error, setError] = useState('')

  const refresh = useCallback(() => getAutomationRun(config, runId).then(
    result => {
      const parsed = parseAutomationRun(result)
      if (parsed) setRun(parsed)
      setError('')
    },
    err => setError(toDisplayError(err)),
  ), [config, runId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => subscribeAutomationRuns(update => { if (update.id === runId) setRun(update) }), [runId])
  usePollWhile(isRunActive(run?.status), refresh)

  return { run, error, refresh, setRun }
}

// ---------------------------------------------------------------------------
// Schedule preview (debounced)
// ---------------------------------------------------------------------------

export function useSchedulePreview(config: BackendConfig, schedule: AutomationSchedule, enabled = true, delayMs = 300) {
  const [preview, setPreview] = useState<AutomationSchedulePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const key = JSON.stringify(schedule)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      previewAutomationSchedule(config, JSON.parse(key) as AutomationSchedule).then(
        result => {
          if (cancelled) return
          setPreview({ valid: !!result.valid, description: result.description ?? '', next_runs: result.next_runs ?? [], error: result.error })
          setError('')
          setLoading(false)
        },
        err => {
          if (cancelled) return
          setError(toDisplayError(err))
          setLoading(false)
        },
      )
    }, delayMs)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [config, key, enabled, delayMs])

  return { preview, loading, error }
}

// ---------------------------------------------------------------------------
// Mutations (toast-wrapped)
// ---------------------------------------------------------------------------

export function useAutomationActions(config: BackendConfig, handlers: { onChanged?: (automation: Automation) => void; onDeleted?: (id: string) => void } = {}) {
  const handlersRef = useRef(handlers)
  useEffect(() => { handlersRef.current = handlers })

  const runNow = useCallback(async (automation: Pick<Automation, 'id' | 'name'>): Promise<AutomationRun | null> => {
    try {
      const run = parseAutomationRun(await runAutomationNow(config, automation.id))
      toast.success('Run started', { description: automation.name })
      if (run) publishAutomationRun(run)
      return run
    } catch (err) {
      toast.error(`Could not start ${automation.name}`, { description: toDisplayError(err) })
      return null
    }
  }, [config])

  const setPaused = useCallback(async (automation: Pick<Automation, 'id' | 'name' | 'enabled'>, paused: boolean) => {
    try {
      const updated = parseAutomation(await (paused ? pauseAutomation(config, automation.id) : resumeAutomation(config, automation.id)))
      if (updated) handlersRef.current.onChanged?.(updated)
      toast.success(paused ? 'Automation paused' : 'Automation resumed', { description: automation.name })
      return updated
    } catch (err) {
      toast.error(`Could not ${paused ? 'pause' : 'resume'} ${automation.name}`, { description: toDisplayError(err) })
      return null
    }
  }, [config])

  const remove = useCallback(async (automation: Pick<Automation, 'id' | 'name'>) => {
    try {
      await deleteAutomation(config, automation.id)
      handlersRef.current.onDeleted?.(automation.id)
      toast.success('Automation deleted', { description: automation.name })
      return true
    } catch (err) {
      toast.error(`Could not delete ${automation.name}`, { description: toDisplayError(err) })
      return false
    }
  }, [config])

  const cancelRun = useCallback(async (run: Pick<AutomationRun, 'id' | 'title'>) => {
    try {
      const updated = parseAutomationRun(await cancelAutomationRun(config, run.id))
      if (updated) publishAutomationRun(updated)
      toast.success('Cancellation requested', { description: run.title })
      return updated
    } catch (err) {
      toast.error('Could not cancel run', { description: toDisplayError(err) })
      return null
    }
  }, [config])

  return { runNow, setPaused, remove, cancelRun }
}
