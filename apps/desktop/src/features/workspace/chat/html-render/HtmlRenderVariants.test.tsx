import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HtmlRenderVariants } from './HtmlRenderVariants'

const renders = [
  { title: 'Calm Layout', height: 300, html: '<div>calm</div>' },
  { title: 'Bold Layout', height: 300, html: '<div>bold</div>' },
  { title: 'Dense Layout', height: 300, html: '<div>dense</div>' },
]

describe('HtmlRenderVariants', () => {
  it('switches the shown frame with the variant tabs', () => {
    render(<HtmlRenderVariants renders={renders} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.textContent)).toEqual(['Variant #1', 'Variant #2', 'Variant #3'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByTestId('html-render-frame')).toHaveLength(1)
    expect(screen.getByTitle('Calm Layout').getAttribute('srcdoc')).toContain('<div>calm</div>')

    fireEvent.click(screen.getByRole('tab', { name: 'Variant #3' }))
    expect(screen.getByRole('tab', { name: 'Variant #3' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Variant #1' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getAllByTestId('html-render-frame')).toHaveLength(1)
    expect(screen.queryByTitle('Calm Layout')).toBeNull()
    expect(screen.getByTitle('Dense Layout').getAttribute('srcdoc')).toContain('<div>dense</div>')

    // Without handlers there are no action buttons
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Implement' })).toBeNull()
  })

  it('calls the actions with the selected variant', () => {
    const onRegenerate = vi.fn()
    const onImplement = vi.fn()
    render(<HtmlRenderVariants renders={renders} onRegenerate={onRegenerate} onImplement={onImplement} />)

    fireEvent.click(screen.getByRole('button', { name: 'Implement' }))
    expect(onImplement).toHaveBeenLastCalledWith(0, renders[0])

    fireEvent.click(screen.getByRole('tab', { name: 'Variant #2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Implement' }))
    expect(onRegenerate).toHaveBeenCalledExactlyOnceWith(1, renders[1])
    expect(onImplement).toHaveBeenLastCalledWith(1, renders[1])
  })

  it('shows no tabs for a single render but keeps the actions', () => {
    const onImplement = vi.fn()
    render(<HtmlRenderVariants renders={[renders[0]!]} onRegenerate={vi.fn()} onImplement={onImplement} />)

    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByTitle('Calm Layout')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Implement' }))
    expect(onImplement).toHaveBeenCalledWith(0, renders[0])
  })

  it('disables the actions when asked and renders nothing without renders', () => {
    const onImplement = vi.fn()
    const { container, rerender } = render(
      <HtmlRenderVariants renders={renders} onRegenerate={vi.fn()} onImplement={onImplement} actionsDisabled />,
    )
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Implement' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Implement' }))
    expect(onImplement).not.toHaveBeenCalled()

    rerender(<HtmlRenderVariants renders={[]} onImplement={onImplement} />)
    expect(container.innerHTML).toBe('')
  })
})
