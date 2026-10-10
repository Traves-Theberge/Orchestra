import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { WorkspaceChatMessage } from '@core/api/client'
import { ChatMessage } from './ChatMessage'

const markdownRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('@ui/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => { markdownRenders.count++; return <div>{content}</div> },
}))

const reply: WorkspaceChatMessage = { id: 'a1', session_id: 's', role: 'assistant', text: 'Fixed it', status: 'completed', created_at: '' }

it('does not re-render a message for an equal rewind object, only when the reason changes', () => {
  const handlers = { onEdit: vi.fn(), onRegenerate: vi.fn(), onSwitchVersion: vi.fn() }
  const { rerender } = render(<ChatMessage message={reply} provider="codex" projectId="p" rewind={{ ...handlers }} />)
  const before = markdownRenders.count
  rerender(<ChatMessage message={reply} provider="codex" projectId="p" rewind={{ ...handlers }} />)
  expect(markdownRenders.count).toBe(before)
  rerender(<ChatMessage message={reply} provider="codex" projectId="p" rewind={{ ...handlers, disabledReason: 'Rewinding…' }} />)
  expect(markdownRenders.count).toBe(before + 1)
})
