import { describe, expect, it } from 'vitest'

import type { TimelineItem } from '@/components/app-shell/types'

import { extractOperationalPlanItems } from './IssueDetailUtils'

function runEvent(issueId: string, issueIdentifier: string, kind: string, message: string): TimelineItem {
  return {
    type: 'run_event',
    at: '2026-03-13T00:00:00Z',
    data: {
      issue_id: issueId,
      issue_identifier: issueIdentifier,
      event: { kind, message },
    },
  }
}

describe('extractOperationalPlanItems', () => {
  it('parses markdown checkbox items from run events', () => {
    const timeline: TimelineItem[] = [
      runEvent(
        'issue-1',
        'OPS-1',
        'thought',
        '### Operational Plan\n- [x] Inspect current flow\n- [ ] Implement parser\n- [ ] Verify end to end',
      ),
    ]

    const items = extractOperationalPlanItems(timeline, 'issue-1', 'OPS-1', '')

    expect(items).toEqual([
      { text: 'Inspect current flow', done: true },
      { text: 'Implement parser', done: false },
      { text: 'Verify end to end', done: false },
    ])
  })

  it('parses numbered lists when no checkboxes are present', () => {
    const timeline: TimelineItem[] = [
      runEvent(
        'issue-1',
        'OPS-1',
        'turn.message',
        'Plan:\n1. Analyze task details\n2. Implement changes\n3. Run validation',
      ),
    ]

    const items = extractOperationalPlanItems(timeline, 'issue-1', 'OPS-1', '')

    expect(items).toEqual([
      { text: 'Analyze task details', done: false },
      { text: 'Implement changes', done: false },
      { text: 'Run validation', done: false },
    ])
  })

  it('falls back to description list when timeline has no plan', () => {
    const timeline: TimelineItem[] = [runEvent('issue-1', 'OPS-1', 'tool_call', 'using Read tool')]

    const items = extractOperationalPlanItems(
      timeline,
      'issue-1',
      'OPS-1',
      'Task details:\n- review architecture\n- update workflow\n- verify UI',
    )

    expect(items).toEqual([
      { text: 'review architecture', done: false },
      { text: 'update workflow', done: false },
      { text: 'verify UI', done: false },
    ])
  })

  it('ignores plan events from other issues', () => {
    const timeline: TimelineItem[] = [
      runEvent('issue-2', 'OPS-2', 'thought', '- [x] wrong issue item'),
      runEvent('issue-1', 'OPS-1', 'thought', '- [ ] right issue item'),
    ]

    const items = extractOperationalPlanItems(timeline, 'issue-1', 'OPS-1', '')

    expect(items).toEqual([{ text: 'right issue item', done: false }])
  })
})
