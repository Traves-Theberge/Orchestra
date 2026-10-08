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

describe('ChatMessage rewind actions', () => {
  const user: WorkspaceChatMessage = { id: 'u1', session_id: 's', role: 'user', text: 'Fix the bug', status: 'completed', created_at: '2026-10-08T10:00:00Z' }
  const reply: WorkspaceChatMessage = { id: 'a1', session_id: 's', role: 'assistant', text: 'Fixed it', status: 'completed', created_at: '2026-10-08T10:00:05Z' }
  const handlers = () => ({ onEdit: vi.fn(), onRegenerate: vi.fn(), onSwitchVersion: vi.fn() })

  it('shows Edit beside Copy on your messages and opens an in-place editor', () => {
    const rewind = handlers()
    render(<ChatMessage message={user} provider="codex" projectId="p" rewind={rewind} />)
    const edit = screen.getByRole('button', { name: 'Edit message' })
    const copy = screen.getByRole('button', { name: 'Copy message' })
    expect(edit.parentElement).toBe(copy.parentElement)
    expect(edit.className).toBe(copy.className)
    fireEvent.click(edit)
    const editor = screen.getByRole('textbox', { name: 'Edit message' })
    expect(editor).toHaveValue('Fix the bug')
    expect(editor).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('submits the edit with Enter, keeps the editor and its text, and keeps Shift+Enter as a newline', () => {
    const rewind = handlers()
    render(<ChatMessage message={user} provider="codex" projectId="p" rewind={rewind} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    const editor = screen.getByRole('textbox', { name: 'Edit message' })
    fireEvent.change(editor, { target: { value: 'Fix the other bug' } })
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })
    expect(rewind.onEdit).not.toHaveBeenCalled()
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(rewind.onEdit).toHaveBeenCalledTimes(1)
    expect(rewind.onEdit).toHaveBeenCalledWith(user, 'Fix the other bug')
    // The text stays until the edit lands (the edited message then replaces this one).
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Fix the other bug')
  })

  it('submits with the Send button and ignores Enter during IME composition', () => {
    const rewind = handlers()
    render(<ChatMessage message={user} provider="codex" projectId="p" rewind={rewind} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    const editor = screen.getByRole('textbox', { name: 'Edit message' })
    fireEvent.change(editor, { target: { value: '修正して' } })
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    expect(rewind.onEdit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(rewind.onEdit).toHaveBeenCalledWith(user, '修正して')
  })

  it('cancels with Escape without bubbling, and disables Send for empty or unchanged text', () => {
    const rewind = handlers()
    const outer = vi.fn()
    render(<div onKeyDown={outer}><ChatMessage message={user} provider="codex" projectId="p" rewind={rewind} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    const editor = screen.getByRole('textbox', { name: 'Edit message' })
    fireEvent.change(editor, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(rewind.onEdit).not.toHaveBeenCalled()
    fireEvent.change(editor, { target: { value: 'Fix the bug' } })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    outer.mockClear()
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(outer).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit message' })).toHaveFocus()
    expect(rewind.onEdit).not.toHaveBeenCalled()
  })

  it('edits only the text of a message with images and keeps the images', () => {
    const rewind = handlers()
    const withImage = { ...user, text: 'Look at this\n\n![shot.png](data:image/png;base64,AAAA)' }
    render(<ChatMessage message={withImage} provider="codex" projectId="p" rewind={rewind} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    const editor = screen.getByRole('textbox', { name: 'Edit message' })
    expect(editor).toHaveValue('Look at this')
    fireEvent.change(editor, { target: { value: 'Look at that' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(rewind.onEdit).toHaveBeenCalledWith(withImage, 'Look at that\n\n![shot.png](data:image/png;base64,AAAA)')
  })

  it('shows Regenerate beside Copy on replies', () => {
    const rewind = handlers()
    render(<ChatMessage message={reply} provider="codex" projectId="p" rewind={rewind} />)
    const regenerate = screen.getByRole('button', { name: 'Regenerate response' })
    const copy = screen.getByRole('button', { name: 'Copy response' })
    expect(regenerate.parentElement).toBe(copy.parentElement)
    expect(regenerate.className).toBe(copy.className)
    fireEvent.click(regenerate)
    expect(rewind.onRegenerate).toHaveBeenCalledWith(reply)
    expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull()
  })

  it('disables Edit, Regenerate and the editor Send with the reason as title', () => {
    const rewind = { ...handlers(), disabledReason: 'Wait for the current turn to finish' }
    const { rerender } = render(<ChatMessage message={user} provider="codex" projectId="p" rewind={rewind} />)
    const edit = screen.getByRole('button', { name: 'Edit message' })
    expect(edit).toBeDisabled()
    expect(edit).toHaveAttribute('title', 'Wait for the current turn to finish')
    rerender(<ChatMessage message={reply} provider="codex" projectId="p" rewind={rewind} />)
    const regenerate = screen.getByRole('button', { name: 'Regenerate response' })
    expect(regenerate).toBeDisabled()
    expect(regenerate).toHaveAttribute('title', 'Wait for the current turn to finish')
    fireEvent.click(regenerate)
    expect(rewind.onRegenerate).not.toHaveBeenCalled()
  })

  it('keeps an open editor but blocks submitting once a reason appears', () => {
    const rewind = handlers()
    const { rerender } = render(<ChatMessage message={user} provider="codex" projectId="p" rewind={rewind} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: 'Changed' } })
    rerender(<ChatMessage message={user} provider="codex" projectId="p" rewind={{ ...rewind, disabledReason: 'Wait for the current turn to finish' }} />)
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute('title', 'Wait for the current turn to finish')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), { key: 'Enter' })
    expect(rewind.onEdit).not.toHaveBeenCalled()
  })

  it('shows no rewind actions without rewind handlers', () => {
    const { rerender } = render(<ChatMessage message={user} provider="codex" projectId="p" />)
    expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull()
    rerender(<ChatMessage message={reply} provider="codex" projectId="p" />)
    expect(screen.queryByRole('button', { name: 'Regenerate response' })).toBeNull()
  })

  it('switches between versions of an edited message', () => {
    const rewind = handlers()
    const versions = [{ branch_id: 'b1', active: false }, { branch_id: 'b2', active: true }, { branch_id: 'b3', active: false }]
    const { rerender } = render(<ChatMessage message={{ ...user, versions }} provider="codex" projectId="p" rewind={rewind} />)
    const switcher = screen.getByRole('group', { name: 'Message version 2 of 3' })
    expect(switcher).toHaveTextContent('2 / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    expect(rewind.onSwitchVersion).toHaveBeenLastCalledWith('b1')
    fireEvent.click(screen.getByRole('button', { name: 'Next version' }))
    expect(rewind.onSwitchVersion).toHaveBeenLastCalledWith('b3')

    rerender(<ChatMessage message={{ ...user, versions: [{ branch_id: 'b1', active: true }, { branch_id: 'b2', active: false }] }} provider="codex" projectId="p" rewind={rewind} />)
    expect(screen.getByRole('group', { name: 'Message version 1 of 2' })).toHaveTextContent('1 / 2')
    expect(screen.getByRole('button', { name: 'Previous version' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next version' })).toBeEnabled()
    rerender(<ChatMessage message={{ ...user, versions: [{ branch_id: 'b1', active: false }, { branch_id: 'b2', active: true }] }} provider="codex" projectId="p" rewind={rewind} />)
    expect(screen.getByRole('button', { name: 'Next version' })).toBeDisabled()
  })

  it('disables the switcher arrows with the reason while rewinding is unavailable', () => {
    const rewind = { ...handlers(), disabledReason: 'Rewinding…' }
    render(<ChatMessage message={{ ...user, versions: [{ branch_id: 'b1', active: true }, { branch_id: 'b2', active: false }] }} provider="codex" projectId="p" rewind={rewind} />)
    expect(screen.getByRole('button', { name: 'Next version' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next version' })).toHaveAttribute('title', 'Rewinding…')
  })

  it('never shows a switcher on replies or with a single version', () => {
    const rewind = handlers()
    const versions = [{ branch_id: 'b1', active: true }, { branch_id: 'b2', active: false }]
    const { rerender } = render(<ChatMessage message={{ ...reply, versions }} provider="codex" projectId="p" rewind={rewind} />)
    expect(screen.queryByRole('group', { name: /Message version/ })).toBeNull()
    rerender(<ChatMessage message={{ ...user, versions: [{ branch_id: 'b1', active: true }] }} provider="codex" projectId="p" rewind={rewind} />)
    expect(screen.queryByRole('group', { name: /Message version/ })).toBeNull()
  })
})
