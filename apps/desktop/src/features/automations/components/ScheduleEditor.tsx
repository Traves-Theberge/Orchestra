import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import type { AutomationSchedule, AutomationScheduleKind, BackendConfig } from '@core/api/client'
import { cn } from '@core/utils/cn'
import { Input } from '@ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/select'
import { useSchedulePreview } from '../hooks/use-automations'
import { CADENCE_OPTIONS, CRON_FIELDS, WEEKDAYS, cronCells, cronFieldCount, formatAbsolute, normalizeSchedule, scheduleToCron } from '../lib/schedule'
import { Caption } from './shared'

/** Cadence select + per-kind inputs + custom cron breakdown + live backend preview. */
export function ScheduleEditor({ config, schedule, onChange, error }: {
  config: BackendConfig
  schedule: AutomationSchedule
  onChange: (schedule: AutomationSchedule) => void
  error?: string
}) {
  const normalized = useMemo(() => normalizeSchedule(schedule), [schedule])
  const { preview, loading, error: previewError } = useSchedulePreview(config, normalized)
  const set = (patch: Partial<AutomationSchedule>) => onChange({ ...schedule, ...patch })

  const changeKind = (kind: AutomationScheduleKind) => {
    if (kind === 'cron' && !schedule.cron) {
      onChange({ ...schedule, kind, cron: scheduleToCron(schedule) })
      return
    }
    onChange({ ...schedule, kind })
  }

  const cells = cronCells(schedule.cron ?? '')
  const fieldCount = cronFieldCount(schedule.cron ?? '')

  return (
    <div className="space-y-2">
      <Select value={schedule.kind} onValueChange={value => changeKind(value as AutomationScheduleKind)}>
        <SelectTrigger aria-label="Cadence"><SelectValue /></SelectTrigger>
        <SelectContent>
          {CADENCE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>

      {schedule.kind === 'hourly' ? (
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
          At minute
          <Input
            aria-label="Minute past the hour"
            type="number"
            min={0}
            max={59}
            className="w-20"
            value={schedule.minute ?? 0}
            onChange={event => set({ minute: event.target.value === '' ? 0 : Number(event.target.value) })}
          />
        </label>
      ) : null}

      {schedule.kind === 'weekly' ? (
        <Select value={String(schedule.day ?? 1)} onValueChange={value => set({ day: Number(value) })}>
          <SelectTrigger aria-label="Day of week"><SelectValue /></SelectTrigger>
          <SelectContent>
            {WEEKDAYS.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : null}

      {schedule.kind === 'daily' || schedule.kind === 'weekdays' || schedule.kind === 'weekly' ? (
        <Input aria-label="Time of day" type="time" value={schedule.time ?? '09:00'} onChange={event => set({ time: event.target.value })} />
      ) : null}

      {schedule.kind === 'cron' ? (
        <div className="space-y-2">
          <Input
            aria-label="Cron expression"
            placeholder="0 9 * * 1-5"
            className="font-mono"
            value={schedule.cron ?? ''}
            aria-invalid={!!error}
            onChange={event => set({ cron: event.target.value })}
          />
          <div className="grid grid-cols-5 gap-1" aria-label="Cron fields">
            {CRON_FIELDS.map((field, index) => (
              <div key={field.key} className={cn('rounded border border-border px-1.5 py-1 text-center', !cells[index] && 'border-dashed')}>
                <div className="truncate font-mono text-[12px] text-foreground" data-testid={`cron-cell-${field.key}`}>{cells[index] || '–'}</div>
                <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground" title={field.range}>{field.label}</div>
              </div>
            ))}
          </div>
          {fieldCount > 5 ? <p className="text-[11px] text-muted-foreground">Only 5 fields are used (minute hour day month weekday).</p> : null}
        </div>
      ) : null}

      {error ? <p className="text-[11px] text-red-500">{error}</p> : null}

      <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2" aria-live="polite" data-testid="schedule-preview">
        <div className="flex items-center gap-1.5">
          <Caption>Next runs</Caption>
          {loading ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
        </div>
        {previewError ? (
          <p className="mt-1 text-[12px] text-muted-foreground">Preview unavailable: {previewError}</p>
        ) : preview && !preview.valid ? (
          <p className="mt-1 text-[12px] text-red-500">{preview.error || 'Invalid schedule'}</p>
        ) : preview ? (
          <>
            <p className="mt-1 text-[12px] text-foreground">{preview.description}</p>
            <ul className="mt-1 space-y-0.5">
              {preview.next_runs.slice(0, 3).map(run => (
                <li key={run} className="font-mono text-[11px] text-muted-foreground">{formatAbsolute(run, schedule.timezone || undefined) || run}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-[12px] text-muted-foreground">Calculating…</p>
        )}
      </div>
    </div>
  )
}
