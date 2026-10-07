import type { Automation } from '@core/api/client'
import type { AutomationFormValues } from './schemas'
import { DEFAULT_GRACE_MINUTES, DEFAULT_PRECHECK_TIMEOUT, localTimezone } from './schedule'
import type { AutomationTemplate } from './templates'

export function initialFormValues(automation?: Automation | null, template?: AutomationTemplate | null): AutomationFormValues {
  if (automation) {
    return {
      name: automation.name,
      prompt: automation.prompt,
      provider: automation.provider,
      model: automation.model ?? '',
      reasoning_effort: automation.reasoning_effort ?? '',
      agent_id: automation.agent_id ?? '',
      project_id: automation.project_id ?? '',
      task_id: automation.task_id ?? '',
      workspace_mode: automation.workspace_mode ?? 'project',
      base_branch: automation.base_branch ?? '',
      schedule: { ...automation.schedule } as AutomationFormValues['schedule'],
      grace_minutes: automation.grace_minutes ?? DEFAULT_GRACE_MINUTES,
      precheck: { command: automation.precheck?.command ?? '', timeout_seconds: automation.precheck?.timeout_seconds || DEFAULT_PRECHECK_TIMEOUT },
      enabled: automation.enabled ?? true,
    }
  }
  const timezone = localTimezone()
  return {
    name: template?.name ?? '',
    prompt: template?.prompt ?? '',
    provider: '',
    model: '',
    reasoning_effort: '',
    agent_id: '',
    project_id: '',
    task_id: '',
    workspace_mode: 'project',
    base_branch: '',
    schedule: { ...(template?.schedule ?? { kind: 'weekdays', time: '09:00' }), timezone } as AutomationFormValues['schedule'],
    grace_minutes: template?.grace_minutes ?? DEFAULT_GRACE_MINUTES,
    precheck: { command: '', timeout_seconds: DEFAULT_PRECHECK_TIMEOUT },
    enabled: true,
  }
}
