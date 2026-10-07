import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'

describe('MarkdownRenderer with HTML visualizations', () => {
  it('renders standard markdown code blocks normally', () => {
    const content = '```typescript\nconst x = 1\n```'
    render(<MarkdownRenderer content={content} />)
    expect(screen.getByText('typescript')).toBeDefined()
    expect(screen.queryByTestId('html-render-frame')).toBeNull()
  })

  it('renders t3-html fence as an isolated HtmlRenderFrame', () => {
    const content = `
\`\`\`t3-html
<!-- title: Dynamic Chart -->
<div class="metrics">Data Points</div>
\`\`\`
`
    render(<MarkdownRenderer content={content} />)
    expect(screen.getByTestId('html-render-frame')).toBeDefined()
    expect(screen.getByTitle('Dynamic Chart')).toBeDefined()
  })

  it('renders clean borderless streaming placeholder when html fence is still unclosed during streaming', () => {
    const content = `
\`\`\`t3-html
<!-- title: Dynamic Chart -->
<div class="metrics">Data Points in progress...
`
    render(<MarkdownRenderer content={content} isStreaming={true} />)
    expect(screen.getByTestId('html-render-streaming')).toBeDefined()
    expect(screen.getByText('Generating preview…')).toBeDefined()
    expect(screen.queryByTestId('html-render-frame')).toBeNull()
  })
})

