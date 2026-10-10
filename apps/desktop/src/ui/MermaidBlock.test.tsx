import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const parse = vi.fn()
const renderSvg = vi.fn()
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: (...args: unknown[]) => parse(...args),
    render: (...args: unknown[]) => renderSvg(...args),
  },
}))

import { MermaidBlock } from './MermaidBlock'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width: 900px;" viewBox="0 0 900 200"><g><text>A</text></g></svg>'

describe('MermaidBlock', () => {
  beforeEach(() => {
    parse.mockReset()
    renderSvg.mockReset()
  })

  it('renders a valid diagram at natural width in a scrollable, borderless container with a copy-source button', async () => {
    parse.mockResolvedValue({ diagramType: 'flowchart' })
    renderSvg.mockResolvedValue({ svg: SVG })
    render(<MermaidBlock code={'flowchart LR\n  A --> B'} theme="dark" />)
    await waitFor(() => expect(screen.getByTestId('mermaid-block').dataset.state).toBe('diagram'))
    const svg = screen.getByRole('img', { name: 'Mermaid diagram' }).querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('900')
    expect(svg.style.maxWidth).toBe('none')
    expect(svg.closest('.overflow-x-auto')).not.toBeNull()
    expect(screen.getByTestId('mermaid-block').querySelector('.border')).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy diagram source' })).toBeDefined()
  })

  it('shows readable source (not an error box) while an incomplete block streams', async () => {
    parse.mockResolvedValue(false)
    render(<MermaidBlock code={'flowchart LR\n  A --> '} theme="light" isStreaming />)
    await waitFor(() => expect(parse).toHaveBeenCalled())
    expect(screen.getByTestId('mermaid-block').dataset.state).toBe('source')
    expect(screen.getByText(/flowchart LR/)).toBeDefined()
    expect(screen.queryByText(/render error/i)).toBeNull()
    expect(renderSvg).not.toHaveBeenCalled()
  })

  it('keeps the last good diagram while streaming, then falls back to source if the final text is invalid', async () => {
    parse.mockResolvedValueOnce({ diagramType: 'flowchart' })
    renderSvg.mockResolvedValue({ svg: SVG })
    const { rerender } = render(<MermaidBlock code={'flowchart LR\n  A --> B'} theme="dark" isStreaming />)
    await waitFor(() => expect(screen.getByTestId('mermaid-block').dataset.state).toBe('diagram'))
    parse.mockResolvedValue(false)
    rerender(<MermaidBlock code={'flowchart LR\n  A --> B --> '} theme="dark" isStreaming />)
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('mermaid-block').dataset.state).toBe('diagram')
    rerender(<MermaidBlock code={'flowchart LR\n  A --> B --> '} theme="dark" />)
    await waitFor(() => expect(screen.getByTestId('mermaid-block').dataset.state).toBe('source'))
    expect(screen.getByText(/A --> B -->/)).toBeDefined()
  })

  it('falls back to a normal code block with the source when rendering throws', async () => {
    parse.mockResolvedValue({ diagramType: 'flowchart' })
    renderSvg.mockRejectedValue(new Error('boom'))
    render(<MermaidBlock code={'flowchart LR\n  A --> B'} theme="dark" />)
    await waitFor(() => expect(renderSvg).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('mermaid-block').dataset.state).toBe('source'))
    const code = screen.getByTestId('mermaid-block').querySelector('pre code')!
    expect(code.textContent).toBe('flowchart LR\n  A --> B')
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeDefined()
    expect(screen.queryByText(/render error/i)).toBeNull()
  })
})
