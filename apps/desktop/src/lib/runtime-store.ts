import type { SnapshotPayload } from '@/lib/orchestra-types'
import type { TimelineItem } from '@/components/app-shell/types'

function snapshotFingerprint(snapshot: SnapshotPayload): string {
  return JSON.stringify(snapshot)
}

export function applySnapshotUpdate(previous: SnapshotPayload | null, next: SnapshotPayload): SnapshotPayload {
  if (!previous) {
    return next
  }

  if (snapshotFingerprint(previous) === snapshotFingerprint(next)) {
    return previous
  }

  return next
}

export function appendTimelineEvent(previous: TimelineItem[], next: TimelineItem, maxItems = 50): TimelineItem[] {
  const head = previous[0]
  if (head && head.type === next.type && head.at === next.at && JSON.stringify(head.data) === JSON.stringify(next.data)) {
    return previous
  }

  return [next, ...previous].slice(0, maxItems)
}
