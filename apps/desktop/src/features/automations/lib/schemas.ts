import { z } from 'zod'
import type { Automation, AutomationInput, AutomationRun } from '@core/api/client'
import { isCronSyntaxValid, normalizeSchedule } from './schedule'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hourly'), minute: z.number().int().min(0, 'Minute must be 0-59').max(59, 'Minute must be 0-59'), timezone: z.string().optional() }),
  z.object({ kind: z.literal('daily'), time: z.string().regex(TIME, 'Use HH:MM (24h)'), timezone: z.string().optional() }),
  z.object({ kind: z.literal('weekdays'), time: z.string().regex(TIME, 'Use HH:MM (24h)'), timezone: z.string().optional() }),
  z.object({ kind: z.literal('weekly'), time: z.string().regex(TIME, 'Use HH:MM (24h)'), day: z.number().int().min(0).max(6), timezone: z.string().optional() }),
  z.object({
    kind: z.literal('cron'),
    cron: z.string().trim().min(1, 'Enter a cron expression').refine(isCronSyntaxValid, 'Cron needs 5 fields: minute hour day month weekday'),
    timezone: z.string().optional(),
  }),
])

/** Client-side validation of the editor form before it is sent to the backend. */
export const automationFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Keep the name under 120 characters'),
  prompt: z.string().trim().min(1, 'Prompt is required'),
  provider: z.string().trim().min(1, 'Choose an agent'),
  model: z.string(),
  reasoning_effort: z.string(),
  agent_id: z.string().optional(),
  project_id: z.string(),
  task_id: z.string(),
  workspace_mode: z.enum(['project', 'new_worktree']),
  base_branch: z.string(),
  schedule: scheduleSchema,
  grace_minutes: z.number().int().min(0),
  precheck: z.object({
    command: z.string(),
    timeout_seconds: z.number().int().min(1, 'Timeout must be at least 1 second').max(3600, 'Timeout must be at most 3600 seconds'),
  }),
  enabled: z.boolean(),
})

export type AutomationFormValues = z.input<typeof automationFormSchema>
export type AutomationFormErrors = Partial<Record<string, string>>

/** Validates the form and returns either the API payload or a field → message map. */
export function validateAutomationForm(values: AutomationFormValues): { ok: true; input: AutomationInput } | { ok: false; errors: AutomationFormErrors } {
  const result = automationFormSchema.safeParse({ ...values, schedule: normalizeSchedule(values.schedule as AutomationInput['schedule']) })
  if (!result.success) {
    const errors: AutomationFormErrors = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || 'form'
      if (!errors[key]) errors[key] = issue.message
    }
    return { ok: false, errors }
  }
  const data = result.data
  const hasProject = data.project_id !== ''
  return {
    ok: true,
    input: {
      name: data.name.trim(),
      prompt: data.prompt,
      provider: data.provider,
      model: data.model,
      reasoning_effort: data.reasoning_effort,
      agent_id: data.agent_id?.trim() ?? '',
      project_id: data.project_id,
      task_id: data.task_id,
      workspace_mode: hasProject ? data.workspace_mode : 'project',
      base_branch: hasProject && data.workspace_mode === 'new_worktree' ? data.base_branch.trim() : '',
      schedule: data.schedule,
      grace_minutes: data.grace_minutes,
      precheck: { command: data.precheck.command.trim(), timeout_seconds: data.precheck.timeout_seconds },
      enabled: data.enabled,
    },
  }
}

// ---------------------------------------------------------------------------
// Response parsing: lenient, so a newer/older backend never crashes the UI.
// ---------------------------------------------------------------------------

const str = z.string().nullish().transform(value => value ?? '')
const num = z.number().nullish().transform(value => value ?? 0)

const automationResponseSchema = z.looseObject({
  id: z.string(),
  name: str,
  prompt: str,
  provider: str,
  model: str,
  reasoning_effort: str,
  agent_id: str,
  project_id: str,
  task_id: str,
  workspace_mode: z.enum(['project', 'new_worktree']).nullish().transform(value => value ?? 'project'),
  base_branch: str,
  schedule: z.looseObject({ kind: z.string() }).nullish().transform(value => value ?? { kind: 'daily' }),
  grace_minutes: z.number().nullish(),
  precheck: z.object({ command: str, timeout_seconds: num }).nullish(),
  enabled: z.boolean().nullish().transform(value => value ?? true),
  created_at: str,
  updated_at: str,
  next_run_at: str,
  last_run_at: str,
  last_run_status: str,
  schedule_description: str,
  project_name: str,
  task_identifier: str,
  task_title: str,
})

const runResponseSchema = z.looseObject({
  id: z.string(),
  automation_id: str,
  automation_name: str,
  run_number: num,
  title: str,
  trigger: z.string().nullish().transform(value => value === 'manual' ? 'manual' : 'scheduled'),
  status: str,
  scheduled_for: str,
  started_at: str,
  finished_at: str,
  project_id: str,
  workspace_id: str,
  workspace_path: str,
  branch: str,
  chat_project_id: str,
  chat_session_id: str,
  task_id: str,
  provider: str,
  model: str,
  output: str,
  output_truncated: z.boolean().nullish().transform(value => value ?? false),
  error: str,
  precheck: z.object({ exit_code: num, stdout: str, stderr: str, duration_ms: num }).nullish(),
  usage: z.object({ input_tokens: num, output_tokens: num, total_tokens: num }).nullish(),
  occurrence_count: z.number().nullish().transform(value => value ?? 1),
})

export function parseAutomation(value: unknown): Automation | null {
  const result = automationResponseSchema.safeParse(value)
  return result.success ? (result.data as unknown as Automation) : null
}

export function parseAutomationRun(value: unknown): AutomationRun | null {
  const result = runResponseSchema.safeParse(value)
  return result.success ? (result.data as unknown as AutomationRun) : null
}

export function parseList<T>(values: unknown, parse: (value: unknown) => T | null): T[] {
  if (!Array.isArray(values)) return []
  return values.map(parse).filter((value): value is T => value !== null)
}
