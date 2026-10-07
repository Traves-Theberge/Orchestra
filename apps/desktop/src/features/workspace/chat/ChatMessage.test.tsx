import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
    expect(screen.getByText('You')).toBeDefined()
    expect(screen.queryByTestId('html-render-frame')).toBeNull()
  })

  it('renders an assistant message with an explicit htmlRender prop', () => {
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
        htmlRender={htmlRender}
      />,
    )

    expect(screen.getByTestId('html-render-frame')).toBeDefined()
    expect(screen.getByTitle('Activity Breakdown')).toBeDefined()
    expect(screen.getByText(/Here is the activity breakdown/i)).toBeDefined()
  })

  it('automatically extracts and renders fenced t3-html visualization in assistant message', () => {
    const message: WorkspaceChatMessage = {
      id: 'msg-3',
      session_id: 'session-1',
      role: 'assistant',
      text: `
\`\`\`t3-html
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

    // The remaining text is rendered cleanly without the raw ```t3-html code fence
    expect(screen.getByText(/The top 10% of installs send 65% of turns/i)).toBeDefined()
    expect(screen.queryByText(/```t3-html/i)).toBeNull()
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
    expect(screen.getByText('antigravity')).toBeDefined()
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
})
