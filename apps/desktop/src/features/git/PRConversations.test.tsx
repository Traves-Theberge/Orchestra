import { it, expect } from 'vitest'
import { groupReviewComments } from './PRConversations'

it('groups replies with their root, including replies arriving before the root', () => {
  const common = { path: 'a.ts', body: 'comment', html_url: 'https://github.com/o/r/pull/1', created_at: '2026-01-01' }
  expect(groupReviewComments([{ ...common, id: 2, in_reply_to_id: 1 }, { ...common, id: 1 }, { ...common, id: 3 }]).map(group => group.map(comment => comment.id))).toEqual([[1, 2], [3]])
})
