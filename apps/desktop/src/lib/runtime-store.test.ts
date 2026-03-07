import { describe, expect, it } from 'vitest'
import { appendTimelineEvent, applySnapshotUpdate } from '@/lib/runtime-store'
import { normalizeSnapshotPayload } from '@/lib/orchestra-client'

describe('applySnapshotUpdate', () => {
  it('returns next snapshot when previous is null', () => {
    const next = normalizeSnapshotPayload({
      generated_at: '2026-03-06T00:00:00Z',
      counts: { running: 1, retrying: 0 },
      running: [],
      retrying: [],
      codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_run: 0 },
      rate_limits: null,
    })

    expect(applySnapshotUpdate(null, next)).toBe(next)
  })

  it('returns previous reference when snapshot is idempotent', () => {
    const previous = normalizeSnapshotPayload({
      generated_at: '2026-03-06T00:00:00Z',
      counts: { running: 1, retrying: 0 },
      running: [],
      retrying: [],
      codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_run: 0 },
      rate_limits: null,
    })
    const next = normalizeSnapshotPayload({
      generated_at: '2026-03-06T00:00:00Z',
      counts: { running: 1, retrying: 0 },
      running: [],
      retrying: [],
      codex_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_run: 0 },
      rate_limits: null,
    })

    expect(applySnapshotUpdate(previous, next)).toBe(previous)
  })
})

describe('appendTimelineEvent', () => {
  it('prepends and bounds timeline items', () => {
    const previous = Array.from({ length: 3 }).map((_, index) => ({
      type: `t-${index}`,
      at: `2026-03-06T00:00:0${index}Z`,
      data: { index },
    }))

    const next = {
      type: 'new',
      at: '2026-03-06T00:01:00Z',
      data: { ok: true },
    }

    const updated = appendTimelineEvent(previous, next, 3)
    expect(updated).toHaveLength(3)
    expect(updated[0]).toEqual(next)
  })

  it('skips duplicate head item', () => {
    const head = {
      type: 'run_event',
      at: '2026-03-06T00:00:00Z',
      data: { issue: 'OPS-1' },
    }
    const previous = [head]

    const updated = appendTimelineEvent(previous, { ...head }, 50)
    expect(updated).toBe(previous)
  })
})
