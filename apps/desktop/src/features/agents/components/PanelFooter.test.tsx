import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PanelFooter } from './PanelFooter'

describe('PanelFooter', () => {
  it('disables Save when not dirty', () => {
    render(<PanelFooter dirty={false} saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('enables Save when dirty', () => {
    render(<PanelFooter dirty saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()
  })

  it('hides Discard when not dirty', () => {
    render(<PanelFooter dirty={false} saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.queryByRole('button', { name: /discard/i })).toBeNull()
  })

  it('shows Discard when dirty', () => {
    render(<PanelFooter dirty saving={false} onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument()
  })

  it('calls onSave when clicked', () => {
    const onSave = vi.fn()
    render(<PanelFooter dirty saving={false} onSave={onSave} onDiscard={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('shows saving indicator', () => {
    render(<PanelFooter dirty saving onSave={() => {}} onDiscard={() => {}} />)
    expect(screen.getByText(/saving/i)).toBeInTheDocument()
  })
})
