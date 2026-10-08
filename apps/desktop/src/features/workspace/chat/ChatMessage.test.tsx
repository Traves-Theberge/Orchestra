import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatMessage } from './ChatMessage'
import type { WorkspaceChatMessage } from '@core/api/client'

describe('ChatMessage', () => {
  it('renders a user message without html render frame', () => {
    const message: WorkspaceChatMessage = {
      id: 'msg-1',
      session_id: 'session-1',
      role: 'user',
      text: 'Render some insights from the database',
      status: 'completed',
      created_at: new Date().toISOString(),
    }

    render(<ChatMessage message={message} provider="antigravity" projectId="proj-1" />)
    expect(screen.getByText('Render some insights from the database')).toBeDefined()
    expect(screen.getByLabelText('Your message')).toBeDefined()
    expect(screen.queryByTestId('html-render-frame')).toBeNull()
  })

  it('renders an assistant message with an explicit htmlRenders prop', () => {
    const message: WorkspaceChatMessage = {
      id: 'msg-2',
      session_id: 'session-1',
      role: 'assistant',
      text: 'Here is the activity breakdown for the past 4 weeks.',
      status: 'completed',
      created_at: new Date().toISOString(),
    }

    const htmlRender = {
      title: 'Activity Breakdown',
      height: 480,
      html: '<div class="heatmap">Heatmap chart</div>',
    }

    render(
      <ChatMessage
        message={message}
        provider="antigravity"
        projectId="proj-1"
        htmlRenders={[htmlRender]}
      />,
    )

    expect(screen.getByTestId('html-render-frame')).toBeDefined()
    expect(screen.getByTitle('Activity Breakdown')).toBeDefined()
    expect(screen.getByText(/Here is the activity breakdown/i)).toBeDefined()
    // A single render has no variant tabs and no actions without handlers
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Implement' })).toBeNull()
  })

  it('combines tool renders and inline fences into one variant bar without duplicating frames', () => {
    const message: WorkspaceChatMessage = {
      id: 'msg-variants',
      session_id: 'session-1',
      role: 'assistant',
      text: 'Two options.\n\n```orchestra-html\n<!-- title: Inline Option -->\n<div>inline</div>\n```\n\nPick one.',
      status: 'completed',
      created_at: new Date().toISOString(),
    }
    const onImplement = vi.fn()

    render(
      <ChatMessage
        message={message}
        provider="codex"
        projectId="proj-1"
        htmlRenders={[{ title: 'Tool Option', height: 300, html: '<div>tool</div>' }]}
        onImplementVariant={onImplement}
      />,
    )

    expect(screen.getAllByTestId('html-render-frame')).toHaveLength(1)
    expect(screen.getByTitle('Tool Option')).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: 'Variant #2' }))
    expect(screen.getByTitle('Inline Option')).toBeDefined()
    expect(screen.getAllByTestId('html-render-frame')).toHaveLength(1)
    expect(screen.getByText('Two options.')).toBeDefined()
    expect(screen.getByText('Pick one.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Implement' }))
    expect(onImplement).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Inline Option' }))
  })

  it('automatically extracts and renders fenced orchestra-html visualization in assistant message', () => {
    const message: WorkspaceChatMessage = {
      id: 'msg-3',
      session_id: 'session-1',
      role: 'assistant',
      text: `
\`\`\`orchestra-html
<!-- title: Model Usage Shares -->
<div class="chart">Opus 3.5 sent 50% of turns</div>
\`\`\`
The top 10% of installs send 65% of turns.
      `.trim(),
      status: 'completed',
      created_at: new Date().toISOString(),
    }

    render(<ChatMessage message={message} provider="codex" projectId="proj-1" />)

    // The visualization frame is rendered
    expect(screen.getByTestId('html-render-frame')).toBeDefined()
    expect(screen.getByTitle('Model Usage Shares')).toBeDefined()

    // The remaining text is rendered cleanly without the raw ```orchestra-html code fence
    expect(screen.getByText(/The top 10% of installs send 65% of turns/i)).toBeDefined()
    expect(screen.queryByText(/```orchestra-html/i)).toBeNull()
    expect(screen.getAllByTestId('html-render-frame')).toHaveLength(1)
  })

  it('renders matching harness icon for the assistant provider instead of generic sparkles', () => {
    const message: WorkspaceChatMessage = {
      id: 'msg-harness',
      session_id: 'session-1',
      role: 'assistant',
      text: 'Antigravity response',
      status: 'completed',
      created_at: new Date().toISOString(),
    }

    const { container } = render(<ChatMessage message={message} provider="antigravity" projectId="proj-1" />)
    const img = container.querySelector('img[src="./antigravity.png"]')
    expect(img).not.toBeNull()
    expect(screen.getByText('Antigravity')).toBeDefined()
    expect(container.querySelector('.lucide-sparkles')).toBeNull()
  })

  it('renders user message with attached image preview and text', () => {
    const message: WorkspaceChatMessage = {
      id: 'msg-4',
      session_id: 'session-1',
      role: 'user',
      text: 'What is happening in this screenshot?\n\n![screenshot.png](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)',
      status: 'completed',
      created_at: new Date().toISOString(),
    }

    render(<ChatMessage message={message} provider="antigravity" projectId="proj-1" />)

    expect(screen.getByText('What is happening in this screenshot?')).toBeDefined()
    const img = screen.getByRole('img', { name: 'screenshot.png' })
    expect(img).toBeDefined()
    expect(img.getAttribute('src')).toContain('data:image/png;base64')
  })

  it('aligns copy button to the right side of the response', () => {
    const message: WorkspaceChatMessage = {
      id: 'msg-5',
      session_id: 'session-1',
      role: 'assistant',
      text: 'Here is some content to copy',
      status: 'completed',
      created_at: new Date().toISOString(),
    }

    render(<ChatMessage message={message} provider="antigravity" projectId="proj-1" />)
    const copyButton = screen.getByRole('button', { name: 'Copy response' })
    expect(copyButton).toBeDefined()
    expect(copyButton.parentElement?.className).toContain('justify-end')
  })

  it('links URLs in user messages and folds long ones behind Show more', () => {
    const text = 'See https://github.com/obra/superpowers please\n' + Array.from({ length: 14 }, (_, i) => `line ${i}`).join('\n')
    const message: WorkspaceChatMessage = { id: 'u-long', session_id: 's', role: 'user', text, status: 'unknown', created_at: new Date().toISOString() }
    render(<ChatMessage message={message} provider="codex" projectId="p" />)
    expect(screen.getByRole('link', { name: 'https://github.com/obra/superpowers' })).toHaveAttribute('href', 'https://github.com/obra/superpowers')
    expect(screen.queryByText('unknown')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByRole('button', { name: 'Show less' })).toBeDefined()
  })
})
