import { createRef } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceChatMessage } from '@core/api/client'
import { MessageRail } from './MessageRail'

const messages: WorkspaceChatMessage[] = [
  { id: 'u1', session_id: 'chat', role: 'user', text: 'First question', status: 'accepted', created_at: '' },
  { id: 'a1', session_id: 'chat', role: 'assistant', text: 'First answer', status: 'completed', created_at: '' },
  { id: 'u2', session_id: 'chat', role: 'user', text: 'Second question', status: 'accepted', created_at: '' },
  { id: 'u3', session_id: 'chat', role: 'user', text: 'Third question', status: 'accepted', created_at: '' },
]

describe('MessageRail', () => {
  it('previews a prompt and its reply, then jumps to the selected prompt', () => {
    const ref = createRef<HTMLDivElement>()
    render(<div ref={ref}>
      {messages.map((message, index) => <div key={message.id} data-rail-message-id={message.id} style={{ marginTop: index * 100 }}>{message.text}</div>)}
      <MessageRail messages={messages} timelineRef={ref} />
    </div>)
    const timeline = ref.current!
    Object.defineProperty(timeline, 'clientWidth', { value: 700 })
    Object.defineProperty(timeline, 'clientHeight', { value: 400 })
    timeline.scrollTo = vi.fn()
    fireEvent.scroll(timeline)
    const rail = screen.getByRole('navigation', { name: 'Conversation message navigator' })
    expect(rail).toHaveClass('opacity-0', 'hover:opacity-100', 'focus-within:opacity-100')
    expect(within(rail).queryByText('First answer')).not.toBeInTheDocument()
    const first = screen.getByRole('button', { name: 'Jump to message 1: First question' })
    fireEvent.mouseEnter(first)
    const preview = within(rail).getByText('First answer')
    fireEvent.click(preview)
    expect(timeline.scrollTo).not.toHaveBeenCalled()
    fireEvent.click(first)
    expect(timeline.scrollTo).toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: /Jump to message/ })).toHaveLength(3)
  })

  it('hides when the conversation pane is too narrow', () => {
    const ref = createRef<HTMLDivElement>()
    render(<div ref={ref}><MessageRail messages={messages} timelineRef={ref} /></div>)
    expect(screen.queryByRole('navigation', { name: 'Conversation message navigator' })).not.toBeInTheDocument()
  })
})
