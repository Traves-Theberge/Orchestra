import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UndoRestoreBanner } from './UndoRestoreBanner'

afterEach(() => cleanup())

it('shows the default line with Undo restore and calls it once per click', () => {
  const onUndo = vi.fn()
  render(<UndoRestoreBanner busy={false} error={null} onUndo={onUndo} onDismiss={vi.fn()} />)
  expect(screen.getByRole('status')).toHaveTextContent('Files were restored to before that message.')
  fireEvent.click(screen.getByRole('button', { name: 'Undo restore' }))
  expect(onUndo).toHaveBeenCalledTimes(1)
})

it('shows a provided message and an error', () => {
  render(<UndoRestoreBanner message="The files were restored but the message was not sent." busy={false} error="Undo failed: locked" onUndo={vi.fn()} onDismiss={vi.fn()} />)
  expect(screen.getByRole('status')).toHaveTextContent('The files were restored but the message was not sent.')
  expect(screen.getByText('Undo failed: locked')).toBeDefined()
})

it('disables Undo restore while busy', () => {
  const onUndo = vi.fn()
  render(<UndoRestoreBanner busy error={null} onUndo={onUndo} onDismiss={vi.fn()} />)
  const undo = screen.getByRole('button', { name: 'Undo restore' })
  expect(undo).toBeDisabled()
  fireEvent.click(undo)
  expect(onUndo).not.toHaveBeenCalled()
})

it('dismisses', () => {
  const onDismiss = vi.fn()
  render(<UndoRestoreBanner busy={false} error={null} onUndo={vi.fn()} onDismiss={onDismiss} />)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(onDismiss).toHaveBeenCalledTimes(1)
})
