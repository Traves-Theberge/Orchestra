import type { AutomationSchedule, AutomationScheduleKind } from '@core/api/client'

export const CADENCE_OPTIONS: { value: AutomationScheduleKind; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'cron', label: 'Custom (cron)' },
]

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export const GRACE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'No grace' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 180, label: '3 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '24 hours' },
  { value: 2880, label: '48 hours' },
]

export const DEFAULT_GRACE_MINUTES = 720
export const DEFAULT_PRECHECK_TIMEOUT = 60

export function graceLabel(minutes: number | undefined): string {
  const value = minutes ?? DEFAULT_GRACE_MINUTES
  return GRACE_OPTIONS.find(option => option.value === value)?.label ?? `${value} minutes`
}

export const CRON_FIELDS = [
  { key: 'minute', label: 'Minute', range: '0-59' },
  { key: 'hour', label: 'Hour', range: '0-23' },
  { key: 'dom', label: 'Day', range: '1-31' },
  { key: 'month', label: 'Month', range: '1-12' },
  { key: 'dow', label: 'Weekday', range: '0-6' },
] as const

/** Splits a cron expression into its 5 cells; missing cells are empty strings. */
export function cronCells(expression: string): string[] {
  const parts = expression.trim().split(/\s+/).filter(Boolean)
  return CRON_FIELDS.map((_, index) => parts[index] ?? '')
}

export function cronFieldCount(expression: string): number {
  return expression.trim().split(/\s+/).filter(Boolean).length
}

const CRON_CELL = /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/

/** Cheap client-side syntax check; the backend preview endpoint is authoritative. */
export function isCronSyntaxValid(expression: string): boolean {
  const parts = expression.trim().split(/\s+/).filter(Boolean)
  return parts.length === 5 && parts.every(part => CRON_CELL.test(part))
}

function parseTime(time: string | undefined): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? '')
  if (!match) return [9, 0]
  return [Number(match[1]), Number(match[2])]
}

/** Compiles a preset schedule to the equivalent 5-field cron string (mirrors the backend). */
export function scheduleToCron(schedule: AutomationSchedule): string {
  const [hour, minute] = parseTime(schedule.time)
  switch (schedule.kind) {
    case 'hourly': return `${schedule.minute ?? 0} * * * *`
    case 'daily': return `${minute} ${hour} * * *`
    case 'weekdays': return `${minute} ${hour} * * 1-5`
    case 'weekly': return `${minute} ${hour} * * ${schedule.day ?? 1}`
    case 'cron': return schedule.cron ?? ''
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Local fallback description used until the backend preview responds. */
export function describeSchedule(schedule: AutomationSchedule): string {
  const zone = schedule.timezone ? ` (${schedule.timezone})` : ''
  switch (schedule.kind) {
    case 'hourly': return `Hourly at :${pad(schedule.minute ?? 0)}${zone}`
    case 'daily': return `Daily at ${schedule.time || '09:00'}${zone}`
    case 'weekdays': return `Weekdays at ${schedule.time || '09:00'}${zone}`
    case 'weekly': return `${WEEKDAYS[schedule.day ?? 1]}s at ${schedule.time || '09:00'}${zone}`
    case 'cron': return `Cron ${schedule.cron || '(empty)'}${zone}`
  }
}

/** Normalizes a schedule so only the fields relevant to its kind are sent. */
export function normalizeSchedule(schedule: AutomationSchedule): AutomationSchedule {
  const base: AutomationSchedule = { kind: schedule.kind }
  if (schedule.timezone) base.timezone = schedule.timezone
  switch (schedule.kind) {
    case 'hourly': return { ...base, minute: schedule.minute ?? 0 }
    case 'daily':
    case 'weekdays': return { ...base, time: schedule.time || '09:00' }
    case 'weekly': return { ...base, time: schedule.time || '09:00', day: schedule.day ?? 1 }
    case 'cron': return { ...base, cron: (schedule.cron ?? '').trim() }
  }
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const FALLBACK_ZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Edmonton', 'America/Los_Angeles', 'America/Toronto', 'America/Vancouver', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Kolkata', 'Australia/Sydney']

export function timezoneOptions(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone')
    if (supported && supported.length) return supported.includes('UTC') ? supported : ['UTC', ...supported]
  } catch { /* fall through */ }
  return FALLBACK_ZONES
}

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

export function parseTimestamp(value: string | undefined | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatAbsolute(value: string | undefined | null, timeZone?: string): string {
  const date = parseTimestamp(value)
  if (!date) return ''
  try {
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) })
  } catch {
    return date.toLocaleString()
  }
}

export function formatRelative(value: string | undefined | null, now: number = Date.now()): string {
  const date = parseTimestamp(value)
  if (!date) return ''
  const diff = date.getTime() - now
  const abs = Math.abs(diff)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  let text: string
  if (abs < minute) return diff >= 0 ? 'in <1m' : 'just now'
  if (abs < hour) text = `${Math.round(abs / minute)}m`
  else if (abs < day) text = `${Math.round(abs / hour)}h`
  else text = `${Math.round(abs / day)}d`
  return diff >= 0 ? `in ${text}` : `${text} ago`
}

/** "Oct 8, 09:00 (in 3h)" */
export function formatAbsoluteWithRelative(value: string | undefined | null, now?: number): string {
  const absolute = formatAbsolute(value)
  if (!absolute) return ''
  return `${absolute} (${formatRelative(value, now)})`
}

export function formatDuration(start: string | undefined | null, end: string | undefined | null, now: number = Date.now()): string {
  const from = parseTimestamp(start)
  if (!from) return ''
  const to = parseTimestamp(end)?.getTime() ?? now
  const seconds = Math.max(0, Math.round((to - from.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
