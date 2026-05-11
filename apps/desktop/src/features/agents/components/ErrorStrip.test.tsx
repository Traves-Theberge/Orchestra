import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorStrip } from './ErrorStrip'

describe('ErrorStrip', () => {
  it('renders message', () => {
    render(<ErrorStrip message="save failed" onDismiss={() => {}} />)
    expect(screen.getByText('save failed')).toBeInTheDocument()
  })

  it('returns null when message empty', () => {
    const { container } = render(<ErrorStrip message="" onDismiss={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('calls onDismiss when X clicked', () => {
    const onDismiss = vi.fn()
    render(<ErrorStrip message="x" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
