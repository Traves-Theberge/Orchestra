import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HtmlRenderFrame } from './HtmlRenderFrame'

describe('HtmlRenderFrame', () => {
  it('renders an isolated iframe with correct sandbox permissions', () => {
    const htmlRender = {
      title: 'Usage Trends',
      height: 450,
      html: '<div class="chart">450k turns</div>',
    }

    render(<HtmlRenderFrame htmlRender={htmlRender} />)

    const frame = screen.getByTitle('Usage Trends')
    expect(frame).toBeDefined()
    expect(frame.tagName).toBe('IFRAME')

    // Crucial security requirement: must have allow-scripts and allow-forms,
    // and must NOT have allow-same-origin
    const sandbox = frame.getAttribute('sandbox')
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).toContain('allow-forms')
    expect(sandbox).not.toContain('allow-same-origin')

    // srcdoc must be used to avoid Chromium cross-origin blob URL navigation blocks
    const srcDoc = frame.getAttribute('srcdoc')
    expect(srcDoc).toContain('450k turns')
    expect(srcDoc).toContain('id="orchestra-theme"')
  })

  it('opens full-screen modal when maximize button is clicked', () => {
    const htmlRender = {
      title: 'Detailed Breakdown',
      height: 500,
      html: '<h1>Breakdown</h1>',
    }

    render(<HtmlRenderFrame htmlRender={htmlRender} />)

    const maximizeBtn = screen.getByRole('button', { name: /Open Detailed Breakdown in modal/i })
    expect(maximizeBtn).toBeDefined()

    fireEvent.click(maximizeBtn)

    const dialog = screen.getByRole('dialog', { name: /Detailed Breakdown/i })
    expect(dialog).toBeDefined()

    // Test switching tabs to Source
    const sourceTab = screen.getByRole('button', { name: 'Source' })
    fireEvent.click(sourceTab)
    expect(screen.getByText('<h1>Breakdown</h1>')).toBeDefined()

    // Close modal
    const closeBtn = screen.getByRole('button', { name: 'Close' })
    fireEvent.click(closeBtn)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders fallback when no content is available', () => {
    const emptyRender = {
      title: 'Empty',
      height: 200,
    }

    render(<HtmlRenderFrame htmlRender={emptyRender} />)
    expect(screen.getByText(/Unable to load visualization: Empty/i)).toBeDefined()
  })
})
