import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownRenderer } from './MarkdownRenderer'
import { USER_SAMPLE } from './mermaidReflow.fixtures'

const DOC = '<!DOCTYPE html>\n<html>\n<head><title>Signal Chain</title></head>\n<body>\n<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>\n<script>parent.document.title = "pwned"</script>\n</body>\n</html>'

describe('MarkdownRenderer fence variants (every provider, render-time only)', () => {
  it.each([
    ['```mermaid', '```mermaid\nflowchart LR\n  A --> B\n```'],
    ['```Mermaid', '```Mermaid\nflowchart LR\n  A --> B\n```'],
    ['~~~mermaid', '~~~mermaid\nflowchart LR\n  A --> B\n~~~'],
    ['indented 2', '  ```mermaid\n  flowchart LR\n    A --> B\n  ```'],
    ['indented 4', 'Diagram:\n\n    ```mermaid\n    flowchart LR\n      A --> B\n    ```'],
    ['info string', '```mermaid title="flow"\nflowchart LR\n  A --> B\n```'],
    ['CRLF', '```mermaid\r\nflowchart LR\r\n  A --> B\r\n```'],
    ['single-line `', '`flowchart LR A["a"] --> B["b"] B --> C`'],
    ['single-line ```mermaid', '```mermaid flowchart LR A["a"] --> B["b"]```'],
    ['user sample', `Here is the rig:\n\n\`${USER_SAMPLE}\`\n\nThen calibrate.`],
  ])('routes %s to the Mermaid renderer', async (_label, content) => {
    render(<MarkdownRenderer content={content} />)
    const block = await screen.findByTestId('mermaid-block')
    expect(block.closest('p')).toBeNull()
    // In jsdom mermaid cannot lay out, so the block falls back to its source:
    // never blank, never an error box.
    expect(block.textContent).toMatch(/flowchart LR\n/)
    expect(screen.queryByText(/Mermaid render error/i)).toBeNull()
    expect(document.querySelector('code:not(pre code)')?.textContent ?? '').not.toMatch(/^flowchart/)
  })

  it.each([
    ['```html', `\`\`\`html\n${DOC}\n\`\`\``],
    ['```HTML', `\`\`\`HTML\n${DOC}\n\`\`\``],
    ['```htm', `\`\`\`htm\n${DOC}\n\`\`\``],
    ['~~~html', `~~~html\n${DOC}\n~~~`],
    ['info string', `\`\`\`html title="x"\n${DOC}\n\`\`\``],
    ['indented 4', `Page:\n\n${`\`\`\`html\n${DOC}\n\`\`\``.split('\n').map((l) => `    ${l}`).join('\n')}`],
    ['CRLF', `\`\`\`html\r\n${DOC.replace(/\n/g, '\r\n')}\r\n\`\`\``],
    ['bare svg', '```html\n<svg viewBox="0 0 4 4"><circle r="2"/></svg>\n```'],
  ])('previews a full-page %s fence in the sandboxed frame', (_label, content) => {
    render(<MarkdownRenderer content={content} />)
    const block = screen.getByTestId('html-preview-block')
    expect(block.dataset.view).toBe('preview')
    expect(block.closest('pre')).toBeNull()
    expect(screen.getByTestId('html-render-frame')).toBeDefined()
  })

  it.each([
    ['<div>hi</div>'],
    ['<kbd>Ctrl</kbd> + <kbd>C</kbd>'],
    ['<p>Hello <b>world</b></p>'],
  ])('keeps a short html snippet as a normal code block: %s', (snippet) => {
    render(<MarkdownRenderer content={`\`\`\`html\n${snippet}\n\`\`\``} />)
    expect(screen.queryByTestId('html-preview-block')).toBeNull()
    expect(screen.queryByTestId('html-render-frame')).toBeNull()
    expect(screen.getByText('html')).toBeDefined()
  })

  it('toggles between Preview and Code with the copy button on the source', () => {
    render(<MarkdownRenderer content={`\`\`\`html\n${DOC}\n\`\`\``} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }))
    const block = screen.getByTestId('html-preview-block')
    expect(block.dataset.view).toBe('code')
    expect(screen.queryByTestId('html-render-frame')).toBeNull()
    expect(block.querySelector('pre code')?.textContent).toContain('<!DOCTYPE html>')
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeDefined()
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByTestId('html-render-frame')).toBeDefined()
  })

  it('shows Code while the html fence is still streaming, then Preview once it closes', () => {
    const partial = `Building it:\n\n\`\`\`html\n<!DOCTYPE html>\n<html><body><svg viewBox="0 0 10 10"><rect wid`
    const { rerender } = render(<MarkdownRenderer content={partial} isStreaming />)
    const block = screen.getByTestId('html-preview-block')
    expect(block.dataset.view).toBe('code')
    expect(screen.queryByTestId('html-render-frame')).toBeNull()
    expect((screen.getByRole('tab', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<MarkdownRenderer content={`Building it:\n\n\`\`\`html\n${DOC}\n\`\`\`\n\nDone`} isStreaming />)
    expect(screen.getByTestId('html-preview-block').dataset.view).toBe('preview')
    expect(screen.getByTestId('html-render-frame')).toBeDefined()
  })

  it('renders a truncated saved message (no closing fence) as code without breaking the rest', () => {
    render(<MarkdownRenderer content={'Intro paragraph.\n\n```html\n<!DOCTYPE html>\n<html><body><div class="ca'} />)
    expect(screen.getByText('Intro paragraph.')).toBeDefined()
    expect(screen.getByTestId('html-preview-block').dataset.view).toBe('code')
    expect(screen.queryByTestId('html-render-frame')).toBeNull()
  })

  it('renders a truncated orchestra-html fence as code when not streaming', () => {
    render(<MarkdownRenderer content={'```orchestra-html\n<div class="x">par'} />)
    expect(screen.queryByTestId('html-render-frame')).toBeNull()
    expect(screen.getByText(/<div class="x">par/)).toBeDefined()
  })

  it('uses the exact same sandbox as the orchestra-html path: opaque origin, no parent access', () => {
    const { unmount } = render(<MarkdownRenderer content={'```orchestra-html\n<div>x</div>\n```'} />)
    const reference = screen.getByTestId('html-render-frame').querySelector('iframe')!
    const referenceAttrs = { sandbox: reference.getAttribute('sandbox'), allow: reference.getAttribute('allow'), csp: reference.getAttribute('csp') }
    unmount()

    render(<MarkdownRenderer content={`\`\`\`html\n${DOC}\n\`\`\``} />)
    const frame = screen.getByTestId('html-render-frame').querySelector('iframe')!
    expect({ sandbox: frame.getAttribute('sandbox'), allow: frame.getAttribute('allow'), csp: frame.getAttribute('csp') }).toEqual(referenceAttrs)
    const tokens = (frame.getAttribute('sandbox') ?? '').split(/\s+/)
    expect(tokens).toEqual(['allow-scripts', 'allow-forms'])
    // Without allow-same-origin the page runs in an opaque (null) origin, so its
    // script cannot read or write parent.document; it is delivered via srcdoc,
    // never a same-origin URL, and it cannot navigate the top window.
    expect(tokens).not.toContain('allow-same-origin')
    expect(tokens).not.toContain('allow-top-navigation')
    expect(tokens).not.toContain('allow-popups-to-escape-sandbox')
    expect(frame.getAttribute('src')).toBeNull()
    expect(frame.getAttribute('srcdoc')).toContain('parent.document.title')
    expect(document.title).not.toBe('pwned')
  })

  it('leaves inline code and prose with backticks untouched', () => {
    render(<MarkdownRenderer content={'Use `graph TD` and `npm run dev`, e.g. `graph LR A-->B` inline.'} />)
    expect(screen.queryByTestId('mermaid-block')).toBeNull()
    expect(screen.getByText('graph TD').tagName).toBe('CODE')
    expect(screen.getByText('graph LR A-->B').tagName).toBe('CODE')
  })

  it('still renders when mermaid is disabled (as a code block)', async () => {
    render(<MarkdownRenderer content={'```mermaid\nflowchart LR\n  A --> B\n```'} enableMermaid={false} />)
    await waitFor(() => expect(screen.getByText('mermaid')).toBeDefined())
    expect(screen.queryByTestId('mermaid-block')).toBeNull()
  })
})
