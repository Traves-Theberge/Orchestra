import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppTooltipProvider } from '@ui/tooltip-wrapper'
import type { WorkspaceChatSession } from '@core/api/client'
import { ConversationMenu } from './ConversationMenu'

const session = (id: string, title: string, updated: string): WorkspaceChatSession => ({ id, project_id: '__orchestrator__', provider: 'CLAUDE', title, status: 'idle', conversation_mode: 'transcript_replay', created_at: updated, updated_at: updated }) as WorkspaceChatSession
afterEach(cleanup)

it('lists conversations newest first, switches and starts a new one', () => {
  const onNew = vi.fn(); const onChoose = vi.fn()
  render(<AppTooltipProvider><ConversationMenu currentId="b" onNew={onNew} onChoose={onChoose} sessions={[session('a', 'Older plan', '2026-10-01T00:00:00Z'), session('b', 'Latest review', '2026-10-06T00:00:00Z')]} /></AppTooltipProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Switch conversation' }))
  const items = screen.getAllByRole('menuitem').map(item => item.textContent)
  expect(items[0]).toContain('New conversation')
  expect(items[1]).toContain('Latest review')
  expect(items[2]).toContain('Older plan')
  fireEvent.click(screen.getByRole('menuitem', { name: /Older plan/ }))
  expect(onChoose).toHaveBeenCalledWith('a')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  expect(onNew).toHaveBeenCalledOnce()
})
