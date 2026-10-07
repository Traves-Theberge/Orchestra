import type { AutomationSchedule } from '@core/api/client'

export type AutomationTemplate = {
  id: string
  name: string
  summary: string
  prompt: string
  schedule: Omit<AutomationSchedule, 'timezone'>
  grace_minutes: number
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'weekday-repo-audit',
    name: 'Weekday repo audit',
    summary: 'Weekdays at 09:00 · 12h grace',
    schedule: { kind: 'weekdays', time: '09:00' },
    grace_minutes: 720,
    prompt: [
      'Audit the repository for problems that appeared since the last working day.',
      '',
      '- Run the test suite and linters; summarize any failures with file and line.',
      '- Review commits merged in the last 24 hours for risky changes.',
      '- Flag new TODO/FIXME comments and dependency changes.',
      '',
      'Reply with a short Markdown report: **Status**, **Findings**, **Suggested follow-ups**. Do not modify files.',
    ].join('\n'),
  },
  {
    id: 'release-readiness',
    name: 'Release readiness',
    summary: 'Thursdays at 14:00 · 24h grace',
    schedule: { kind: 'weekly', time: '14:00', day: 4 },
    grace_minutes: 1440,
    prompt: [
      'Assess whether the default branch is ready to release.',
      '',
      '- Build the project and run the full test suite.',
      '- List changes since the last tag and draft release notes grouped by area.',
      '- Call out blockers: failing checks, open migrations, unfinished feature flags.',
      '',
      'End with a clear **Ready / Not ready** verdict and the reasons.',
    ].join('\n'),
  },
  {
    id: 'daily-change-review',
    name: 'Daily change review',
    summary: 'Daily at 16:30 · 3h grace',
    schedule: { kind: 'daily', time: '16:30' },
    grace_minutes: 180,
    prompt: [
      "Review today's changes in this repository.",
      '',
      '- Summarize each commit in one line.',
      '- Point out bugs, missing tests, or unclear code worth a second look.',
      '',
      'Keep the report concise and actionable. Do not modify files.',
    ].join('\n'),
  },
  {
    id: 'hourly-maintenance-check',
    name: 'Hourly maintenance check',
    summary: 'Hourly at :15 · 30m grace',
    schedule: { kind: 'hourly', minute: 15 },
    grace_minutes: 30,
    prompt: [
      'Run a quick health check of the workspace.',
      '',
      '- Confirm the project builds and the fast test subset passes.',
      '- Report only if something is broken; otherwise reply "All clear".',
    ].join('\n'),
  },
]
